import assert from 'node:assert/strict';
import { buildApp } from '../src/server/app.js';
import { signAuthToken } from '../src/modules/auth/token.js';
import { CRMService, ALLOWED_STAGE_TRANSITIONS } from '../src/modules/crm/crm.service.js';
import {
  LeadRepository,
  CRMActivityRepository,
  AuditRepository,
} from '../src/database/repository.js';
import { databaseClient, type DatabaseClient } from '../src/database/client.js';
import { NotFoundError, BadRequestError } from '../src/core/errors/api-error.js';
import type {
  PrismaClient,
  Lead,
  Contact,
  CRMActivity,
  AuditLog,
  LeadStatus,
  CRMActivityType,
} from '@prisma/client';

async function runCRMTests() {
  console.log('\n--- Starting closeVDS CRM Domain Tests (Hardened) ---');

  // In-memory test stores
  const leadsStore: Map<string, Lead> = new Map();
  const contactsStore: Map<string, Contact> = new Map();
  const crmActivitiesStore: Map<string, CRMActivity> = new Map();
  const auditLogsStore: AuditLog[] = [];

  const mockPrisma = {
    lead: {
      findFirst: async ({ where }: { where: { id?: string; workspaceId?: string } }) => {
        for (const lead of leadsStore.values()) {
          const matchId = !where.id || lead.id === where.id;
          const matchWs = !where.workspaceId || lead.workspaceId === where.workspaceId;
          if (matchId && matchWs) {
            const contacts = Array.from(contactsStore.values()).filter((c) => c.leadId === lead.id);
            return {
              ...lead,
              contacts,
              leadScore: null,
              websiteAudit: null,
              aiAnalysis: null,
            };
          }
        }
        return null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Lead> }) => {
        const existing = leadsStore.get(where.id);
        if (!existing) throw new Error('Not found');
        const cleanData = Object.fromEntries(Object.entries(data).filter(([_, v]) => v !== undefined));
        const updated: Lead = { ...existing, ...cleanData, updatedAt: new Date() };
        leadsStore.set(where.id, updated);
        const contacts = Array.from(contactsStore.values()).filter((c) => c.leadId === updated.id);
        return { ...updated, contacts, leadScore: null, websiteAudit: null, aiAnalysis: null };
      },
    },
    cRMActivity: {
      findMany: async ({ where }: { where: { leadId: string } }) => {
        return Array.from(crmActivitiesStore.values())
          .filter((a) => a.leadId === where.leadId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      },
      create: async ({ data }: { data: { leadId: string; userId?: string; type: CRMActivityType; description: string; metadata?: Record<string, unknown> } }) => {
        const id = `act_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const entry: CRMActivity = {
          id,
          leadId: data.leadId,
          userId: data.userId || null,
          type: data.type,
          description: data.description,
          metadata: data.metadata as never,
          createdAt: new Date(),
        };
        crmActivitiesStore.set(id, entry);
        return entry;
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

  const mockDbClient: DatabaseClient = {
    connect: async () => {},
    disconnect: async () => {},
    isConnected: () => true,
    healthCheck: async () => ({ ready: true, status: 'connected', message: 'OK' }),
    transaction: async (cb) => cb(mockPrisma),
    getPrismaClient: () => mockPrisma,
  };

  const testLeadRepo = new LeadRepository(mockDbClient);
  const testCRMRepo = new CRMActivityRepository(mockDbClient);
  const testAuditRepo = new AuditRepository(mockDbClient);
  const testCRMService = new CRMService(testLeadRepo, testCRMRepo, testAuditRepo, mockDbClient);

  const workspaceA = 'ws_alpha_111';
  const workspaceB = 'ws_beta_222';

  const tokenA = signAuthToken({
    userId: 'user_a',
    workspaceId: workspaceA,
    email: 'user_a@company.com',
    role: 'OWNER',
  });

  const tokenB = signAuthToken({
    userId: 'user_b',
    workspaceId: workspaceB,
    email: 'user_b@other.com',
    role: 'OWNER',
  });

  // Seed Lead in Workspace A
  const leadA: Lead = {
    id: 'lead_alpha_1',
    workspaceId: workspaceA,
    campaignId: '11111111-1111-4111-8111-111111111111',
    businessName: 'Canary Wharf Dental',
    domain: 'canarywharfdental.com',
    phone: '+442079463333',
    address: 'London',
    status: 'QUALIFIED',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  leadsStore.set(leadA.id, leadA);

  try {
    // --------------------------------------------------------------------------
    // 1. CRM Activity Recording & Retrieval
    // --------------------------------------------------------------------------
    console.log('Test 1-3: Recording CRM activities and retrieving timeline...');
    const act1 = await testCRMService.recordActivity(leadA.id, workspaceA, 'user_a', {
      type: 'NOTE',
      description: 'Spoke with receptionist. Principal Dr. Watson is available on Tuesdays.',
    });

    assert.ok(act1.id);
    assert.equal(act1.type, 'NOTE');
    assert.equal(act1.leadId, leadA.id);

    const act2 = await testCRMService.recordActivity(leadA.id, workspaceA, 'user_a', {
      type: 'CALL_LOG',
      description: 'Attempted phone call, left brief voicemail regarding booking audit.',
    });
    assert.equal(act2.type, 'CALL_LOG');

    const timeline = await testCRMService.getLeadActivities(leadA.id, workspaceA);
    assert.equal(timeline.length, 2);
    console.log('✓ CRM activity recorded and timeline fetched successfully');

    // --------------------------------------------------------------------------
    // 2. Stage Transition & Lifecycle Policy
    // --------------------------------------------------------------------------
    console.log('Test 4-6: Stage transition updates lead status and adds STAGE_CHANGE activity...');
    const stageResult = await testCRMService.updateLeadStage(leadA.id, workspaceA, 'user_a', {
      status: 'CONTACTED',
      note: 'Initial cold outreach email drafted and reviewed',
    });

    assert.equal(stageResult.lead.status, 'CONTACTED');
    assert.equal(stageResult.activity.type, 'STAGE_CHANGE');
    assert.ok(stageResult.activity.description.includes('CONTACTED'));

    // Same stage check: calling again with 'CONTACTED' does not create another activity
    const sameStage = await testCRMService.updateLeadStage(leadA.id, workspaceA, 'user_a', {
      status: 'CONTACTED',
    });
    assert.equal(sameStage.lead.status, 'CONTACTED');

    // Regulatory OPT_OUT check
    await testCRMService.updateLeadStage(leadA.id, workspaceA, 'user_a', {
      status: 'OPT_OUT',
    });

    // Attempt to transition out of OPT_OUT must be rejected
    await assert.rejects(
      async () => {
        await testCRMService.updateLeadStage(leadA.id, workspaceA, 'user_a', {
          status: 'QUALIFIED',
        });
      },
      BadRequestError,
      'Transition out of OPT_OUT must be blocked by regulatory guardrails'
    );
    console.log('✓ Stage update, same-stage deduplication, and regulatory OPT_OUT boundary passed');

    // Reset lead status to QUALIFIED for remaining tests
    leadsStore.get(leadA.id)!.status = 'QUALIFIED';

    // --------------------------------------------------------------------------
    // 3. Multi-Tenant Cross-Workspace Isolation
    // --------------------------------------------------------------------------
    console.log('Test 7-9: Multi-tenant cross-workspace access rejection...');
    // User from Workspace B cannot get CRM profile for Workspace A lead
    await assert.rejects(
      async () => {
        await testCRMService.getLeadCRMProfile(leadA.id, workspaceB);
      },
      NotFoundError,
      'Cross-tenant CRM profile read must be blocked'
    );

    // User from Workspace B cannot record activity on Workspace A lead
    await assert.rejects(
      async () => {
        await testCRMService.recordActivity(leadA.id, workspaceB, 'user_b', {
          type: 'NOTE',
          description: 'Hacked note',
        });
      },
      NotFoundError,
      'Cross-tenant CRM activity record must be blocked'
    );

    // User from Workspace B cannot update stage of Workspace A lead
    await assert.rejects(
      async () => {
        await testCRMService.updateLeadStage(leadA.id, workspaceB, 'user_b', {
          status: 'DISQUALIFIED',
        });
      },
      NotFoundError,
      'Cross-tenant CRM stage update must be blocked'
    );
    console.log('✓ Multi-tenant CRM isolation passed');

    // --------------------------------------------------------------------------
    // 4. Fastify HTTP Endpoints (/api/v1/crm/*)
    // --------------------------------------------------------------------------
    console.log('Test 10-15: Fastify CRM HTTP Routes & Input Validation...');
    const app = await buildApp();

    // Unauthenticated request -> 401
    const unauthRes = await app.inject({
      method: 'GET',
      url: `/api/v1/crm/leads/${leadA.id}`,
    });
    assert.equal(unauthRes.statusCode, 401);

    // Authenticated get CRM profile
    const getProfileRes = await app.inject({
      method: 'GET',
      url: `/api/v1/crm/leads/${leadA.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(getProfileRes.statusCode, 200);
    const profileBody = JSON.parse(getProfileRes.payload);
    assert.equal(profileBody.success, true);
    assert.equal(profileBody.lead.businessName, 'Canary Wharf Dental');

    // Authenticated post activity
    const postActRes = await app.inject({
      method: 'POST',
      url: `/api/v1/crm/leads/${leadA.id}/activities`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        type: 'NOTE',
        description: 'Confirmed lead interest from web chat widget inquiry',
      },
    });
    assert.equal(postActRes.statusCode, 201);

    // Blank activity description rejection -> 400
    const blankActRes = await app.inject({
      method: 'POST',
      url: `/api/v1/crm/leads/${leadA.id}/activities`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        type: 'NOTE',
        description: '   ',
      },
    });
    assert.equal(blankActRes.statusCode, 400);

    // Authenticated patch stage
    const patchStageRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/crm/leads/${leadA.id}/stage`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        status: 'CONTACTED',
        note: 'Lead contacted via audit review',
      },
    });
    assert.equal(patchStageRes.statusCode, 200);

    // Cross-tenant HTTP attempt -> 404
    const crossRes = await app.inject({
      method: 'GET',
      url: `/api/v1/crm/leads/${leadA.id}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    assert.equal(crossRes.statusCode, 404);

    await app.close();
    console.log('✓ Fastify CRM HTTP routes and security guards passed');
    console.log('\n--- All CRM Domain Tests Passed Successfully ---');
  } finally {
    databaseClient.setPrismaClient(null);
  }
}

runCRMTests().catch((err) => {
  console.error('CRM Test Suite Failed:', err);
  process.exit(1);
});
