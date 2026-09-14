/// <reference types="node" />
import assert from 'node:assert/strict';
import { databaseClient } from '../src/database/client.js';
import { LeadAiService } from '../src/modules/leads/lead-ai.service.js';
import { LeadRepository, AuditRepository, SuppressionRepository } from '../src/database/repository.js';
import { NotFoundError, InternalServerError } from '../src/core/errors/api-error.js';
import type { PrismaClient, Lead, Contact, AuditLog } from '@prisma/client';

async function runLeadAiAuditSafetyTests() {
  console.log('--- Starting Stage 3: Step 17 Audit, Safety & Failure Handling Tests ---');

  const workspaceAlpha = 'ws_alpha_audit_test';
  const workspaceBeta = 'ws_beta_audit_test';
  const leadAlphaId = 'lead_alpha_001';
  const leadSuppressedId = 'lead_suppressed_002';

  const testLeads = new Map<string, Lead>();
  const testContacts = new Map<string, Contact>();
  const auditLogsCreated: Array<{
    workspaceId: string;
    userId?: string;
    eventType: string;
    entityType: string;
    entityId: string;
    metadata?: Record<string, unknown>;
  }> = [];

  const leadAlpha: Lead = {
    id: leadAlphaId,
    workspaceId: workspaceAlpha,
    campaignId: null,
    businessName: 'Apex Dental Care',
    domain: 'apexdental.example.com',
    phone: '+1-555-0199',
    address: '100 Main St, Austin, TX',
    status: 'NEW',
    createdAt: new Date('2026-09-02T09:00:00Z'),
    updatedAt: new Date('2026-09-02T09:00:00Z'),
  };
  testLeads.set(leadAlphaId, { ...leadAlpha });

  const contactAlpha: Contact = {
    id: 'contact_apex_001',
    leadId: leadAlphaId,
    fullName: 'Dr. Sarah Apex',
    email: 'sarah@apexdental.example.com',
    title: 'Owner',
    phone: '+1-555-0199',
    isPrimary: true,
    createdAt: new Date('2026-09-02T09:00:00Z'),
    updatedAt: new Date('2026-09-02T09:00:00Z'),
  };
  testContacts.set(contactAlpha.id, { ...contactAlpha });

  const leadSuppressed: Lead = {
    id: leadSuppressedId,
    workspaceId: workspaceAlpha,
    campaignId: null,
    businessName: 'Suppressed Healthcare',
    domain: 'suppressed.example.com',
    phone: '+1-555-0999',
    address: '200 Oak St, Austin, TX',
    status: 'NEW',
    createdAt: new Date('2026-09-02T09:00:00Z'),
    updatedAt: new Date('2026-09-02T09:00:00Z'),
  };
  testLeads.set(leadSuppressedId, { ...leadSuppressed });

  let mutationCount = 0;
  const mockPrisma = {
    lead: {
      findFirst: async ({ where }: { where: { id?: string; workspaceId?: string } }) => {
        for (const lead of testLeads.values()) {
          const matchId = !where.id || lead.id === where.id;
          const matchWs = !where.workspaceId || lead.workspaceId === where.workspaceId;
          if (matchId && matchWs) {
            const contacts = Array.from(testContacts.values()).filter((c) => c.leadId === lead.id);
            return { ...lead, contacts };
          }
        }
        return null;
      },
      update: async () => {
        mutationCount++;
        throw new Error('Database write violation: Lead AI workflow must be strictly read-only');
      },
      create: async () => {
        mutationCount++;
        throw new Error('Database write violation: Lead AI workflow must be strictly read-only');
      },
    },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(mockPrisma),
  } as unknown as PrismaClient;

  databaseClient.setPrismaClient(mockPrisma);

  const mockLeadRepo = new LeadRepository(databaseClient);

  // Mock AuditRepository
  let shouldAuditThrow = false;
  const mockAuditRepo = {
    create: async (data: any) => {
      if (shouldAuditThrow) {
        throw new Error('Database connection failure during audit log insertion');
      }
      auditLogsCreated.push(data);
      return { id: `audit_${Date.now()}`, ...data, createdAt: new Date() } as AuditLog;
    },
  } as unknown as AuditRepository;

  // Mock SuppressionRepository
  let shouldSuppressionThrow = false;
  const suppressedIdentifiers = new Set(['suppressed.example.com']);
  const mockSuppressionRepo = {
    isSuppressed: async (_workspaceId: string, emailOrPhone: string, domain?: string) => {
      if (shouldSuppressionThrow) {
        throw new Error('Suppression service timeout');
      }
      return (
        suppressedIdentifiers.has(emailOrPhone.toLowerCase().trim()) ||
        Boolean(domain && suppressedIdentifiers.has(domain.toLowerCase().trim()))
      );
    },
  } as unknown as SuppressionRepository;

  // Standard Deterministic Workflow Graph
  const standardWorkflowGraph = {
    invoke: async (input: Record<string, unknown>) => ({
      leadId: input.leadId,
      workspaceId: input.workspaceId,
      status: 'awaiting_approval',
      currentStep: 'human_approval_pending',
      aiResult: {
        summary: 'Target medical practice',
        intent: 'high_fit',
        confidence: 0.94,
      },
      qualification: {
        isQualified: true,
        score: 92,
        reason: 'Meets qualification criteria',
      },
      personalizedMessage: {
        channel: 'EMAIL',
        subject: 'Quick question regarding Apex Dental Care',
        body: 'Hi Dr. Sarah, observed your clinical workflow...',
      },
      qualityCheck: {
        passed: true,
        score: 95,
        reasons: ['No spam triggers', 'Accurate business context'],
      },
      approval: {
        status: 'pending',
      },
    }),
  };

  // ==============================================================================
  // 1. NON-BLOCKING AUDIT LOGGING ON SUCCESS (started & completed)
  // ==============================================================================
  console.log('\n[Test 1] Successful AI workflow records started and completed audit events...');
  auditLogsCreated.length = 0;

  const service = new LeadAiService(
    mockLeadRepo,
    standardWorkflowGraph,
    mockAuditRepo,
    mockSuppressionRepo
  );

  const result = await service.executeLeadAiWorkflow(leadAlphaId, workspaceAlpha, 'user_123');

  assert.strictEqual(result.status, 'awaiting_approval');
  assert.strictEqual(result.currentStep, 'human_approval_pending');
  assert.strictEqual(result.approval?.status, 'pending', 'Approval MUST remain pending');

  assert.strictEqual(auditLogsCreated.length, 2, 'Must create exactly 2 audit logs (started and completed)');
  const [startedLog, completedLog] = auditLogsCreated;

  assert.strictEqual(startedLog.eventType, 'lead_ai_workflow:started');
  assert.strictEqual(startedLog.entityType, 'Lead');
  assert.strictEqual(startedLog.entityId, leadAlphaId);
  assert.strictEqual(startedLog.workspaceId, workspaceAlpha);
  assert.strictEqual(startedLog.userId, 'user_123');
  assert.strictEqual(startedLog.metadata?.suppressionChecked, true);
  assert.strictEqual(startedLog.metadata?.suppressionDetected, false);

  assert.strictEqual(completedLog.eventType, 'lead_ai_workflow:completed');
  assert.strictEqual(completedLog.entityType, 'Lead');
  assert.strictEqual(completedLog.entityId, leadAlphaId);
  assert.strictEqual(completedLog.metadata?.status, 'awaiting_approval');
  assert.strictEqual(completedLog.metadata?.currentStep, 'human_approval_pending');
  assert.strictEqual(completedLog.metadata?.isQualified, true);
  assert.strictEqual(completedLog.metadata?.qualityCheckPassed, true);
  console.log('✓ Successfully recorded started and completed audit logs');

  // ==============================================================================
  // 2. MINIMAL DNC / SUPPRESSION DETECTION IN AUDIT (WITHOUT MUTATING RESPONSE)
  // ==============================================================================
  console.log('\n[Test 2] Suppression detection is recorded in audit metadata without modifying state/response...');
  auditLogsCreated.length = 0;

  const suppressedResult = await service.executeLeadAiWorkflow(leadSuppressedId, workspaceAlpha, 'user_123');

  assert.strictEqual(suppressedResult.status, 'awaiting_approval');
  assert.strictEqual(suppressedResult.approval?.status, 'pending');
  assert.strictEqual(
    (suppressedResult as any).isSuppressed,
    undefined,
    'Service return signature must NOT add suppression fields to clean response'
  );

  assert.strictEqual(auditLogsCreated.length, 2);
  const suppressedStartedLog = auditLogsCreated[0];
  assert.strictEqual(suppressedStartedLog.metadata?.suppressionChecked, true);
  assert.strictEqual(suppressedStartedLog.metadata?.suppressionDetected, true);
  console.log('✓ Suppression awareness recorded in audit metadata while preserving clean API response');

  // ==============================================================================
  // 3. NON-BLOCKING AUDIT RESILIENCE
  // ==============================================================================
  console.log('\n[Test 3] Workflow succeeds even if AuditRepository throws an error...');
  auditLogsCreated.length = 0;
  shouldAuditThrow = true;

  const resilientResult = await service.executeLeadAiWorkflow(leadAlphaId, workspaceAlpha, 'user_123');
  assert.strictEqual(resilientResult.status, 'awaiting_approval');
  assert.strictEqual(resilientResult.approval?.status, 'pending');
  shouldAuditThrow = false;
  console.log('✓ Workflow successfully completed despite audit repository failure (non-blocking)');

  // ==============================================================================
  // 4. NON-BLOCKING SUPPRESSION RESILIENCE
  // ==============================================================================
  console.log('\n[Test 4] Workflow succeeds even if SuppressionRepository throws an error...');
  auditLogsCreated.length = 0;
  shouldSuppressionThrow = true;

  const suppResilientResult = await service.executeLeadAiWorkflow(leadAlphaId, workspaceAlpha, 'user_123');
  assert.strictEqual(suppResilientResult.status, 'awaiting_approval');
  assert.strictEqual(auditLogsCreated.length, 2);
  assert.strictEqual(auditLogsCreated[0].metadata?.suppressionDetected, false);
  shouldSuppressionThrow = false;
  console.log('✓ Workflow successfully completed despite suppression repository failure (non-blocking)');

  // ==============================================================================
  // 5. WORKFLOW FAILURE HANDLING & SENSITIVE CREDENTIAL SCRUBBING
  // ==============================================================================
  console.log('\n[Test 5] Workflow failure logs failed audit event and sanitizes API keys and tokens...');
  auditLogsCreated.length = 0;

  const failingWorkflowGraph = {
    invoke: async () => {
      throw new Error(
        'Gemini API request failed with key AIzaSyD9876543210abcdefghijklmnopqrs and header Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.secret'
      );
    },
  };

  const failingService = new LeadAiService(
    mockLeadRepo,
    failingWorkflowGraph,
    mockAuditRepo,
    mockSuppressionRepo
  );

  await assert.rejects(
    async () => {
      await failingService.executeLeadAiWorkflow(leadAlphaId, workspaceAlpha, 'user_123');
    },
    (err: unknown) => {
      assert.ok(err instanceof InternalServerError, 'Expected InternalServerError');
      assert.ok(!err.message.includes('AIzaSyD9876543210abcdefghijklmnopqrs'), 'API key must be scrubbed from error');
      assert.ok(err.message.includes('[REDACTED_API_KEY]'), 'Expected [REDACTED_API_KEY] in error');
      assert.ok(!err.message.includes('secret'), 'Token must be scrubbed from error');
      assert.ok(err.message.includes('[REDACTED_TOKEN]'), 'Expected [REDACTED_TOKEN] in error');
      return true;
    }
  );

  assert.strictEqual(auditLogsCreated.length, 2, 'Should have started and failed audit events');
  const failedAudit = auditLogsCreated[1];
  assert.strictEqual(failedAudit.eventType, 'lead_ai_workflow:failed');
  assert.strictEqual(failedAudit.entityId, leadAlphaId);
  const loggedError = String(failedAudit.metadata?.error);
  assert.ok(!loggedError.includes('AIzaSyD9876543210abcdefghijklmnopqrs'), 'Audit log must never store raw API key');
  assert.ok(loggedError.includes('[REDACTED_API_KEY]'), 'Audit log contains [REDACTED_API_KEY]');
  assert.ok(!loggedError.includes('secret'), 'Audit log must never store raw bearer token');
  assert.ok(loggedError.includes('[REDACTED_TOKEN]'), 'Audit log contains [REDACTED_TOKEN]');
  console.log('✓ Secret credentials scrubbed from both API error message and audit log');

  // ==============================================================================
  // 6. CROSS-WORKSPACE SECURITY & ZERO AUDIT LEAKAGE
  // ==============================================================================
  console.log('\n[Test 6] Cross-workspace lead access throws NotFoundError and writes NO foreign audit logs...');
  auditLogsCreated.length = 0;

  await assert.rejects(
    async () => {
      // User Beta attempts to run AI workflow on Workspace Alpha's lead
      await service.executeLeadAiWorkflow(leadAlphaId, workspaceBeta, 'user_beta');
    },
    (err: unknown) => {
      assert.ok(err instanceof NotFoundError, 'Expected NotFoundError on cross-tenant access');
      return true;
    }
  );

  assert.strictEqual(
    auditLogsCreated.length,
    0,
    'Cross-workspace rejection must NEVER write an audit log containing foreign lead data'
  );
  console.log('✓ Cross-tenant request rejected without leaking audit logs for unauthorized workspace');

  // ==============================================================================
  // 7. INVARIANTS: STRICTLY READ-ONLY, NO DISPATCH, NO MUTATIONS
  // ==============================================================================
  console.log('\n[Test 7] Verifying zero mutations and strictly read-only execution...');
  assert.strictEqual(mutationCount, 0, 'No database mutations were performed');
  console.log('✓ Zero mutations confirmed');

  console.log('\n==================================================');
  console.log('✅ ALL STAGE 3 STEP 17 AUDIT & SAFETY TESTS PASSED');
  console.log('==================================================\n');
}

runLeadAiAuditSafetyTests().catch((err) => {
  console.error('❌ Lead AI Audit & Safety Tests Failed:', err);
  process.exit(1);
});
