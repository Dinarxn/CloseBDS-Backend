import assert from 'node:assert/strict';
import { buildApp } from '../src/server/app.js';
import { validateEnv } from '../src/config/env.js';
import {
  assertHumanApprovalGranted,
} from '../src/core/permissions/permission-gates.js';
import {
  assertKillSwitchNotActive,
} from '../src/core/security/security.js';
import {
  assertTenantBoundary,
  assertWorkspaceContext,
} from '../src/core/workspace/workspace-context.js';
import {
  PermissionGatedError,
  KillSwitchActiveError,
  ForbiddenError,
  UnauthorizedError,
} from '../src/core/errors/api-error.js';

async function runTests() {
  console.log('--- Starting closeVDS Backend Foundation Tests ---');

  // Test 1: Environment Validation
  console.log('Test 1: Environment validation defaults & parsing...');
  const parsedEnv = validateEnv({
    NODE_ENV: 'test',
    PORT: '4000',
    HOST: '127.0.0.1',
  });
  assert.equal(parsedEnv.PORT, 4000);
  assert.equal(parsedEnv.NODE_ENV, 'test');
  console.log('✓ Environment validation passed');

  // Test 2: App Build & Fastify Initialization
  console.log('Test 2: Fastify app initialization...');
  const app = await buildApp();
  assert.ok(app, 'Fastify app instance should be created');
  console.log('✓ Fastify app built successfully');

  // Test 3: GET /health
  console.log('Test 3: Checking GET /health endpoint...');
  const healthRes = await app.inject({
    method: 'GET',
    url: '/health',
  });
  assert.equal(healthRes.statusCode, 200, 'Expected 200 OK');
  const healthBody = JSON.parse(healthRes.payload);
  assert.deepEqual(healthBody, { status: 'ok' });
  console.log('✓ GET /health responded with 200 { status: "ok" }');

  // Test 4: GET /api/v1/health
  console.log('Test 4: Checking GET /api/v1/health endpoint...');
  const v1HealthRes = await app.inject({
    method: 'GET',
    url: '/api/v1/health',
  });
  assert.equal(v1HealthRes.statusCode, 200, 'Expected 200 OK');
  const v1HealthBody = JSON.parse(v1HealthRes.payload);
  assert.deepEqual(v1HealthBody, { status: 'ok' });
  console.log('✓ GET /api/v1/health responded with 200 { status: "ok" }');

  // Test 5: Safe Error Response (404)
  console.log('Test 5: Checking 404 error response format...');
  const notFoundRes = await app.inject({
    method: 'GET',
    url: '/non-existent-route',
  });
  assert.equal(notFoundRes.statusCode, 404);
  const notFoundBody = JSON.parse(notFoundRes.payload);
  assert.ok(notFoundBody.error, 'Error payload must be structured');
  assert.ok(notFoundBody.error.message, 'Error message must be present');
  assert.equal(notFoundBody.stack, undefined, 'Stack trace must not leak');
  console.log('✓ Error response is safe and structured');

  // Test 6: Permission Gate Foundation (Human Approval)
  console.log('Test 6: Permission gate human approval assertion...');
  assert.throws(
    () => {
      assertHumanApprovalGranted('GATE_INITIAL_OUTREACH_APPROVAL', false);
    },
    PermissionGatedError,
    'Must throw PermissionGatedError when approval is false'
  );
  assert.doesNotThrow(() => {
    assertHumanApprovalGranted('GATE_INITIAL_OUTREACH_APPROVAL', true);
  });
  console.log('✓ Permission gate human-approval enforcement passed');

  // Test 7: Kill Switch Foundation
  console.log('Test 7: Global kill-switch assertion...');
  assert.throws(
    () => {
      assertKillSwitchNotActive(true);
    },
    KillSwitchActiveError,
    'Must throw KillSwitchActiveError when kill switch is true'
  );
  assert.doesNotThrow(() => {
    assertKillSwitchNotActive(false);
  });
  console.log('✓ Kill-switch assertion passed');

  // Test 8: Workspace Context & Tenant Isolation
  console.log('Test 8: Workspace context & tenant isolation...');
  assert.throws(
    () => {
      assertWorkspaceContext({});
    },
    UnauthorizedError,
    'Must throw UnauthorizedError if workspaceId is missing'
  );
  assert.throws(
    () => {
      assertTenantBoundary('workspace_a', 'workspace_b');
    },
    ForbiddenError,
    'Must throw ForbiddenError on cross-tenant access'
  );
  assert.doesNotThrow(() => {
    assertTenantBoundary('workspace_a', 'workspace_a');
  });
  console.log('✓ Workspace isolation boundary passed');

  await app.close();
  console.log('\n--- All Backend Foundation Tests Passed Successfully (8/8) ---');
}

runTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
