import assert from 'node:assert/strict';
import { buildApp } from '../src/server/app.js';
import { signAuthToken } from '../src/modules/auth/token.js';
import { databaseClient, type DatabaseClient } from '../src/database/client.js';
import { LeadRepository, AuditRepository, LeadScoreRepository, AIAnalysisRepository } from '../src/database/repository.js';
import { LeadService } from '../src/modules/leads/lead.service.js';
import { QualificationDomainService } from '../src/modules/qualification/qualification.service.js';
import type { PrismaClient, Lead, Contact, WebsiteAudit, AIAnalysis, LeadScore, AuditLog, LeadStatus } from '@prisma/client';

async function runServiceOpportunityE2ETests() {
  console.log('\n--- Starting closeVDS Phase A5: Service Opportunity E2E Verification Tests ---');

  // In-memory isolated state
  const leadsStore: Map<string, Lead> = new Map();
  const contactsStore: Map<string, Contact> = new Map();
  const websiteAuditsStore: Map<string, WebsiteAudit> = new Map();
  const aiAnalysesStore: Map<string, AIAnalysis> = new Map();
  const leadScoresStore: Map<string, LeadScore> = new Map();
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
            const aiAnalysis = aiAnalysesStore.get(lead.id) || null;
            const leadScore = leadScoresStore.get(lead.id) || null;
            return { ...lead, contacts, websiteAudit, aiAnalysis, leadScore };
          }
        }
        return null;
      },
      findMany: async ({ where, skip, take }: { where: { workspaceId: string; status?: LeadStatus; campaignId?: string; OR?: unknown[] }; skip?: number; take?: number }) => {
        let results = Array.from(leadsStore.values()).filter((l) => l.workspaceId === where.workspaceId);
        if (where.status) {
          results = results.filter((l) => l.status === where.status);
        }
        if (where.campaignId) {
          results = results.filter((l) => l.campaignId === where.campaignId);
        }
        if (skip !== undefined && take !== undefined) {
          results = results.slice(skip, skip + take);
        }
        return results.map((l) => ({
          ...l,
          contacts: Array.from(contactsStore.values()).filter((c) => c.leadId === l.id),
          websiteAudit: websiteAuditsStore.get(l.id) || null,
          aiAnalysis: aiAnalysesStore.get(l.id) || null,
          leadScore: leadScoresStore.get(l.id) || null,
        }));
      },
      count: async ({ where }: { where: { workspaceId: string; status?: LeadStatus; campaignId?: string; OR?: unknown[] } }) => {
        let count = Array.from(leadsStore.values()).filter((l) => l.workspaceId === where.workspaceId).length;
        if (where.status) {
          count = Array.from(leadsStore.values()).filter((l) => l.workspaceId === where.workspaceId && l.status === where.status).length;
        }
        return count;
      },
      create: async ({ data }: { data: { workspaceId: string; campaignId?: string | null; businessName: string; domain?: string | null; phone?: string | null; address?: string | null; status?: LeadStatus; contacts?: { create?: Array<{ fullName: string; email: string; title?: string; phone?: string; isPrimary?: boolean }> } } }) => {
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
        const updated = { ...existing, ...data, updatedAt: new Date() };
        leadsStore.set(where.id, updated);
        return updated;
      },
    },
    contact: {
      findMany: async ({ where }: { where: { leadId: string } }) => {
        return Array.from(contactsStore.values()).filter((c) => c.leadId === where.leadId);
      },
    },
    leadScore: {
      findFirst: async ({ where }: { where: { leadId: string; workspaceId: string } }) => {
        return leadScoresStore.get(where.leadId) || null;
      },
      upsert: async ({ where, create, update }: { where: { leadId: string }; create: LeadScore; update: Partial<LeadScore> }) => {
        const existing = leadScoresStore.get(where.leadId);
        const record = existing ? { ...existing, ...update, updatedAt: new Date() } : { ...create, id: `score_${Date.now()}`, createdAt: new Date(), updatedAt: new Date() };
        leadScoresStore.set(where.leadId, record);
        return record;
      },
    },
    aIAnalysis: {
      findFirst: async ({ where }: { where: { leadId: string; workspaceId: string } }) => {
        return aiAnalysesStore.get(where.leadId) || null;
      },
      upsert: async ({ where, create, update }: { where: { leadId: string }; create: AIAnalysis; update: Partial<AIAnalysis> }) => {
        const existing = aiAnalysesStore.get(where.leadId);
        const record = existing ? { ...existing, ...update, updatedAt: new Date() } : { ...create, id: `ai_${Date.now()}`, createdAt: new Date(), updatedAt: new Date() };
        aiAnalysesStore.set(where.leadId, record);
        return record;
      },
    },
    auditLog: {
      create: async ({ data }: { data: any }) => {
        const record: AuditLog = {
          id: `audit_${Date.now()}`,
          workspaceId: data.workspaceId,
          userId: data.userId || null,
          eventType: data.eventType,
          entityType: data.entityType,
          entityId: data.entityId,
          metadata: data.metadata || null,
          ipAddress: null,
          userAgent: null,
          createdAt: new Date(),
        };
        auditLogsStore.push(record);
        return record;
      },
    },
    $transaction: async (cb: (tx: any) => Promise<any>) => cb(mockPrisma),
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
  const testAuditRepo = new AuditRepository(mockDbClient);
  const testLeadScoreRepo = new LeadScoreRepository(mockDbClient);
  const testAiAnalysisRepo = new AIAnalysisRepository(mockDbClient);

  const testLeadService = new LeadService(testLeadRepo, testAuditRepo);
  const testQualificationService = new QualificationDomainService(
    undefined,
    testLeadRepo,
    testLeadScoreRepo,
    testAiAnalysisRepo,
    testAuditRepo
  );

  const authorizedWorkspace = 'ws_verified_client_001';
  const unauthorizedWorkspace = 'ws_intruder_999';
  const testUserId = 'user_auditor_001';

  const authToken = signAuthToken({
    userId: testUserId,
    workspaceId: authorizedWorkspace,
    email: 'auditor@closevds.test',
    role: 'OWNER',
  });

  const intruderToken = signAuthToken({
    userId: 'user_intruder',
    workspaceId: unauthorizedWorkspace,
    email: 'intruder@evil.test',
    role: 'OWNER',
  });

  const app = await buildApp();

  try {
    // =========================================================================
    // SCENARIO 1: No Business Website Found
    // Expected: serviceOpportunity = YES, recommendedService = Website Design / Development
    // =========================================================================
    console.log('Testing Scenario 1: Lead with no website...');
    const lead1 = await testLeadService.createLead(authorizedWorkspace, testUserId, {
      businessName: 'Covent Garden Dental Clinic',
      phone: '+442079460001',
      address: '10 Floral Street, London',
      // domain intentionally omitted
    });

    // Evaluate via LeadService.getLead
    const fetchedLead1 = await testLeadService.getLead(lead1.id, authorizedWorkspace);
    assert.ok(fetchedLead1.serviceRecommendation, 'Service recommendation must be present');
    assert.strictEqual(fetchedLead1.serviceRecommendation.hasOpportunity, true);
    assert.strictEqual(fetchedLead1.serviceRecommendation.serviceOpportunity, 'YES');
    assert.strictEqual(fetchedLead1.serviceRecommendation.recommendedService, 'Website Design / Development');
    assert.strictEqual(fetchedLead1.serviceRecommendation.reason, 'No business website found.');
    assert.strictEqual(fetchedLead1.serviceRecommendation.evidence, 'No business website found.');

    // HTTP Verification for Scenario 1
    const res1 = await app.inject({
      method: 'GET',
      url: `/api/v1/leads/${lead1.id}`,
      headers: { authorization: `Bearer ${authToken}` },
    });
    assert.strictEqual(res1.statusCode, 200);
    const body1 = JSON.parse(res1.payload);
    assert.strictEqual(body1.success, true);
    assert.strictEqual(body1.serviceRecommendation.serviceOpportunity, 'YES');
    assert.strictEqual(body1.serviceRecommendation.recommendedService, 'Website Design / Development');
    assert.strictEqual(body1.serviceRecommendation.reason, 'No business website found.');
    console.log('✓ Scenario 1: No website correctly returns Website Design / Development');

    // =========================================================================
    // SCENARIO 2: Concrete Manual / Repetitive Workflow Evidence
    // Expected: serviceOpportunity = YES, recommendedService = AI Automation
    // =========================================================================
    console.log('Testing Scenario 2: Concrete manual workflow evidence...');
    const lead2 = await testLeadService.createLead(authorizedWorkspace, testUserId, {
      businessName: 'Soho Health Center',
      domain: 'sohohealth.example.com',
      phone: '+442079460002',
      address: '25 Dean Street, London',
    });

    // Seed research data with concrete operational bottleneck
    websiteAuditsStore.set(lead2.id, {
      id: `audit_${lead2.id}`,
      leadId: lead2.id,
      url: 'https://sohohealth.example.com',
      status: 200,
      mobileOptimized: true,
      bookingCtaVisible: false,
      auditGaps: ['Manual booking workflow: appointments handled exclusively by telephone receptionist'],
      rawAuditData: {},
      createdAt: new Date(),
    });

    aiAnalysesStore.set(lead2.id, {
      id: `ai_${lead2.id}`,
      workspaceId: authorizedWorkspace,
      leadId: lead2.id,
      summary: 'Practice operates high-volume outpatient schedule with manual customer inquiry handling via phone queue.',
      opportunityPoints: ['Manual booking workflow and repetitive lead handling creates major scheduling backlog'],
      riskFactors: [],
      createdAt: new Date(),
    });

    // Verify qualification domain evaluation
    const qual2 = await testQualificationService.getQualification(lead2.id, authorizedWorkspace);
    assert.ok(qual2.serviceRecommendation);
    assert.strictEqual(qual2.serviceRecommendation.hasOpportunity, true);
    assert.strictEqual(qual2.serviceRecommendation.serviceOpportunity, 'YES');
    assert.strictEqual(qual2.serviceRecommendation.recommendedService, 'AI Automation');
    assert.ok(qual2.serviceRecommendation.reason.length > 0);
    assert.ok(qual2.serviceRecommendation.evidence.length > 0);

    // HTTP Verification for Scenario 2
    const res2 = await app.inject({
      method: 'GET',
      url: `/api/v1/leads/${lead2.id}`,
      headers: { authorization: `Bearer ${authToken}` },
    });
    assert.strictEqual(res2.statusCode, 200);
    const body2 = JSON.parse(res2.payload);
    assert.strictEqual(body2.serviceRecommendation.serviceOpportunity, 'YES');
    assert.strictEqual(body2.serviceRecommendation.recommendedService, 'AI Automation');
    console.log('✓ Scenario 2: Concrete manual workflow correctly returns AI Automation');

    // =========================================================================
    // SCENARIO 3: Concrete Customer Acquisition / Lead Gen Evidence
    // Expected: serviceOpportunity = YES, recommendedService = Customer Acquisition System
    // =========================================================================
    console.log('Testing Scenario 3: Concrete customer acquisition deficit...');
    const lead3 = await testLeadService.createLead(authorizedWorkspace, testUserId, {
      businessName: 'Mayfair Aesthetic Surgery',
      domain: 'mayfairaesthetics.example.com',
      phone: '+442079460003',
      address: '14 Berkeley Square, London',
    });

    aiAnalysesStore.set(lead3.id, {
      id: `ai_${lead3.id}`,
      workspaceId: authorizedWorkspace,
      leadId: lead3.id,
      summary: 'High-end surgical practice suffering from severe lead generation deficiency and low patient inquiries.',
      opportunityPoints: ['Zero lead pipeline and customer acquisition problem resulting in unfilled treatment slots'],
      riskFactors: ['High overhead with low inquiry volume'],
      createdAt: new Date(),
    });

    const qual3 = await testQualificationService.getQualification(lead3.id, authorizedWorkspace);
    assert.ok(qual3.serviceRecommendation);
    assert.strictEqual(qual3.serviceRecommendation.hasOpportunity, true);
    assert.strictEqual(qual3.serviceRecommendation.serviceOpportunity, 'YES');
    assert.strictEqual(qual3.serviceRecommendation.recommendedService, 'Customer Acquisition System');

    const res3 = await app.inject({
      method: 'GET',
      url: `/api/v1/leads/${lead3.id}`,
      headers: { authorization: `Bearer ${authToken}` },
    });
    assert.strictEqual(res3.statusCode, 200);
    const body3 = JSON.parse(res3.payload);
    assert.strictEqual(body3.serviceRecommendation.serviceOpportunity, 'YES');
    assert.strictEqual(body3.serviceRecommendation.recommendedService, 'Customer Acquisition System');
    console.log('✓ Scenario 3: Concrete acquisition problem correctly returns Customer Acquisition System');

    // =========================================================================
    // SCENARIO 4: Insufficient Evidence
    // Expected: serviceOpportunity = NONE, recommendedService = NONE
    // =========================================================================
    console.log('Testing Scenario 4: Insufficient evidence...');
    const lead4 = await testLeadService.createLead(authorizedWorkspace, testUserId, {
      businessName: 'Kensington Dental Care',
      domain: 'kensingtondental.example.com',
      phone: '+442079460004',
      address: '88 Kensington High St, London',
    });
    // No website audit, no AI analysis, no observations

    const qual4 = await testQualificationService.getQualification(lead4.id, authorizedWorkspace);
    assert.ok(qual4.serviceRecommendation);
    assert.strictEqual(qual4.serviceRecommendation.hasOpportunity, false);
    assert.strictEqual(qual4.serviceRecommendation.serviceOpportunity, 'NONE');
    assert.strictEqual(qual4.serviceRecommendation.recommendedService, 'NONE');
    assert.strictEqual(qual4.serviceRecommendation.reason, 'Not enough evidence for a specific service opportunity.');
    assert.strictEqual(qual4.serviceRecommendation.evidence, 'Insufficient evidence.');

    const res4 = await app.inject({
      method: 'GET',
      url: `/api/v1/leads/${lead4.id}`,
      headers: { authorization: `Bearer ${authToken}` },
    });
    assert.strictEqual(res4.statusCode, 200);
    const body4 = JSON.parse(res4.payload);
    assert.strictEqual(body4.serviceRecommendation.serviceOpportunity, 'NONE');
    assert.strictEqual(body4.serviceRecommendation.recommendedService, 'NONE');
    console.log('✓ Scenario 4: Insufficient evidence correctly returns NONE');

    // =========================================================================
    // SCENARIO 5: Functioning Website + No Operational Bottlenecks
    // Expected: serviceOpportunity = NONE, recommendedService = NONE
    // =========================================================================
    console.log('Testing Scenario 5: Functioning website with no operational bottleneck...');
    const lead5 = await testLeadService.createLead(authorizedWorkspace, testUserId, {
      businessName: 'Harley Premier Smile',
      domain: 'harleypremiersmile.example.com',
      phone: '+442079460005',
      address: '1 Harley Street, London',
    });

    websiteAuditsStore.set(lead5.id, {
      id: `audit_${lead5.id}`,
      leadId: lead5.id,
      url: 'https://harleypremiersmile.example.com',
      status: 200,
      mobileOptimized: true,
      bookingCtaVisible: true,
      auditGaps: [],
      rawAuditData: {},
      createdAt: new Date(),
    });

    aiAnalysesStore.set(lead5.id, {
      id: `ai_${lead5.id}`,
      workspaceId: authorizedWorkspace,
      leadId: lead5.id,
      summary: 'State of the art dental practice with full online scheduling, automated intake, and steady organic flow.',
      opportunityPoints: [],
      riskFactors: [],
      createdAt: new Date(),
    });

    const qual5 = await testQualificationService.getQualification(lead5.id, authorizedWorkspace);
    assert.ok(qual5.serviceRecommendation);
    assert.strictEqual(qual5.serviceRecommendation.hasOpportunity, false);
    assert.strictEqual(qual5.serviceRecommendation.serviceOpportunity, 'NONE');
    assert.strictEqual(qual5.serviceRecommendation.recommendedService, 'NONE');

    const res5 = await app.inject({
      method: 'GET',
      url: `/api/v1/leads/${lead5.id}`,
      headers: { authorization: `Bearer ${authToken}` },
    });
    assert.strictEqual(res5.statusCode, 200);
    const body5 = JSON.parse(res5.payload);
    assert.strictEqual(body5.serviceRecommendation.serviceOpportunity, 'NONE');
    assert.strictEqual(body5.serviceRecommendation.recommendedService, 'NONE');
    console.log('✓ Scenario 5: Functioning website without bottleneck correctly returns NONE');

    // =========================================================================
    // SECURITY & INVARIANT VERIFICATION
    // =========================================================================
    console.log('\nTesting Security & Architectural Invariants...');

    // 1. Cross-tenant isolation on lead API
    const crossTenantRes = await app.inject({
      method: 'GET',
      url: `/api/v1/leads/${lead1.id}`,
      headers: { authorization: `Bearer ${intruderToken}` },
    });
    assert.strictEqual(crossTenantRes.statusCode, 404, 'Cross-tenant lead access must be rejected with 404');
    console.log('✓ Cross-tenant lead authorization strictly enforced');

    // 2. Cross-tenant isolation on qualification API
    const crossTenantQualRes = await app.inject({
      method: 'GET',
      url: `/api/v1/qualification/${lead1.id}`,
      headers: { authorization: `Bearer ${intruderToken}` },
    });
    assert.strictEqual(crossTenantQualRes.statusCode, 404, 'Cross-tenant qualification access must be rejected with 404');
    console.log('✓ Cross-tenant qualification authorization strictly enforced');

    // 3. Paginated list includes serviceRecommendation for every lead
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/leads',
      headers: { authorization: `Bearer ${authToken}` },
    });
    assert.strictEqual(listRes.statusCode, 200);
    const listBody = JSON.parse(listRes.payload);
    assert.ok(listBody.data.length >= 5);
    for (const lead of listBody.data) {
      assert.ok(lead.serviceRecommendation, `Lead ${lead.id} must include serviceRecommendation`);
      assert.ok(['YES', 'NONE'].includes(lead.serviceRecommendation.serviceOpportunity));
    }
    console.log('✓ All leads in paginated list contain deterministic serviceRecommendation');

    // 4. Verify generic/vague text does not trigger AI Automation
    const leadGeneric = await testLeadService.createLead(authorizedWorkspace, testUserId, {
      businessName: 'Generic Dental Practice',
      domain: 'genericpractice.example.com',
      phone: '+442079460099',
    });
    aiAnalysesStore.set(leadGeneric.id, {
      id: `ai_${leadGeneric.id}`,
      workspaceId: authorizedWorkspace,
      leadId: leadGeneric.id,
      summary: 'A standard practice that exists and uses technology.',
      opportunityPoints: ['Could use technology and modern AI solutions to grow.'],
      riskFactors: [],
      createdAt: new Date(),
    });
    const qualGeneric = await testQualificationService.getQualification(leadGeneric.id, authorizedWorkspace);
    assert.strictEqual(
      qualGeneric.serviceRecommendation?.serviceOpportunity,
      'NONE',
      'Generic text without evidence must NOT trigger AI Automation'
    );
    console.log('✓ Generic AI text strictly prevented from triggering false positive recommendation');

    console.log('\n===============================================================');
    console.log('--- ALL PHASE A5 END-TO-END VERIFICATION TESTS PASSED ---');
    console.log('===============================================================');
  } finally {
    await app.close();
    databaseClient.setPrismaClient(null);
  }
}

runServiceOpportunityE2ETests().catch((err) => {
  console.error('Service Opportunity E2E Test Failed:', err);
  process.exit(1);
});
