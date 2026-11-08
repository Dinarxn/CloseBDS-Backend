import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server/app.js';
import { signAuthToken } from '../src/modules/auth/token.js';
import { normalizePhoneNumber, VoiceSafetyEvaluator, resolveTimezoneFromPhone } from '../src/modules/voice/voice.safety.js';
import { callingPolicyService } from '../src/modules/voice/calling-policy.service.js';
import { voiceService } from '../src/modules/voice/voice.service.js';
import { voiceRepository } from '../src/database/repository.js';
import { databaseClient } from '../src/database/client.js';
import { BadRequestError, ForbiddenError, KillSwitchActiveError } from '../src/core/errors/api-error.js';
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
  CallTranscript,
  WorkspaceCallingPolicy,
} from '@prisma/client';

async function runVoiceSafetyOperationsTests() {
  console.log('\n========================================================================');
  console.log('--- Starting closeVDS Voice Safety & Calling Operations Tests (M5 / R5) ---');
  console.log('========================================================================\n');

  // In-memory test stores
  const workspaceCallingPoliciesStore: Map<string, WorkspaceCallingPolicy> = new Map();
  const campaignsStore: Map<string, Campaign> = new Map();
  const voiceCampaignsStore: Map<string, VoiceCampaign> = new Map();
  const voiceAgentConfigsStore: Map<string, VoiceAgentConfig> = new Map();
  const leadsStore: Map<string, Lead> = new Map();
  const contactsStore: Map<string, Contact> = new Map();
  const callsStore: Map<string, Call> = new Map();
  const callAttemptsStore: Map<string, CallAttempt> = new Map();
  const callEventsStore: Map<string, CallEvent> = new Map();
  const callTranscriptsStore: Map<string, CallTranscript> = new Map();
  const suppressionsStore: Map<string, Suppression> = new Map();

  const wsId = 'ws_safety_ops_test';
  const otherWsId = 'ws_safety_ops_other';

  // Mock Prisma client mapping
  const mockPrisma = {
    workspaceCallingPolicy: {
      findUnique: async ({ where }: any) => {
        return workspaceCallingPoliciesStore.get(where.workspaceId) || null;
      },
      upsert: async ({ create, update, where }: any) => {
        const existing = workspaceCallingPoliciesStore.get(where.workspaceId);
        const data: WorkspaceCallingPolicy = existing
          ? ({ ...existing, ...update, updatedAt: new Date() } as WorkspaceCallingPolicy)
          : ({
              id: `wcp_${Date.now()}`,
              ...create,
              createdAt: new Date(),
              updatedAt: new Date(),
            } as WorkspaceCallingPolicy);
        workspaceCallingPoliciesStore.set(where.workspaceId, data);
        return data;
      },
      update: async ({ where, data }: any) => {
        const existing = workspaceCallingPoliciesStore.get(where.workspaceId);
        if (!existing) throw new Error('Policy not found');
        const updated = { ...existing, ...data, updatedAt: new Date() } as WorkspaceCallingPolicy;
        workspaceCallingPoliciesStore.set(where.workspaceId, updated);
        return updated;
      },
    },
    campaign: {
      findFirst: async ({ where }: any) => {
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
    },
    voiceCampaign: {
      findFirst: async ({ where }: any) => {
        return (
          Array.from(voiceCampaignsStore.values()).find(
            (vc) => !where.campaignId || vc.campaignId === where.campaignId
          ) || null
        );
      },
    },
    voiceAgentConfig: {
      create: async ({ data }: any) => {
        const record = { id: crypto.randomUUID(), ...data, createdAt: new Date(), updatedAt: new Date() };
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
    },
    lead: {
      findFirst: async ({ where }: any) => {
        return (
          Array.from(leadsStore.values()).find(
            (l) => (!where.id || l.id === where.id) && (!where.workspaceId || l.workspaceId === where.workspaceId)
          ) || null
        );
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
      findFirst: async ({ where }: any) => {
        return (
          Array.from(contactsStore.values()).find(
            (c) => (!where.id || c.id === where.id) && (!where.leadId || c.leadId === where.leadId)
          ) || null
        );
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
      findUnique: async ({ where }: any) => {
        if (where.id) return callsStore.get(where.id) || null;
        if (where.unique_workspace_call_idempotency) {
          const { workspaceId, idempotencyKey } = where.unique_workspace_call_idempotency;
          return (
            Array.from(callsStore.values()).find(
              (c) => c.workspaceId === workspaceId && c.idempotencyKey === idempotencyKey
            ) || null
          );
        }
        return null;
      },
      findFirst: async ({ where }: any) => {
        const call = Array.from(callsStore.values()).find((c) => {
          if (where.id && c.id !== where.id) return false;
          if (where.workspaceId && c.workspaceId !== where.workspaceId) return false;
          if (where.leadId && c.leadId !== where.leadId) return false;
          if (where.idempotencyKey && c.idempotencyKey !== where.idempotencyKey) return false;
          if (where.status) {
            if (typeof where.status === 'string' && c.status !== where.status) return false;
            if (where.status.in && !where.status.in.includes(c.status)) return false;
          }
          return true;
        });
        if (!call) return null;
        return {
          ...call,
          campaign: call.campaignId ? campaignsStore.get(call.campaignId) || null : null,
          voiceCampaign: call.voiceCampaignId ? voiceCampaignsStore.get(call.voiceCampaignId) || null : null,
          lead: leadsStore.get(call.leadId) || testLead,
          contact: contactsStore.get(call.contactId) || testContact,
          agentConfig: call.agentConfigId ? voiceAgentConfigsStore.get(call.agentConfigId) || null : null,
          attempts: Array.from(callAttemptsStore.values()).filter((a) => a.callId === call.id),
          events: Array.from(callEventsStore.values()).filter((e) => e.callId === call.id),
          transcripts: Array.from(callTranscriptsStore.values()).filter((t) => t.callId === call.id),
        };
      },
      findMany: async ({ where }: any) => {
        return Array.from(callsStore.values()).filter((c) => {
          if (where.workspaceId && c.workspaceId !== where.workspaceId) return false;
          if (where.campaignId && c.campaignId !== where.campaignId) return false;
          if (where.status && c.status !== where.status) return false;
          return true;
        });
      },
      update: async ({ where, data }: any) => {
        const existing = callsStore.get(where.id);
        if (!existing) throw new Error('Call not found');
        const updated = { ...existing, ...data, updatedAt: new Date() };
        callsStore.set(where.id, updated);
        return updated;
      },
      count: async ({ where }: any) => {
        return Array.from(callsStore.values()).filter((c) => {
          if (where.workspaceId && c.workspaceId !== where.workspaceId) return false;
          if (where.campaignId && c.campaignId !== where.campaignId) return false;
          return true;
        }).length;
      },
    },
    callAttempt: {
      create: async ({ data }: any) => {
        const record = { id: crypto.randomUUID(), ...data, startedAt: new Date() };
        callAttemptsStore.set(record.id, record);
        return record;
      },
      update: async ({ where, data }: any) => {
        const existing = callAttemptsStore.get(where.id);
        if (!existing) throw new Error('Attempt not found');
        const updated = { ...existing, ...data };
        callAttemptsStore.set(where.id, updated);
        return updated;
      },
      count: async ({ where }: any) => {
        return Array.from(callAttemptsStore.values()).filter((a) => {
          const call = callsStore.get(a.callId);
          return call && call.workspaceId === where.call?.workspaceId && call.leadId === where.call?.leadId;
        }).length;
      },
    },
    callEvent: {
      create: async ({ data }: any) => {
        const record = { id: crypto.randomUUID(), ...data, occurredAt: new Date() };
        callEventsStore.set(record.id, record);
        return record;
      },
      findMany: async ({ where }: any) => {
        return Array.from(callEventsStore.values()).filter((e) => !where?.callId || e.callId === where.callId);
      },
    },
    callTranscript: {
      create: async ({ data }: any) => {
        const record = { id: crypto.randomUUID(), ...data, createdAt: new Date() };
        callTranscriptsStore.set(record.id, record);
        return record;
      },
      findMany: async ({ where }: any) => {
        return Array.from(callTranscriptsStore.values()).filter((t) => !where?.callId || t.callId === where.callId);
      },
    },
    suppression: {
      findFirst: async ({ where }: any) => {
        return (
          Array.from(suppressionsStore.values()).find(
            (s) =>
              s.workspaceId === where.workspaceId &&
              s.type === where.type &&
              s.value.toLowerCase() === where.value.toLowerCase()
          ) || null
        );
      },
      create: async ({ data }: any) => {
        const record = { id: crypto.randomUUID(), ...data, createdAt: new Date() };
        suppressionsStore.set(record.id, record);
        return record;
      },
    },
    auditLog: {
      create: async ({ data }: any) => ({ id: crypto.randomUUID(), ...data, createdAt: new Date() }),
    },
    cRMActivity: {
      create: async ({ data }: any) => ({ id: crypto.randomUUID(), ...data, createdAt: new Date() }),
    },
    notification: {
      create: async ({ data }: any) => ({ id: crypto.randomUUID(), ...data, createdAt: new Date() }),
    },
  };

  (databaseClient as any).prisma = mockPrisma;

  // Seed baseline entities
  const testPolicy: WorkspaceCallingPolicy = {
    id: 'wcp_ops_1',
    workspaceId: wsId,
    dailyCallLimit: 10,
    maxConcurrentCalls: 2,
    maxAttemptsPerLead: 3,
    retryDelayMinutes: 60,
    allowedCallingDays: [1, 2, 3, 4, 5],
    callingWindowStart: '09:00',
    callingWindowEnd: '17:00',
    recordingConsent: true,
    humanApprovalRequired: true,
    providerRestrictions: [],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  workspaceCallingPoliciesStore.set(wsId, testPolicy);

  const testAgentConfig: VoiceAgentConfig = {
    id: 'vac_ops_1',
    workspaceId: wsId,
    name: 'Autonomous Operations Closer',
    callObjective: 'Verify operations and schedule executive demo',
    openingScript: 'Hello, this is CloseVDS Operations calling regarding your pipeline.',
    qualificationQuestions: ['Do you have 5+ sales reps?'],
    approvedTalkingPoints: ['Obsidian precision design', 'Server-authoritative safety invariants'],
    objectionHandling: { 'Too expensive': 'We offer a verifiable positive ROI guarantee.' },
    prohibitedClaims: ['No free unlimited telephony forever'],
    escalationConditions: ['Prospect requests human supervisor'],
    fallbackBehavior: 'Leave voicemail',
    maxDurationSeconds: 300,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  voiceAgentConfigsStore.set(testAgentConfig.id, testAgentConfig);

  const testLead: Lead = {
    id: 'lead_ops_1',
    workspaceId: wsId,
    campaignId: null,
    businessName: 'Apex Precision Logistics',
    domain: 'apexprecision.local',
    phone: '+15125550199',
    address: '500 Congress Ave, Austin, TX',
    status: 'QUALIFIED',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  leadsStore.set(testLead.id, testLead);

  const testContact: Contact = {
    id: 'cnt_ops_1',
    leadId: testLead.id,
    fullName: 'David Sterling',
    email: 'david@apexprecision.local',
    title: 'VP Operations',
    phone: '+15125550199',
    isPrimary: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  contactsStore.set(testContact.id, testContact);

  // =========================================================================
  // Section 1: Pre-Flight Safety Checks & Checklist Evaluation
  // =========================================================================
  console.log('--- Section 1: Pre-Flight Safety Checks & Dry-Run Evaluation ---');

  // 1.1 Successful pre-flight preparation
  const prepResult = await voiceService.prepareCall(wsId, {
    leadId: testLead.id,
    contactId: testContact.id,
    agentConfigId: testAgentConfig.id,
  });

  assert.equal(prepResult.requiresApproval, true, 'Call preparation must strictly require approval');
  assert.equal(prepResult.normalizedPhone, '+15125550199', 'Normalized phone must match E.164');
  assert.equal(prepResult.lead?.businessName, 'Apex Precision Logistics');
  assert.equal(prepResult.contact?.fullName, 'David Sterling');
  assert.equal(prepResult.agentConfig?.name, 'Autonomous Operations Closer');
  assert.ok(prepResult.safetyCheck.evaluatedGates.length >= 18, 'Must evaluate all 18 compliance gates');
  console.log('✓ 1.1 Pre-flight preparation evaluates context and gates successfully');

  // 1.2 Invalid phone number rejection in pre-flight
  await assert.rejects(
    async () => {
      normalizePhoneNumber('not-a-phone');
    },
    BadRequestError,
    'Invalid phone must throw BadRequestError'
  );
  console.log('✓ 1.2 Strict E.164 normalization rejects malformed numbers');

  // =========================================================================
  // Section 2: Non-Negotiable Human Approval Gate
  // =========================================================================
  console.log('\n--- Section 2: Non-Negotiable Human Approval Gate ---');

  // 2.1 Call created is placed in APPROVAL_REQUIRED
  const unapprovedCall = await voiceService.createCall(wsId, {
    leadId: testLead.id,
    contactId: testContact.id,
    agentConfigId: testAgentConfig.id,
    humanApprovalRequired: true,
  });

  assert.equal(unapprovedCall.status, 'APPROVAL_REQUIRED');
  assert.equal(unapprovedCall.isApproved, false);

  // 2.2 Attempting to dispatch an unapproved call must be rejected with ForbiddenError
  await assert.rejects(
    async () => {
      await voiceService.dispatchCall(unapprovedCall.id, wsId);
    },
    ForbiddenError,
    'Dispatching unapproved call must throw ForbiddenError'
  );
  console.log('✓ 2.1 Unapproved call dispatch is strictly blocked by Human Approval Gate');

  // 2.3 Approving call transitions to APPROVED
  const approvedCall = await voiceService.approveCall(unapprovedCall.id, wsId, 'user_operator_1');
  assert.equal(approvedCall.status, 'APPROVED');
  assert.equal(approvedCall.isApproved, true);
  assert.equal(approvedCall.approvedByUserId, 'user_operator_1');
  assert.ok(approvedCall.approvedAt !== null);
  console.log('✓ 2.2 Human operator sign-off transitions call to APPROVED');

  // 2.4 Modifying call parameters invalidates approval
  const invalidatedCall = await voiceService.invalidateCallApproval(
    approvedCall.id,
    wsId,
    'user_operator_1',
    'Recipient phone updated'
  );
  assert.equal(invalidatedCall.status, 'APPROVAL_REQUIRED');
  assert.equal(invalidatedCall.isApproved, false);
  console.log('✓ 2.3 Parameter modification safely invalidates approval back to APPROVAL_REQUIRED');

  // Clean up unapproved call for subsequent tests
  callsStore.delete(unapprovedCall.id);

  // =========================================================================
  // Section 3: Do-Not-Call (DNC) / Phone Suppression Enforcement
  // =========================================================================
  console.log('\n--- Section 3: DNC & Phone Suppression Enforcement ---');

  const suppressedPhone = '+14155550999';
  suppressionsStore.set(`${wsId}:PHONE:${suppressedPhone}`, {
    id: 'supp_1',
    workspaceId: wsId,
    type: 'PHONE',
    value: suppressedPhone,
    reason: 'OPT_OUT',
    createdAt: new Date(),
  });

  const evaluator = new VoiceSafetyEvaluator();
  const dncCheck = await evaluator.evaluate({
    workspaceId: wsId,
    leadId: testLead.id,
    contactId: testContact.id,
    recipientPhone: suppressedPhone,
    normalizedPhone: suppressedPhone,
    callingPolicy: testPolicy,
    lead: testLead,
    contact: { ...testContact, phone: suppressedPhone },
    agentConfig: testAgentConfig,
  });

  assert.equal(dncCheck.passed, false, 'DNC suppressed phone must fail safety evaluation');
  const gate3 = dncCheck.evaluatedGates.find((g) => g.gateNumber === 3);
  assert.ok(gate3 && !gate3.passed, 'Gate 3 (Phone Suppression / DNC) must fail');
  assert.match(dncCheck.blockedReason || '', /Phone number \+14155550999 is suppressed/);
  console.log('✓ 3.1 DNC and phone suppression lists strictly block call dispatch');

  // =========================================================================
  // Section 4: Timezone-Aware Calling Windows
  // =========================================================================
  console.log('\n--- Section 4: Timezone-Aware Calling Windows ---');

  // 4.1 Phone timezone resolution
  const nyTz = resolveTimezoneFromPhone('+12125550100');
  const chiTz = resolveTimezoneFromPhone('+13125550100');
  const laTz = resolveTimezoneFromPhone('+14155550100');
  const ukTz = resolveTimezoneFromPhone('+442071234567');

  assert.equal(nyTz, 'America/New_York');
  assert.equal(chiTz, 'America/Chicago');
  assert.equal(laTz, 'America/Los_Angeles');
  assert.equal(ukTz, 'Europe/London');
  console.log('✓ 4.1 Phone number prefixes accurately resolve to recipient IANA timezones');

  // 4.2 Timezone-aware window evaluation
  // 14:00 UTC = 10:00 AM EDT (Inside 09:00 - 17:00 window)
  const morningUtc = new Date(Date.UTC(2026, 7, 3, 14, 0, 0));
  const insideEval = callingPolicyService.isWithinCallingWindow(testPolicy, morningUtc, 'America/New_York');
  assert.equal(insideEval.inside, true, '10:00 AM EDT must be inside 09:00-17:00 calling window');

  // 03:00 UTC = 23:00 PM EDT (Outside 09:00 - 17:00 window)
  const nightUtc = new Date(Date.UTC(2026, 7, 3, 3, 0, 0));
  const outsideEval = callingPolicyService.isWithinCallingWindow(testPolicy, nightUtc, 'America/New_York');
  assert.equal(outsideEval.inside, false, '23:00 PM EDT must be outside 09:00-17:00 calling window');

  // Gate 10 check with night time
  const windowCheck = await evaluator.evaluate({
    workspaceId: wsId,
    leadId: testLead.id,
    contactId: testContact.id,
    recipientPhone: '+12125550100',
    normalizedPhone: '+12125550100',
    callingPolicy: testPolicy,
    lead: testLead,
    contact: testContact,
    agentConfig: testAgentConfig,
    currentTime: nightUtc,
    recipientTimezone: 'America/New_York',
  });

  assert.equal(windowCheck.passed, false, 'Nighttime call must fail calling window gate');
  const gate10 = windowCheck.evaluatedGates.find((g) => g.gateNumber === 10);
  assert.ok(gate10 && !gate10.passed, 'Gate 10 must fail when evaluated outside calling window');
  console.log('✓ 4.2 Calling window correctly enforces permissible recipient local hours');

  // =========================================================================
  // Section 5: Daily Call Limits & Workspace Caps
  // =========================================================================
  console.log('\n--- Section 5: Daily Call Limits & Workspace Caps ---');

  // Set tight daily limit of 1
  const tightPolicy: WorkspaceCallingPolicy = { ...testPolicy, dailyCallLimit: 1 };

  // Seed 1 existing call today
  callsStore.set('existing_today_1', {
    id: 'existing_today_1',
    workspaceId: wsId,
    campaignId: null,
    voiceCampaignId: null,
    leadId: testLead.id,
    contactId: testContact.id,
    agentConfigId: testAgentConfig.id,
    recipientPhone: testLead.phone!,
    normalizedPhone: testLead.phone!,
    status: 'COMPLETED',
    humanApprovalRequired: true,
    isApproved: true,
    approvedByUserId: 'user_1',
    approvedAt: new Date(),
    idempotencyKey: null,
    scheduledAt: null,
    initiatedAt: new Date(),
    completedAt: new Date(),
    durationSeconds: 45,
    providerName: 'twilio',
    providerCallId: 'CA_test_done',
    blockedReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const capCheck = await evaluator.evaluate({
    workspaceId: wsId,
    leadId: testLead.id,
    contactId: testContact.id,
    recipientPhone: testLead.phone!,
    normalizedPhone: testLead.phone!,
    callingPolicy: tightPolicy,
    lead: testLead,
    contact: testContact,
    agentConfig: testAgentConfig,
  });

  assert.equal(capCheck.passed, false, 'Exceeded daily limit must fail evaluation');
  const gate6 = capCheck.evaluatedGates.find((g) => g.gateNumber === 6);
  assert.ok(gate6 && !gate6.passed, 'Gate 6 (Daily Workspace Call Limit) must fail');
  assert.match(capCheck.blockedReason || '', /Daily call limit reached/);
  console.log('✓ 5.1 Workspace daily call limit strictly blocks dispatch once cap is reached');

  // Clean up seeded call
  callsStore.delete('existing_today_1');

  // =========================================================================
  // Section 6: Retry Cooldowns & Delay Enforcement
  // =========================================================================
  console.log('\n--- Section 6: Retry Cooldowns & Cooldown Delays ---');

  const now = new Date();
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

  const callWithRecentAttempt: any = {
    id: 'call_cooldown_test',
    workspaceId: wsId,
    leadId: testLead.id,
    contactId: testContact.id,
    recipientPhone: testLead.phone!,
    normalizedPhone: testLead.phone!,
    status: 'APPROVAL_REQUIRED',
    humanApprovalRequired: true,
    isApproved: false,
    attempts: [
      {
        id: 'att_1',
        callId: 'call_cooldown_test',
        attemptNumber: 1,
        status: 'BUSY',
        endedAt: tenMinutesAgo,
      },
    ],
  };

  const cooldownCheck = await evaluator.evaluate({
    workspaceId: wsId,
    leadId: testLead.id,
    contactId: testContact.id,
    recipientPhone: testLead.phone!,
    normalizedPhone: testLead.phone!,
    callingPolicy: { ...testPolicy, retryDelayMinutes: 60 },
    lead: testLead,
    contact: testContact,
    agentConfig: testAgentConfig,
    currentCall: callWithRecentAttempt,
    currentTime: now,
  });

  assert.equal(cooldownCheck.passed, false, 'Call within cooldown interval must fail evaluation');
  const gate8 = cooldownCheck.evaluatedGates.find((g) => g.gateNumber === 8);
  assert.ok(gate8 && !gate8.passed, 'Gate 8 (Retry Delay Gate) must fail');
  assert.match(gate8?.reason || '', /Retry cooldown active/);
  console.log('✓ 6.1 Retry cooldown enforces configured delay between call attempts');

  // =========================================================================
  // Section 7: Emergency Kill Switch (Global and Workspace-Level)
  // =========================================================================
  console.log('\n--- Section 7: Emergency Kill Switch Enforcement ---');

  // 7.1 Global Emergency Kill Switch
  callingPolicyService.setGlobalKillSwitch(true);
  assert.equal(callingPolicyService.isGlobalKillSwitchActive(), true);

  const globalKillCheck = await evaluator.evaluate({
    workspaceId: wsId,
    leadId: testLead.id,
    contactId: testContact.id,
    recipientPhone: testLead.phone!,
    normalizedPhone: testLead.phone!,
    callingPolicy: testPolicy,
    lead: testLead,
    contact: testContact,
    agentConfig: testAgentConfig,
  });

  assert.equal(globalKillCheck.passed, false, 'Global kill switch must fail safety check');
  const gate5Global = globalKillCheck.evaluatedGates.find((g) => g.gateNumber === 5);
  assert.ok(gate5Global && !gate5Global.passed);
  assert.match(globalKillCheck.blockedReason || '', /Global Emergency Kill Switch is active/);

  // Calling dispatch when global kill switch is active throws KillSwitchActiveError
  const callToKill = await voiceService.createCall(wsId, {
    leadId: testLead.id,
    contactId: testContact.id,
    agentConfigId: testAgentConfig.id,
    humanApprovalRequired: false,
  });
  await voiceRepository.approveCall(callToKill.id, wsId, 'operator');

  await assert.rejects(
    async () => {
      await voiceService.dispatchCall(callToKill.id, wsId);
    },
    KillSwitchActiveError,
    'Dispatch during global kill switch must throw KillSwitchActiveError'
  );
  console.log('✓ 7.1 Global Emergency Kill Switch halts all dispatches and pre-flights');

  // Reset global kill switch
  callingPolicyService.setGlobalKillSwitch(false);
  assert.equal(callingPolicyService.isGlobalKillSwitchActive(), false);

  // 7.2 Workspace-Level Emergency Kill Switch
  await callingPolicyService.triggerEmergencyKillSwitch(wsId, 'Security maintenance');
  const isWsKilled = await callingPolicyService.isWorkspaceKillSwitchActive(wsId);
  assert.equal(isWsKilled, true, 'Workspace kill switch must be active');

  const wsKilledPolicy = await callingPolicyService.getOrCreatePolicy(wsId);
  assert.equal(wsKilledPolicy.isActive, false);

  const wsKillCheck = await evaluator.evaluate({
    workspaceId: wsId,
    leadId: testLead.id,
    contactId: testContact.id,
    recipientPhone: testLead.phone!,
    normalizedPhone: testLead.phone!,
    callingPolicy: wsKilledPolicy,
    lead: testLead,
    contact: testContact,
    agentConfig: testAgentConfig,
  });

  assert.equal(wsKillCheck.passed, false, 'Workspace kill switch must fail safety check');
  assert.match(wsKillCheck.blockedReason || '', /Emergency Kill Switch is active for workspace/);

  await assert.rejects(
    async () => {
      await voiceService.dispatchCall(callToKill.id, wsId);
    },
    KillSwitchActiveError,
    'Dispatch during workspace kill switch must throw KillSwitchActiveError'
  );

  // Reset workspace kill switch
  await callingPolicyService.resetEmergencyKillSwitch(wsId);
  const isWsRestored = await callingPolicyService.isWorkspaceKillSwitchActive(wsId);
  assert.equal(isWsRestored, false, 'Workspace kill switch must be deactivated after reset');
  console.log('✓ 7.2 Workspace-level Emergency Kill Switch halts and resumes outreach cleanly');

  // Clean up
  callsStore.delete(callToKill.id);

  // =========================================================================
  // Section 8: Strict Idempotency & Duplicate Prevention
  // =========================================================================
  console.log('\n--- Section 8: Strict Idempotency & Duplicate Prevention ---');

  const idempotencyKey = 'idem_token_abc_123';
  const firstCall = await voiceService.createCall(wsId, {
    leadId: testLead.id,
    contactId: testContact.id,
    agentConfigId: testAgentConfig.id,
    idempotencyKey,
  });

  // Calling createCall again with identical idempotencyKey returns existing record
  const secondCall = await voiceService.createCall(wsId, {
    leadId: testLead.id,
    contactId: testContact.id,
    agentConfigId: testAgentConfig.id,
    idempotencyKey,
  });

  assert.equal(firstCall.id, secondCall.id, 'Idempotent call creation must return identical call record');
  console.log('✓ 8.1 Idempotency key prevents duplicate call creation');

  // Attempting to create another active call for the SAME lead without idempotency throws BadRequestError
  await assert.rejects(
    async () => {
      await voiceService.createCall(wsId, {
        leadId: testLead.id,
        contactId: testContact.id,
        agentConfigId: testAgentConfig.id,
      });
    },
    BadRequestError,
    'Must prevent double-dialing the same lead while a session is active'
  );
  console.log('✓ 8.2 Duplicate call creation for active leads is strictly rejected');

  // Clean up
  callsStore.delete(firstCall.id);

  // =========================================================================
  // Section 9: Timeline Generation & Complete Milestone Progression
  // =========================================================================
  console.log('\n--- Section 9: Complete Milestone Progression Timeline ---');

  const timelineCall = await voiceService.createCall(wsId, {
    leadId: testLead.id,
    contactId: testContact.id,
    agentConfigId: testAgentConfig.id,
  });

  await voiceService.approveCall(timelineCall.id, wsId, 'user_operator_1');

  // Seed events simulating call lifecycle
  await voiceRepository.createEvent(timelineCall.id, 'CALL_INITIATED', { attemptNumber: 1 });
  await voiceRepository.createEvent(timelineCall.id, 'CALL_RINGING', {});
  await voiceRepository.createEvent(timelineCall.id, 'CALL_MEDIA_CONNECTED', {});
  await voiceService.recordCallTurn(timelineCall.id, wsId, {
    turnIndex: 0,
    speaker: 'agent',
    text: 'Hello, this is CloseVDS.',
  });

  const timeline = await voiceService.getCallTimeline(timelineCall.id, wsId);
  assert.equal(timeline.callId, timelineCall.id);
  assert.equal(timeline.milestones.length, 8, 'Must return all 8 milestone steps');

  const steps = timeline.milestones.map((m) => m.step);
  assert.deepEqual(steps, [
    'PREPARED',
    'APPROVED',
    'QUEUED',
    'INITIATING',
    'RINGING',
    'CONNECTED',
    'TRANSCRIBING',
    'ENDED',
  ]);

  const preparedMilestone = timeline.milestones.find((m) => m.step === 'PREPARED');
  const approvedMilestone = timeline.milestones.find((m) => m.step === 'APPROVED');
  const connectedMilestone = timeline.milestones.find((m) => m.step === 'CONNECTED');

  assert.equal(preparedMilestone?.status, 'COMPLETED');
  assert.equal(approvedMilestone?.status, 'COMPLETED');
  assert.equal(connectedMilestone?.status, 'COMPLETED');
  console.log('✓ 9.1 Timeline progression (Prepared → Approved → Queued → Initiated → Ringing → Connected → Transcribing → Ended) generated accurately');

  // Clean up
  callsStore.delete(timelineCall.id);

  // =========================================================================
  // Section 10: Fastify Voice HTTP Endpoints (Kill Switch & Timeline Routes)
  // =========================================================================
  console.log('\n--- Section 10: Fastify Voice HTTP Routes & Security Guards ---');

  const app = await buildApp();
  const tokenOwner = signAuthToken({
    userId: 'user_ops_owner',
    workspaceId: wsId,
    role: 'OWNER',
    email: 'owner@ops.local',
  });

  // 10.1 Toggle workspace emergency kill switch via HTTP POST /policy/kill-switch
  const resKillOn = await app.inject({
    method: 'POST',
    url: '/api/v1/voice/policy/kill-switch',
    headers: { Authorization: `Bearer ${tokenOwner}` },
    payload: { active: true, reason: 'Testing emergency kill switch endpoint' },
  });

  assert.equal(resKillOn.statusCode, 200);
  const killOnBody = JSON.parse(resKillOn.body);
  assert.equal(killOnBody.success, true);
  assert.equal(killOnBody.data.isActive, false);
  assert.match(killOnBody.message, /Emergency Kill Switch ACTIVATED/);

  // 10.2 Deactivate emergency kill switch via HTTP
  const resKillOff = await app.inject({
    method: 'POST',
    url: '/api/v1/voice/policy/kill-switch',
    headers: { Authorization: `Bearer ${tokenOwner}` },
    payload: { active: false },
  });

  assert.equal(resKillOff.statusCode, 200);
  const killOffBody = JSON.parse(resKillOff.body);
  assert.equal(killOffBody.success, true);
  assert.equal(killOffBody.data.isActive, true);
  assert.match(killOffBody.message, /Emergency Kill Switch DEACTIVATED/);

  // 10.3 Create a call and fetch its milestone timeline via HTTP GET /calls/:id/timeline
  const newCall = await voiceService.createCall(wsId, {
    leadId: testLead.id,
    contactId: testContact.id,
    agentConfigId: testAgentConfig.id,
  });

  const resTimeline = await app.inject({
    method: 'GET',
    url: `/api/v1/voice/calls/${newCall.id}/timeline`,
    headers: { Authorization: `Bearer ${tokenOwner}` },
  });

  assert.equal(resTimeline.statusCode, 200);
  const timelineBody = JSON.parse(resTimeline.body);
  assert.equal(timelineBody.success, true);
  assert.equal(timelineBody.data.milestones.length, 8);

  await app.close();
  console.log('✓ 10.1 Fastify Emergency Kill Switch & Timeline endpoints verified');

  console.log('\n========================================================================');
  console.log('--- All CloseVDS Voice Safety & Operations Tests (M5 / R5) Passed! ---');
  console.log('========================================================================\n');
}

runVoiceSafetyOperationsTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
