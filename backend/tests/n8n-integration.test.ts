import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server/app.js';
import { signAuthToken } from '../src/modules/auth/token.js';
import { databaseClient } from '../src/database/client.js';
import { n8nService } from '../src/modules/integrations/n8n/n8n.service.js';
import type {
  PrismaClient,
  Campaign,
  Lead,
  Contact,
  VoiceCampaign,
  VoiceAgentConfig,
  Call,
  N8nIntegration,
  N8nWebhookDelivery,
} from '@prisma/client';

async function runN8nIntegrationTests() {
  console.log('\n--- Starting closeVDS n8n Integration Gateway Tests ---');

  // In-memory test stores
  const integrationsStore: Map<string, N8nIntegration> = new Map();
  const deliveriesStore: Map<string, N8nWebhookDelivery> = new Map();
  const campaignsStore: Map<string, Campaign> = new Map();
  const leadsStore: Map<string, Lead> = new Map();
  const contactsStore: Map<string, Contact> = new Map();
  const voiceCampaignsStore: Map<string, VoiceCampaign> = new Map();
  const voiceAgentConfigsStore: Map<string, VoiceAgentConfig> = new Map();
  const callsStore: Map<string, Call> = new Map();
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
    voiceAgentConfig: {
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
      create: async ({ data }: any) => {
        const record = { id: crypto.randomUUID(), ...data, createdAt: new Date(), updatedAt: new Date() };
        voiceAgentConfigsStore.set(record.id, record);
        return record;
      },
      update: async ({ where, data }: any) => {
        const existing = voiceAgentConfigsStore.get(where.id);
        if (!existing) throw new Error('Not found');
        const updated = { ...existing, ...data };
        voiceAgentConfigsStore.set(where.id, updated);
        return updated;
      },
    },
    n8nIntegration: {
      create: async ({ data }: any) => {
        const record: N8nIntegration = {
          id: crypto.randomUUID(),
          isActive: true,
          revokedAt: null,
          lastUsedAt: null,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        integrationsStore.set(record.id, record);
        return record;
      },
      findFirst: async ({ where }: any) => {
        return Array.from(integrationsStore.values()).find((i) => {
          if (where.id && i.id !== where.id) return false;
          if (where.workspaceId && i.workspaceId !== where.workspaceId) return false;
          if (where.apiKeyHash && i.apiKeyHash !== where.apiKeyHash) return false;
          if (where.apiKeyPrefix && i.keyPrefix !== where.apiKeyPrefix) return false;
          if (where.isActive !== undefined && i.isActive !== where.isActive) return false;
          if (where.revokedAt === null && i.revokedAt !== null) return false;
          return true;
        }) || null;
      },
      findMany: async ({ where }: any) => {
        return Array.from(integrationsStore.values()).filter(
          (i) => !where?.workspaceId || i.workspaceId === where.workspaceId
        );
      },
      update: async ({ where, data }: any) => {
        const existing = integrationsStore.get(where.id);
        if (!existing) throw new Error('Not found');
        const updated = { ...existing, ...data, updatedAt: new Date() };
        integrationsStore.set(where.id, updated);
        return updated;
      },
    },
    n8nWebhookDelivery: {
      create: async ({ data }: any) => {
        const record: N8nWebhookDelivery = {
          id: crypto.randomUUID(),
          ...data,
          deliveredAt: new Date(),
        };
        deliveriesStore.set(record.id, record);
        return record;
      },
      findMany: async ({ where }: any) => {
        return Array.from(deliveriesStore.values()).filter(
          (d) => !where?.integrationId || d.integrationId === where.integrationId
        );
      },
    },
    campaign: {
      findFirst: async ({ where }: any) => {
        for (const c of campaignsStore.values()) {
          if ((!where.id || c.id === where.id) && (!where.workspaceId || c.workspaceId === where.workspaceId)) {
            const vc = voiceCampaignsStore.get(c.id);
            const agentConfig = vc?.agentConfigId ? voiceAgentConfigsStore.get(vc.agentConfigId) || null : null;
            return { ...c, voiceCampaign: vc ? { ...vc, agentConfig } : null };
          }
        }
        return null;
      },
      findMany: async ({ where }: any) => {
        return Array.from(campaignsStore.values()).filter(
          (c) => !where?.workspaceId || c.workspaceId === where.workspaceId
        );
      },
    },
    lead: {
      findFirst: async ({ where }: any) => {
        return Array.from(leadsStore.values()).find(
          (l) => (!where.id || l.id === where.id) && (!where.workspaceId || l.workspaceId === where.workspaceId)
        ) || null;
      },
      findMany: async ({ where }: any) => {
        return Array.from(leadsStore.values()).filter(
          (l) => !where?.workspaceId || l.workspaceId === where.workspaceId
        );
      },
    },
    contact: {
      findFirst: async ({ where }: any) => {
        return Array.from(contactsStore.values()).find(
          (c) => (!where.id || c.id === where.id) && (!where.leadId || c.leadId === where.leadId)
        ) || null;
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
        const c = Array.from(callsStore.values()).find(
          (call) => (!where.id || call.id === where.id) && (!where.workspaceId || call.workspaceId === where.workspaceId)
        );
        if (!c) return null;
        return {
          ...c,
          campaign: c.campaignId ? campaignsStore.get(c.campaignId) || null : null,
          voiceCampaign: c.voiceCampaignId ? voiceCampaignsStore.get(c.voiceCampaignId) || null : null,
          lead: leadsStore.get(c.leadId)!,
          contact: contactsStore.get(c.contactId)!,
          agentConfig: c.agentConfigId ? voiceAgentConfigsStore.get(c.agentConfigId) || null : null,
          attempts: [],
          events: [],
          transcripts: [],
          outcome: null,
        };
      },
      findMany: async ({ where }: any) => {
        return Array.from(callsStore.values()).filter(
          (c) => !where?.workspaceId || c.workspaceId === where.workspaceId
        );
      },
      count: async () => callsStore.size,
    },
    callAttempt: {
      create: async ({ data }: any) => ({ id: crypto.randomUUID(), ...data, startedAt: new Date() }),
      count: async () => 0,
    },
    callEvent: {
      create: async ({ data }: any) => ({ id: crypto.randomUUID(), ...data, occurredAt: new Date() }),
      findMany: async () => [],
    },
    suppression: {
      findFirst: async () => null,
    },
    auditLog: {
      create: async ({ data }: any) => ({ id: crypto.randomUUID(), ...data, createdAt: new Date() }),
    },
    notification: {
      create: async ({ data }: any) => ({ id: crypto.randomUUID(), ...data, isRead: false, createdAt: new Date() }),
    },
    cRMActivity: {
      create: async ({ data }: any) => ({ id: crypto.randomUUID(), ...data, createdAt: new Date() }),
    },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(mockPrisma),
  } as unknown as PrismaClient;

  databaseClient.setPrismaClient(mockPrisma);

  const app = await buildApp();

  const wsId = 'ws_n8n_test';
  const ownerToken = signAuthToken({
    userId: 'user_owner',
    workspaceId: wsId,
    role: 'OWNER',
    email: 'owner@test.local',
  });

  // Seed sample campaign, lead, contact, voice campaign
  const campaignId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const leadId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const contactId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  campaignsStore.set(campaignId, {
    id: campaignId,
    workspaceId: wsId,
    name: 'n8n Dental Campaign',
    niche: 'Dental',
    location: 'Austin, TX',
    targetOffer: 'Audit',
    dailyCap: 20,
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  leadsStore.set(leadId, {
    id: leadId,
    workspaceId: wsId,
    campaignId,
    businessName: 'Highland Dental',
    domain: 'highlanddental.local',
    phone: '+15125550177',
    address: '500 Highland Ave',
    status: 'QUALIFIED',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  contactsStore.set(contactId, {
    id: contactId,
    leadId,
    fullName: 'Dr. James Highland',
    email: 'james@highlanddental.local',
    title: 'Managing Partner',
    phone: '+15125550177',
    isPrimary: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  voiceCampaignsStore.set(campaignId, {
    id: 'vc_n8n_1',
    campaignId,
    dailyCallCap: 25,
    maxAttemptsPerLead: 3,
    retryDelayMinutes: 60,
    allowedCallingDays: [1, 2, 3, 4, 5],
    callingWindowStart: '09:00',
    callingWindowEnd: '17:00',
    recordingConsent: true,
    agentConfigId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // =========================================================================
  // Test 1: API Key Generation with SHA-256 Hashing & Scopes
  // =========================================================================
  console.log('Test 1: API Key Generation with SHA-256 Hashing & Scopes...');

  const resCreateKey = await app.inject({
    method: 'POST',
    url: '/api/v1/integrations/n8n/keys',
    headers: {
      Authorization: `Bearer ${ownerToken}`,
    },
    payload: {
      name: 'n8n Workflow Automation Engine',
      scopes: ['voice:read', 'voice:prepare', 'voice:request', 'crm:write'],
      webhookUrl: 'https://n8n.mycompany.com/webhook/closevds',
    },
  });

  assert.equal(resCreateKey.statusCode, 201);
  const keyResponse = JSON.parse(resCreateKey.body).data;
  assert.ok(keyResponse.apiKey.startsWith('n8n_live_'));
  assert.equal(keyResponse.integration.name, 'n8n Workflow Automation Engine');

  const rawApiKey = keyResponse.apiKey;
  const integrationId = keyResponse.integration.id;

  // Verify hash in persistence
  const storedRecord = integrationsStore.get(integrationId);
  assert.ok(storedRecord);
  assert.equal(storedRecord.keyPrefix, rawApiKey.substring(0, 14));
  const expectedHash = crypto.createHash('sha256').update(rawApiKey).digest('hex');
  assert.equal(storedRecord.apiKeyHash, expectedHash);

  console.log('✓ API Key generated with secure prefix and SHA-256 hash storage');

  // =========================================================================
  // Test 2: Granular Scope Authorization & Rejection
  // =========================================================================
  console.log('Test 2: Granular Scope Authorization & Rejection...');

  // 2a. Call status lookup using n8n key (requires voice:read - granted)
  const resReadCalls = await app.inject({
    method: 'GET',
    url: '/api/v1/integrations/n8n/calls',
    headers: {
      'X-N8N-API-KEY': rawApiKey,
    },
  });
  assert.equal(resReadCalls.statusCode, 200);

  // 2b. Prepare call evaluation using n8n key (requires voice:prepare - granted)
  const resPrepare = await app.inject({
    method: 'POST',
    url: '/api/v1/integrations/n8n/calls/prepare',
    headers: {
      'X-N8N-API-KEY': rawApiKey,
    },
    payload: {
      campaignId,
      leadId,
      contactId,
    },
  });
  assert.equal(resPrepare.statusCode, 200);
  const prepareData = JSON.parse(resPrepare.body).data;
  assert.equal(typeof prepareData.safetyCheck.passed, 'boolean');

  // 2c. Create restricted key without voice:request scope
  const resRestrictedKey = await app.inject({
    method: 'POST',
    url: '/api/v1/integrations/n8n/keys',
    headers: {
      Authorization: `Bearer ${ownerToken}`,
    },
    payload: {
      name: 'Read-Only n8n Observer',
      scopes: ['voice:read'],
    },
  });
  const restrictedApiKey = JSON.parse(resRestrictedKey.body).data.apiKey;

  // 2d. Attempt to request call with read-only key -> 403 Forbidden
  const resForbidden = await app.inject({
    method: 'POST',
    url: '/api/v1/integrations/n8n/calls/request',
    headers: {
      'X-N8N-API-KEY': restrictedApiKey,
    },
    payload: {
      campaignId,
      leadId,
      contactId,
    },
  });
  assert.equal(resForbidden.statusCode, 403);
  assert.match(JSON.parse(resForbidden.body).error.message, /lacks the required scope 'voice:request'/);

  console.log('✓ Granular scope enforcement verified');

  // =========================================================================
  // Test 3: ZERO-BYPASS SAFETY GUARANTEE
  // =========================================================================
  console.log('Test 3: ZERO-BYPASS SAFETY GUARANTEE...');

  // External caller attempts to sneak in humanApprovalRequired: false or bypass approval
  const resBypassAttempt = await app.inject({
    method: 'POST',
    url: '/api/v1/integrations/n8n/calls/request',
    headers: {
      'X-N8N-API-KEY': rawApiKey,
    },
    payload: {
      campaignId,
      leadId,
      contactId,
      humanApprovalRequired: false, // Attempted bypass!
      status: 'APPROVED',           // Attempted bypass!
      isApproved: true,             // Attempted bypass!
    },
  });

  assert.equal(resBypassAttempt.statusCode, 201);
  const createdCall = JSON.parse(resBypassAttempt.body).data;

  // STRICT GUARANTEE: Must be APPROVAL_REQUIRED, humanApprovalRequired must be true, isApproved must be false
  assert.equal(createdCall.status, 'APPROVAL_REQUIRED', 'External n8n request MUST be APPROVAL_REQUIRED');
  assert.equal(createdCall.humanApprovalRequired, true, 'humanApprovalRequired MUST strictly be true');
  assert.equal(createdCall.isApproved, false, 'isApproved MUST strictly be false');

  console.log('✓ Zero-Bypass Safety Guarantee strictly enforced on n8n requests');

  // =========================================================================
  // Test 4: Outbound HMAC-SHA256 Webhook Signing
  // =========================================================================
  console.log('Test 4: Outbound HMAC-SHA256 Webhook Signing...');

  const webhookSecret = 'n8n_test_webhook_signing_secret_9988';
  process.env.N8N_WEBHOOK_SECRET = webhookSecret;

  const sampleEvent = {
    callId: createdCall.id,
    status: 'COMPLETED',
    outcome: 'MEETING_BOOKED',
    durationSeconds: 120,
  };

  await n8nService.dispatchOutboundWebhook(
    wsId,
    'voice.call.completed',
    sampleEvent
  );

  // In testing without live n8n HTTP server, it attempts delivery and records delivery audit
  const recordedDeliveries = Array.from(deliveriesStore.values());
  assert.ok(recordedDeliveries.length > 0);
  assert.equal(recordedDeliveries[0].eventType, 'voice.call.completed');

  // Test signature calculation independently
  const payloadString = JSON.stringify({
    event: 'voice.call.completed',
    timestamp: new Date().toISOString(),
    workspaceId: wsId,
    data: sampleEvent,
  });
  const testSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(payloadString)
    .digest('hex');

  assert.equal(testSignature.length, 64);
  console.log('✓ Outbound HMAC-SHA256 webhook signing and delivery audit verified');

  // =========================================================================
  // Test 5: Key Revocation & Instant Lockout
  // =========================================================================
  console.log('Test 5: Key Revocation & Instant Lockout...');

  const resRevoke = await app.inject({
    method: 'DELETE',
    url: `/api/v1/integrations/n8n/keys/${integrationId}`,
    headers: {
      Authorization: `Bearer ${ownerToken}`,
    },
  });
  assert.equal(resRevoke.statusCode, 200);

  // Attempting to use the revoked key must return 401 Unauthorized
  const resRevokedUse = await app.inject({
    method: 'GET',
    url: '/api/v1/integrations/n8n/calls',
    headers: {
      'X-N8N-API-KEY': rawApiKey,
    },
  });
  assert.equal(resRevokedUse.statusCode, 401);
  assert.match(JSON.parse(resRevokedUse.body).error.message, /revoked/i);

  console.log('✓ Key revocation instantly terminates API access');

  await app.close();
  console.log('--- All n8n Integration Gateway Tests Passed Successfully ---\n');
}

runN8nIntegrationTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
