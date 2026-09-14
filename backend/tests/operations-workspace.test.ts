import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server/app.js';
import { signAuthToken } from '../src/modules/auth/token.js';
import { databaseClient } from '../src/database/client.js';
import { voiceService } from '../src/modules/voice/voice.service.js';
import { operationsService } from '../src/modules/operations/operations.service.js';
import { crmService } from '../src/modules/crm/crm.service.js';
import type {
  Lead,
  Contact,
  Call,
  CallAttempt,
  CallEvent,
  VoiceAgentConfig,
  Task,
  CRMActivity,
  Suppression,
  AuditLog,
  PrismaClient,
} from '@prisma/client';
import type { WorkspaceCallingPolicy } from '../src/modules/voice/voice.types.js';

async function runOperationsWorkspaceTests() {
  console.log('\n--- Starting closeVDS Operations Workspace & Acquisition Architecture Tests ---');

  // In-memory test stores
  const leadsStore: Map<string, Lead> = new Map();
  const contactsStore: Map<string, Contact> = new Map();
  const callsStore: Map<string, Call> = new Map();
  const callAttemptsStore: Map<string, CallAttempt> = new Map();
  const callEventsStore: Map<string, CallEvent> = new Map();
  const callingPoliciesStore: Map<string, WorkspaceCallingPolicy> = new Map();
  const voiceAgentConfigsStore: Map<string, VoiceAgentConfig> = new Map();
  const tasksStore: Map<string, Task> = new Map();
  const crmActivitiesStore: Map<string, CRMActivity> = new Map();
  const suppressionsStore: Map<string, Suppression> = new Map();
  const auditLogsStore: Map<string, AuditLog> = new Map();

  const mockPrisma = {
    workspaceCallingPolicy: {
      findUnique: async ({ where }: any) => {
        return callingPoliciesStore.get(where.workspaceId) || null;
      },
      findFirst: async ({ where }: any) => {
        return callingPoliciesStore.get(where.workspaceId) || null;
      },
      upsert: async ({ create, update, where }: any) => {
        const existing = callingPoliciesStore.get(where.workspaceId);
        const data = existing
          ? { ...existing, ...update, updatedAt: new Date() }
          : { id: `wcp_${crypto.randomUUID()}`, ...create, createdAt: new Date(), updatedAt: new Date() };
        callingPoliciesStore.set(where.workspaceId, data);
        return data;
      },
      update: async ({ where, data }: any) => {
        const existing = callingPoliciesStore.get(where.workspaceId);
        if (!existing) throw new Error('Policy not found');
        const updated = { ...existing, ...data, updatedAt: new Date() };
        callingPoliciesStore.set(where.workspaceId, updated);
        return updated;
      },
    },
    voiceAgentConfig: {
      create: async ({ data }: any) => {
        const record: VoiceAgentConfig = {
          id: crypto.randomUUID(),
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        voiceAgentConfigsStore.set(record.id, record);
        return record;
      },
      findFirst: async ({ where }: any) => {
        return (
          Array.from(voiceAgentConfigsStore.values()).find(
            (c) => (!where.id || c.id === where.id) && (!where.workspaceId || c.workspaceId === where.workspaceId)
          ) || null
        );
      },
      findMany: async ({ where }: any) => {
        return Array.from(voiceAgentConfigsStore.values()).filter(
          (c) => !where?.workspaceId || c.workspaceId === where.workspaceId
        );
      },
      count: async ({ where }: any) => {
        return Array.from(voiceAgentConfigsStore.values()).filter(
          (c) => !where?.workspaceId || c.workspaceId === where.workspaceId
        ).length;
      },
      update: async ({ where, data }: any) => {
        const existing = voiceAgentConfigsStore.get(where.id);
        if (!existing) throw new Error('Agent config not found');
        const updated = { ...existing, ...data, updatedAt: new Date() };
        voiceAgentConfigsStore.set(where.id, updated);
        return updated;
      },
    },
    lead: {
      create: async ({ data }: any) => {
        const record: Lead = {
          id: crypto.randomUUID(),
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        leadsStore.set(record.id, record);
        return record;
      },
      findFirst: async ({ where }: any) => {
        return (
          Array.from(leadsStore.values()).find(
            (l) => (!where.id || l.id === where.id) && (!where.workspaceId || l.workspaceId === where.workspaceId)
          ) || null
        );
      },
      findMany: async ({ where }: any) => {
        return Array.from(leadsStore.values()).filter((l) => {
          if (where?.workspaceId && l.workspaceId !== where.workspaceId) return false;
          if (where?.status) {
            if (typeof where.status === 'string' && l.status !== where.status) return false;
            if (where.status.in && !where.status.in.includes(l.status)) return false;
          }
          return true;
        });
      },
      count: async ({ where }: any) => {
        return Array.from(leadsStore.values()).filter((l) => {
          if (where?.workspaceId && l.workspaceId !== where.workspaceId) return false;
          if (where?.status) {
            if (typeof where.status === 'string' && l.status !== where.status) return false;
            if (where.status.in && !where.status.in.includes(l.status)) return false;
          }
          return true;
        }).length;
      },
      update: async ({ where, data }: any) => {
        const existing = leadsStore.get(where.id);
        if (!existing) throw new Error('Lead not found');
        const updated = { ...existing, ...data, updatedAt: new Date() };
        leadsStore.set(where.id, updated);
        return updated;
      },
    },
    contact: {
      create: async ({ data }: any) => {
        const record: Contact = {
          id: crypto.randomUUID(),
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        contactsStore.set(record.id, record);
        return record;
      },
      findFirst: async ({ where }: any) => {
        return (
          Array.from(contactsStore.values()).find(
            (c) => (!where.id || c.id === where.id) && (!where.leadId || c.leadId === where.leadId)
          ) || null
        );
      },
      findMany: async ({ where }: any) => {
        return Array.from(contactsStore.values()).filter((c) => !where?.leadId || c.leadId === where.leadId);
      },
    },
    call: {
      create: async ({ data }: any) => {
        const record: Call = {
          id: crypto.randomUUID(),
          campaignId: null,
          voiceCampaignId: null,
          scheduledAt: null,
          startedAt: null,
          endedAt: null,
          durationSeconds: null,
          costUsd: null,
          recordingUrl: null,
          outcomeId: null,
          idempotencyKey: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        callsStore.set(record.id, record);
        return record;
      },
      findFirst: async ({ where }: any) => {
        const c = Array.from(callsStore.values()).find(
          (call) => (!where.id || call.id === where.id) && (!where.workspaceId || call.workspaceId === where.workspaceId)
        );
        if (!c) return null;
        return {
          ...c,
          campaign: null,
          voiceCampaign: null,
          lead: leadsStore.get(c.leadId) || null,
          contact: contactsStore.get(c.contactId) || null,
          agentConfig: c.agentConfigId ? voiceAgentConfigsStore.get(c.agentConfigId) || null : null,
          attempts: Array.from(callAttemptsStore.values()).filter((a) => a.callId === c.id),
          events: Array.from(callEventsStore.values()).filter((e) => e.callId === c.id),
          transcripts: [],
          outcome: null,
        };
      },
      findMany: async ({ where }: any) => {
        return Array.from(callsStore.values()).filter((c) => {
          if (where?.workspaceId && c.workspaceId !== where.workspaceId) return false;
          if (where?.status) {
            if (typeof where.status === 'string' && c.status !== where.status) return false;
            if (where.status.in && !where.status.in.includes(c.status)) return false;
          }
          return true;
        }).map((c) => ({
          ...c,
          campaign: null,
          voiceCampaign: null,
          lead: leadsStore.get(c.leadId) || null,
          contact: contactsStore.get(c.contactId) || null,
          agentConfig: c.agentConfigId ? voiceAgentConfigsStore.get(c.agentConfigId) || null : null,
          attempts: Array.from(callAttemptsStore.values()).filter((a) => a.callId === c.id),
          events: Array.from(callEventsStore.values()).filter((e) => e.callId === c.id),
          transcripts: [],
          outcome: null,
        }));
      },
      count: async ({ where }: any) => {
        return Array.from(callsStore.values()).filter((c) => {
          if (where?.workspaceId && c.workspaceId !== where.workspaceId) return false;
          if (where?.status && c.status !== where.status) return false;
          if (where?.status?.in && !where.status.in.includes(c.status)) return false;
          return true;
        }).length;
      },
      update: async ({ where, data }: any) => {
        const existing = callsStore.get(where.id);
        if (!existing) throw new Error('Call not found');
        const updated = { ...existing, ...data, updatedAt: new Date() };
        callsStore.set(where.id, updated);
        return updated;
      },
    },
    callAttempt: {
      create: async ({ data }: any) => {
        const record = { id: `att_${crypto.randomUUID()}`, ...data, startedAt: new Date() };
        callAttemptsStore.set(record.id, record);
        return record;
      },
      count: async () => callAttemptsStore.size,
    },
    callEvent: {
      create: async ({ data }: any) => {
        const record = { id: `evt_${crypto.randomUUID()}`, ...data, occurredAt: new Date() };
        callEventsStore.set(record.id, record);
        return record;
      },
      findMany: async () => Array.from(callEventsStore.values()),
    },
    task: {
      create: async ({ data }: any) => {
        const record: Task = {
          id: crypto.randomUUID(),
          dueAt: null,
          completedAt: null,
          crmActivityId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        tasksStore.set(record.id, record);
        return record;
      },
      findFirst: async ({ where }: any) => {
        return Array.from(tasksStore.values()).find((t) => !where.id || t.id === where.id) || null;
      },
      findMany: async ({ where }: any) => {
        return Array.from(tasksStore.values()).filter((t) => {
          if (where?.status && t.status !== where.status) return false;
          if (where?.lead?.workspaceId) {
            const lead = leadsStore.get(t.leadId);
            if (!lead || lead.workspaceId !== where.lead.workspaceId) return false;
          }
          return true;
        });
      },
      count: async ({ where }: any) => {
        return Array.from(tasksStore.values()).filter((t) => {
          if (where?.status && t.status !== where.status) return false;
          if (where?.lead?.workspaceId) {
            const lead = leadsStore.get(t.leadId);
            if (!lead || lead.workspaceId !== where.lead.workspaceId) return false;
          }
          return true;
        }).length;
      },
      update: async ({ where, data }: any) => {
        const existing = tasksStore.get(where.id);
        if (!existing) throw new Error('Task not found');
        const updated = { ...existing, ...data, updatedAt: new Date() };
        tasksStore.set(where.id, updated);
        return updated;
      },
    },
    cRMActivity: {
      create: async ({ data }: any) => {
        const record = { id: `crm_${crypto.randomUUID()}`, ...data, createdAt: new Date() };
        crmActivitiesStore.set(record.id, record);
        return record;
      },
      findMany: async () => Array.from(crmActivitiesStore.values()),
    },
    suppression: {
      findFirst: async ({ where }: any) => {
        return (
          Array.from(suppressionsStore.values()).find((s) => {
            if (s.workspaceId !== where.workspaceId) return false;
            if (where.type && s.type !== where.type) return false;
            if (where.value && s.value === where.value) return true;
            return false;
          }) || null
        );
      },
      create: async ({ data }: any) => {
        const record = { id: `sup_${crypto.randomUUID()}`, ...data, createdAt: new Date() };
        suppressionsStore.set(record.id, record);
        return record;
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        const record = { id: `audit_${crypto.randomUUID()}`, ...data, createdAt: new Date() };
        auditLogsStore.set(record.id, record);
        return record;
      },
    },
    notification: {
      create: async ({ data }: any) => ({ id: `notif_${crypto.randomUUID()}`, ...data, isRead: false, createdAt: new Date() }),
    },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(mockPrisma),
  } as unknown as PrismaClient;

  databaseClient.setPrismaClient(mockPrisma);

  const ws1 = 'ws_operations_1';
  const ws2 = 'ws_operations_2';
  const tokenWs1 = signAuthToken({
    userId: 'user_ops_1',
    workspaceId: ws1,
    role: 'OWNER',
    email: 'ops_owner@closevds.local',
  });
  const tokenWs2 = signAuthToken({
    userId: 'user_ops_2',
    workspaceId: ws2,
    role: 'OWNER',
    email: 'ops_owner2@closevds.local',
  });

  const app = await buildApp();

  // =========================================================================
  // Test 1: Workspace Calling Policy Endpoints & Auto-Creation
  // =========================================================================
  console.log('Test 1: Workspace Calling Policy Endpoints & Auto-Creation...');

  const getPolicyRes = await app.inject({
    method: 'GET',
    url: '/api/v1/voice/policy',
    headers: { authorization: `Bearer ${tokenWs1}` },
  });

  assert.equal(getPolicyRes.statusCode, 200);
  const policy = JSON.parse(getPolicyRes.payload).data;
  assert.equal(policy.workspaceId, ws1);
  assert.equal(policy.dailyCallLimit, 25);
  assert.equal(policy.maxConcurrentCalls, 1);
  assert.equal(policy.isActive, true);

  const updatePolicyRes = await app.inject({
    method: 'PUT',
    url: '/api/v1/voice/policy',
    headers: { authorization: `Bearer ${tokenWs1}` },
    payload: {
      dailyCallLimit: 50,
      maxConcurrentCalls: 3,
      retryDelayMinutes: 90,
      allowedCallingDays: [0, 1, 2, 3, 4, 5, 6],
      callingWindowStart: '00:00',
      callingWindowEnd: '23:59',
    },
  });

  assert.equal(updatePolicyRes.statusCode, 200);
  const updatedPolicy = JSON.parse(updatePolicyRes.payload).data;
  assert.equal(updatedPolicy.dailyCallLimit, 50);
  assert.equal(updatedPolicy.maxConcurrentCalls, 3);
  assert.equal(updatedPolicy.retryDelayMinutes, 90);
  assert.equal(updatedPolicy.callingWindowStart, '00:00');
  assert.equal(updatedPolicy.callingWindowEnd, '23:59');
  console.log('✓ Workspace Calling Policy verified');

  // =========================================================================
  // Test 2: Voice Agent Config with Fallback Behavior
  // =========================================================================
  console.log('Test 2: Voice Agent Config with Fallback Behavior...');

  const agentConfigRes = await app.inject({
    method: 'POST',
    url: '/api/v1/voice/agent-configs',
    headers: { authorization: `Bearer ${tokenWs1}` },
    payload: {
      name: 'Austin Dental AI Agent',
      callObjective: 'Verify mobile website usability findings with clinic director',
      openingScript: 'Hello, this is Alex calling from Client Growth Solutions.',
      fallbackBehavior: 'Leave clear voicemail and create follow-up task',
      prohibitedClaims: ['Guaranteed 10x ROI', 'Free medical treatment'],
      qualificationQuestions: ['Are you currently accepting new patients?'],
      approvedTalkingPoints: ['We noticed mobile layout issues on your booking page'],
      maxDurationSeconds: 180,
    },
  });

  assert.equal(agentConfigRes.statusCode, 201);
  const agentConfig = JSON.parse(agentConfigRes.payload).data;
  assert.equal(agentConfig.name, 'Austin Dental AI Agent');
  assert.equal(agentConfig.fallbackBehavior, 'Leave clear voicemail and create follow-up task');
  console.log('✓ Voice Agent Config created and decoupled from campaigns');

  // =========================================================================
  // Test 3: Campaign-Independent Call Preparation & Pre-Flight Safety
  // =========================================================================
  console.log('Test 3: Campaign-Independent Call Preparation & Pre-Flight Safety...');

  // Create test lead & contact without campaignId
  const seedLead: any = {
    id: crypto.randomUUID(),
    workspaceId: ws1,
    campaignId: null,
    businessName: 'Apex Dental Care',
    domain: 'apexdental.local',
    phone: '+15125550188',
    address: '200 Congress Ave, Austin, TX',
    status: 'CALL_READY',
    score: 85,
    enrichmentData: { niche: 'Dentistry', verified: true },
    researchNotes: 'Website mobile navigation is sluggish',
    qualificationAnswers: { acceptsPatients: true },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  leadsStore.set(seedLead.id, seedLead);

  const seedContact: any = {
    id: crypto.randomUUID(),
    leadId: seedLead.id,
    fullName: 'Sarah Connor',
    email: 'sarah@apexdental.local',
    phone: '+15125550188',
    title: 'Practice Manager',
    isPrimary: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  contactsStore.set(seedContact.id, seedContact);

  const prepRes = await app.inject({
    method: 'POST',
    url: '/api/v1/voice/calls/prepare',
    headers: { authorization: `Bearer ${tokenWs1}` },
    payload: {
      leadId: seedLead.id,
      contactId: seedContact.id,
      agentConfigId: agentConfig.id,
    },
  });

  assert.equal(prepRes.statusCode, 200);
  const prepBody = JSON.parse(prepRes.payload).data;
  assert.equal(prepBody.status, 'BLOCKED');
  assert.equal(prepBody.safetyCheck.passed, false);
  assert.match(prepBody.safetyCheck.blockedReason, /Telephony Provider Configured Gate/);
  assert.equal(prepBody.normalizedPhone, '+15125550188');
  assert.equal(prepBody.requiresApproval, true);
  assert.ok(prepBody.groundedContext);
  assert.equal(prepBody.groundedContext.verifiedFacts.businessName, 'Apex Dental Care');
  assert.equal(prepBody.groundedContext.verifiedFacts.contactPerson, 'Sarah Connor');
  console.log('✓ Campaign-independent call preparation and honest Gate 15 safety check succeeded');

  // =========================================================================
  // Test 4: Campaign-Independent Call Creation in Call Queue (QUEUED status)
  // =========================================================================
  console.log('Test 4: Campaign-Independent Call Creation in Call Queue...');

  const createCallRes = await app.inject({
    method: 'POST',
    url: '/api/v1/voice/calls',
    headers: { authorization: `Bearer ${tokenWs1}` },
    payload: {
      leadId: seedLead.id,
      contactId: seedContact.id,
      agentConfigId: agentConfig.id,
    },
  });

  assert.equal(createCallRes.statusCode, 201);
  const createdCall = JSON.parse(createCallRes.payload).data;
  assert.equal(createdCall.status, 'APPROVAL_REQUIRED');
  assert.equal(createdCall.humanApprovalRequired, true);
  assert.equal(createdCall.isApproved, false);
  assert.ok(!createdCall.campaignId);
  console.log('✓ Call placed in call queue without campaign dependency');

  // =========================================================================
  // Test 5: Operations Summary Endpoint (Canonical Acquisition Pipeline)
  // =========================================================================
  console.log('Test 5: Operations Summary Endpoint...');

  const summaryRes = await app.inject({
    method: 'GET',
    url: '/api/v1/operations/summary',
    headers: { authorization: `Bearer ${tokenWs1}` },
  });

  assert.equal(summaryRes.statusCode, 200);
  const summary = JSON.parse(summaryRes.payload).data;
  assert.ok(summary.leadPool);
  assert.equal(typeof summary.leadPool.total, 'number');
  assert.ok(summary.voicePipeline);
  assert.equal(summary.voicePipeline.callReady, 1);
  assert.equal(summary.voicePipeline.approvalRequired, 1);
  assert.ok(summary.conversions);
  assert.ok(summary.systemHealth);
  assert.equal(summary.systemHealth.callingPolicyActive, true);
  assert.equal(summary.systemHealth.agentConfigsCount, 1);
  console.log('✓ Operations summary returns honest real-time metrics');

  // =========================================================================
  // Test 6: Operations Tasks & Approval Actions
  // =========================================================================
  console.log('Test 6: Operations Tasks & Approval Actions...');

  const tasksRes = await app.inject({
    method: 'GET',
    url: '/api/v1/operations/tasks',
    headers: { authorization: `Bearer ${tokenWs1}` },
  });

  assert.equal(tasksRes.statusCode, 200);
  const tasks = JSON.parse(tasksRes.payload).data;
  assert.ok(Array.isArray(tasks));
  assert.ok(tasks.length >= 1);

  const approvalTask = tasks.find((t: any) => t.category === 'approvals' && t.targetId === createdCall.id);
  assert.ok(approvalTask, 'Approval task for queued call must be generated');

  // Approve the task via Operations domain
  const approveRes = await app.inject({
    method: 'POST',
    url: `/api/v1/operations/tasks/${approvalTask.id}/approve`,
    headers: { authorization: `Bearer ${tokenWs1}` },
  });

  assert.equal(approveRes.statusCode, 200);
  const approveResult = JSON.parse(approveRes.payload).data;
  assert.equal(approveResult.isApproved, true);
  assert.equal(approveResult.status, 'APPROVED');

  // Verify call in store is now approved
  const callInStore = callsStore.get(createdCall.id);
  assert.equal(callInStore?.isApproved, true);
  console.log('✓ Task approval via operations workspace succeeded');

  // =========================================================================
  // Test 7: Human Approval Invalidation Guardrail
  // =========================================================================
  console.log('Test 7: Human Approval Invalidation Guardrail...');

  // Modifying the call's parameters must invalidate approval
  const invalidateResult = await voiceService.invalidateCallApproval(
    createdCall.id,
    ws1,
    'user_ops_1',
    'Phone number modified by operator'
  );

  assert.equal(invalidateResult.isApproved, false);
  const recheckedCall = callsStore.get(createdCall.id);
  assert.equal(recheckedCall?.isApproved, false);
  console.log('✓ Human approval invalidated upon context modification');

  // =========================================================================
  // Test 8: Operations Call Queue & Prioritization
  // =========================================================================
  console.log('Test 8: Operations Call Queue & Prioritization...');

  const queueRes = await app.inject({
    method: 'GET',
    url: '/api/v1/operations/queue',
    headers: { authorization: `Bearer ${tokenWs1}` },
  });

  assert.equal(queueRes.statusCode, 200);
  const queueItems = JSON.parse(queueRes.payload).data;
  assert.ok(Array.isArray(queueItems));
  assert.equal(queueItems.length, 1);
  assert.equal(queueItems[0].businessName, 'Apex Dental Care');
  assert.equal(queueItems[0].recipientPhone, '+15125550188');

  // Reprioritize queue item
  const prioritizeRes = await app.inject({
    method: 'POST',
    url: `/api/v1/operations/queue/${createdCall.id}/prioritize`,
    headers: { authorization: `Bearer ${tokenWs1}` },
    payload: {
      priority: 5,
    },
  });

  assert.equal(prioritizeRes.statusCode, 200);
  const prioritizeResult = JSON.parse(prioritizeRes.payload).data;
  assert.equal(prioritizeResult.id, createdCall.id);
  assert.ok(prioritizeResult.scheduledAt);
  console.log('✓ Queue querying and prioritization verified');

  // =========================================================================
  // Test 9: Lead Pool Lifecycle Stage Transitions
  // =========================================================================
  console.log('Test 9: Lead Pool Lifecycle Stage Transitions...');

  // Progress lead from CALL_READY -> CONTACTED -> INTERESTED -> MEETING -> WON
  const updateStageRes1 = await app.inject({
    method: 'PATCH',
    url: `/api/v1/crm/leads/${seedLead.id}/stage`,
    headers: { authorization: `Bearer ${tokenWs1}` },
    payload: { status: 'CONTACTED' },
  });
  assert.equal(updateStageRes1.statusCode, 200);

  const updateStageRes2 = await app.inject({
    method: 'PATCH',
    url: `/api/v1/crm/leads/${seedLead.id}/stage`,
    headers: { authorization: `Bearer ${tokenWs1}` },
    payload: { status: 'INTERESTED' },
  });
  assert.equal(updateStageRes2.statusCode, 200);

  const updateStageRes3 = await app.inject({
    method: 'PATCH',
    url: `/api/v1/crm/leads/${seedLead.id}/stage`,
    headers: { authorization: `Bearer ${tokenWs1}` },
    payload: { status: 'MEETING' },
  });
  assert.equal(updateStageRes3.statusCode, 200);

  const updateStageRes4 = await app.inject({
    method: 'PATCH',
    url: `/api/v1/crm/leads/${seedLead.id}/stage`,
    headers: { authorization: `Bearer ${tokenWs1}` },
    payload: { status: 'WON' },
  });
  assert.equal(updateStageRes4.statusCode, 200);
  console.log('✓ Lead pool canonical acquisition transitions verified');

  // =========================================================================
  // Test 10: Acquisition Funnel Analytics
  // =========================================================================
  console.log('Test 10: Acquisition Funnel Analytics...');

  const funnelRes = await app.inject({
    method: 'GET',
    url: '/api/v1/analytics/acquisition-funnel',
    headers: { authorization: `Bearer ${tokenWs1}` },
  });

  assert.equal(funnelRes.statusCode, 200);
  const funnel = JSON.parse(funnelRes.payload).data;
  assert.ok(funnel.leadPool);
  assert.ok(funnel.voiceQueue);
  assert.ok(funnel.conversions);
  assert.equal(funnel.conversions.won, 1);
  console.log('✓ Acquisition funnel analytics computed without campaign dependency');

  // =========================================================================
  // Test 11: closeBDS Honest Sync Endpoint
  // =========================================================================
  console.log('Test 11: closeBDS Honest Sync Endpoint...');

  const syncRes = await app.inject({
    method: 'POST',
    url: '/api/v1/lead-discovery/sync-closebds',
    headers: { authorization: `Bearer ${tokenWs1}` },
    payload: {
      niche: 'Dental',
      location: 'Austin, TX',
      limit: 10,
    },
  });

  assert.equal(syncRes.statusCode, 200);
  const syncBody = JSON.parse(syncRes.payload);
  assert.equal(syncBody.configured, false);
  assert.equal(syncBody.status, 'NOT_CONFIGURED');
  assert.equal(syncBody.syncedCount, 0);
  assert.match(syncBody.message, /CLOSEBDS_API_KEY/);
  console.log('✓ closeBDS sync returns honest NOT_CONFIGURED state');

  // =========================================================================
  // Test 12: Cross-Workspace Tenant Isolation
  // =========================================================================
  console.log('Test 12: Cross-Workspace Tenant Isolation...');

  const crossWsPolicyRes = await app.inject({
    method: 'PUT',
    url: '/api/v1/voice/policy',
    headers: { authorization: `Bearer ${tokenWs2}` },
    payload: {
      dailyCallLimit: 10,
    },
  });

  assert.equal(crossWsPolicyRes.statusCode, 200);
  // Ensure workspace 1 policy was not modified by workspace 2
  const ws1Policy = callingPoliciesStore.get(ws1);
  assert.equal(ws1Policy?.dailyCallLimit, 50);

  // Attempt to prioritize workspace 1 call using workspace 2 credentials
  const crossPrioritizeRes = await app.inject({
    method: 'POST',
    url: `/api/v1/operations/queue/${createdCall.id}/prioritize`,
    headers: { authorization: `Bearer ${tokenWs2}` },
    payload: { priority: 1 },
  });

  assert.equal(crossPrioritizeRes.statusCode, 404);
  console.log('✓ Strict multi-tenant isolation enforced on operations and voice policies');

  console.log('\n--- All Operations Workspace & Acquisition Architecture Tests Passed Successfully ---');
}

runOperationsWorkspaceTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
