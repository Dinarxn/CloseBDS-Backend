import assert from 'node:assert/strict';
import { buildApp } from '../src/server/app.js';
import { signAuthToken } from '../src/modules/auth/token.js';
import { DiscoveryDomainService } from '../src/modules/lead-discovery/discovery.service.js';
import { ResearchDomainService } from '../src/modules/lead-research/research.service.js';
import {
  LeadRepository,
  LeadSourceRepository,
  WebsiteAuditRepository,
  AuditRepository,
} from '../src/database/repository.js';
import { databaseClient, type DatabaseClient } from '../src/database/client.js';
import { NotFoundError } from '../src/core/errors/api-error.js';
import type {
  PrismaClient,
  Lead,
  Contact,
  LeadSource,
  WebsiteAudit,
  AuditLog,
  LeadStatus,
} from '@prisma/client';
import type {
  LeadDiscoveryService,
  RawLeadCandidate,
  NormalizedLeadCandidate,
} from '../src/integrations/lead-discovery/index.js';
import type { AIService, AuditResult } from '../src/integrations/ai/index.js';

async function runDiscoveryResearchTests() {
  console.log('\n--- Starting closeVDS Discovery & Research Domain Tests ---');

  // In-memory test stores
  const leadsStore: Map<string, Lead> = new Map();
  const contactsStore: Map<string, Contact> = new Map();
  const leadSourcesStore: Map<string, LeadSource> = new Map();
  const websiteAuditsStore: Map<string, WebsiteAudit> = new Map();
  const auditLogsStore: AuditLog[] = [];

  const mockPrisma = {
    lead: {
      findFirst: async ({ where }: { where: { id?: string; workspaceId?: string; businessName?: string; domain?: string | null; phone?: string | null; address?: string | null } }) => {
        for (const lead of leadsStore.values()) {
          const matchId = !where.id || lead.id === where.id;
          const matchWs = !where.workspaceId || lead.workspaceId === where.workspaceId;
          const matchBiz = !where.businessName || lead.businessName === where.businessName;
          const matchDom = where.domain === undefined || lead.domain === where.domain;
          const matchPhone = where.phone === undefined || lead.phone === where.phone;
          const matchAddr = where.address === undefined || lead.address === where.address;

          if (matchId && matchWs && matchBiz && matchDom && matchPhone && matchAddr) {
            const contacts = Array.from(contactsStore.values()).filter((c) => c.leadId === lead.id);
            const websiteAudit = websiteAuditsStore.get(lead.id) || null;
            const leadSource = leadSourcesStore.get(lead.id) || null;
            return { ...lead, contacts, websiteAudit, leadSource };
          }
        }
        return null;
      },
      create: async ({ data }: { data: { workspaceId: string; campaignId?: string; businessName: string; domain?: string; phone?: string; address?: string; status?: LeadStatus } }) => {
        const id = `lead_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const lead: Lead = {
          id,
          workspaceId: data.workspaceId,
          campaignId: data.campaignId || null,
          businessName: data.businessName,
          domain: data.domain || null,
          phone: data.phone || null,
          address: data.address || null,
          status: data.status || 'NEW',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        leadsStore.set(id, lead);
        return { ...lead, contacts: [] };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Lead> }) => {
        const existing = leadsStore.get(where.id);
        if (!existing) throw new Error('Not found');
        const cleanData = Object.fromEntries(Object.entries(data).filter(([_, v]) => v !== undefined));
        const updated: Lead = { ...existing, ...cleanData, updatedAt: new Date() };
        leadsStore.set(where.id, updated);
        return updated;
      },
    },
    leadSource: {
      upsert: async ({ where, update, create }: { where: { leadId: string }; update: Record<string, unknown>; create: Record<string, unknown> }) => {
        const existing = leadSourcesStore.get(where.leadId);
        const data = existing ? { ...existing, ...update } : create;
        const entry: LeadSource = {
          id: existing?.id || `src_${Date.now()}`,
          leadId: where.leadId,
          provider: data.provider as string,
          externalId: data.externalId as string,
          queryPayload: data.queryPayload as never,
          createdAt: existing?.createdAt || new Date(),
        };
        leadSourcesStore.set(where.leadId, entry);
        return entry;
      },
    },
    websiteAudit: {
      upsert: async ({ where, update, create }: { where: { leadId: string }; update: Record<string, unknown>; create: Record<string, unknown> }) => {
        const existing = websiteAuditsStore.get(where.leadId);
        const data = existing ? { ...existing, ...update } : create;
        const entry: WebsiteAudit = {
          id: existing?.id || `audit_${Date.now()}`,
          leadId: where.leadId,
          domain: data.domain as string,
          mobileOptimized: Boolean(data.mobileOptimized),
          bookingCtaVisible: Boolean(data.bookingCtaVisible),
          auditGaps: (data.auditGaps as string[]) || [],
          rawAuditData: data.rawAuditData as never,
          auditedAt: new Date(),
        };
        websiteAuditsStore.set(where.leadId, entry);
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
  const testLeadSourceRepo = new LeadSourceRepository(mockDbClient);
  const testWebsiteAuditRepo = new WebsiteAuditRepository(mockDbClient);
  const testAuditRepo = new AuditRepository(mockDbClient);

  const workspaceA = 'ws_alpha_111';
  const workspaceB = 'ws_beta_222';
  const campaignId = '11111111-1111-4111-8111-111111111111';

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
    // 1. Lead Discovery: Unconfigured Provider Behavior
    // --------------------------------------------------------------------------
    console.log('Test 1: Unconfigured lead discovery provider...');
    const unconfiguredDiscovery = new DiscoveryDomainService(
      undefined,
      testLeadRepo,
      testLeadSourceRepo,
      testAuditRepo
    );

    const unconfResult = await unconfiguredDiscovery.executeDiscovery(workspaceA, 'user_a', {
      campaignId,
      niche: 'Dentistry',
      location: 'Manchester, UK',
      limit: 10,
    });

    assert.equal(unconfResult.status, 'unavailable');
    assert.equal(unconfResult.persistedCount, 0);
    console.log('✓ Unconfigured provider returns honest unavailable state');

    // --------------------------------------------------------------------------
    // 2. Lead Discovery: Configured Provider & Deduplication
    // --------------------------------------------------------------------------
    console.log('Test 2-4: Configured discovery provider, persistence, and deduplication...');
    const mockDiscoveryProvider: LeadDiscoveryService = {
      async discoverCandidates(): Promise<RawLeadCandidate[]> {
        return [
          {
            rawId: 'maps_123',
            rawName: 'Manchester Dental Studio',
            rawAddress: '45 Deansgate, Manchester',
            rawPhone: '+441619998888',
            rawWebsite: 'https://manchesterdental.co.uk',
          },
          {
            rawId: 'maps_456',
            rawName: 'Salford Smiles Clinic',
            rawAddress: '10 Chapel Street, Salford',
            rawPhone: '+441617776666',
            rawWebsite: 'https://salfordsmiles.co.uk',
          },
        ];
      },
      normalizeCandidate(raw: RawLeadCandidate): NormalizedLeadCandidate {
        return {
          businessName: raw.rawName,
          normalizedAddress: raw.rawAddress,
          normalizedPhone: raw.rawPhone,
          domain: 'manchesterdental.co.uk',
          sourceProvider: 'mock-google-maps',
          sourceExternalId: raw.rawId,
        };
      },
    };

    const activeDiscovery = new DiscoveryDomainService(
      mockDiscoveryProvider,
      testLeadRepo,
      testLeadSourceRepo,
      testAuditRepo
    );

    // Initial discovery -> 2 candidates persisted
    const res1 = await activeDiscovery.executeDiscovery(workspaceA, 'user_a', {
      campaignId,
      niche: 'Dentistry',
      location: 'Manchester, UK',
      limit: 10,
    });

    assert.equal(res1.status, 'completed');
    assert.equal(res1.discoveredCount, 2);
    assert.equal(res1.persistedCount, 2);
    assert.equal(res1.skippedDuplicateCount, 0);

    // Second discovery with same candidates -> 2 duplicates skipped
    const res2 = await activeDiscovery.executeDiscovery(workspaceA, 'user_a', {
      campaignId,
      niche: 'Dentistry',
      location: 'Manchester, UK',
      limit: 10,
    });
    assert.equal(res2.persistedCount, 0);
    assert.equal(res2.skippedDuplicateCount, 2);

    // Same candidates in workspace B -> Allowed (Multi-Tenant Scoped)
    const res3 = await activeDiscovery.executeDiscovery(workspaceB, 'user_b', {
      campaignId,
      niche: 'Dentistry',
      location: 'Manchester, UK',
      limit: 10,
    });
    assert.equal(res3.persistedCount, 2);

    // Verify audit log for campaign-backed discovery uses Campaign entity
    const campaignAudit = auditLogsStore.find(
      (log) => log.eventType === 'lead_discovery:executed' && log.entityType === 'Campaign'
    );
    assert.ok(campaignAudit, 'Audit log with entityType Campaign should exist');
    assert.equal(campaignAudit.entityId, campaignId);

    // Campaign-less discovery (no campaignId provided) -> executes successfully with Workspace audit
    const resNoCampaign = await activeDiscovery.executeDiscovery(workspaceA, 'user_a', {
      niche: 'Dentistry',
      location: 'Leeds, UK',
      limit: 10,
    });
    assert.equal(resNoCampaign.status, 'completed');
    const workspaceAudit = auditLogsStore.find(
      (log) => log.eventType === 'lead_discovery:executed' && log.entityType === 'Workspace'
    );
    assert.ok(workspaceAudit, 'Audit log with entityType Workspace should exist for campaign-less discovery');
    assert.equal(workspaceAudit.entityId, workspaceA);
    console.log('✓ Discovery normalization, persistence, deduplication, tenant isolation, and campaign-optional audit passed');

    // --------------------------------------------------------------------------
    // 3. Lead Research & Website Audit
    // --------------------------------------------------------------------------
    console.log('Test 5-8: Lead research observations & AI audit provider...');
    const createdLeads = Array.from(leadsStore.values()).filter((l) => l.workspaceId === workspaceA);
    const targetLead = createdLeads[0];

    const mockAiService: AIService = {
      async analyzeWebsite(): Promise<AuditResult> {
        return {
          mobileOptimized: true,
          bookingCtaVisible: false,
          identifiedGaps: ['Missing direct online booking CTA', 'Page speed score 48/100'],
          summary: 'Modern clinic site lacking streamlined booking interface',
        };
      },
      async qualifyLead() {
        throw new Error('Not used here');
      },
      async personalizeOutreach() {
        throw new Error('Not used here');
      },
      async classifyReply() {
        throw new Error('Not used here');
      },
    };

    const activeResearch = new ResearchDomainService(
      mockAiService,
      testLeadRepo,
      testWebsiteAuditRepo,
      testAuditRepo
    );

    // Execute research
    const researchResult = await activeResearch.executeResearch(
      targetLead.id,
      workspaceA,
      'user_a',
      {
        domain: targetLead.domain || undefined,
        htmlSnippet: '<html><body>Mock content</body></html>',
      }
    );

    assert.equal(researchResult.status, 'completed');
    assert.ok(researchResult.audit);
    assert.equal(researchResult.audit.bookingCtaVisible, false);
    assert.equal(researchResult.audit.auditGaps.length, 2);

    // Cross-tenant research attempt blocked
    await assert.rejects(
      async () => {
        await activeResearch.executeResearch(targetLead.id, workspaceB, 'user_b', {});
      },
      NotFoundError,
      'Cross-tenant research attempt must be rejected'
    );

    // Retrieve audit
    const fetchedAudit = await activeResearch.getAudit(targetLead.id, workspaceA);
    assert.equal(fetchedAudit.id, researchResult.audit.id);
    console.log('✓ Website audit execution, persistence, retrieval, and tenant isolation passed');

    // --------------------------------------------------------------------------
    // 4. Fastify HTTP Endpoints
    // --------------------------------------------------------------------------
    console.log('Test 9-13: Fastify Discovery & Research HTTP Routes...');
    const app = await buildApp();

    // Unauthenticated -> 401
    const unauthDiscovery = await app.inject({
      method: 'POST',
      url: '/api/v1/lead-discovery/query',
      payload: {
        campaignId,
        niche: 'Dentistry',
        location: 'London',
      },
    });
    assert.equal(unauthDiscovery.statusCode, 401);

    // Authenticated discovery query with default unconfigured service
    const authDiscovery = await app.inject({
      method: 'POST',
      url: '/api/v1/lead-discovery/query',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        campaignId,
        niche: 'Dentistry',
        location: 'London',
      },
    });
    assert.equal(authDiscovery.statusCode, 200);
    const discBody = JSON.parse(authDiscovery.payload);
    assert.equal(discBody.status, 'unavailable');

    // Authenticated discovery query containing only niche + location + limit (UI discovery format)
    const campaignlessDiscovery = await app.inject({
      method: 'POST',
      url: '/api/v1/lead-discovery/query',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        niche: 'dentist',
        location: 'london',
        limit: 10,
      },
    });
    assert.equal(campaignlessDiscovery.statusCode, 200);
    const campaignlessBody = JSON.parse(campaignlessDiscovery.payload);
    assert.equal(campaignlessBody.success, true);
    assert.equal(campaignlessBody.status, 'unavailable');

    // Authenticated get audit
    const getAuditRes = await app.inject({
      method: 'GET',
      url: `/api/v1/lead-research/${targetLead.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(getAuditRes.statusCode, 200);
    const getAuditBody = JSON.parse(getAuditRes.payload);
    assert.equal(getAuditBody.audit.domain, 'manchesterdental.co.uk');

    // Cross-tenant HTTP audit get -> 404
    const crossAuditRes = await app.inject({
      method: 'GET',
      url: `/api/v1/lead-research/${targetLead.id}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    assert.equal(crossAuditRes.statusCode, 404);

    await app.close();
    console.log('✓ Fastify Discovery and Research HTTP endpoints passed');
    console.log('\n--- All Discovery & Research Tests Passed Successfully ---');
  } finally {
    databaseClient.setPrismaClient(null);
  }
}

runDiscoveryResearchTests().catch((err) => {
  console.error('Discovery & Research Test Suite Failed:', err);
  process.exit(1);
});
