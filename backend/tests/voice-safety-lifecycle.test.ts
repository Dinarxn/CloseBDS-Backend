import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server/app.js';
import { signAuthToken } from '../src/modules/auth/token.js';
import { normalizePhoneNumber, VoiceSafetyEvaluator } from '../src/modules/voice/voice.safety.js';
import {
  isValidCallTransition,
  assertValidCallTransition,
  isTerminalCallStatus,
} from '../src/modules/voice/voice.lifecycle.js';
import { databaseClient } from '../src/database/client.js';
import { BadRequestError } from '../src/core/errors/api-error.js';
import type {
  CallStatus,
  VoiceCampaign,
  Campaign,
  Lead,
  Contact,
  VoiceAgentConfig,
  Suppression,
  Call,
  CallAttempt,
  CallEvent,
  PrismaClient,
} from '@prisma/client';
import type { CallWithRelations } from '../src/database/repository.js';

async function runVoiceSafetyLifecycleTests() {
  console.log('\n--- Starting closeVDS Voice Safety & Lifecycle Tests ---');

  // In-memory test stores
  const campaignsStore: Map<string, Campaign> = new Map();
  const leadsStore: Map<string, Lead> = new Map();
  const contactsStore: Map<string, Contact> = new Map();
  const voiceCampaignsStore: Map<string, VoiceCampaign> = new Map();
  const voiceAgentConfigsStore: Map<string, VoiceAgentConfig> = new Map();
  const callsStore: Map<string, Call> = new Map();
  const callAttemptsStore: Map<string, CallAttempt> = new Map();
  const callEventsStore: Map<string, CallEvent> = new Map();
  const suppressionsStore: Map<string, Suppression> = new Map();
  const workspaceCallingPoliciesStore: Map<string, any> = new Map();

  const mockPrisma = {
    workspaceCallingPolicy: {
      findUnique: async ({ where }: any) => {
        return workspaceCallingPoliciesStore.get(where.workspaceId) || null;
      },
      upsert: async ({ create, update, where }: any) => {
        const existing = workspaceCallingPoliciesStore.get(where.workspaceId);
        const data = existing ? { ...existing, ...update } : { id: `wcp_${Date.now()}`, ...create };
        workspaceCallingPoliciesStore.set(where.workspaceId, data);
        return data;
      },
      update: async ({ where, data }: any) => {
        const existing = workspaceCallingPoliciesStore.get(where.workspaceId);
        const updated = { ...existing, ...data };
        workspaceCallingPoliciesStore.set(where.workspaceId, updated);
        return updated;
      },
    },
    campaign: {
      findFirst: async ({ where }: { where: { id?: string; workspaceId?: string } }) => {
        for (const c of campaignsStore.values()) {
          const matchId = !where.id || c.id === where.id;
          const matchWs = !where.workspaceId || c.workspaceId === where.workspaceId;
          if (matchId && matchWs) {
            const vc = voiceCampaignsStore.get(c.id);
            const agentConfig = vc?.agentConfigId ? voiceAgentConfigsStore.get(vc.agentConfigId) || null : null;
            return {
              ...c,
              voiceCampaign: vc ? { ...vc, agentConfig } : null,
            };
          }
        }
        return null;
      },
      findMany: async ({ where }: { where: { workspaceId?: string } }) => {
        return Array.from(campaignsStore.values()).filter(
          (c) => !where?.workspaceId || c.workspaceId === where.workspaceId
        );
      },
    },
    voiceCampaign: {
      upsert: async ({ create, update, where }: any) => {
        const existing = voiceCampaignsStore.get(where.campaignId);
        const data = existing ? { ...existing, ...update } : { id: `vc_${Date.now()}`, ...create };
        voiceCampaignsStore.set(where.campaignId, data);
        return data;
      },
      findFirst: async ({ where }: any) => {
        return Array.from(voiceCampaignsStore.values()).find(
          (vc) => !where.campaignId || vc.campaignId === where.campaignId
        ) || null;
      },
    },
    voiceAgentConfig: {
      create: async ({ data }: any) => {
        const record = { id: crypto.randomUUID(), ...data, createdAt: new Date(), updatedAt: new Date() };
        voiceAgentConfigsStore.set(record.id, record);
        return record;
      },
      findFirst: async ({ where }: any) => {
        return Array.from(voiceAgentConfigsStore.values()).find(
          (c) => (!where.id || c.id === where.id) && (!where.workspaceId || c.workspaceId === where.workspaceId)
        ) || null;
      },
      findMany: async ({ where }: any) => {
        return Array.from(voiceAgentConfigsStore.values()).filter(
          (c) => !where?.workspaceId || c.workspaceId === where.workspaceId
        );
      },
      update: async ({ where, data }: any) => {
        const existing = voiceAgentConfigsStore.get(where.id);
        if (!existing) throw new Error('Not found');
        const updated = { ...existing, ...data };
        voiceAgentConfigsStore.set(where.id, updated);
        return updated;
      },
    },
    call: {
      create: async ({ data }: any) => {
        const record = {
          id: crypto.randomUUID(),
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        callsStore.set(record.id, record);
        return record;
      },
      findFirst: async ({ where }: any) => {
        const call = Array.from(callsStore.values()).find(
          (c) => (!where.id || c.id === where.id) && (!where.workspaceId || c.workspaceId === where.workspaceId)
        );
        if (!call) return null;
        const campaign = campaignsStore.get(call.campaignId)!;
        const voiceCampaign = voiceCampaignsStore.get(call.voiceCampaignId)!;
        const lead = leadsStore.get(call.leadId)!;
        const contact = contactsStore.get(call.contactId)!;
        const agentConfig = call.agentConfigId ? voiceAgentConfigsStore.get(call.agentConfigId) || null : null;
        return {
          ...call,
          campaign,
          voiceCampaign,
          lead,
          contact,
          agentConfig,
          attempts: Array.from(callAttemptsStore.values()).filter((a) => a.callId === call.id),
          events: Array.from(callEventsStore.values()).filter((e) => e.callId === call.id),
          transcripts: [],
          outcome: null,
        };
      },
      findUnique: async ({ where }: any) => {
        if (where.unique_workspace_call_idempotency) {
          const { workspaceId, idempotencyKey } = where.unique_workspace_call_idempotency;
          return Array.from(callsStore.values()).find(
            (c) => c.workspaceId === workspaceId && c.idempotencyKey === idempotencyKey
          ) || null;
        }
        return callsStore.get(where.id) || null;
      },
      findMany: async () => Array.from(callsStore.values()),
      count: async () => callsStore.size,
      update: async ({ where, data }: any) => {
        const existing = callsStore.get(where.id);
        if (!existing) throw new Error('Not found');
        const updated = { ...existing, ...data };
        callsStore.set(where.id, updated);
        return updated;
      },
    },
    callAttempt: {
      create: async ({ data }: any) => {
        const record = { id: `att_${Date.now()}`, ...data, startedAt: new Date() };
        callAttemptsStore.set(record.id, record);
        return record;
      },
      count: async () => callAttemptsStore.size,
      update: async ({ where, data }: any) => {
        const existing = callAttemptsStore.get(where.id);
        if (!existing) throw new Error('Not found');
        const updated = { ...existing, ...data };
        callAttemptsStore.set(where.id, updated);
        return updated;
      },
    },
    callEvent: {
      create: async ({ data }: any) => {
        const record = { id: `evt_${Date.now()}`, ...data, occurredAt: new Date() };
        callEventsStore.set(record.id, record);
        return record;
      },
      findMany: async () => Array.from(callEventsStore.values()),
    },
    suppression: {
      findFirst: async ({ where }: any) => {
        return Array.from(suppressionsStore.values()).find((s) => {
          if (s.workspaceId !== where.workspaceId) return false;
          if (where.type && s.type !== where.type) return false;
          if (where.value && typeof where.value === 'string' && s.value === where.value) return true;
          if (where.value?.in && where.value.in.includes(s.value)) return true;
          return false;
        }) || null;
      },
      create: async ({ data }: any) => {
        const record = { id: `sup_${Date.now()}`, ...data, createdAt: new Date() };
        suppressionsStore.set(record.id, record);
        return record;
      },
    },
    auditLog: {
      create: async ({ data }: any) => ({ id: `audit_${Date.now()}`, ...data, createdAt: new Date() }),
    },
    notification: {
      create: async ({ data }: any) => ({ id: `notif_${Date.now()}`, ...data, isRead: false, createdAt: new Date() }),
    },
    cRMActivity: {
      create: async ({ data }: any) => ({ id: `crm_${Date.now()}`, ...data, createdAt: new Date() }),
    },
    lead: {
      findFirst: async ({ where }: any) => {
        return Array.from(leadsStore.values()).find(
          (l) => (!where.id || l.id === where.id) && (!where.workspaceId || l.workspaceId === where.workspaceId)
        ) || null;
      },
      update: async ({ where, data }: any) => {
        const existing = leadsStore.get(where.id);
        if (!existing) throw new Error('Not found');
        const updated = { ...existing, ...data };
        leadsStore.set(where.id, updated);
        return updated;
      },
    },
    contact: {
      findFirst: async ({ where }: any) => {
        return Array.from(contactsStore.values()).find(
          (c) => (!where.id || c.id === where.id) && (!where.leadId || c.leadId === where.leadId)
        ) || null;
      },
    },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(mockPrisma),
  } as unknown as PrismaClient;

  databaseClient.setPrismaClient(mockPrisma);

  // =========================================================================
  // Test 1: Strict E.164 Phone Normalization
  // =========================================================================
  console.log('Test 1: Strict E.164 Phone Normalization...');
  assert.equal(normalizePhoneNumber('+1 (415) 555-2671'), '+14155552671');
  assert.equal(normalizePhoneNumber('4155552671'), '+14155552671');
  assert.equal(normalizePhoneNumber('14155552671'), '+14155552671');
  assert.equal(normalizePhoneNumber('+44 20 7946 0958'), '+442079460958');
  assert.equal(normalizePhoneNumber('00442079460958'), '+442079460958');
  assert.equal(normalizePhoneNumber('+61.2.9374.4000'), '+61293744000');

  assert.throws(
    () => normalizePhoneNumber(''),
    (err: unknown) => err instanceof BadRequestError,
    'Empty phone must throw BadRequestError'
  );
  assert.throws(
    () => normalizePhoneNumber('123'),
    (err: unknown) => err instanceof BadRequestError,
    'Short phone must throw BadRequestError'
  );
  assert.throws(
    () => normalizePhoneNumber('invalid-phone-string'),
    (err: unknown) => err instanceof BadRequestError,
    'Non-numeric phone must throw BadRequestError'
  );
  console.log('✓ E.164 Phone Normalizer successfully validated');

  // =========================================================================
  // Test 2: Authoritative Call State Machine Transitions
  // =========================================================================
  console.log('Test 2: Authoritative Call State Machine Transitions...');

  // Valid forward progressions
  assert.equal(isValidCallTransition('QUEUED', 'SAFETY_CHECKING'), true);
  assert.equal(isValidCallTransition('SAFETY_CHECKING', 'APPROVAL_REQUIRED'), true);
  assert.equal(isValidCallTransition('APPROVAL_REQUIRED', 'APPROVED'), true);
  assert.equal(isValidCallTransition('APPROVED', 'INITIATING'), true);
  assert.equal(isValidCallTransition('INITIATING', 'RINGING'), true);
  assert.equal(isValidCallTransition('RINGING', 'IN_PROGRESS'), true);
  assert.equal(isValidCallTransition('IN_PROGRESS', 'COMPLETED'), true);
  assert.equal(isValidCallTransition('IN_PROGRESS', 'OPTED_OUT'), true);

  // Approval invalidation transition
  assert.equal(isValidCallTransition('APPROVED', 'APPROVAL_REQUIRED'), true);

  // Invalid jump disallowance
  assert.equal(isValidCallTransition('QUEUED', 'INITIATING'), false);
  assert.equal(isValidCallTransition('APPROVAL_REQUIRED', 'IN_PROGRESS'), false);
  assert.equal(isValidCallTransition('COMPLETED', 'INITIATING'), false);
  assert.equal(isValidCallTransition('OPTED_OUT', 'INITIATING'), false);

  // Terminal state assertions
  assert.equal(isTerminalCallStatus('COMPLETED'), true);
  assert.equal(isTerminalCallStatus('FAILED'), true);
  assert.equal(isTerminalCallStatus('OPTED_OUT'), true);
  assert.equal(isTerminalCallStatus('IN_PROGRESS'), false);

  assert.throws(
    () => assertValidCallTransition('QUEUED', 'IN_PROGRESS'),
    (err: unknown) => err instanceof BadRequestError,
    'Illegal jump from QUEUED directly to IN_PROGRESS must throw'
  );
  console.log('✓ Call State Machine transitions and terminal boundaries verified');

  // =========================================================================
  // Test 3: 18-Point Voice Safety Evaluator
  // =========================================================================
  console.log('Test 3: 18-Point Voice Safety Evaluator...');

  const mockEvaluator = new VoiceSafetyEvaluator();

  const baseVoiceCampaign: VoiceCampaign = {
    id: 'vc_1',
    campaignId: 'camp_1',
    dailyCallCap: 25,
    maxAttemptsPerLead: 3,
    retryDelayMinutes: 120,
    allowedCallingDays: [1, 2, 3, 4, 5],
    callingWindowStart: '09:00',
    callingWindowEnd: '17:00',
    recordingConsent: true,
    agentConfigId: 'cfg_1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const baseCampaign: Campaign = {
    id: 'camp_1',
    workspaceId: 'ws_test',
    name: 'Dentists Outreach',
    niche: 'Dental',
    location: 'Austin, TX',
    targetOffer: 'Free SEO Audit',
    dailyCap: 50,
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const baseLead: Lead = {
    id: 'lead_1',
    workspaceId: 'ws_test',
    campaignId: 'camp_1',
    businessName: 'Austin Dental Care',
    domain: 'austindental.com',
    phone: '+15125550199',
    address: '123 Congress Ave',
    status: 'QUALIFIED',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const baseContact: Contact = {
    id: 'cnt_1',
    leadId: 'lead_1',
    fullName: 'Dr. Jane Smith',
    email: 'jane@austindental.com',
    title: 'Owner & Dentist',
    phone: '+15125550199',
    isPrimary: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const baseAgentConfig: VoiceAgentConfig = {
    id: 'cfg_1',
    workspaceId: 'ws_test',
    name: 'Dental Qualification Agent',
    callObjective: 'Identify website booking issues',
    openingScript: 'Hi, Dr. Jane Smith?',
    qualificationQuestions: ['Do you accept new patients?'],
    approvedTalkingPoints: ['We found mobile issues on your website'],
    objectionHandling: {},
    prohibitedClaims: ['No pricing guarantees'],
    escalationConditions: [],
    maxDurationSeconds: 300,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // 3a. Gate 1: Human Approval Check
  const unapprovedCall = {
    id: 'call_1',
    workspaceId: 'ws_test',
    humanApprovalRequired: true,
    isApproved: false,
    attempts: [],
  } as unknown as CallWithRelations;

  const resultUnapproved = await mockEvaluator.evaluate({
    workspaceId: 'ws_test',
    campaignId: 'camp_1',
    leadId: 'lead_1',
    contactId: 'cnt_1',
    recipientPhone: '+15125550199',
    normalizedPhone: '+15125550199',
    voiceCampaign: baseVoiceCampaign,
    campaign: baseCampaign,
    lead: baseLead,
    contact: baseContact,
    agentConfig: baseAgentConfig,
    currentCall: unapprovedCall,
    currentTime: new Date(2026, 7, 31, 11, 0, 0),
  });

  assert.equal(resultUnapproved.passed, false);
  assert.match(resultUnapproved.blockedReason || '', /Human Approval Gate/);

  // 3b. Gate 2: Workspace Isolation
  const resultCrossWs = await mockEvaluator.evaluate({
    workspaceId: 'ws_other',
    campaignId: 'camp_1',
    leadId: 'lead_1',
    contactId: 'cnt_1',
    recipientPhone: '+15125550199',
    normalizedPhone: '+15125550199',
    voiceCampaign: baseVoiceCampaign,
    campaign: baseCampaign,
    lead: baseLead,
    contact: baseContact,
    agentConfig: baseAgentConfig,
    currentTime: new Date(2026, 7, 31, 11, 0, 0),
  });

  assert.equal(resultCrossWs.passed, false);
  assert.match(resultCrossWs.blockedReason || '', /Workspace Multi-Tenant Isolation Gate/);

  // 3c. Gate 3: Suppression Check
  suppressionsStore.set('sup_1', {
    id: 'sup_1',
    workspaceId: 'ws_test',
    type: 'PHONE',
    value: '+15125550199',
    reason: 'OPT_OUT',
    createdAt: new Date(),
  });

  const resultSuppressed = await mockEvaluator.evaluate({
    workspaceId: 'ws_test',
    campaignId: 'camp_1',
    leadId: 'lead_1',
    contactId: 'cnt_1',
    recipientPhone: '+15125550199',
    normalizedPhone: '+15125550199',
    voiceCampaign: baseVoiceCampaign,
    campaign: baseCampaign,
    lead: baseLead,
    contact: baseContact,
    agentConfig: baseAgentConfig,
    currentTime: new Date(2026, 7, 31, 11, 0, 0),
  });

  assert.equal(resultSuppressed.passed, false);
  assert.match(resultSuppressed.blockedReason || '', /Phone Suppression/);
  suppressionsStore.clear();

  // 3d. Gate 5: Campaign Not Active
  const resultInactiveCamp = await mockEvaluator.evaluate({
    workspaceId: 'ws_test',
    campaignId: 'camp_1',
    leadId: 'lead_1',
    contactId: 'cnt_1',
    recipientPhone: '+15125550199',
    normalizedPhone: '+15125550199',
    voiceCampaign: baseVoiceCampaign,
    campaign: { ...baseCampaign, status: 'PAUSED' },
    lead: baseLead,
    contact: baseContact,
    agentConfig: baseAgentConfig,
    currentTime: new Date(2026, 7, 31, 11, 0, 0),
  });

  assert.equal(resultInactiveCamp.passed, false);
  assert.match(resultInactiveCamp.blockedReason || '', /Campaign Active Status Gate/);

  // 3e. Gate 11: Disqualified Lead
  const resultDisqualified = await mockEvaluator.evaluate({
    workspaceId: 'ws_test',
    campaignId: 'camp_1',
    leadId: 'lead_1',
    contactId: 'cnt_1',
    recipientPhone: '+15125550199',
    normalizedPhone: '+15125550199',
    voiceCampaign: baseVoiceCampaign,
    campaign: baseCampaign,
    lead: { ...baseLead, status: 'DISQUALIFIED' },
    contact: baseContact,
    agentConfig: baseAgentConfig,
    currentTime: new Date(2026, 7, 31, 11, 0, 0),
  });

  assert.equal(resultDisqualified.passed, false);
  assert.match(resultDisqualified.blockedReason || '', /Lead Status Qualification Gate/);

  // 3f. Gate 12: Contact Association Mismatch
  const resultMismatchedContact = await mockEvaluator.evaluate({
    workspaceId: 'ws_test',
    campaignId: 'camp_1',
    leadId: 'lead_1',
    contactId: 'cnt_1',
    recipientPhone: '+15125550199',
    normalizedPhone: '+15125550199',
    voiceCampaign: baseVoiceCampaign,
    campaign: baseCampaign,
    lead: baseLead,
    contact: { ...baseContact, leadId: 'other_lead' },
    agentConfig: baseAgentConfig,
    currentTime: new Date(2026, 7, 31, 11, 0, 0),
  });

  assert.equal(resultMismatchedContact.passed, false);
  assert.match(resultMismatchedContact.blockedReason || '', /Contact Association Gate/);

  console.log('✓ 18-Point Voice Safety Evaluator accurately enforced safety checks');

  // =========================================================================
  // Test 4: Fastify Voice HTTP Endpoints & Workspace Scoping
  // =========================================================================
  console.log('Test 4: Fastify Voice HTTP Endpoints & Workspace Scoping...');

  const app = await buildApp();

  const ws1 = 'ws_voice_1';
  const ws2 = 'ws_voice_2';
  const tokenWs1 = signAuthToken({
    userId: 'user_voice_1',
    workspaceId: ws1,
    role: 'OWNER',
    email: 'owner@voice1.local',
  });
  const tokenWs2 = signAuthToken({
    userId: 'user_voice_2',
    workspaceId: ws2,
    role: 'OWNER',
    email: 'owner@voice2.local',
  });

  // Populate mock data for Fastify routes
  const seedCampaign: Campaign = {
    id: '11111111-1111-4111-8111-111111111111',
    workspaceId: ws1,
    name: 'Dentists Outreach Campaign',
    niche: 'Dental',
    location: 'Austin',
    targetOffer: 'Audit',
    dailyCap: 25,
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  campaignsStore.set(seedCampaign.id, seedCampaign);

  const seedLead: Lead = {
    id: '22222222-2222-4222-8222-222222222222',
    workspaceId: ws1,
    campaignId: seedCampaign.id,
    businessName: 'Dr. Smile Clinic',
    domain: 'drsmile.local',
    phone: '+15125550199',
    address: '100 Main St',
    status: 'QUALIFIED',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  leadsStore.set(seedLead.id, seedLead);

  const seedContact: Contact = {
    id: '33333333-3333-4333-8333-333333333333',
    leadId: seedLead.id,
    fullName: 'Dr. Robert Smile',
    email: 'robert@drsmile.local',
    title: 'Founder',
    phone: '+15125550199',
    isPrimary: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  contactsStore.set(seedContact.id, seedContact);

  // 4a. Agent Config Creation
  const resCreateCfg = await app.inject({
    method: 'POST',
    url: '/api/v1/voice/agent-configs',
    headers: {
      Authorization: `Bearer ${tokenWs1}`,
    },
    payload: {
      name: 'High-Impact Dental Closer',
      callObjective: 'Audit follow-up and appointment booking',
      openingScript: 'Hello, am I speaking with the practice manager?',
      qualificationQuestions: ['Do you have online booking?'],
      approvedTalkingPoints: ['Speed to lead optimization'],
      prohibitedClaims: ['No pricing guarantees'],
      maxDurationSeconds: 180,
    },
  });

  assert.equal(resCreateCfg.statusCode, 201);
  const cfgData = JSON.parse(resCreateCfg.body).data;
  assert.equal(cfgData.name, 'High-Impact Dental Closer');
  assert.equal(cfgData.workspaceId, ws1);

  // 4b. Multi-tenant access check: ws2 cannot read ws1 config
  const resGetCross = await app.inject({
    method: 'GET',
    url: `/api/v1/voice/agent-configs/${cfgData.id}`,
    headers: {
      Authorization: `Bearer ${tokenWs2}`,
    },
  });

  const bodyCross = JSON.parse(resGetCross.body);
  assert.equal(bodyCross.data, null);

  // 4c. Voice Campaign Configuration
  const resVoiceCamp = await app.inject({
    method: 'POST',
    url: `/api/v1/voice/campaigns/${seedCampaign.id}`,
    headers: {
      Authorization: `Bearer ${tokenWs1}`,
    },
    payload: {
      campaignId: seedCampaign.id,
      dailyCallCap: 30,
      maxAttemptsPerLead: 2,
      agentConfigId: cfgData.id,
    },
  });
  assert.equal(resVoiceCamp.statusCode, 200);

  // 4d. Create Call (enforces APPROVAL_REQUIRED)
  const resCreateCall = await app.inject({
    method: 'POST',
    url: '/api/v1/voice/calls',
    headers: {
      Authorization: `Bearer ${tokenWs1}`,
    },
    payload: {
      campaignId: seedCampaign.id,
      leadId: seedLead.id,
      contactId: seedContact.id,
      humanApprovalRequired: true,
    },
  });
  assert.equal(resCreateCall.statusCode, 201);
  const callData = JSON.parse(resCreateCall.body).data;
  assert.equal(callData.status, 'APPROVAL_REQUIRED');
  assert.equal(callData.humanApprovalRequired, true);
  assert.equal(callData.isApproved, false);

  // 4e. Human Approval Action
  const resApprove = await app.inject({
    method: 'POST',
    url: `/api/v1/voice/calls/${callData.id}/approve`,
    headers: {
      Authorization: `Bearer ${tokenWs1}`,
    },
  });
  assert.equal(resApprove.statusCode, 200);
  const approvedData = JSON.parse(resApprove.body).data;
  assert.equal(approvedData.status, 'APPROVED');
  assert.equal(approvedData.isApproved, true);

  // 4f. Unauthenticated rejection
  const resUnauth = await app.inject({
    method: 'GET',
    url: '/api/v1/voice/agent-configs',
  });
  assert.equal(resUnauth.statusCode, 401);

  await app.close();
  console.log('✓ Fastify Voice routes, permissions, and tenant isolation verified');

  console.log('--- All Voice Safety & Lifecycle Tests Passed Successfully ---\n');
}

runVoiceSafetyLifecycleTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
