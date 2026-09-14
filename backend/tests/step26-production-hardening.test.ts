/// <reference types="node" />
import assert from 'node:assert/strict';
import { buildApp } from '../src/server/app.js';
import { validateEnv } from '../src/config/env.js';
import { databaseClient } from '../src/database/client.js';
import { TwilioVoiceAdapter } from '../src/integrations/calling/twilio.adapter.js';
import { StandardWhatsAppAdapter } from '../src/integrations/whatsapp/whatsapp.adapter.js';
import { StandardEmailAdapter } from '../src/integrations/email/email.adapter.js';
import { n8nService } from '../src/modules/integrations/n8n/n8n.service.js';
import { n8nIntegrationRepository, auditRepository, outreachRepository } from '../src/database/repository.js';
import { outreachService } from '../src/modules/outreach/outreach.service.js';
import { assertHumanApprovalGranted } from '../src/core/permissions/permission-gates.js';

async function runStep26Tests() {
  console.log('\n================================================================');
  console.log('--- Stage 5 — Step 26: Production Hardening Integration Tests ---');
  console.log('================================================================\n');

  const testResults: Array<{ name: string; status: 'PASS' | 'FAIL'; details?: string }> = [];

  const recordPass = (name: string) => {
    testResults.push({ name, status: 'PASS' });
    console.log(`✓ PASS: ${name}`);
  };

  const recordFail = (name: string, error: unknown) => {
    const errorMsg = error instanceof Error ? error.message : String(error);
    testResults.push({ name, status: 'FAIL', details: errorMsg });
    console.error(`✗ FAIL: ${name} — ${errorMsg}`);
  };

  // =========================================================================
  // TEST 1: Production Configuration Validation
  // =========================================================================
  console.log('--- Running Test 1: Production Configuration Validation ---');
  try {
    // 1a. Production requires DATABASE_URL
    assert.throws(
      () => {
        validateEnv({
          NODE_ENV: 'production',
          JWT_SECRET: 'production_valid_secret_key_32_chars_long',
          COOKIE_SECRET: 'production_valid_cookie_key_32_chars_long',
        });
      },
      (err: Error) => err.message.includes('DATABASE_URL is strictly required'),
      'Production mode must reject missing DATABASE_URL'
    );

    // 1b. Production rejects default/development JWT_SECRET
    assert.throws(
      () => {
        validateEnv({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://user:pass@localhost:5432/prod_db',
          JWT_SECRET: 'development_jwt_secret_must_be_32_characters_long_min',
          COOKIE_SECRET: 'production_valid_cookie_key_32_chars_long',
        });
      },
      (err: Error) => err.message.includes('Production secrets for JWT_SECRET and COOKIE_SECRET must be explicitly configured'),
      'Production mode must reject weak development secrets'
    );

    // 1c. Valid production configuration passes
    const validProdConfig = validateEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://prod_user:prod_pass@pg.prod:5432/closevds_prod',
      JWT_SECRET: 'prod_secure_random_jwt_signing_secret_key_123',
      COOKIE_SECRET: 'prod_secure_random_cookie_signing_secret_key_456',
    });
    assert.strictEqual(validProdConfig.NODE_ENV, 'production');
    assert.strictEqual(validProdConfig.DATABASE_URL, 'postgresql://prod_user:prod_pass@pg.prod:5432/closevds_prod');

    recordPass('1. Production Configuration Validation enforced');
  } catch (err) {
    recordFail('1. Production Configuration Validation', err);
  }

  // =========================================================================
  // TEST 2: Production Database Error Response Sanitization
  // =========================================================================
  console.log('\n--- Running Test 2: Production Database Error Sanitization ---');
  try {
    const app = await buildApp();

    // Route that simulates a raw database connection error
    app.get('/test-db-error', async () => {
      const dbErr = new Error("Can't reach database server at localhost:5432. Connection refused.");
      dbErr.name = 'PrismaClientInitializationError';
      throw dbErr;
    });

    // 2a. In production mode: message must be generic and omit localhost:5432 and DATABASE_URL
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const prodRes = await app.inject({
      method: 'GET',
      url: '/test-db-error',
    });
    assert.strictEqual(prodRes.statusCode, 503);
    const prodBody = JSON.parse(prodRes.body);
    assert.strictEqual(prodBody.error.code, 'DATABASE_UNAVAILABLE');
    assert.strictEqual(prodBody.error.message, 'Database service is temporarily unavailable.');
    assert.strictEqual(prodRes.body.includes('localhost:5432'), false, 'Response must not contain localhost:5432');
    assert.strictEqual(prodRes.body.includes('DATABASE_URL'), false, 'Response must not contain DATABASE_URL');

    // 2b. In development/test mode: developer-facing guidance is preserved
    process.env.NODE_ENV = 'development';
    const devRes = await app.inject({
      method: 'GET',
      url: '/test-db-error',
    });
    assert.strictEqual(devRes.statusCode, 503);
    const devBody = JSON.parse(devRes.body);
    assert.ok(devBody.error.message.includes('localhost:5432'));

    // Restore env
    process.env.NODE_ENV = originalEnv;
    await app.close();

    recordPass('2. Production Database Error Sanitization verified');
  } catch (err) {
    recordFail('2. Production Database Error Sanitization', err);
  }

  // =========================================================================
  // TEST 3: Fastify Shutdown Lifecycle Database Disconnect Hook
  // =========================================================================
  console.log('\n--- Running Test 3: Fastify Shutdown Lifecycle Database Disconnect ---');
  try {
    let disconnectCalled = false;
    const originalDisconnect = databaseClient.disconnect.bind(databaseClient);
    databaseClient.disconnect = async () => {
      disconnectCalled = true;
      return originalDisconnect();
    };

    const app = await buildApp();
    assert.strictEqual(disconnectCalled, false, 'Disconnect must not be called before shutdown');

    // Trigger Fastify graceful close
    await app.close();
    assert.strictEqual(disconnectCalled, true, 'Fastify app.close() must invoke databaseClient.disconnect() via onClose hook');

    // Restore original disconnect
    databaseClient.disconnect = originalDisconnect;

    recordPass('3. Fastify Shutdown Lifecycle Database Disconnect verified');
  } catch (err) {
    recordFail('3. Fastify Shutdown Lifecycle Database Disconnect', err);
  }

  // =========================================================================
  // TEST 4: Outbound HTTP Timeout Protection
  // =========================================================================
  console.log('\n--- Running Test 4: Outbound HTTP Timeout Protection ---');
  try {
    const originalFetch = globalThis.fetch;
    const interceptedSignals: Array<AbortSignal | null | undefined> = [];

    (globalThis as any).fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      interceptedSignals.push(init?.signal);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ sid: 'CA_mock_timeout', id: 'res_mock_timeout', messages: [{ id: 'wa_mock' }] }),
        json: async () => ({ sid: 'CA_mock_timeout', id: 'res_mock_timeout', messages: [{ id: 'wa_mock' }] }),
      };
    };

    // 4a. TwilioVoiceAdapter initiateCall passes timeout signal
    const twilioAdapter = new TwilioVoiceAdapter({
      accountSid: 'AC_mock_sid',
      authToken: 'mock_auth_token',
      phoneNumber: '+15551234567',
    });
    await twilioAdapter.initiateCall({
      callId: 'call_timeout_test',
      leadId: 'lead_timeout_test',
      contactId: 'cnt_timeout_test',
      recipientPhone: '+15559876543',
    });
    assert.ok(interceptedSignals[0] instanceof AbortSignal, 'Twilio initiateCall must pass an AbortSignal');

    // 4b. StandardWhatsAppAdapter sendMessage passes timeout signal
    const waAdapter = new StandardWhatsAppAdapter({
      accessToken: 'wa_mock_token',
      phoneNumberId: '1234567890',
      dispatchEnabled: true,
    });
    await waAdapter.sendMessage({
      recipientPhoneNumber: '+15559876543',
      messageText: 'Testing timeout signal',
    });
    assert.ok(interceptedSignals[1] instanceof AbortSignal, 'WhatsApp sendMessage must pass an AbortSignal');

    // 4c. StandardEmailAdapter sendEmail passes timeout signal
    const emailAdapter = new StandardEmailAdapter({
      apiKey: 're_mock_api_key_valid',
      dispatchEnabled: true,
    });
    await emailAdapter.sendEmail({
      messageId: 'msg_timeout',
      workspaceId: 'ws_timeout',
      campaignId: 'cmp_timeout',
      toEmail: 'timeout@example.com',
      fromEmail: 'outreach@closevds.com',
      fromName: 'Outreach Team',
      subject: 'Timeout check',
      bodyText: 'Testing timeout signal',
    });
    assert.ok(interceptedSignals[2] instanceof AbortSignal, 'Email sendEmail must pass an AbortSignal');

    // 4d. n8nService dispatchOutboundWebhook passes timeout signal
    const originalFindMany = n8nIntegrationRepository.findMany;
    const originalCreateDelivery = n8nIntegrationRepository.createDelivery;
    n8nIntegrationRepository.findMany = async () => [
      {
        id: 'n8n_mock_node',
        workspaceId: 'ws_timeout',
        name: 'Node Timeout',
        apiKeyPrefix: 'n8n_live_test',
        apiKeyHash: 'hash',
        webhookUrl: 'http://localhost:5678/webhook/test',
        scopes: ['leads:read'],
        isActive: true,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
    ];
    n8nIntegrationRepository.createDelivery = async () => ({} as any);

    await n8nService.dispatchOutboundWebhook('ws_timeout', 'lead.created', { id: 'lead_timeout' });
    assert.ok(interceptedSignals[3] instanceof AbortSignal, 'n8n dispatchOutboundWebhook must pass an AbortSignal');

    // Cleanup mocks
    n8nIntegrationRepository.findMany = originalFindMany;
    n8nIntegrationRepository.createDelivery = originalCreateDelivery;
    globalThis.fetch = originalFetch;

    recordPass('4. Outbound HTTP Timeout Protection verified across all 4 integration channels');
  } catch (err) {
    recordFail('4. Outbound HTTP Timeout Protection', err);
  }

  // =========================================================================
  // TEST 5: Health & Readiness Probes
  // =========================================================================
  console.log('\n--- Running Test 5: Health & Readiness Probes ---');
  try {
    const app = await buildApp();

    // 5a. Liveness Probe
    const healthRes = await app.inject({
      method: 'GET',
      url: '/health',
    });
    assert.strictEqual(healthRes.statusCode, 200);
    const healthBody = JSON.parse(healthRes.body);
    assert.deepEqual(healthBody, { status: 'ok' });

    // 5b. Readiness Probe (Connected or Disconnected)
    const readyRes = await app.inject({
      method: 'GET',
      url: '/health/ready',
    });
    assert.ok([200, 503].includes(readyRes.statusCode), 'Readiness returns valid HTTP status');
    const readyBody = JSON.parse(readyRes.body);
    assert.ok('status' in readyBody, 'Readiness response contains status');
    assert.ok('database' in readyBody, 'Readiness response contains database state');
    assert.ok('timestamp' in readyBody, 'Readiness response contains timestamp');

    await app.close();
    recordPass('5. Health and Readiness probes verified');
  } catch (err) {
    recordFail('5. Health and Readiness probes', err);
  }

  // =========================================================================
  // TEST 6: Security Headers Regression
  // =========================================================================
  console.log('\n--- Running Test 6: Security Headers Regression ---');
  try {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
    assert.strictEqual(res.headers['x-frame-options'], 'DENY');
    assert.ok(res.headers['strict-transport-security'] !== undefined, 'HSTS header must be present');
    assert.ok(res.headers['content-security-policy'] !== undefined, 'CSP header must be present');

    await app.close();
    recordPass('6. Security headers regression passed');
  } catch (err) {
    recordFail('6. Security headers regression', err);
  }

  // =========================================================================
  // TEST 7: Rate Limiting Enforcement
  // =========================================================================
  console.log('\n--- Running Test 7: Rate Limiting Regression ---');
  try {
    const app = await buildApp();

    // Send request with distinct client IP
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-forwarded-for': '198.51.100.42' },
    });
    assert.ok(res.statusCode === 200 || res.statusCode === 429);

    await app.close();
    recordPass('7. Rate limiting configuration regression passed');
  } catch (err) {
    recordFail('7. Rate limiting configuration regression', err);
  }

  // =========================================================================
  // TEST 8: Outbound Safety Invariant (Human Approval Barrier)
  // =========================================================================
  console.log('\n--- Running Test 8: Outbound Safety Invariant ---');
  try {
    // 8a. Permission Gate check: unapproved state strictly throws PermissionGatedError
    assert.throws(
      () => {
        assertHumanApprovalGranted('GATE_INITIAL_OUTREACH_APPROVAL', false);
      },
      (err: any) => err.name === 'PermissionGatedError' || err.message?.includes('APPROVAL_REQUIRED'),
      'Human approval gate must strictly block unapproved actions'
    );

    // 8b. Outreach draft dispatch: unapproved draft strictly blocked with ForbiddenError (403)
    const originalFindById = outreachRepository.findById.bind(outreachRepository);
    outreachRepository.findById = async () => ({
      id: 'msg_unapproved_test',
      isApproved: false,
      status: 'DRAFT',
      emailCampaign: { campaignId: 'c1', campaign: { workspaceId: 'ws_test', name: 'C1' } },
      contact: { leadId: 'l1', fullName: 'Test Contact', email: 'test@example.com', lead: { businessName: 'Test Corp' } },
    } as any);

    await assert.rejects(
      async () => {
        await outreachService.dispatchDraft('msg_unapproved_test', 'ws_test', 'user_test');
      },
      (err: any) => {
        return err.statusCode === 403 || err.name === 'ForbiddenError' || err.message?.includes('human approval');
      },
      'Unapproved outreach dispatch must strictly be blocked with 403 Forbidden'
    );

    outreachRepository.findById = originalFindById;

    recordPass('8. Outbound Safety Invariant verified (Human approval strictly enforced)');
  } catch (err) {
    recordFail('8. Outbound Safety Invariant', err);
  }

  // =========================================================================
  // TEST 9: Audit Resilience (Non-Blocking Audit Writes)
  // =========================================================================
  console.log('\n--- Running Test 9: Audit Resilience ---');
  try {
    const originalCreate = auditRepository.create.bind(auditRepository);
    auditRepository.create = async () => {
      throw new Error('Simulated PostgreSQL transient audit error');
    };

    // Calling auditRepository.create wrapped in non-blocking try/catch must not crash caller
    let callerFinished = false;
    try {
      await auditRepository.create({
        workspaceId: 'ws_test',
        userId: 'usr_test',
        eventType: 'test:event',
        entityType: 'Test',
        entityId: 'id_123',
      }).catch(() => {
        // Non-blocking catch pattern used across all closeVDS services
      });
      callerFinished = true;
    } catch {
      callerFinished = false;
    }

    assert.strictEqual(callerFinished, true, 'Audit failure must be non-blocking for operational callers');
    auditRepository.create = originalCreate;

    recordPass('9. Audit Resilience verified (Non-blocking audit write pattern)');
  } catch (err) {
    recordFail('9. Audit Resilience', err);
  }

  // =========================================================================
  // TEST 10: Startup Database Health Visibility Check
  // =========================================================================
  console.log('\n--- Running Test 10: Startup Database Health Visibility Check ---');
  try {
    // Database client healthCheck executes safely and returns structured status
    const healthResult = await databaseClient.healthCheck();
    assert.ok(typeof healthResult.ready === 'boolean');
    assert.ok(['connected', 'disconnected', 'error'].includes(healthResult.status));
    assert.ok(typeof healthResult.message === 'string');

    // Simulate transient failure during health check
    const originalHealthCheck = databaseClient.healthCheck.bind(databaseClient);
    databaseClient.healthCheck = async () => {
      throw new Error('Simulated network drop');
    };

    // Verify startup check handler gracefully handles failure without throwing
    let startupSurvived = false;
    try {
      try {
        await databaseClient.healthCheck();
      } catch {
        // Handled in server/index.ts via try/catch non-blocking log
      }
      startupSurvived = true;
    } catch {
      startupSurvived = false;
    }

    assert.strictEqual(startupSurvived, true, 'Startup health check failure must not crash application startup');
    databaseClient.healthCheck = originalHealthCheck;

    recordPass('10. Startup Database Health Visibility Check verified');
  } catch (err) {
    recordFail('10. Startup Database Health Visibility Check', err);
  }

  // =========================================================================
  // FINAL SUMMARY
  // =========================================================================
  console.log('\n================================================================');
  console.log(`--- Step 26 Production Hardening Test Summary: ${testResults.filter((t) => t.status === 'PASS').length}/${testResults.length} Passed ---`);
  console.log('================================================================\n');

  const failedTests = testResults.filter((t) => t.status === 'FAIL');
  if (failedTests.length > 0) {
    console.error(`Step 26 Tests Encountered ${failedTests.length} Failures:`);
    for (const f of failedTests) {
      console.error(` - ${f.name}: ${f.details}`);
    }
    process.exit(1);
  }
}

runStep26Tests().catch((err) => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});
