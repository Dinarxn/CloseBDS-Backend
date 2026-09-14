import assert from 'node:assert/strict';
import {
  StandardAIAdapter,
  StandardEmailAdapter,
  StandardDiscoveryAdapter,
  StandardWhatsAppAdapter,
  StandardCallingAdapter,
  ProviderRegistry,
  ProviderError,
} from '../src/integrations/index.js';
import { assertKillSwitchNotActive } from '../src/core/security/security.js';
import { KillSwitchActiveError } from '../src/core/errors/api-error.js';

async function runProviderAdapterTests() {
  console.log('--- Starting closeVDS Provider Adapters & Hardening Tests ---');

  // --- Test 1: Provider Registry Initialization & Capability Reporting ---
  console.log('Test 1-3: Provider registry initialization, capabilities, and secret non-disclosure...');
  const registry = new ProviderRegistry();
  const capabilities = registry.getAllCapabilities();

  assert.ok(Array.isArray(capabilities));
  assert.ok(capabilities.length >= 5, 'Should have registered AI, Email, and Discovery adapters');

  // Verify capabilities do NOT contain secrets
  const capJson = JSON.stringify(capabilities);
  assert.strictEqual(capJson.includes('sk-'), false, 'Capabilities must never contain secret keys');
  assert.strictEqual(capJson.includes('whsec_'), false, 'Capabilities must never contain webhook secrets');

  const healthResults = await registry.checkAllHealth();
  assert.ok(Array.isArray(healthResults));
  assert.ok(healthResults.every((h) => typeof h.isConfigured === 'boolean'));
  console.log('✓ Provider registry capability reporting and secret non-disclosure passed');

  // --- Test 2: AI Adapter Unconfigured / Availability Handling ---
  console.log('Test 4-6: AI Adapter availability and fact-grounded qualification...');
  const unconfiguredAI = new StandardAIAdapter({ apiKey: '' });
  assert.strictEqual(unconfiguredAI.isConfigured(), false);

  let unconfiguredThrown = false;
  try {
    await unconfiguredAI.qualifyLead({
      leadId: 'l1',
      businessName: 'Apex Dental',
      niche: 'Dental Clinic',
      location: 'London',
      campaignCriteria: ['Dental in UK'],
    });
  } catch (err: unknown) {
    unconfiguredThrown = true;
    assert.ok(err instanceof ProviderError);
    assert.strictEqual((err as ProviderError).code, 'PROVIDER_UNAVAILABLE');
  }
  assert.strictEqual(unconfiguredThrown, true, 'Unconfigured AI provider must throw typed ProviderError');

  // Configured AI Adapter Factual Grounding
  const configuredAI = new StandardAIAdapter({ apiKey: 'test-api-key-mock' });
  assert.strictEqual(configuredAI.isConfigured(), true);

  const qualResult = await configuredAI.qualifyLead({
    leadId: 'l1',
    businessName: 'Apex Dental',
    niche: 'Dental Clinic',
    location: 'London',
    websiteUrl: 'https://apexdental.co.uk',
    websiteObservations: ['Modern site', 'No online booking widget'],
    campaignCriteria: ['Dental in UK'],
  });
  assert.ok(qualResult.totalScore >= 0 && qualResult.totalScore <= 100);
  assert.ok(qualResult.reasoningRationale.length > 0);
  assert.strictEqual(typeof qualResult.isQualified, 'boolean');
  console.log('✓ AI Adapter error normalization and fact-grounding passed');

  // --- Test 3: Email Adapter Dispatch-Disabled Safety Lock ---
  console.log('Test 7-9: Email Adapter non-dispatch safety lock and domain verification...');
  const defaultEmail = new StandardEmailAdapter({ apiKey: 're_test_123', dispatchEnabled: false });
  assert.strictEqual(defaultEmail.isConfigured(), true);

  let dispatchBlocked = false;
  try {
    await defaultEmail.sendEmail({
      messageId: 'msg_1',
      workspaceId: 'ws_1',
      campaignId: 'c_1',
      toEmail: 'lead@test.com',
      fromEmail: 'outreach@domain.com',
      fromName: 'Growth Team',
      subject: 'Quick question',
      bodyText: 'Hello',
    });
  } catch (err: unknown) {
    dispatchBlocked = true;
    assert.ok(err instanceof ProviderError);
    assert.strictEqual((err as ProviderError).code, 'DISPATCH_DISABLED');
  }
  assert.strictEqual(dispatchBlocked, true, 'CRITICAL: Email adapter MUST block outbound dispatch by default');

  const domainStatus = await defaultEmail.verifySenderDomain('domain.com');
  assert.strictEqual(domainStatus.domain, 'domain.com');
  assert.strictEqual(domainStatus.spfValid, true);
  assert.strictEqual(domainStatus.isVerified, true);
  console.log('✓ Email Adapter dispatch safety lock and domain verification passed');

  // --- Test 4: Lead Discovery Adapter Normalization ---
  console.log('Test 10-12: Discovery Adapter query bounding and candidate normalization...');
  const discovery = new StandardDiscoveryAdapter({ apiKey: 'serp_test_123' });
  assert.strictEqual(discovery.isConfigured(), true);

  const candidates = await discovery.discoverCandidates({
    niche: 'Cosmetic Dentistry',
    location: 'Manchester',
    limit: 5,
  });
  assert.ok(Array.isArray(candidates));
  assert.strictEqual(candidates.length, 1);

  const normalized = discovery.normalizeCandidate(candidates[0]);
  assert.strictEqual(normalized.businessName, 'Cosmetic Dentistry Practice');
  assert.strictEqual(normalized.domain, 'cosmeticdentistry.co.uk');
  assert.strictEqual(normalized.sourceProvider, 'SerpAPI');
  console.log('✓ Discovery Adapter query bounding and normalization passed');

  // --- Test 5: Global Kill Switch Assertion ---
  console.log('Test 13-14: Global Outreach Kill Switch security assertion...');
  assert.doesNotThrow(() => assertKillSwitchNotActive(false));
  assert.throws(
    () => assertKillSwitchNotActive(true),
    (err: unknown) => err instanceof KillSwitchActiveError
  );
  console.log('✓ Global Kill Switch security assertion passed');

  // --- Test 6: WhatsApp & Calling Safe Dispatch Locks ---
  console.log('Test 15-18: WhatsApp & Calling non-dispatch safety assertions...');
  const whatsapp = new StandardWhatsAppAdapter();
  assert.strictEqual(whatsapp.isConfigured(), false);
  let waBlocked = false;
  try {
    await whatsapp.sendMessage({
      recipientPhoneNumber: '+1234567890',
      templateName: 'intro',
      parameters: {},
    });
  } catch (err: unknown) {
    waBlocked = true;
    assert.ok(err instanceof ProviderError);
    assert.strictEqual((err as ProviderError).code, 'DISPATCH_DISABLED');
  }
  assert.strictEqual(waBlocked, true, 'WhatsApp dispatch MUST be blocked in Phase 2');

  const calling = new StandardCallingAdapter();
  assert.strictEqual(calling.isConfigured(), false);
  let callBlocked = false;
  try {
    await calling.initiateCall({
      leadId: 'l1',
      contactId: 'c1',
      phoneNumber: '+1234567890',
      agentScriptId: 'script1',
      maxDurationSeconds: 60,
    });
  } catch (err: unknown) {
    callBlocked = true;
    assert.ok(err instanceof ProviderError);
    assert.strictEqual((err as ProviderError).code, 'DISPATCH_DISABLED');
  }
  assert.strictEqual(callBlocked, true, 'Calling dispatch MUST be blocked in Phase 2');
  console.log('✓ WhatsApp & Calling non-dispatch safety assertions passed\n');

  console.log('--- All Provider Adapters & Hardening Tests Passed Successfully ---');
}

runProviderAdapterTests().catch((err) => {
  console.error('Provider Adapter Tests Failed:', err);
  process.exit(1);
});
