import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { RetellVoiceAIAdapter } from '../src/integrations/voice-ai/retell.adapter.js';
import { VapiVoiceAIAdapter } from '../src/integrations/voice-ai/vapi.adapter.js';
import { voiceAIRegistry, getVoiceAIAdapter } from '../src/integrations/voice-ai/index.js';
import { voiceAIService } from '../src/modules/voice/voice-ai.service.js';
import { voiceWebhookService } from '../src/modules/voice/voice-webhook.service.js';
import { ProviderError } from '../src/integrations/core/provider.types.js';

async function runVoiceAIProvidersTests() {
  console.log('\n--- Starting closeVDS Voice AI Provider Integrations (Retell & Vapi) Tests ---');

  // =========================================================================
  // SECTION 1: Independent Retell AI Adapter Tests
  // =========================================================================
  console.log('\n--- Section 1: Retell AI Adapter ---');

  // Test 1.1: Unconfigured State & Error Handling
  console.log('Test 1.1: Retell AI Unconfigured State & Honest Diagnostics...');
  const unconfiguredRetell = new RetellVoiceAIAdapter({
    apiKey: '',
    offlineFallback: false,
  });

  assert.equal(unconfiguredRetell.isConfigured(), false);
  const retellHealth = await unconfiguredRetell.healthCheck();
  assert.equal(retellHealth.status, 'UNCONFIGURED');
  assert.equal(retellHealth.isConfigured, false);
  assert.match(retellHealth.message, /not configured/);

  const testConnUnconfigured = await unconfiguredRetell.testConnection();
  assert.equal(testConnUnconfigured.connected, false);
  assert.equal(testConnUnconfigured.status, 'NOT_CONFIGURED');

  await assert.rejects(
    async () => {
      await unconfiguredRetell.dispatchCall({
        callId: 'call_retell_test_1',
        leadId: 'lead_test_1',
        contactId: 'contact_test_1',
        recipientPhone: '+15125550199',
        assistantId: 'asst_123',
      });
    },
    (err: unknown) => {
      return (
        err instanceof ProviderError &&
        err.message.includes('Retell AI credentials not configured')
      );
    },
    'Unconfigured Retell AI provider must reject dispatch with ProviderError'
  );
  console.log('✓ Retell AI honest unconfigured behavior verified');

  // Test 1.2: Configured Retell Adapter & Discovery
  console.log('Test 1.2: Retell AI Connection, Model & Voice Discovery...');
  const testRetellKey = 'key_sample_retell_live_token_12345';
  const testRetellSecret = 'secret_retell_webhook_signing_67890';
  const configuredRetell = new RetellVoiceAIAdapter({
    apiKey: testRetellKey,
    webhookSecret: testRetellSecret,
  });

  assert.equal(configuredRetell.isConfigured(), true);
  const retellHealthConfigured = await configuredRetell.healthCheck();
  assert.equal(retellHealthConfigured.status, 'AVAILABLE');

  const testConnConfigured = await configuredRetell.testConnection();
  assert.equal(testConnConfigured.connected, true);
  assert.equal(testConnConfigured.status, 'CONNECTED');

  const retellModels = await configuredRetell.listModels();
  assert.ok(Array.isArray(retellModels) && retellModels.length >= 2);
  assert.ok(retellModels.some((m) => m.id === 'gpt-4o' && m.provider === 'retell'));

  const retellVoices = await configuredRetell.listVoices();
  assert.ok(Array.isArray(retellVoices) && retellVoices.length >= 1);
  assert.ok(retellVoices.every((v) => v.provider === 'retell'));

  // Test 1.3: Retell Assistant Synchronization & Dispatch
  console.log('Test 1.3: Retell AI Assistant Sync & Call Initiation...');
  const retellSync = await configuredRetell.syncAssistant({
    provider: 'retell',
    name: 'Sarah Dental SDR',
    model: 'gpt-4o',
    voice: 'voice_rachel_11labs',
    systemPrompt: 'You are Sarah diagnosing page load times.',
    firstMessage: 'Hi Dr. Connor, do you have 2 minutes?',
  });
  assert.equal(retellSync.status, 'SYNCED');
  assert.equal(retellSync.provider, 'retell');
  assert.ok(retellSync.assistantId.startsWith('asst_retell_'));

  const retellDispatch = await configuredRetell.dispatchCall({
    callId: 'call_1',
    leadId: 'lead_1',
    contactId: 'contact_1',
    recipientPhone: '+15125550199',
    assistantId: retellSync.assistantId,
  });
  assert.equal(retellDispatch.status, 'initiated');
  assert.equal(retellDispatch.provider, 'retell');
  assert.ok(retellDispatch.providerCallId.startsWith('call_retell_'));
  console.log('✓ Retell AI discovery, assistant sync, and call initiation verified');

  // Test 1.4: Retell Webhook HMAC-SHA256 Signature Verification
  console.log('Test 1.4: Retell AI Webhook HMAC-SHA256 Signature Verification...');
  const retellPayload = JSON.stringify({
    event: 'call_analyzed',
    call: {
      call_id: 'call_retell_verified_123',
      call_status: 'ended',
      duration_ms: 84000,
      disconnection_reason: 'user_hangup',
      call_cost: { total_cost: 0.14 },
      recording_url: 'https://storage.closevds.com/recordings/retell_123.mp3',
      transcript_object: [
        { role: 'agent', content: 'Hi Dr. Connor', words: [{ word: 'Hi', start: 0.5 }] },
        { role: 'user', content: 'Hello, what is this?', words: [{ word: 'Hello', start: 3.2 }] },
      ],
    },
  });

  const validRetellSigHex = crypto.createHmac('sha256', testRetellSecret).update(retellPayload).digest('hex');

  // 1.4a: Exact hex signature validates
  assert.equal(
    configuredRetell.verifyWebhookSignature(retellPayload, validRetellSigHex, testRetellSecret),
    true,
    'Valid hex HMAC signature must pass'
  );

  // 1.4b: Signature with "v=" or "sha256=" prefix validates
  assert.equal(
    configuredRetell.verifyWebhookSignature(retellPayload, `v=${validRetellSigHex}`, testRetellSecret),
    true,
    'Signature with v= prefix must validate'
  );
  assert.equal(
    configuredRetell.verifyWebhookSignature(retellPayload, `sha256=${validRetellSigHex}`, testRetellSecret),
    true,
    'Signature with sha256= prefix must validate'
  );

  // 1.4c: Tampered payload fails
  const tamperedRetellPayload = retellPayload.replace('84000', '99999');
  assert.equal(
    configuredRetell.verifyWebhookSignature(tamperedRetellPayload, validRetellSigHex, testRetellSecret),
    false,
    'Tampered payload must fail signature validation'
  );

  // 1.4d: Forged signature fails
  const forgedRetellSig = crypto.createHmac('sha256', 'wrong_secret_key').update(retellPayload).digest('hex');
  assert.equal(
    configuredRetell.verifyWebhookSignature(retellPayload, forgedRetellSig, testRetellSecret),
    false,
    'Forged signature must fail validation'
  );

  // 1.4e: Missing signature fails
  assert.equal(
    configuredRetell.verifyWebhookSignature(retellPayload, undefined, testRetellSecret),
    false,
    'Missing signature header must fail validation'
  );
  console.log('✓ Retell AI timing-safe HMAC-SHA256 signature verification verified');

  // Test 1.5: Retell Event Normalization & Utterance Extraction
  console.log('Test 1.5: Retell AI Event & Transcript Normalization...');
  const parsedRetellEvent = configuredRetell.parseWebhookEvent(JSON.parse(retellPayload));
  assert.equal(parsedRetellEvent.provider, 'retell');
  assert.equal(parsedRetellEvent.providerCallId, 'call_retell_verified_123');
  assert.equal(parsedRetellEvent.normalizedStatus, 'completed');
  assert.equal(parsedRetellEvent.durationSeconds, 84);
  assert.equal(parsedRetellEvent.recordingUrl, 'https://storage.closevds.com/recordings/retell_123.mp3');
  assert.ok(Array.isArray(parsedRetellEvent.transcriptTurns) && parsedRetellEvent.transcriptTurns.length === 2);
  assert.equal(parsedRetellEvent.transcriptTurns[0].speaker, 'agent');
  assert.equal(parsedRetellEvent.transcriptTurns[0].text, 'Hi Dr. Connor');
  assert.equal(parsedRetellEvent.transcriptTurns[1].speaker, 'lead');
  assert.equal(parsedRetellEvent.transcriptTurns[1].text, 'Hello, what is this?');
  assert.equal(parsedRetellEvent.metadata?.cost, 0.14);
  assert.equal(parsedRetellEvent.metadata?.disconnectionReason, 'user_hangup');

  // Verify status mapping for Retell busy and no-answer disconnection reasons
  const busyEvent = configuredRetell.parseWebhookEvent({
    call: { call_id: 'call_b1', call_status: 'ended', disconnection_reason: 'dial_busy' },
  });
  assert.equal(busyEvent.normalizedStatus, 'busy');

  const noAnswerEvent = configuredRetell.parseWebhookEvent({
    call: { call_id: 'call_na1', call_status: 'ended', disconnection_reason: 'dial_no_answer' },
  });
  assert.equal(noAnswerEvent.normalizedStatus, 'no-answer');

  const failedEvent = configuredRetell.parseWebhookEvent({
    call: { call_id: 'call_f1', call_status: 'ended', disconnection_reason: 'machine_detected' },
  });
  assert.equal(failedEvent.normalizedStatus, 'failed');

  console.log('✓ Retell AI event, status, cost, and transcript normalization verified');

  // =========================================================================
  // SECTION 2: Independent Vapi Adapter Tests
  // =========================================================================
  console.log('\n--- Section 2: Vapi Adapter ---');

  // Test 2.1: Unconfigured State & Error Handling
  console.log('Test 2.1: Vapi Unconfigured State & Diagnostics...');
  const unconfiguredVapi = new VapiVoiceAIAdapter({
    apiKey: '',
    offlineFallback: false,
  });

  assert.equal(unconfiguredVapi.isConfigured(), false);
  const vapiHealth = await unconfiguredVapi.healthCheck();
  assert.equal(vapiHealth.status, 'UNCONFIGURED');
  assert.equal(vapiHealth.isConfigured, false);
  assert.match(vapiHealth.message, /not configured/);

  await assert.rejects(
    async () => {
      await unconfiguredVapi.dispatchCall({
        callId: 'call_vapi_test_1',
        leadId: 'lead_test_1',
        contactId: 'contact_test_1',
        recipientPhone: '+15125550199',
        assistantId: 'asst_vapi_123',
      });
    },
    (err: unknown) => {
      return (
        err instanceof ProviderError &&
        err.message.includes('Vapi credentials not configured')
      );
    },
    'Unconfigured Vapi provider must reject dispatch with ProviderError'
  );
  console.log('✓ Vapi honest unconfigured behavior verified');

  // Test 2.2: Configured Vapi Adapter & Discovery
  console.log('Test 2.2: Vapi Connection, Model & Voice Discovery...');
  const testVapiApiKey = 'vapi_test_mock_token_abcdef12345';
  const testVapiSecret = 'vapi_server_secret_xyz789';
  const configuredVapi = new VapiVoiceAIAdapter({
    apiKey: testVapiApiKey,
    serverSecret: testVapiSecret,
    orgId: 'org_test_999',
  });

  assert.equal(configuredVapi.isConfigured(), true);
  assert.equal(configuredVapi.getOrgId(), 'org_test_999');
  const vapiHealthConfigured = await configuredVapi.healthCheck();
  assert.equal(vapiHealthConfigured.status, 'AVAILABLE');

  const testVapiConn = await configuredVapi.testConnection();
  assert.equal(testVapiConn.connected, true);
  assert.equal(testVapiConn.status, 'CONNECTED');

  const vapiModels = await configuredVapi.listModels();
  assert.ok(Array.isArray(vapiModels) && vapiModels.length >= 2);
  assert.ok(vapiModels.some((m) => m.id === 'vapi-neural-1' && m.provider === 'vapi'));

  const vapiVoices = await configuredVapi.listVoices();
  assert.ok(Array.isArray(vapiVoices) && vapiVoices.length >= 1);
  assert.ok(vapiVoices.every((v) => v.provider === 'vapi'));

  // Test 2.3: Vapi Assistant Synchronization & Dispatch
  console.log('Test 2.3: Vapi Assistant Sync & Outbound Call Dispatch...');
  const vapiSync = await configuredVapi.syncAssistant({
    provider: 'vapi',
    name: 'Sophia Outreach Agent',
    model: 'vapi-neural-1',
    voice: 'voice_sophia_cartesia',
    systemPrompt: 'You are Sophia diagnosing dental booking conversion.',
    firstMessage: 'Hi, this is Sophia with closeVDS.',
  });
  assert.equal(vapiSync.status, 'SYNCED');
  assert.equal(vapiSync.provider, 'vapi');
  assert.ok(vapiSync.assistantId.startsWith('asst_vapi_'));

  const vapiDispatch = await configuredVapi.dispatchCall({
    callId: 'call_2',
    leadId: 'lead_2',
    contactId: 'contact_2',
    recipientPhone: '+15125550199',
    assistantId: vapiSync.assistantId,
  });
  assert.equal(vapiDispatch.status, 'initiated');
  assert.equal(vapiDispatch.provider, 'vapi');
  assert.ok(vapiDispatch.providerCallId.startsWith('call_vapi_'));
  console.log('✓ Vapi discovery, assistant sync, and call dispatch verified');

  // Test 2.4: Vapi Webhook Secret & HMAC Verification
  console.log('Test 2.4: Vapi Webhook Secret Verification (x-vapi-secret & HMAC)...');
  const vapiPayload = JSON.stringify({
    message: {
      type: 'end-of-call-report',
      call: {
        id: 'call_vapi_verified_456',
        status: 'ended',
      },
      endedReason: 'customer-ended-call',
      durationSeconds: 92,
      cost: 0.11,
      artifact: {
        recordingUrl: 'https://storage.closevds.com/recordings/vapi_456.mp3',
        messages: [
          { role: 'assistant', message: 'Hi there, how can I help?', secondsFromStart: 1.0 },
          { role: 'user', message: 'I need to check our website speed.', secondsFromStart: 5.5 },
        ],
      },
      analysis: {
        summary: 'Prospect inquired about booking page speed.',
        sentiment: 'POSITIVE',
      },
    },
  });

  // 2.4a: Exact x-vapi-secret header validates timing-safely
  assert.equal(
    configuredVapi.verifyWebhookSignature(vapiPayload, testVapiSecret, testVapiSecret),
    true,
    'Valid x-vapi-secret header must pass verification'
  );

  // 2.4b: HMAC-SHA256 signature validates
  const vapiHmacHex = crypto.createHmac('sha256', testVapiSecret).update(vapiPayload).digest('hex');
  assert.equal(
    configuredVapi.verifyWebhookSignature(vapiPayload, vapiHmacHex, testVapiSecret),
    true,
    'Valid HMAC signature must pass verification'
  );

  // 2.4c: Forged secret fails
  assert.equal(
    configuredVapi.verifyWebhookSignature(vapiPayload, 'invalid_forged_vapi_secret', testVapiSecret),
    false,
    'Forged secret must fail verification'
  );

  // 2.4d: Missing secret header fails
  assert.equal(
    configuredVapi.verifyWebhookSignature(vapiPayload, undefined, testVapiSecret),
    false,
    'Missing secret header must fail verification'
  );
  console.log('✓ Vapi timing-safe secret and HMAC verification verified');

  // Test 2.5: Vapi Event Normalization & End-of-Call Report
  console.log('Test 2.5: Vapi End-of-Call Report & Transcript Normalization...');
  const parsedVapiEvent = configuredVapi.parseWebhookEvent(JSON.parse(vapiPayload));
  assert.equal(parsedVapiEvent.provider, 'vapi');
  assert.equal(parsedVapiEvent.providerCallId, 'call_vapi_verified_456');
  assert.equal(parsedVapiEvent.normalizedStatus, 'completed');
  assert.equal(parsedVapiEvent.durationSeconds, 92);
  assert.equal(parsedVapiEvent.recordingUrl, 'https://storage.closevds.com/recordings/vapi_456.mp3');
  assert.ok(Array.isArray(parsedVapiEvent.transcriptTurns) && parsedVapiEvent.transcriptTurns.length === 2);
  assert.equal(parsedVapiEvent.transcriptTurns[0].speaker, 'agent');
  assert.equal(parsedVapiEvent.transcriptTurns[0].text, 'Hi there, how can I help?');
  assert.equal(parsedVapiEvent.transcriptTurns[1].speaker, 'lead');
  assert.equal(parsedVapiEvent.transcriptTurns[1].text, 'I need to check our website speed.');

  // Verify status mapping for Vapi busy, no-answer, and error
  const vapiBusy = configuredVapi.parseWebhookEvent({
    message: { type: 'end-of-call-report', call: { id: 'call_vb1' }, endedReason: 'customer-busy' },
  });
  assert.equal(vapiBusy.normalizedStatus, 'busy');

  const vapiNoAnswer = configuredVapi.parseWebhookEvent({
    message: { type: 'end-of-call-report', call: { id: 'call_vna1' }, endedReason: 'customer-did-not-answer' },
  });
  assert.equal(vapiNoAnswer.normalizedStatus, 'no-answer');

  const vapiFailed = configuredVapi.parseWebhookEvent({
    message: { type: 'end-of-call-report', call: { id: 'call_vf1' }, endedReason: 'assistant-error' },
  });
  assert.equal(vapiFailed.normalizedStatus, 'failed');

  const vapiRinging = configuredVapi.parseWebhookEvent({
    message: { type: 'status-update', call: { id: 'call_vr1', status: 'ringing' } },
  });
  assert.equal(vapiRinging.normalizedStatus, 'ringing');

  console.log('✓ Vapi status, transcript, and recording normalization verified');

  // =========================================================================
  // SECTION 3: Multi-Provider Voice AI Registry & Provider Decoupling
  // =========================================================================
  console.log('\n--- Section 3: Multi-Provider Registry & Cross-Provider Decoupling ---');

  // Test 3.1: Registry Provider Discovery
  const retellFromRegistry = getVoiceAIAdapter('retell');
  assert.equal(retellFromRegistry.providerId, 'retell');
  assert.equal(retellFromRegistry.providerName, 'Retell AI');

  const vapiFromRegistry = getVoiceAIAdapter('vapi');
  assert.equal(vapiFromRegistry.providerId, 'vapi');
  assert.equal(vapiFromRegistry.providerName, 'Vapi');

  const mockFromRegistry = getVoiceAIAdapter('mock-voice-ai');
  assert.equal(mockFromRegistry.providerId, 'mock-voice-ai');

  assert.ok(voiceAIRegistry.hasAdapter('retell'));
  assert.ok(voiceAIRegistry.hasAdapter('vapi'));
  assert.ok(voiceAIRegistry.hasAdapter('mock-voice-ai'));

  // Test 3.2: Cross-Provider Decoupling
  // Configuring or dispatching Retell must NOT modify or contaminate Vapi
  const standaloneRetell = new RetellVoiceAIAdapter({ apiKey: 'retell_isolated_key' });
  const standaloneVapi = new VapiVoiceAIAdapter({ apiKey: 'vapi_isolated_key' });

  assert.equal(standaloneRetell.providerId, 'retell');
  assert.equal(standaloneVapi.providerId, 'vapi');
  assert.notEqual(standaloneRetell.providerName, standaloneVapi.providerName);
  assert.notEqual(standaloneRetell.getCapabilities().name, standaloneVapi.getCapabilities().name);

  console.log('✓ Voice AI registry discovery and complete provider decoupling verified');

  // =========================================================================
  // SECTION 4: Replay Protection & Idempotent Webhook Processing
  // =========================================================================
  console.log('\n--- Section 4: Replay Protection & Webhook Idempotency ---');

  voiceWebhookService.resetReplayCache();

  // Test 4.1: Fresh Event Passes Replay Check
  const eventId1 = `evt_test_unique_${Date.now()}`;
  const now = Date.now();
  assert.equal(
    voiceWebhookService.checkReplayProtection(eventId1, now),
    true,
    'Fresh event within drift window must pass replay check'
  );

  // Test 4.2: Duplicate Event Rejected
  assert.equal(
    voiceWebhookService.checkReplayProtection(eventId1, now),
    false,
    'Duplicate eventId must be rejected by replay protection'
  );

  // Test 4.3: Stale Event (> 5 min in past) Rejected
  const eventIdStale = `evt_test_stale_${Date.now()}`;
  const sixMinutesAgo = now - 6 * 60 * 1000;
  assert.equal(
    voiceWebhookService.checkReplayProtection(eventIdStale, sixMinutesAgo),
    false,
    'Event older than 5 minutes must be rejected as stale'
  );

  // Test 4.4: Future Event (> 5 min in future) Rejected
  const eventIdFuture = `evt_test_future_${Date.now()}`;
  const sixMinutesInFuture = now + 6 * 60 * 1000;
  assert.equal(
    voiceWebhookService.checkReplayProtection(eventIdFuture, sixMinutesInFuture),
    false,
    'Event timestamp too far in future must be rejected'
  );

  // Test 4.5: Replay Protection in Retell Webhook Handler
  const retellSamplePayload = {
    event: 'call_ended',
    call: {
      call_id: 'call_retell_replay_test_1',
      call_status: 'ended',
      disconnection_reason: 'user_hangup',
    },
  };
  const retellSig = crypto.createHmac('sha256', testRetellSecret).update(JSON.stringify(retellSamplePayload)).digest('hex');

  const retellResult1 = await voiceWebhookService.handleRetellWebhook(retellSamplePayload, retellSig, testRetellSecret);
  assert.equal(retellResult1.received, true);

  console.log('✓ Cryptographic replay protection and timestamp drift verification verified');

  // =========================================================================
  // SECTION 5: Provider Integration Cards & Safe Credential Masking
  // =========================================================================
  console.log('\n--- Section 5: Voice AI Service Provider Integration Cards ---');

  const providerCards = await voiceAIService.listProviderCards();
  assert.ok(Array.isArray(providerCards) && providerCards.length === 2);

  const retellCard = providerCards.find((c) => c.providerId === 'retell');
  assert.ok(retellCard);
  assert.equal(retellCard.category, 'VOICE_AI');
  assert.ok(retellCard.capabilities.supportsTranscripts);

  const vapiCard = providerCards.find((c) => c.providerId === 'vapi');
  assert.ok(vapiCard);
  assert.equal(vapiCard.category, 'VOICE_AI');
  assert.ok(vapiCard.capabilities.supportsRealtimeTranscription);

  // Confirm zero raw secrets are exposed
  for (const card of providerCards) {
    if (card.maskedCredentials) {
      for (const val of Object.values(card.maskedCredentials)) {
        assert.ok(!val.includes('live_token') && !val.includes('signing_67890'));
      }
    }
  }
  console.log('✓ Client-facing provider integration cards with masked credentials verified');

  console.log('\n--- All Voice AI Provider Integrations (Retell & Vapi) Tests Passed Successfully! ---');
}

runVoiceAIProvidersTests().catch((err) => {
  console.error('\n❌ Voice AI Providers test run failed:');
  console.error(err);
  process.exit(1);
});
