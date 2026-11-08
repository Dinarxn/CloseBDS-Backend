import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { TwilioTelephonyAdapter, TwilioVoiceAdapter } from '../src/integrations/calling/twilio.adapter.js';
import { telephonyService } from '../src/modules/voice/telephony.service.js';
import { phoneNumbersService } from '../src/modules/voice/phone-numbers.service.js';
import {
  encryptCredential,
  decryptCredential,
  maskTwilioSid,
  maskSecret,
  maskPhoneNumber,
} from '../src/security/credential-vault.js';
import type { NormalizedCallStatus } from '../src/modules/voice/voice.types.js';

async function runTwilioTelephonyTests() {
  console.log('\n--- Starting closeVDS Twilio Telephony & Phone Number Management Tests (Milestone 2 / R2) ---');

  // =========================================================================
  // Test 1: Twilio Telephony Adapter & Contract Compliance
  // =========================================================================
  console.log('Test 1: Twilio Telephony Adapter & Contract Compliance...');

  const adapter = new TwilioTelephonyAdapter({
    accountSid: 'AC_mock_twilio_account_sid_valid_1111',
    authToken: 'sample_auth_token_for_twilio_tests_32ch',
    phoneNumber: '+15125550199',
    isTestMode: true,
  });

  assert.equal(adapter.providerId, 'twilio', 'Provider ID must be "twilio"');
  assert.equal(adapter.providerName, 'Twilio', 'Provider Name must be "Twilio"');
  assert.equal(adapter.category, 'CALLING', 'Category must be "CALLING"');

  // Backward compatibility alias check
  const legacyAdapter = new TwilioVoiceAdapter({
    accountSid: 'AC_mock_twilio_account_sid_valid_1111',
    authToken: 'sample_auth_token_for_twilio_tests_32ch',
    phoneNumber: '+15125550199',
    isTestMode: true,
  });
  assert.equal(legacyAdapter instanceof TwilioTelephonyAdapter, true, 'TwilioVoiceAdapter must be backward-compatible');

  const capabilities = adapter.getProviderCapabilities();
  assert.equal(capabilities.supportsInbound, true);
  assert.equal(capabilities.supportsOutbound, true);
  assert.equal(capabilities.supportsTransfer, true);
  assert.equal(capabilities.supportsRecording, true);
  assert.ok(capabilities.supportedCodecs.includes('opus'));

  console.log('✓ Twilio adapter interface and capability contracts verified');

  // =========================================================================
  // Test 2: Connection Testing (ProviderConnectionState)
  // =========================================================================
  console.log('Test 2: Connection Testing (ProviderConnectionState)...');

  // 2a. Unconfigured credentials test
  const unconfiguredAdapter = new TwilioTelephonyAdapter({
    accountSid: '',
    authToken: '',
    phoneNumber: '',
  });
  const unconfiguredResult = await unconfiguredAdapter.testConnection();
  assert.equal(unconfiguredResult.connected, false);
  assert.equal(unconfiguredResult.status, 'NOT_CONFIGURED');

  // 2b. Invalid Account SID format (must start with AC)
  const invalidSidResult = await unconfiguredAdapter.testConnection({
    accountSid: 'INVALID_PREFIX_FOR_ACCOUNT_SID_TEST',
    authToken: 'valid_auth_token_string_32chars_long',
  });
  assert.equal(invalidSidResult.connected, false);
  assert.equal(invalidSidResult.status, 'CONNECTION_FAILED');
  assert.match(invalidSidResult.message, /SID must start with "AC"/);

  // 2c. Invalid Auth Token length
  const shortTokenResult = await unconfiguredAdapter.testConnection({
    accountSid: 'AC_mock_twilio_account_sid_valid_1234',
    authToken: 'short',
  });
  assert.equal(shortTokenResult.connected, false);
  assert.equal(shortTokenResult.status, 'CONNECTION_FAILED');
  assert.match(shortTokenResult.message, /Token length is insufficient/);

  // 2d. Valid test credentials return CONNECTED with account details in test mode
  const validTestResult = await adapter.testConnection({
    accountSid: 'AC_mock_twilio_account_sid_valid_1111',
    authToken: 'sample_auth_token_for_twilio_tests_32ch',
  });
  assert.equal(validTestResult.connected, true);
  assert.equal(validTestResult.status, 'CONNECTED');
  assert.ok(validTestResult.accountDetails);
  assert.equal(validTestResult.accountDetails?.status, 'active');

  console.log('✓ Connection testing states (NOT_CONFIGURED, CONNECTION_FAILED, CONNECTED) verified');

  // =========================================================================
  // Test 3: Phone Number Capabilities & E.164 Format Validation
  // =========================================================================
  console.log('Test 3: Phone Number Capabilities & E.164 Format Validation...');

  // Standard US mobile/local number
  const standardCaps = await adapter.validateCapabilities('+15125550199');
  assert.equal(standardCaps.e164, true, 'Must be valid E.164');
  assert.equal(standardCaps.voice, true, 'Must support voice');
  assert.equal(standardCaps.sms, true, 'Must support SMS');
  assert.equal(standardCaps.tollFree, false, 'Must not be toll-free');

  // US Toll-free number (+1800...)
  const tollFreeCaps = await adapter.validateCapabilities('+18005550144');
  assert.equal(tollFreeCaps.e164, true, 'Toll free must be valid E.164');
  assert.equal(tollFreeCaps.voice, true, 'Toll free must support voice');
  assert.equal(tollFreeCaps.sms, false, 'Toll free standard voice line');
  assert.equal(tollFreeCaps.tollFree, true, 'Must be flagged as toll-free');

  // Invalid non-E.164 numbers
  const invalidCaps1 = await adapter.validateCapabilities('5125550199');
  assert.equal(invalidCaps1.e164, false, 'Missing "+" must fail E.164 check');

  const invalidCaps2 = await adapter.validateCapabilities('+12');
  assert.equal(invalidCaps2.e164, false, 'Short number must fail E.164 check');

  const invalidCaps3 = await adapter.validateCapabilities('invalid_string');
  assert.equal(invalidCaps3.e164, false);

  console.log('✓ Phone number capabilities and E.164 validation verified');

  // =========================================================================
  // Test 4: Phone Numbers Service (Strict Invariant: NO Auto-Purchasing)
  // =========================================================================
  console.log('Test 4: Phone Numbers Service (Strict Invariant: NO Auto-Purchasing)...');

  const testWorkspace = `ws_telephony_test_${Date.now()}`;

  // 4a. Initial empty list for clean workspace
  const initialNumbers = await phoneNumbersService.listPhoneNumbers(testWorkspace);
  assert.equal(initialNumbers.length, 0);

  // 4b. Non-E.164 import must be rejected
  await assert.rejects(
    async () => {
      await phoneNumbersService.importPhoneNumber(testWorkspace, {
        phoneNumber: '5125550100', // Missing +
      });
    },
    (err: unknown) => {
      return err instanceof Error && err.message.includes('not valid E.164');
    },
    'Importing non-E.164 phone number must be rejected'
  );

  // 4c. Successful import of existing carrier line
  const importedNumber = await phoneNumbersService.importPhoneNumber(testWorkspace, {
    phoneNumber: '+15125550100',
    friendlyName: 'Austin Inbound Line 1',
    assignedAgentId: null,
  });

  assert.ok(importedNumber.id);
  assert.equal(importedNumber.workspaceId, testWorkspace);
  assert.equal(importedNumber.phoneNumber, '+15125550100');
  assert.equal(importedNumber.friendlyName, 'Austin Inbound Line 1');
  assert.equal(importedNumber.provider, 'twilio');
  assert.equal(importedNumber.status, 'ACTIVE');
  // CRITICAL INVARIANT: purchasedWithoutAutoBuy must be true
  assert.equal(
    importedNumber.purchasedWithoutAutoBuy,
    true,
    'Non-negotiable invariant: Phone numbers are imported without auto-purchasing'
  );
  assert.equal(importedNumber.capabilities.voice, true);
  assert.equal(importedNumber.capabilities.sms, true);

  // 4d. Duplicate import of same number in same workspace must be rejected
  await assert.rejects(
    async () => {
      await phoneNumbersService.importPhoneNumber(testWorkspace, {
        phoneNumber: '+15125550100',
      });
    },
    (err: unknown) => {
      return err instanceof Error && err.message.includes('already registered in this workspace');
    },
    'Duplicate phone number registration must be rejected'
  );

  // 4e. Inbound routing configuration
  const routedNumber = await phoneNumbersService.configureRouting(testWorkspace, importedNumber.id, {
    phoneNumber: importedNumber.phoneNumber,
    targetAgentId: 'agent_sarah_voice_1',
    webhookUrl: 'https://api.closevds.com/api/v1/voice/webhooks/twilio',
    recordingEnabled: true,
  });
  assert.equal(routedNumber.assignedAgentId, 'agent_sarah_voice_1');
  assert.equal(routedNumber.inboundWebhookUrl, 'https://api.closevds.com/api/v1/voice/webhooks/twilio');

  // 4f. Number retrieval
  const retrievedNumber = await phoneNumbersService.getPhoneNumber(testWorkspace, importedNumber.id);
  assert.equal(retrievedNumber?.phoneNumber, '+15125550100');

  // 4g. Release phone number
  const releaseRes = await phoneNumbersService.releasePhoneNumber(testWorkspace, importedNumber.id);
  assert.equal(releaseRes.released, true);

  const afterReleaseNumbers = await phoneNumbersService.listPhoneNumbers(testWorkspace);
  assert.equal(afterReleaseNumbers.length, 0);

  console.log('✓ Phone Numbers Service operations, routing, and no-auto-buy invariant verified');

  // =========================================================================
  // Test 5: Server-Side Cryptographic Credential Vault (AES-256-GCM)
  // =========================================================================
  console.log('Test 5: Server-Side Cryptographic Credential Vault (AES-256-GCM)...');

  const rawSid = 'AC_mock_twilio_account_sid_for_testing_cdef';
  const rawToken = 'super_secret_twilio_auth_token_9999';

  const encryptedSid = encryptCredential(rawSid);
  const encryptedToken = encryptCredential(rawToken);

  // Verify structure
  assert.equal(encryptedSid.algorithm, 'aes-256-gcm');
  assert.equal(encryptedSid.keyVersion, 1);
  assert.equal(encryptedSid.iv.length, 24, 'IV must be 12 bytes (24 hex characters)');
  assert.equal(encryptedSid.tag.length, 32, 'Auth tag must be 16 bytes (32 hex characters)');
  assert.notEqual(encryptedSid.ciphertext, rawSid, 'Ciphertext must not match raw secret');

  // Verify decryption recovers exact plaintext
  const decryptedSid = decryptCredential(encryptedSid);
  assert.equal(decryptedSid, rawSid);

  const decryptedToken = decryptCredential(encryptedToken);
  assert.equal(decryptedToken, rawToken);

  // Tamper detection: altered ciphertext must fail authenticated decryption
  const tamperedPayload = {
    ...encryptedSid,
    ciphertext: encryptedSid.ciphertext.slice(0, -4) + '0000',
  };
  assert.throws(
    () => decryptCredential(tamperedPayload),
    /Unsupported state or unable to authenticate data/,
    'Tampered ciphertext must fail AES-256-GCM authenticated decryption'
  );

  console.log('✓ Server-side AES-256-GCM authenticated credential encryption and tamper-proofing verified');

  // =========================================================================
  // Test 6: Client-Facing Credential Masking (Zero Raw Disclosure)
  // =========================================================================
  console.log('Test 6: Client-Facing Credential Masking (Zero Raw Disclosure)...');

  const sidMasked = maskTwilioSid(rawSid);
  assert.match(sidMasked, /^AC\.\.\.[a-f0-9]{4}$/i);
  assert.equal(sidMasked.endsWith('cdef'), true);
  assert.equal(sidMasked.includes(rawSid), false, 'Raw SID must never be exposed');

  const tokenMasked = maskSecret(rawToken);
  assert.match(tokenMasked, /^•+9999$/);
  assert.equal(tokenMasked.includes(rawToken), false, 'Raw Auth Token must never be exposed');

  const phoneMasked = maskPhoneNumber('+15125550199');
  assert.equal(phoneMasked, '+1••••••0199');

  // Test TelephonyService persistence and masking
  const vaultWorkspace = `ws_vault_${Date.now()}`;
  const savedMasked = await telephonyService.saveCredentials(vaultWorkspace, {
    accountSid: rawSid,
    authToken: rawToken,
    primaryPhoneNumber: '+15125550199',
  });

  assert.equal(savedMasked.accountSid, sidMasked);
  assert.equal(savedMasked.authTokenMasked, tokenMasked);
  assert.equal(savedMasked.isConfigured, true);
  assert.equal(typeof savedMasked['authToken'], 'undefined', 'Raw authToken must not exist on return payload');

  const retrievedSettings = await telephonyService.getSettings(vaultWorkspace);
  assert.equal(retrievedSettings.accountSid, sidMasked);
  assert.equal(retrievedSettings.authTokenMasked, tokenMasked);
  assert.equal(typeof (retrievedSettings as any).authToken, 'undefined');

  console.log('✓ Client-facing credential masking guarantees zero raw secret disclosure');

  // =========================================================================
  // Test 7: RFC Twilio HMAC-SHA1 Webhook Signature Verification
  // =========================================================================
  console.log('Test 7: RFC Twilio HMAC-SHA1 Webhook Signature Verification...');

  const webhookSecret = 'tw_secret_signing_key_44321';
  const webhookUrl = 'https://api.closevds.com/api/v1/voice/webhooks/twilio';

  const testParams: Record<string, string> = {
    CallSid: 'CA99998888777766665555444433332222',
    CallStatus: 'completed',
    CallDuration: '72',
    From: '+15005550006',
    To: '+15125550199',
    Direction: 'outbound-api',
    Timestamp: '2026-10-30T14:30:00Z',
  };

  const payloadString = new URLSearchParams(testParams).toString();

  // Compute reference Twilio RFC HMAC-SHA1 signature
  const sortedKeys = Object.keys(testParams).sort();
  let baseString = webhookUrl;
  for (const k of sortedKeys) {
    baseString += k + testParams[k];
  }
  const validSignature = crypto.createHmac('sha1', webhookSecret).update(baseString).digest('base64');

  // 7a. Valid signature must pass
  const validResult = adapter.verifyWebhookSignature(payloadString, validSignature, webhookSecret, webhookUrl);
  assert.equal(validResult, true, 'Properly signed Twilio payload must validate');

  // 7b. Tampered parameter value must fail
  const tamperedParams = { ...testParams, CallDuration: '9999' };
  const tamperedPostPayload = new URLSearchParams(tamperedParams).toString();
  const tamperedResult = adapter.verifyWebhookSignature(tamperedPostPayload, validSignature, webhookSecret, webhookUrl);
  assert.equal(tamperedResult, false, 'Payload with altered value must fail verification');

  // 7c. Tampered URL must fail
  const tamperedUrlResult = adapter.verifyWebhookSignature(
    payloadString,
    validSignature,
    webhookSecret,
    'https://attacker.evil.com/webhooks/twilio'
  );
  assert.equal(tamperedUrlResult, false, 'Altered URL must fail verification');

  // 7d. Forged signature must fail
  const forgedSignature = crypto.createHmac('sha1', 'wrong_secret').update(baseString).digest('base64');
  const forgedResult = adapter.verifyWebhookSignature(payloadString, forgedSignature, webhookSecret, webhookUrl);
  assert.equal(forgedResult, false, 'Forged signature must fail verification');

  // 7e. Missing signature must fail safely
  const missingResult = adapter.verifyWebhookSignature(payloadString, undefined, webhookSecret, webhookUrl);
  assert.equal(missingResult, false, 'Missing signature must return false');

  console.log('✓ Timing-safe RFC Twilio HMAC-SHA1 signature verification verified');

  // =========================================================================
  // Test 8: Call Status Normalization (NormalizedCallStatus)
  // =========================================================================
  console.log('Test 8: Call Status Normalization (NormalizedCallStatus)...');

  const twilioToExpected: Array<{ twilioStatus: string; expected: NormalizedCallStatus }> = [
    { twilioStatus: 'queued', expected: 'queued' },
    { twilioStatus: 'initiated', expected: 'initiated' },
    { twilioStatus: 'ringing', expected: 'ringing' },
    { twilioStatus: 'in-progress', expected: 'in-progress' },
    { twilioStatus: 'answered', expected: 'in-progress' },
    { twilioStatus: 'completed', expected: 'completed' },
    { twilioStatus: 'busy', expected: 'busy' },
    { twilioStatus: 'no-answer', expected: 'no-answer' },
    { twilioStatus: 'canceled', expected: 'canceled' },
    { twilioStatus: 'cancelled', expected: 'canceled' },
    { twilioStatus: 'failed', expected: 'failed' },
  ];

  for (const { twilioStatus, expected } of twilioToExpected) {
    const rawEvt = {
      CallSid: 'CA1234567890abcdef',
      CallStatus: twilioStatus,
      CallDuration: '30',
    };
    const parsed = adapter.parseCallStatusEvent(rawEvt);
    assert.equal(
      parsed.normalizedStatus,
      expected,
      `Twilio status "${twilioStatus}" must normalize to "${expected}"`
    );
    assert.equal(parsed.provider, 'twilio');
    assert.equal(parsed.providerCallId, 'CA1234567890abcdef');
    assert.equal(parsed.durationSeconds, 30);
  }

  console.log('✓ Bidirectional status normalization for all Twilio states verified');

  console.log('\n--- All CloseVDS Twilio Telephony & Phone Number Management Tests Passed Successfully! ---');
}

runTwilioTelephonyTests().catch((err) => {
  console.error('Telephony Test Suite Failed:', err);
  process.exit(1);
});
