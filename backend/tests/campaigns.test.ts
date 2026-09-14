import assert from 'node:assert/strict';
import { buildApp } from '../src/server/app.js';
import { signAuthToken } from '../src/modules/auth/token.js';
import { CampaignService } from '../src/modules/campaigns/campaign.service.js';
import { CampaignRepository, AuditRepository } from '../src/database/repository.js';
import { databaseClient, type DatabaseClient } from '../src/database/client.js';
import { NotFoundError } from '../src/core/errors/api-error.js';
import type { PrismaClient, Campaign, CampaignStatus, AuditLog } from '@prisma/client';

async function runCampaignTests() {
  console.log('\n--- Starting closeVDS Campaign Domain Tests ---');

  // In-memory test store
  const campaignsStore: Map<string, Campaign> = new Map();
  const auditLogsStore: AuditLog[] = [];

  const mockPrisma = {
    campaign: {
      findFirst: async ({ where }: { where: { id?: string; workspaceId?: string } }) => {
        for (const camp of campaignsStore.values()) {
          const matchId = !where.id || camp.id === where.id;
          const matchWs = !where.workspaceId || camp.workspaceId === where.workspaceId;
          if (matchId && matchWs) return { ...camp, _count: { leads: 0 } };
        }
        return null;
      },
      findMany: async ({ where, skip, take }: { where: { workspaceId: string; status?: CampaignStatus; OR?: unknown[] }; skip?: number; take?: number }) => {
        let results = Array.from(campaignsStore.values()).filter((c) => c.workspaceId === where.workspaceId);
        if (where.status) {
          results = results.filter((c) => c.status === where.status);
        }
        if (skip !== undefined && take !== undefined) {
          results = results.slice(skip, skip + take);
        }
        return results.map((c) => ({ ...c, _count: { leads: 0 } }));
      },
      count: async ({ where }: { where: { workspaceId: string; status?: CampaignStatus; OR?: unknown[] } }) => {
        let count = Array.from(campaignsStore.values()).filter((c) => c.workspaceId === where.workspaceId).length;
        if (where.status) {
          count = Array.from(campaignsStore.values()).filter((c) => c.workspaceId === where.workspaceId && c.status === where.status).length;
        }
        return count;
      },
      create: async ({ data }: { data: { workspaceId: string; name: string; niche: string; location: string; targetOffer: string; dailyCap?: number } }) => {
        const id = `camp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const camp: Campaign = {
          id,
          workspaceId: data.workspaceId,
          name: data.name,
          niche: data.niche,
          location: data.location,
          targetOffer: data.targetOffer,
          dailyCap: data.dailyCap || 50,
          status: 'DRAFT',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        campaignsStore.set(id, camp);
        return camp;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Campaign> }) => {
        const existing = campaignsStore.get(where.id);
        if (!existing) throw new Error('Not found');
        const cleanData = Object.fromEntries(Object.entries(data).filter(([_, v]) => v !== undefined));
        const updated: Campaign = { ...existing, ...cleanData, updatedAt: new Date() };
        campaignsStore.set(where.id, updated);
        return updated;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        campaignsStore.delete(where.id);
        return true;
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

  const testCampaignRepo = new CampaignRepository(mockDbClient);
  const testAuditRepo = new AuditRepository(mockDbClient);
  const testCampaignService = new CampaignService(testCampaignRepo, testAuditRepo);

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

  try {
    // --------------------------------------------------------------------------
    // 1. Campaign Domain Service: Create, Read, Update, Delete
    // --------------------------------------------------------------------------
    console.log('Test 1-4: Campaign CRUD operations & lifecycle transitions...');
    const campA = await testCampaignService.createCampaign(workspaceA, 'user_a', {
      name: 'London Dental Clinics Q3',
      niche: 'Dental',
      location: 'London, UK',
      targetOffer: 'Free Technical Booking Audit',
      dailyCap: 50,
    });

    assert.ok(campA.id);
    assert.equal(campA.name, 'London Dental Clinics Q3');
    assert.equal(campA.status, 'DRAFT');

    const fetchedA = await testCampaignService.getCampaign(campA.id, workspaceA);
    assert.equal(fetchedA.id, campA.id);

    const updatedA = await testCampaignService.updateCampaign(campA.id, workspaceA, 'user_a', {
      status: 'ACTIVE',
      dailyCap: 75,
    });
    assert.equal(updatedA.status, 'ACTIVE');
    assert.equal(updatedA.dailyCap, 75);
    console.log('✓ Campaign creation, retrieval, and status updates passed');

    // --------------------------------------------------------------------------
    // 2. Cross-Tenant Campaign Isolation
    // --------------------------------------------------------------------------
    console.log('Test 5-7: Cross-tenant campaign read, update, delete isolation...');
    // User from Workspace B cannot read Campaign from Workspace A
    await assert.rejects(
      async () => {
        await testCampaignService.getCampaign(campA.id, workspaceB);
      },
      NotFoundError,
      'Cross-tenant campaign read must be blocked'
    );

    // User from Workspace B cannot update Campaign from Workspace A
    await assert.rejects(
      async () => {
        await testCampaignService.updateCampaign(campA.id, workspaceB, 'user_b', {
          name: 'Compromised Campaign',
        });
      },
      NotFoundError,
      'Cross-tenant campaign update must be blocked'
    );

    // User from Workspace B cannot delete Campaign from Workspace A
    await assert.rejects(
      async () => {
        await testCampaignService.deleteCampaign(campA.id, workspaceB, 'user_b');
      },
      NotFoundError,
      'Cross-tenant campaign deletion must be blocked'
    );
    console.log('✓ Cross-tenant campaign isolation passed');

    // --------------------------------------------------------------------------
    // 3. Fastify Campaign HTTP Endpoints (/api/v1/campaigns/*)
    // --------------------------------------------------------------------------
    console.log('Test 8-12: Fastify Campaign HTTP Endpoints...');
    const app = await buildApp();

    // Unauthenticated request -> 401
    const unauthRes = await app.inject({
      method: 'GET',
      url: '/api/v1/campaigns',
    });
    assert.equal(unauthRes.statusCode, 401);

    // Authenticated list campaigns
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/campaigns',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(listRes.statusCode, 200);
    const listBody = JSON.parse(listRes.payload);
    assert.equal(listBody.success, true);
    assert.ok(listBody.data.length >= 1);

    // Authenticated get campaign by ID
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/campaigns/${campA.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(getRes.statusCode, 200);
    const getBody = JSON.parse(getRes.payload);
    assert.equal(getBody.campaign.name, 'London Dental Clinics Q3');

    // Cross-tenant HTTP attempt -> 404 (NotFoundError masked)
    const crossRes = await app.inject({
      method: 'GET',
      url: `/api/v1/campaigns/${campA.id}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    assert.equal(crossRes.statusCode, 404);

    // Malformed body -> 400
    const malformedRes = await app.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        dailyCap: -10, // Invalid negative cap
      },
    });
    assert.equal(malformedRes.statusCode, 400);

    await app.close();
    console.log('✓ Fastify Campaign HTTP routes and security guards passed');
    console.log('\n--- All Campaign Domain Tests Passed Successfully ---');
  } finally {
    databaseClient.setPrismaClient(null);
  }
}

runCampaignTests().catch((err) => {
  console.error('Campaign Test Suite Failed:', err);
  process.exit(1);
});
