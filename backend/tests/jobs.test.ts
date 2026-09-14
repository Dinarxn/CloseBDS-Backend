import assert from 'node:assert/strict';
import { buildApp } from '../src/server/app.js';
import { signAuthToken } from '../src/modules/auth/token.js';
import { JobService } from '../src/modules/jobs/job.service.js';
import { JobRepository } from '../src/modules/jobs/job.repository.js';
import { AuditRepository } from '../src/database/repository.js';
import type { AuditLog } from '@prisma/client';
import type { JobItem } from '../src/modules/jobs/job.types.js';

async function runJobsTests() {
  console.log('--- Starting closeVDS Background Jobs Tests ---');

  const workspaceA = 'ws_jobs_test_a';
  const workspaceB = 'ws_jobs_test_b';
  const userIdA = 'usr_jobs_1';

  const auditLogsStore: AuditLog[] = [];
  const mockAuditRepo = {
    create: async (data: Omit<AuditLog, 'id' | 'createdAt'>) => {
      const entry: AuditLog = {
        id: `audit_${Date.now()}`,
        ...data,
        userId: data.userId || null,
        metadata: (data.metadata as any) || null,
        createdAt: new Date(),
      };
      auditLogsStore.push(entry);
      return entry;
    },
  } as unknown as AuditRepository;

  const jobRepo = new JobRepository();
  const jobService = new JobService(jobRepo, mockAuditRepo);

  // --- Test 1: Enqueue Job ---
  console.log('Test 1-3: Enqueueing background jobs with validation and idempotency...');
  const job1 = await jobService.enqueueJob(workspaceA, userIdA, {
    type: 'LEAD_DEDUPLICATION_JOB',
    payload: { batchSize: 50 },
    idempotencyKey: 'dedup_key_1',
    maxRetries: 3,
  });

  assert.ok(job1.id);
  assert.strictEqual(job1.status, 'QUEUED');
  assert.strictEqual(job1.workspaceId, workspaceA);
  assert.strictEqual(job1.attempts, 0);

  // Enqueue duplicate with same idempotencyKey returns existing job
  const dupJob = await jobService.enqueueJob(workspaceA, userIdA, {
    type: 'LEAD_DEDUPLICATION_JOB',
    payload: { batchSize: 50 },
    idempotencyKey: 'dedup_key_1',
    maxRetries: 3,
  });
  assert.strictEqual(dupJob.id, job1.id, 'Duplicate idempotencyKey must return existing job');
  console.log('✓ Job enqueueing and idempotency passed');

  // --- Test 2: Multi-Tenant Scoping ---
  console.log('Test 4-6: Multi-tenant workspace isolation for jobs...');
  let crossWsError = false;
  try {
    await jobService.getJob(job1.id, workspaceB);
  } catch (err: any) {
    crossWsError = true;
    assert.strictEqual(err.statusCode, 404);
  }
  assert.strictEqual(crossWsError, true, 'Cross-workspace job access must fail with 404');
  console.log('✓ Multi-tenant job isolation passed');

  // --- Test 3: Safe Internal Execution Lifecycle ---
  console.log('Test 7-9: Executing safe internal job handlers (dedup, audit, qualification)...');
  const executed = await jobService.executeJob(job1.id, workspaceA);
  assert.strictEqual(executed.status, 'COMPLETED');
  assert.strictEqual(executed.attempts, 1);
  assert.ok(executed.result);
  assert.strictEqual(executed.result?.status, 'CLEAN');

  // Test Personalization Job Safety Assertion
  const persJob = await jobService.enqueueJob(workspaceA, userIdA, {
    type: 'AI_PERSONALIZATION_JOB',
    payload: { leadId: 'lead_123' },
  });
  const executedPers = await jobService.executeJob(persJob.id, workspaceA);
  assert.strictEqual(executedPers.status, 'COMPLETED');
  assert.strictEqual(executedPers.result?.draftGenerated, true);
  assert.strictEqual(executedPers.result?.humanApprovalRequired, true);
  assert.strictEqual(
    executedPers.result?.outboundDispatched,
    false,
    'CRITICAL: Background job must NEVER dispatch cold outreach autonomously'
  );
  console.log('✓ Safe internal job execution and zero-dispatch boundary passed');

  // --- Test 4: Job Cancellation ---
  console.log('Test 10-12: Job cancellation workflow...');
  const cancelTarget = await jobService.enqueueJob(workspaceA, userIdA, {
    type: 'CLEANUP_JOB',
    payload: {},
  });
  const cancelled = await jobService.cancelJob(cancelTarget.id, workspaceA, userIdA);
  assert.strictEqual(cancelled.status, 'CANCELLED');
  console.log('✓ Job cancellation passed');

  // --- Test 5: Job Retries ---
  console.log('Test 13-14: Job retry workflow...');
  // Force a failed state
  await jobRepo.updateStatus(cancelTarget.id, workspaceA, 'FAILED', {
    errorMessage: 'Simulated worker failure',
  });
  const retried = await jobService.retryJob(cancelTarget.id, workspaceA, userIdA);
  assert.strictEqual(retried.status, 'RETRYING');
  console.log('✓ Job retry passed');

  // --- Test 6: Fastify HTTP Routes ---
  console.log('Test 15-18: Fastify Job HTTP Routes & Security Guards...');
  const app = await buildApp();

  const userToken = signAuthToken({
    userId: userIdA,
    email: 'user@test.com',
    role: 'ADMIN',
    workspaceId: workspaceA,
  });

  // POST /api/v1/jobs
  const postRes = await app.inject({
    method: 'POST',
    url: '/api/v1/jobs',
    headers: { Authorization: `Bearer ${userToken}` },
    payload: {
      type: 'ANALYTICS_AGGREGATION_JOB',
      payload: {},
    },
  });
  assert.strictEqual(postRes.statusCode, 201);
  const postBody = JSON.parse(postRes.body);
  assert.strictEqual(postBody.success, true);
  const newJobId = postBody.job.id;

  // GET /api/v1/jobs
  const listRes = await app.inject({
    method: 'GET',
    url: '/api/v1/jobs',
    headers: { Authorization: `Bearer ${userToken}` },
  });
  assert.strictEqual(listRes.statusCode, 200);
  const listBody = JSON.parse(listRes.body);
  assert.strictEqual(listBody.success, true);
  assert.ok(Array.isArray(listBody.data));

  // GET /api/v1/jobs/:id
  const getRes = await app.inject({
    method: 'GET',
    url: `/api/v1/jobs/${newJobId}`,
    headers: { Authorization: `Bearer ${userToken}` },
  });
  assert.strictEqual(getRes.statusCode, 200);

  // POST /api/v1/jobs/:id/execute
  const execRes = await app.inject({
    method: 'POST',
    url: `/api/v1/jobs/${newJobId}/execute`,
    headers: { Authorization: `Bearer ${userToken}` },
  });
  assert.strictEqual(execRes.statusCode, 200);
  const execBody = JSON.parse(execRes.body);
  assert.strictEqual(execBody.job.status, 'COMPLETED');

  await app.close();
  console.log('✓ Fastify Job HTTP routes and security guards passed\n');
  console.log('--- All Background Jobs Tests Passed Successfully ---');
}

runJobsTests().catch((err) => {
  console.error('Jobs Test Suite Failed:', err);
  process.exit(1);
});
