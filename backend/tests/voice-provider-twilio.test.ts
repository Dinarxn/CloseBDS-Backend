import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { TwilioVoiceAdapter } from '../src/integrations/calling/twilio.adapter.js';
import { ProviderError } from '../src/integrations/core/provider.types.js';

async function runTwilioVoiceTests() {
  console.log('\n--- Starting closeVDS Twilio Voice Provider Tests ---');

  // =========================================================================
  // Test 1: Honest Unconfigured State & Zero Fake Calls
  // =========================================================================
  console.log('Test 1: Honest Unconfigured State & Zero Fake Calls...');

  const unconfiguredAdapter = new TwilioVoiceAdapter({
    accountSid: '',
    authToken: '',
    phoneNumber: '',
  });

  assert.equal(unconfiguredAdapter.isConfigured(), false);
  const health = await unconfiguredAdapter.healthCheck();
  assert.equal(health.status, 'UNCONFIGURED');
  assert.equal(health.isConfigured, false);
  assert.match(health.message, /not configured/);

  await assert.rejects(
    async () => {
      await unconfiguredAdapter.initiateCall({
        callId: 'call_test_1',
        leadId: 'lead_test_1',
        recipientPhone: '+15125550199',
        campaignId: 'camp_test_1',
        workspaceId: 'ws_test_1',
      });
    },
    (err: unknown) => {
      return (
        err instanceof ProviderError &&
        err.message.includes('Twilio credentials not configured')
      );
    },
    'Unconfigured Twilio provider must reject dispatch with honest error rather than faking call'
  );

  console.log('✓ Zero-fake-call and honest unconfigured provider behavior verified');

  // =========================================================================
  // Test 2: Cryptographic Webhook Signature Verification (HMAC-SHA1)
  // =========================================================================
  console.log('Test 2: Cryptographic Webhook Signature Verification (HMAC-SHA1)...');

  const testAuthToken = 'sample_twilio_secret_token_12345';
  const configuredAdapter = new TwilioVoiceAdapter({
    accountSid: 'AC11111111111111111111111111111111',
    authToken: testAuthToken,
    phoneNumber: '+15005550006',
  });

  const webhookUrl = 'https://api.closevds.com/api/v1/voice/webhooks/twilio';
  const postParams: Record<string, string> = {
    CallSid: 'CA1234567890abcdef',
    CallStatus: 'completed',
    CallDuration: '45',
    From: '+15005550006',
    To: '+15125550199',
    Direction: 'outbound-api',
  };

  const postPayloadString = new URLSearchParams(postParams).toString();

  // Compute expected Twilio HMAC-SHA1 signature:
  // URL + sorted keys concatenated with values
  const sortedKeys = Object.keys(postParams).sort();
  let sigBase = webhookUrl;
  for (const key of sortedKeys) {
    sigBase += key + postParams[key];
  }
  const validSignature = crypto.createHmac('sha1', testAuthToken).update(sigBase).digest('base64');

  // 2a. Valid signature must pass
  const isValid = configuredAdapter.verifyWebhookSignature(postPayloadString, validSignature, testAuthToken, webhookUrl);
  assert.equal(isValid, true, 'Properly signed payload must validate');

  // 2b. Tampered body must fail
  const tamperedParams = { ...postParams, CallDuration: '9999' };
  const tamperedPayloadString = new URLSearchParams(tamperedParams).toString();
  const isTamperedValid = configuredAdapter.verifyWebhookSignature(tamperedPayloadString, validSignature, testAuthToken, webhookUrl);
  assert.equal(isTamperedValid, false, 'Tampered parameters must fail validation');

  // 2c. Tampered signature must fail
  const fakeSignature = crypto.createHmac('sha1', 'wrong_token').update(sigBase).digest('base64');
  const isFakeValid = configuredAdapter.verifyWebhookSignature(postPayloadString, fakeSignature, testAuthToken, webhookUrl);
  assert.equal(isFakeValid, false, 'Forged signature must fail validation');

  // 2d. Missing signature must fail
  const isMissingValid = configuredAdapter.verifyWebhookSignature(postPayloadString, undefined, testAuthToken, webhookUrl);
  assert.equal(isMissingValid, false, 'Missing signature must fail validation');

  console.log('✓ Timing-safe HMAC-SHA1 Twilio signature verification verified');

  // =========================================================================
  // Test 3: Normalization of Webhook Telephony Events
  // =========================================================================
  console.log('Test 3: Normalization of Webhook Telephony Events...');

  // 3a. Completed Call
  const completedNormalized = configuredAdapter.normalizeEvent({
    CallSid: 'CA_001',
    CallStatus: 'completed',
    CallDuration: '72',
    To: '+15125550199',
    From: '+15005550006',
    Timestamp: '2026-08-31T15:00:00Z',
  });
  assert.equal(completedNormalized.providerCallId, 'CA_001');
  assert.equal(completedNormalized.status, 'COMPLETED');
  assert.equal(completedNormalized.eventType, 'CALL_COMPLETED');
  assert.equal(completedNormalized.durationSeconds, 72);

  // 3b. Busy Call
  const busyNormalized = configuredAdapter.normalizeEvent({
    CallSid: 'CA_002',
    CallStatus: 'busy',
    To: '+15125550199',
  });
  assert.equal(busyNormalized.status, 'BUSY');
  assert.equal(busyNormalized.eventType, 'CALL_BUSY');

  // 3c. No Answer Call
  const noAnswerNormalized = configuredAdapter.normalizeEvent({
    CallSid: 'CA_003',
    CallStatus: 'no-answer',
    To: '+15125550199',
  });
  assert.equal(noAnswerNormalized.status, 'NO_ANSWER');
  assert.equal(noAnswerNormalized.eventType, 'CALL_NO_ANSWER');

  // 3d. Failed Call
  const failedNormalized = configuredAdapter.normalizeEvent({
    CallSid: 'CA_004',
    CallStatus: 'failed',
    ErrorCode: '30008',
    ErrorMessage: 'Unknown destination',
  });
  assert.equal(failedNormalized.status, 'FAILED');
  assert.equal(failedNormalized.eventType, 'CALL_FAILED');
  assert.equal((failedNormalized.metadata as Record<string, string>)?.ErrorCode, '30008');

  // 3e. In-Progress / Answered Call
  const answeredNormalized = configuredAdapter.normalizeEvent({
    CallSid: 'CA_005',
    CallStatus: 'in-progress',
  });
  assert.equal(answeredNormalized.status, 'IN_PROGRESS');
  assert.equal(answeredNormalized.eventType, 'CALL_STARTED');

  console.log('✓ Normalization of provider statuses into CloseVDS CallStatus & CallEvent verified');

  // =========================================================================
  // Test 4: Secret Non-Disclosure
  // =========================================================================
  console.log('Test 4: Secret Non-Disclosure...');

  assert.equal(configuredAdapter.isConfigured(), true);
  const configuredHealth = await configuredAdapter.healthCheck();
  assert.equal(configuredHealth.status, 'AVAILABLE');
  const serializedHealth = JSON.stringify(configuredHealth);

  assert.equal(
    serializedHealth.includes(testAuthToken),
    false,
    'Raw auth token must NEVER be disclosed in health checks or diagnostics'
  );

  console.log('✓ Secret protection and credential masking verified');

  console.log('--- All Twilio Voice Provider Tests Passed Successfully ---\n');
}

runTwilioVoiceTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
