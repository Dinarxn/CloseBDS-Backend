import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  normalizeCallStatus,
  toPrismaCallStatus,
} from '../src/modules/voice/voice.types.js';
import type { CallStatus } from '@prisma/client';
import {
  encryptCredential,
  decryptCredential,
  maskApiKey,
  maskTwilioSid,
  maskSecret,
  maskPhoneNumber,
  maskProviderCredentials,
} from '../src/security/credential-vault.js';
import { MockTelephonyAdapter } from '../src/integrations/calling/mock-telephony.adapter.js';
import { MockVoiceAIAdapter } from '../src/integrations/voice-ai/mock-voice-ai.adapter.js';

async function runVoiceSharedContractsTests() {
  console.log('\n--- Starting closeVDS Shared Voice Contracts & Multi-Provider Architecture Tests ---');

  // =========================================================================
  // Test 1: Bidirectional Call Status Normalization
  // =========================================================================
  console.log('Test 1: Bidirectional Call Status Normalization...');

  const prismaToNormalizedCases: Array<[CallStatus, string]> = [
    ['QUEUED', 'queued'],
    ['SAFETY_CHECKING', 'queued'],
    ['APPROVAL_REQUIRED', 'queued'],
    ['APPROVED', 'queued'],
    ['INITIATING', 'initiated'],
    ['RINGING', 'ringing'],
    ['IN_PROGRESS', 'in-progress'],
    ['COMPLETED', 'completed'],
    ['FAILED', 'failed'],
    ['BLOCKED', 'failed'],
    ['BUSY', 'busy'],
    ['NO_ANSWER', 'no-answer'],
    ['VOICEMAIL', 'no-answer'],
    ['CANCELLED', 'canceled'],
    ['OPTED_OUT', 'canceled'],
  ];

  for (const [prismaStatus, expectedNormalized] of prismaToNormalizedCases) {
    const normalized = normalizeCallStatus(prismaStatus);
    assert.equal(
      normalized,
      expectedNormalized,
      `Prisma status ${prismaStatus} must map to normalized status ${expectedNormalized}`
    );
  }

  // Reverse mapping
  assert.equal(toPrismaCallStatus('queued'), 'QUEUED');
  assert.equal(toPrismaCallStatus('initiated'), 'INITIATING');
  assert.equal(toPrismaCallStatus('ringing'), 'RINGING');
  assert.equal(toPrismaCallStatus('in-progress'), 'IN_PROGRESS');
  assert.equal(toPrismaCallStatus('completed'), 'COMPLETED');
  assert.equal(toPrismaCallStatus('failed'), 'FAILED');
  assert.equal(toPrismaCallStatus('busy'), 'BUSY');
  assert.equal(toPrismaCallStatus('no-answer'), 'NO_ANSWER');
  assert.equal(toPrismaCallStatus('canceled'), 'CANCELLED');

  console.log('✓ Bidirectional status normalization verified for all 15 states');

  // =========================================================================
  // Test 2: Server-Side Cryptographic Credential Vault (AES-256-GCM)
  // =========================================================================
  console.log('Test 2: Server-Side Cryptographic Credential Vault (AES-256-GCM)...');

  const rawApiKey = 'test_api_key_sample_vault_raw_string_12345';
  const customSecret = 'production-grade-master-workspace-vault-key-512';

  // 2a. Roundtrip encryption and decryption
  const encrypted = encryptCredential(rawApiKey, customSecret);
  assert.ok(encrypted.ciphertext.length > 0);
  assert.ok(encrypted.iv.length === 24); // 12 bytes = 24 hex characters
  assert.ok(encrypted.tag.length === 32); // 16 bytes = 32 hex characters
  assert.equal(encrypted.algorithm, 'aes-256-gcm');
  assert.equal(encrypted.keyVersion, 1);
  assert.notEqual(encrypted.ciphertext, rawApiKey);

  const decrypted = decryptCredential(encrypted, customSecret);
  assert.equal(decrypted, rawApiKey, 'Decrypted credential must match original plaintext');

  // 2b. Tampered ciphertext must fail authentication
  const tamperedPayload = {
    ...encrypted,
    ciphertext: encrypted.ciphertext.slice(0, -2) + (encrypted.ciphertext.endsWith('00') ? '11' : '00'),
  };
  assert.throws(
    () => {
      decryptCredential(tamperedPayload, customSecret);
    },
    /Unsupported state or unable to authenticate data/,
    'Tampered ciphertext must fail AES-GCM authentication'
  );

  // 2c. Tampered auth tag must fail authentication
  const tamperedTagPayload = {
    ...encrypted,
    tag: encrypted.tag.slice(0, -2) + (encrypted.tag.endsWith('ff') ? '00' : 'ff'),
  };
  assert.throws(
    () => {
      decryptCredential(tamperedTagPayload, customSecret);
    },
    /Unsupported state or unable to authenticate data/,
    'Tampered auth tag must fail authentication'
  );

  console.log('✓ AES-256-GCM authenticated credential encryption and tamper-proofing verified');

  // =========================================================================
  // Test 3: Client-Facing Credential Masking
  // =========================================================================
  console.log('Test 3: Client-Facing Credential Masking...');

  // Twilio Account SID
  assert.equal(maskTwilioSid('AC_test_mock_sample_account_sid_eeff'), 'AC...eeff');
  assert.equal(maskTwilioSid('AC_mock_7766'), 'AC...7766');

  // API Keys (Retell, Vapi)
  assert.equal(maskApiKey('test_live_sample_api_key_abcdef'), 'test_...cdef');
  assert.equal(maskApiKey('key_retell_9876543210'), 'key_...3210');
  assert.equal(maskApiKey('short'), '••••••••');

  // Secrets & Auth Tokens
  assert.equal(maskSecret('super_secret_auth_token_9999'), '••••••••••••9999');

  // Phone Numbers
  assert.equal(maskPhoneNumber('+15125550199'), '+1••••••0199');
  assert.equal(maskPhoneNumber('+442071838750'), '+4••••••8750');

  // Multi-field provider object masking
  const twilioCreds = {
    accountSid: 'AC_test_mock_sample_account_sid_9012',
    authToken: 'secret_token_1234',
    primaryPhoneNumber: '+15125550199',
  };
  const maskedTwilio = maskProviderCredentials('twilio', twilioCreds);
  assert.equal(maskedTwilio.accountSid, 'AC...9012');
  assert.equal(maskedTwilio.authToken, 'secret_...1234');
  assert.equal(maskedTwilio.primaryPhoneNumber, '+1••••••0199');

  console.log('✓ Credential masking guarantees zero secret disclosure');

  // =========================================================================
  // Test 4: Mock Telephony Adapter & Carrier Operations
  // =========================================================================
  console.log('Test 4: Mock Telephony Adapter & Carrier Operations...');

  const telephony = new MockTelephonyAdapter();
  assert.equal(telephony.isConfigured(), true);
  const health = await telephony.healthCheck();
  assert.equal(health.status, 'AVAILABLE');

  // 4a. List & validate numbers
  const numbers = await telephony.listPhoneNumbers();
  assert.ok(numbers.length >= 2);
  const austinLine = numbers.find((n) => n.phoneNumber === '+15125550199');
  assert.ok(austinLine);
  assert.equal(austinLine.capabilities.voice, true);
  assert.equal(austinLine.capabilities.sms, true);
  assert.equal(austinLine.capabilities.tollFree, false);

  // 4b. Import new number without auto-buy
  const imported = await telephony.importPhoneNumber('+15125550999');
  assert.equal(imported.phoneNumber, '+15125550999');
  assert.equal(imported.purchasedWithoutAutoBuy, true);

  // 4c. Toll-Free capability check
  const tollFreeCaps = await telephony.validateCapabilities('+18005550199');
  assert.equal(tollFreeCaps.tollFree, true);
  assert.equal(tollFreeCaps.voice, true);

  // 4d. Cryptographic Webhook signature verification
  const webhookUrl = 'https://api.closevds.com/api/v1/voice/webhooks/twilio';
  const postParams: Record<string, string> = {
    CallSid: 'CA_mock_998877',
    CallStatus: 'completed',
    CallDuration: '72',
  };
  const postBody = new URLSearchParams(postParams).toString();
  const sortedKeys = Object.keys(postParams).sort();
  let baseString = webhookUrl;
  for (const k of sortedKeys) {
    baseString += k + postParams[k];
  }
  const validSig = crypto.createHmac('sha1', 'mock_twilio_webhook_signing_secret_test').update(baseString).digest('base64');

  assert.equal(telephony.verifyWebhookSignature(postBody, validSig, undefined, webhookUrl), true);
  assert.equal(telephony.verifyWebhookSignature(postBody, 'forged_sig', undefined, webhookUrl), false);

  // 4e. Call lifecycle simulation
  const callResult = await telephony.initiateCall({
    callId: 'call_test_mock_1',
    leadId: 'lead_test_1',
    contactId: 'contact_test_1',
    recipientPhone: '+15125550188',
  });
  assert.ok(callResult.providerCallId.startsWith('mock_carrier_call_'));

  const status1 = await telephony.getCallStatus(callResult.providerCallId);
  assert.equal(status1.status, 'IN_PROGRESS');

  await telephony.terminateCall(callResult.providerCallId);
  const status2 = await telephony.getCallStatus(callResult.providerCallId);
  assert.equal(status2.status, 'COMPLETED');

  console.log('✓ Mock Telephony carrier operations, verification, and lifecycle verified');

  // =========================================================================
  // Test 5: Mock Voice AI Adapter (Retell & Vapi Multi-Provider)
  // =========================================================================
  console.log('Test 5: Mock Voice AI Adapter (Retell & Vapi Multi-Provider)...');

  const retellAI = new MockVoiceAIAdapter({ providerId: 'retell' });
  const vapiAI = new MockVoiceAIAdapter({ providerId: 'vapi' });

  // 5a. Model Discovery
  const retellModels = await retellAI.listModels();
  assert.ok(retellModels.some((m) => m.id === 'gpt-4o'));
  assert.ok(retellModels.every((m) => m.provider === 'retell'));

  const vapiModels = await vapiAI.listModels();
  assert.ok(vapiModels.some((m) => m.id === 'vapi-neural-1'));
  assert.ok(vapiModels.every((m) => m.provider === 'vapi'));

  // 5b. Voice Discovery
  const voices = await retellAI.listVoices();
  assert.ok(voices.length >= 3);
  assert.ok(voices.some((v) => v.gender === 'female'));
  assert.ok(voices.some((v) => v.gender === 'male'));

  // 5c. Assistant Synchronization
  const syncResult = await retellAI.syncAssistant({
    name: 'Diagnostic SDR',
    model: 'gpt-4o',
    voice: 'voice_rachel_11labs',
    systemPrompt: 'You are Sarah, healthcare diagnostic SDR',
    firstMessage: 'Hello, this is Sarah',
    provider: 'retell',
  });
  assert.equal(syncResult.status, 'SYNCED');
  assert.ok(syncResult.assistantId.startsWith('mock_asst_retell_'));

  // 5d. Call Dispatch
  const dispatchResult = await retellAI.dispatchCall({
    callId: 'call_lead_123',
    leadId: 'lead_smile_123',
    contactId: 'contact_sarah_1',
    recipientPhone: '+15125550188',
    assistantId: syncResult.assistantId,
  });
  assert.equal(dispatchResult.status, 'initiated');
  assert.equal(dispatchResult.provider, 'retell');

  // 5e. Webhook Signature Verification (HMAC-SHA256)
  const webhookBody = JSON.stringify({ event: 'call_ended', call_id: 'call_lead_123' });
  const validVoiceAISig = crypto
    .createHmac('sha256', 'mock_voice_ai_webhook_signing_secret')
    .update(webhookBody)
    .digest('hex');

  assert.equal(retellAI.verifyWebhookSignature(webhookBody, validVoiceAISig), true);
  assert.equal(retellAI.verifyWebhookSignature(webhookBody, 'invalid_voice_ai_signature'), false);

  // 5f. Transcript & Recording Metadata retrieval
  const transcripts = await retellAI.fetchTranscript('call_lead_123');
  assert.ok(transcripts.length >= 4);
  assert.equal(transcripts[0].speaker, 'agent');
  assert.equal(transcripts[1].speaker, 'lead');

  const recording = await retellAI.fetchRecordingMetadata('call_lead_123');
  assert.equal(recording.callId, 'call_lead_123');
  assert.equal(recording.status, 'AVAILABLE');
  assert.ok(recording.authorizedPlaybackUrl?.includes('storage.closevds.com'));

  console.log('✓ Mock Voice AI multi-provider synchronization, dispatch, and transcripts verified');

  console.log('\n--- All Shared Voice Contracts & Multi-Provider Architecture Tests Passed Successfully ---');
}

runVoiceSharedContractsTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
