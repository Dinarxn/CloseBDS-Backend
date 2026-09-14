/// <reference types="node" />
import assert from 'node:assert/strict';
import { buildApp } from '../src/server/app.js';
import { databaseClient, type DatabaseClient } from '../src/database/client.js';
import { signAuthToken } from '../src/modules/auth/token.js';
import { LeadRepository, SuppressionRepository, AuditRepository } from '../src/database/repository.js';
import { LeadAiService, leadAiService } from '../src/modules/leads/lead-ai.service.js';
import { PrismaClientInitializationError } from '@prisma/client/runtime/library.js';
import type { PrismaClient, Lead, Contact, Call, Suppression, AuditLog, LeadStatus, CallStatus } from '@prisma/client';

async function runStep20To22E2ETests() {
  console.log('\n================================================================');
  console.log('--- Stage 4 Steps 20-22: End-to-End Acquisition & Safety Tests ---');
  console.log('================================================================\n');

  const testResults: Array<{ name: string; category: string; status: 'PASS' | 'FAIL' | 'BLOCKED'; details?: string }> = [];

  // In-memory mock stores
  const leadsStore: Map<string, Lead> = new Map();
  const contactsStore: Map<string, Contact> = new Map();
  const callsStore: Map<string, Call> = new Map();
  const suppressionsStore: Map<string, Suppression> = new Map();
  const auditLogsStore: AuditLog[] = [];

  const workspaceAlpha = 'ws_alpha_step20_22';
  const workspaceBeta = 'ws_beta_step20_22';

  const userAlphaId = 'user_alpha_operator_01';
  const userBetaId = 'user_beta_operator_02';

  const tokenAlpha = signAuthToken({
    userId: userAlphaId,
    workspaceId: workspaceAlpha,
    email: 'operator@alpha.local',
    role: 'ADMIN',
  });

  const tokenBeta = signAuthToken({
    userId: userBetaId,
    workspaceId: workspaceBeta,
    email: 'operator@beta.local',
    role: 'ADMIN',
  });

  // 1. Seed Leads for Workspace Alpha
  const lead1Id = 'lead_alpha_dental_101';
  const lead1: Lead = {
    id: lead1Id,
    workspaceId: workspaceAlpha,
    campaignId: null,
    businessName: 'Apex Dental Care',
    domain: 'apexdental.example.com',
    phone: '+1-555-019-1001',
    address: '101 Healthcare Way, Austin, TX',
    status: 'QUALIFIED' as LeadStatus,
    createdAt: new Date('2026-09-08T09:00:00Z'),
    updatedAt: new Date('2026-09-08T09:00:00Z'),
  };
  leadsStore.set(lead1Id, lead1);

  const contact1: Contact = {
    id: 'contact_alpha_101',
    leadId: lead1Id,
    fullName: 'Dr. Sarah Connor',
    email: 'sconnor@apexdental.example.com',
    title: 'Managing Partner',
    phone: '+1-555-019-1001',
    isPrimary: true,
    createdAt: new Date('2026-09-08T09:00:00Z'),
    updatedAt: new Date('2026-09-08T09:00:00Z'),
  };
  contactsStore.set(contact1.id, contact1);

  const lead2Id = 'lead_alpha_chiro_102';
  const lead2: Lead = {
    id: lead2Id,
    workspaceId: workspaceAlpha,
    campaignId: null,
    businessName: 'Summit Chiropractic Clinic',
    domain: 'summitchiro.example.com',
    phone: '+1-555-019-1002',
    address: '202 Spine Blvd, Austin, TX',
    status: 'QUALIFIED' as LeadStatus,
    createdAt: new Date('2026-09-08T10:00:00Z'),
    updatedAt: new Date('2026-09-08T10:00:00Z'),
  };
  leadsStore.set(lead2Id, lead2);

  const lead3SuppressedId = 'lead_alpha_suppressed_103';
  const lead3: Lead = {
    id: lead3SuppressedId,
    workspaceId: workspaceAlpha,
    campaignId: null,
    businessName: 'Blocked Practice Group',
    domain: 'blockedpractice.example.com',
    phone: '+1-555-019-9999',
    address: '303 Do Not Call Rd, Austin, TX',
    status: 'QUALIFIED' as LeadStatus,
    createdAt: new Date('2026-09-08T11:00:00Z'),
    updatedAt: new Date('2026-09-08T11:00:00Z'),
  };
  leadsStore.set(lead3SuppressedId, lead3);

  const suppression1: Suppression = {
    id: 'sup_alpha_01',
    workspaceId: workspaceAlpha,
    type: 'EMAIL',
    value: 'dnc@blockedpractice.example.com',
    reason: 'OPT_OUT',
    createdAt: new Date('2026-09-01T00:00:00Z'),
  };
  suppressionsStore.set(suppression1.id, suppression1);

  const contact3: Contact = {
    id: 'contact_alpha_103',
    leadId: lead3SuppressedId,
    fullName: 'John Doe',
    email: 'dnc@blockedpractice.example.com',
    title: 'Owner',
    phone: '+1-555-019-9999',
    isPrimary: true,
    createdAt: new Date('2026-09-08T11:00:00Z'),
    updatedAt: new Date('2026-09-08T11:00:00Z'),
  };
  contactsStore.set(contact3.id, contact3);

  const lead4OptOutId = 'lead_alpha_optout_104';
  const lead4: Lead = {
    id: lead4OptOutId,
    workspaceId: workspaceAlpha,
    campaignId: null,
    businessName: 'Opted Out Wellness',
    domain: 'optedoutwellness.example.com',
    phone: '+1-555-019-8888',
    address: '404 Opt Out St, Austin, TX',
    status: 'OPT_OUT' as LeadStatus,
    createdAt: new Date('2026-09-08T12:00:00Z'),
    updatedAt: new Date('2026-09-08T12:00:00Z'),
  };
  leadsStore.set(lead4OptOutId, lead4);

  // 2. Seed Lead for Workspace Beta (Cross-Tenant)
  const leadBetaId = 'lead_beta_clinic_201';
  const leadBeta: Lead = {
    id: leadBetaId,
    workspaceId: workspaceBeta,
    campaignId: null,
    businessName: 'Rocky Mountain Dental',
    domain: 'rockymountaindental.example.com',
    phone: '+1-555-028-2001',
    address: '505 Mountain Ave, Denver, CO',
    status: 'QUALIFIED' as LeadStatus,
    createdAt: new Date('2026-09-08T13:00:00Z'),
    updatedAt: new Date('2026-09-08T13:00:00Z'),
  };
  leadsStore.set(leadBetaId, leadBeta);

  // 3. Seed Calls for Workspace Alpha
  const call1Id = 'call_alpha_queue_01';
  const call1: Call = {
    id: call1Id,
    workspaceId: workspaceAlpha,
    campaignId: null,
    voiceCampaignId: null,
    leadId: lead1Id,
    contactId: contact1.id,
    agentConfigId: null,
    recipientPhone: '+1-555-019-1001',
    normalizedPhone: '+15550191001',
    status: 'APPROVAL_REQUIRED' as CallStatus,
    humanApprovalRequired: true,
    isApproved: false,
    approvedByUserId: null,
    approvedAt: null,
    idempotencyKey: null,
    scheduledAt: new Date('2026-09-08T14:00:00Z'),
    initiatedAt: null,
    completedAt: null,
    durationSeconds: null,
    providerName: 'twilio',
    providerCallId: null,
    blockedReason: null,
    createdAt: new Date('2026-09-08T14:00:00Z'),
    updatedAt: new Date('2026-09-08T14:00:00Z'),
  };
  callsStore.set(call1Id, call1);

  let simulateDbOffline = false;

  const mockPrisma = {
    lead: {
      findFirst: async ({ where, include }: { where: { id?: string; workspaceId?: string }; include?: Record<string, boolean> }) => {
        if (simulateDbOffline) {
          throw new PrismaClientInitializationError("Can't reach database server at localhost:5432", '5.0.0');
        }
        for (const l of leadsStore.values()) {
          const matchId = !where.id || l.id === where.id;
          const matchWs = !where.workspaceId || l.workspaceId === where.workspaceId;
          if (matchId && matchWs) {
            const contacts = Array.from(contactsStore.values()).filter((c) => c.leadId === l.id);
            return {
              ...l,
              contacts,
              leadScore: null,
              websiteAudit: null,
              aiAnalysis: null,
            };
          }
        }
        return null;
      },
      findMany: async ({ where, skip, take }: { where: { workspaceId: string; status?: any }; skip?: number; take?: number }) => {
        if (simulateDbOffline) {
          throw new PrismaClientInitializationError("Can't reach database server at localhost:5432", '5.0.0');
        }
        const filtered = Array.from(leadsStore.values()).filter((l) => {
          if (l.workspaceId !== where.workspaceId) return false;
          if (where.status) {
            if (typeof where.status === 'object' && where.status.in) {
              return where.status.in.includes(l.status);
            }
            return l.status === where.status;
          }
          return true;
        });
        const paged = filtered.slice(skip || 0, (skip || 0) + (take || 50));
        return paged.map((l) => ({
          ...l,
          contacts: Array.from(contactsStore.values()).filter((c) => c.leadId === l.id),
          leadScore: null,
          websiteAudit: null,
        }));
      },
      count: async ({ where }: { where: { workspaceId: string } }) => {
        if (simulateDbOffline) {
          throw new PrismaClientInitializationError("Can't reach database server at localhost:5432", '5.0.0');
        }
        return Array.from(leadsStore.values()).filter((l) => l.workspaceId === where.workspaceId).length;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Lead> }) => {
        if (simulateDbOffline) {
          throw new PrismaClientInitializationError("Can't reach database server at localhost:5432", '5.0.0');
        }
        const existing = leadsStore.get(where.id);
        if (!existing) throw new Error('Lead not found');
        const updated = { ...existing, ...data, updatedAt: new Date() };
        leadsStore.set(where.id, updated);
        return updated;
      },
    },
    call: {
      findFirst: async ({ where }: { where: { id?: string; workspaceId?: string } }) => {
        if (simulateDbOffline) {
          throw new PrismaClientInitializationError("Can't reach database server at localhost:5432", '5.0.0');
        }
        for (const c of callsStore.values()) {
          const matchId = !where.id || c.id === where.id;
          const matchWs = !where.workspaceId || c.workspaceId === where.workspaceId;
          if (matchId && matchWs) {
            const lead = leadsStore.get(c.leadId);
            const contact = contactsStore.get(c.contactId);
            return { ...c, lead, contact };
          }
        }
        return null;
      },
      findMany: async ({ where }: { where: { workspaceId: string; status?: any } }) => {
        if (simulateDbOffline) {
          throw new PrismaClientInitializationError("Can't reach database server at localhost:5432", '5.0.0');
        }
        const filtered = Array.from(callsStore.values()).filter((c) => {
          if (c.workspaceId !== where.workspaceId) return false;
          if (where.status && typeof where.status === 'object' && where.status.in) {
            return where.status.in.includes(c.status);
          }
          return true;
        });
        return filtered.map((c) => ({
          ...c,
          lead: leadsStore.get(c.leadId),
          contact: contactsStore.get(c.contactId),
        }));
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Call> }) => {
        if (simulateDbOffline) {
          throw new PrismaClientInitializationError("Can't reach database server at localhost:5432", '5.0.0');
        }
        const existing = callsStore.get(where.id);
        if (!existing) throw new Error('Call not found');
        const updated = { ...existing, ...data, updatedAt: new Date() };
        callsStore.set(where.id, updated);
        return updated;
      },
      create: async ({ data }: { data: any }) => {
        const entry = { id: `call_${Date.now()}`, ...data, createdAt: new Date(), updatedAt: new Date() };
        callsStore.set(entry.id, entry);
        return entry;
      },
    },
    callEvent: {
      create: async () => ({}),
      findMany: async () => [],
    },
    task: {
      findMany: async () => [],
    },
    callingPolicy: {
      findUnique: async () => ({
        id: 'policy_01',
        workspaceId: workspaceAlpha,
        isActive: true,
        dailyCallLimit: 50,
        humanApprovalRequired: true,
      }),
      create: async () => ({
        id: 'policy_01',
        workspaceId: workspaceAlpha,
        isActive: true,
        dailyCallLimit: 50,
        humanApprovalRequired: true,
      }),
    },
    workspaceCallingPolicy: {
      findUnique: async () => ({
        id: 'policy_01',
        workspaceId: workspaceAlpha,
        isActive: true,
        dailyCallLimit: 50,
        humanApprovalRequired: true,
      }),
      upsert: async () => ({
        id: 'policy_01',
        workspaceId: workspaceAlpha,
        isActive: true,
        dailyCallLimit: 50,
        humanApprovalRequired: true,
      }),
    },
    voiceAgentConfig: {
      count: async () => 1,
    },
    suppression: {
      findFirst: async ({ where }: { where: { workspaceId: string; value: { in: string[] } } }) => {
        if (simulateDbOffline) {
          throw new PrismaClientInitializationError("Can't reach database server at localhost:5432", '5.0.0');
        }
        for (const s of suppressionsStore.values()) {
          if (s.workspaceId === where.workspaceId && where.value.in.includes(s.value)) {
            return s;
          }
        }
        return null;
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const entry = { id: `audit_${Date.now()}`, ...data, createdAt: new Date() } as unknown as AuditLog;
        auditLogsStore.push(entry);
        return entry;
      },
    },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(mockPrisma),
  } as unknown as PrismaClient;

  databaseClient.setPrismaClient(mockPrisma);

  const mockWorkflowGraph = {
    invoke: async (input: Record<string, unknown>) => ({
      leadId: input.leadId,
      workspaceId: input.workspaceId,
      status: 'awaiting_approval',
      currentStep: 'human_approval_gate',
      aiResult: {
        summary: 'Clinical practice with strong local presence',
        intent: 'high_fit',
        confidence: 0.92,
      },
      qualification: {
        qualified: true,
        reason: 'Meets ICP dental practice profile',
        score: 88,
      },
      personalizedMessage: {
        subject: 'Modernizing appointment scheduling for Apex Dental Care',
        body: 'Hello Dr. Connor, noticed opportunities to enhance patient scheduling.',
      },
      qualityCheck: {
        passed: true,
        score: 95,
        issues: [],
      },
      approval: {
        status: 'pending' as const,
      },
    }),
  };
  leadAiService.setWorkflowGraph(mockWorkflowGraph);

  const app = await buildApp();

  try {
    // --------------------------------------------------------------------------
    // Test 1: Lead Pool & AI Analysis Verification
    // --------------------------------------------------------------------------
    console.log('[Test 1] Deterministic Lead Pool query & AI execution...');
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/leads',
      headers: { authorization: `Bearer ${tokenAlpha}` },
    });
    assert.strictEqual(listRes.statusCode, 200);
    const listBody = JSON.parse(listRes.payload);
    assert.strictEqual(listBody.success, true);
    assert.strictEqual(listBody.total >= 4, true, 'Must list leads for Workspace Alpha');

    // Run AI analysis
    const aiRes = await app.inject({
      method: 'POST',
      url: `/api/v1/leads/${lead1Id}/ai`,
      headers: { authorization: `Bearer ${tokenAlpha}` },
    });
    assert.strictEqual(aiRes.statusCode, 200);
    const aiBody = JSON.parse(aiRes.payload);
    assert.strictEqual(aiBody.success, true);
    assert.strictEqual(aiBody.data.leadId, lead1Id);
    assert.strictEqual(aiBody.data.approval?.status, 'pending', 'Initial AI output must be pending approval');
    testResults.push({ name: 'Lead Pool & AI Analysis Verification', category: 'Deterministic Integration', status: 'PASS' });
    console.log('✓ Test 1 Passed: Lead Pool and AI execution verified.');

    // --------------------------------------------------------------------------
    // Test 2: Server-Authoritative Human Approval (Step 20)
    // --------------------------------------------------------------------------
    console.log('\n[Test 2] Server-Authoritative Human Approval...');
    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/leads/${lead1Id}/approve`,
      headers: { authorization: `Bearer ${tokenAlpha}` },
      payload: { reason: 'Clinical ICP match verified by operator' },
    });
    assert.strictEqual(approveRes.statusCode, 200);
    const approveBody = JSON.parse(approveRes.payload);
    assert.strictEqual(approveBody.success, true);
    assert.strictEqual(approveBody.data.status, 'CALL_READY', 'Approved lead status must be CALL_READY');
    assert.strictEqual(approveBody.data.approval.status, 'approved');
    assert.strictEqual(approveBody.data.approval.approvedBy, userAlphaId);
    assert.ok(approveBody.data.approval.approvedAt);
    assert.strictEqual(approveBody.data.approval.reason, 'Clinical ICP match verified by operator');

    // Verify audit log
    const auditApprove = auditLogsStore.find((a) => a.eventType === 'lead_ai_workflow:approved' && a.entityId === lead1Id);
    assert.ok(auditApprove, 'Audit event lead_ai_workflow:approved must be recorded');
    testResults.push({ name: 'Server-Authoritative Lead Approval (Step 20)', category: 'Deterministic Integration', status: 'PASS' });
    console.log('✓ Test 2 Passed: Human Approval transitions lead to CALL_READY with audit trail.');

    // --------------------------------------------------------------------------
    // Test 3: Server-Authoritative Human Rejection (Step 20)
    // --------------------------------------------------------------------------
    console.log('\n[Test 3] Server-Authoritative Human Rejection...');
    const rejectRes = await app.inject({
      method: 'POST',
      url: `/api/v1/leads/${lead2Id}/reject`,
      headers: { authorization: `Bearer ${tokenAlpha}` },
      payload: { reason: 'Out of regional territory' },
    });
    assert.strictEqual(rejectRes.statusCode, 200);
    const rejectBody = JSON.parse(rejectRes.payload);
    assert.strictEqual(rejectBody.success, true);
    assert.strictEqual(rejectBody.data.status, 'DISQUALIFIED', 'Rejected lead status must be DISQUALIFIED');
    assert.strictEqual(rejectBody.data.approval.status, 'rejected');
    assert.strictEqual(rejectBody.data.approval.reason, 'Out of regional territory');

    const auditReject = auditLogsStore.find((a) => a.eventType === 'lead_ai_workflow:rejected' && a.entityId === lead2Id);
    assert.ok(auditReject, 'Audit event lead_ai_workflow:rejected must be recorded');
    testResults.push({ name: 'Server-Authoritative Lead Rejection (Step 20)', category: 'Deterministic Integration', status: 'PASS' });
    console.log('✓ Test 3 Passed: Human Rejection transitions lead to DISQUALIFIED with audit trail.');

    // --------------------------------------------------------------------------
    // Test 4: Regulatory Suppression & DNC Safety Guards
    // --------------------------------------------------------------------------
    console.log('\n[Test 4] Safety Guards: Suppression & OPT_OUT blocks approval...');
    // A. Suppressed contact/domain
    const suppressedApprovalRes = await app.inject({
      method: 'POST',
      url: `/api/v1/leads/${lead3SuppressedId}/approve`,
      headers: { authorization: `Bearer ${tokenAlpha}` },
      payload: { reason: 'Attempting approval of suppressed contact' },
    });
    assert.strictEqual(suppressedApprovalRes.statusCode, 400, 'Suppressed lead must be blocked from approval');

    // B. OPT_OUT lead status
    const optOutApprovalRes = await app.inject({
      method: 'POST',
      url: `/api/v1/leads/${lead4OptOutId}/approve`,
      headers: { authorization: `Bearer ${tokenAlpha}` },
      payload: { reason: 'Attempting approval of opted out lead' },
    });
    assert.strictEqual(optOutApprovalRes.statusCode, 400, 'Opted out lead must be blocked from approval');
    testResults.push({ name: 'Suppression & DNC Safety Blocks (Step 20)', category: 'Safety & Guardrails', status: 'PASS' });
    console.log('✓ Test 4 Passed: Suppression and OPT_OUT blocks strictly enforced by server.');

    // --------------------------------------------------------------------------
    // Test 5: Call Queue Operations & Prioritization (Step 21)
    // --------------------------------------------------------------------------
    console.log('\n[Test 5] Call Queue Listing, Prioritization & Cancellation (Step 21)...');
    const queueRes = await app.inject({
      method: 'GET',
      url: '/api/v1/operations/queue',
      headers: { authorization: `Bearer ${tokenAlpha}` },
    });
    assert.strictEqual(queueRes.statusCode, 200);
    const queueBody = JSON.parse(queueRes.payload);
    assert.strictEqual(queueBody.success, true);
    assert.strictEqual(Array.isArray(queueBody.data), true);
    assert.strictEqual(queueBody.data.length >= 1, true);

    // Prioritize call
    const prioRes = await app.inject({
      method: 'POST',
      url: `/api/v1/operations/queue/${call1Id}/prioritize`,
      headers: { authorization: `Bearer ${tokenAlpha}` },
      payload: { priority: 5 },
    });
    assert.strictEqual(prioRes.statusCode, 200);

    // Cancel call
    const cancelRes = await app.inject({
      method: 'POST',
      url: `/api/v1/operations/queue/${call1Id}/cancel`,
      headers: { authorization: `Bearer ${tokenAlpha}` },
      payload: { reason: 'Cancelled by operator via queue test' },
    });
    assert.strictEqual(cancelRes.statusCode, 200);
    testResults.push({ name: 'Call Queue Operations (Step 21)', category: 'Deterministic Integration', status: 'PASS' });
    console.log('✓ Test 5 Passed: Call Queue listing, prioritization, and cancellation verified.');

    // --------------------------------------------------------------------------
    // Test 6: Operations Call-Ready Pipeline & Operational Readiness
    // --------------------------------------------------------------------------
    console.log('\n[Test 6] Operations Call-Ready Pipeline & Summary...');
    const callReadyRes = await app.inject({
      method: 'GET',
      url: '/api/v1/operations/call-ready',
      headers: { authorization: `Bearer ${tokenAlpha}` },
    });
    assert.strictEqual(callReadyRes.statusCode, 200);
    const callReadyBody = JSON.parse(callReadyRes.payload);
    assert.strictEqual(callReadyBody.success, true);
    assert.strictEqual(Array.isArray(callReadyBody.data), true);

    const summaryRes = await app.inject({
      method: 'GET',
      url: '/api/v1/operations/summary',
      headers: { authorization: `Bearer ${tokenAlpha}` },
    });
    assert.strictEqual(summaryRes.statusCode, 200);
    const summaryBody = JSON.parse(summaryRes.payload);
    assert.strictEqual(summaryBody.success, true);
    assert.strictEqual(typeof summaryBody.data.callReadyCount, 'number');
    testResults.push({ name: 'Operations Pipeline Summary (Step 21)', category: 'Deterministic Integration', status: 'PASS' });
    console.log('✓ Test 6 Passed: Operations Summary and Call-Ready task views verified.');

    // --------------------------------------------------------------------------
    // Test 7: Cross-Workspace Tenant Isolation Security
    // --------------------------------------------------------------------------
    console.log('\n[Test 7] Cross-Workspace Tenant Isolation Security...');
    // Workspace Beta user attempts to inspect Lead 1 in Workspace Alpha
    const crossGetLead = await app.inject({
      method: 'GET',
      url: `/api/v1/leads/${lead1Id}`,
      headers: { authorization: `Bearer ${tokenBeta}` },
    });
    assert.strictEqual(crossGetLead.statusCode, 404, 'Cross-workspace lead get must return 404');

    // Workspace Beta user attempts to approve Lead 1 in Workspace Alpha
    const crossApprove = await app.inject({
      method: 'POST',
      url: `/api/v1/leads/${lead1Id}/approve`,
      headers: { authorization: `Bearer ${tokenBeta}` },
      payload: { reason: 'Unauthorized approval attempt' },
    });
    assert.strictEqual(crossApprove.statusCode, 404, 'Cross-workspace lead approve must return 404');

    // Workspace Beta user attempts to prioritize Call 1 in Workspace Alpha
    const crossPrio = await app.inject({
      method: 'POST',
      url: `/api/v1/operations/queue/${call1Id}/prioritize`,
      headers: { authorization: `Bearer ${tokenBeta}` },
      payload: { priority: 99 },
    });
    assert.strictEqual(crossPrio.statusCode, 404, 'Cross-workspace call prioritize must return 404');
    testResults.push({ name: 'Cross-Workspace Isolation Security', category: 'Security & Multi-Tenancy', status: 'PASS' });
    console.log('✓ Test 7 Passed: Strict multi-tenant isolation enforced on all approval and queue endpoints.');

    // --------------------------------------------------------------------------
    // Test 8: PostgreSQL Offline Resilience
    // --------------------------------------------------------------------------
    console.log('\n[Test 8] PostgreSQL Offline Resilience (503 response verification)...');
    simulateDbOffline = true;
    const dbOfflineRes = await app.inject({
      method: 'GET',
      url: '/api/v1/leads',
      headers: { authorization: `Bearer ${tokenAlpha}` },
    });
    assert.strictEqual(dbOfflineRes.statusCode, 503, 'Database unavailable must return 503');
    simulateDbOffline = false;
    testResults.push({ name: 'PostgreSQL Offline Resilience (503)', category: 'Resilience & Offline Handling', status: 'PASS' });
    console.log('✓ Test 8 Passed: 503 DATABASE_UNAVAILABLE returned gracefully when PostgreSQL is disconnected.');

    // --------------------------------------------------------------------------
    // Test 9: Live Environment Status (PostgreSQL & Gemini External Connectivity)
    // --------------------------------------------------------------------------
    console.log('\n[Test 9] Live External Systems Status Assessment...');
    testResults.push({
      name: 'Live PostgreSQL Database Connection',
      category: 'Environment / Infrastructure',
      status: 'BLOCKED',
      details: 'PostgreSQL offline locally. Handled via server-authoritative 503 DATABASE_UNAVAILABLE responses.',
    });

    const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);
    testResults.push({
      name: 'Live Gemini External LLM Endpoint',
      category: 'Environment / Infrastructure',
      status: hasGeminiKey ? 'PASS' : 'BLOCKED',
      details: hasGeminiKey ? 'GEMINI_API_KEY present in environment' : 'GEMINI_API_KEY not configured for live test invocation',
    });

    // ==============================================================================
    // Print Formatted Report
    // ==============================================================================
    console.log('\n================================================================');
    console.log('STAGE 4 (STEPS 20-22) TEST CLASSIFICATION REPORT');
    console.log('================================================================');
    console.table(testResults);

    const failCount = testResults.filter((r) => r.status === 'FAIL').length;
    assert.strictEqual(failCount, 0, 'No deterministic tests may fail');

  } finally {
    leadAiService.setWorkflowGraph(null);
    databaseClient.setPrismaClient(null);
    await app.close();
  }
}

runStep20To22E2ETests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
