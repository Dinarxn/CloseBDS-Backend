import assert from 'node:assert/strict';
import { buildApp } from '../src/server/app.js';
import { validateEnv } from '../src/config/env.js';
import { PrismaDatabaseClient, type DatabaseClient } from '../src/database/client.js';
import { CampaignRepository } from '../src/database/repository.js';
import { ForbiddenError } from '../src/core/errors/api-error.js';
import { assertTenantBoundary } from '../src/core/workspace/workspace-context.js';
import type { PrismaClient } from '@prisma/client';

async function runDatabaseTests() {
  console.log('\n--- Starting closeVDS Database Foundation Tests ---');

  // Test 1: Database Environment Validation
  console.log('Test 1: Database environment validation in dev vs production...');
  const devEnv = validateEnv({
    NODE_ENV: 'development',
    PORT: '4000',
  });
  assert.equal(devEnv.DATABASE_URL, undefined, 'DATABASE_URL is optional in development');

  assert.throws(
    () => {
      validateEnv({
        NODE_ENV: 'production',
        PORT: '4000',
      });
    },
    /DATABASE_URL is strictly required when running in production mode/,
    'Production must throw error when DATABASE_URL is missing'
  );
  console.log('✓ Database environment validation passed');

  // Test 2: Database Client Readiness Fallback
  console.log('Test 2: Prisma database client disconnected readiness fallback...');
  const disconnectedClient = new PrismaDatabaseClient(undefined);
  const readiness = await disconnectedClient.healthCheck();
  assert.equal(readiness.ready, false);
  assert.equal(readiness.status, 'disconnected');
  assert.ok(readiness.message.includes('DATABASE_URL is not configured'));
  console.log('✓ Database client readiness fallback passed');

  // Test 3: Fastify App Liveness vs Readiness Endpoints
  console.log('Test 3: Testing /health (liveness) vs /health/ready (readiness)...');
  const app = await buildApp();

  // Liveness check should be 200 OK
  const livenessRes = await app.inject({
    method: 'GET',
    url: '/health',
  });
  assert.equal(livenessRes.statusCode, 200);
  assert.deepEqual(JSON.parse(livenessRes.payload), { status: 'ok' });

  // Readiness check without live DB should return 503 Unready (safe, no secret leakage)
  const readinessRes = await app.inject({
    method: 'GET',
    url: '/health/ready',
  });
  assert.equal(readinessRes.statusCode, 503);
  const readinessBody = JSON.parse(readinessRes.payload);
  assert.equal(readinessBody.status, 'unready');
  assert.equal(readinessBody.database, 'disconnected');
  assert.equal(readinessBody.databaseUrl, undefined, 'Must not leak database URL');
  assert.equal(readinessBody.password, undefined, 'Must not leak passwords');

  // v1 Readiness check
  const v1ReadinessRes = await app.inject({
    method: 'GET',
    url: '/api/v1/health/ready',
  });
  assert.equal(v1ReadinessRes.statusCode, 503);
  console.log('✓ Liveness (200) and Readiness (503) probes function as expected without leaking secrets');

  // Test 4: Repository Multi-Tenant Workspace Isolation Assertion
  console.log('Test 4: Repository multi-tenant workspace isolation assertion...');
  
  // A. Tenant boundary guard unit check
  assert.throws(
    () => {
      assertTenantBoundary('workspace_a', 'workspace_b');
    },
    ForbiddenError,
    'assertTenantBoundary must throw ForbiddenError on cross-tenant access'
  );
  assert.doesNotThrow(() => {
    assertTenantBoundary('workspace_target', 'workspace_target');
  });

  // B. Repository-level isolation check with controlled mock client
  const mockPrisma = {
    campaign: {
      findFirst: async ({ where }: { where: { id: string; workspaceId: string } }) => {
        // Return null if workspaceId doesn't match the campaign's owning workspace
        if (where.workspaceId !== 'workspace_owner') {
          return null;
        }
        return {
          id: 'camp_123',
          workspaceId: 'workspace_owner',
          name: 'Test Dental',
          niche: 'Dental',
          location: 'London',
          targetOffer: 'Audit',
          dailyCap: 50,
          status: 'DRAFT' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
    },
  } as unknown as PrismaClient;

  const mockDbClient: DatabaseClient = {
    connect: async () => {},
    disconnect: async () => {},
    isConnected: () => true,
    healthCheck: async () => ({ ready: true, status: 'connected', message: 'OK' }),
    transaction: async (cb) => cb(mockPrisma),
    getPrismaClient: () => mockPrisma,
  };

  const testCampaignRepo = new CampaignRepository(mockDbClient);

  // Attempting to update status from an unauthorized workspace must throw ForbiddenError
  await assert.rejects(
    async () => {
      await testCampaignRepo.updateStatus('camp_123', 'workspace_intruder', 'ACTIVE');
    },
    ForbiddenError,
    'Must throw ForbiddenError when workspaceId does not own the campaign'
  );
  console.log('✓ Multi-tenant workspace isolation boundary asserted in repositories');

  await app.close();
  console.log('\n--- All Database Foundation Tests Passed Successfully (4/4) ---');
}

runDatabaseTests().catch((err) => {
  console.error('Database Test Suite Failed:', err);
  process.exit(1);
});
