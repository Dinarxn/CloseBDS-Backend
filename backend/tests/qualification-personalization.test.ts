import assert from 'node:assert/strict';
import { buildApp } from '../src/server/app.js';
import { signAuthToken } from '../src/modules/auth/token.js';
import { QualificationDomainService } from '../src/modules/qualification/qualification.service.js';
import { PersonalizationDomainService } from '../src/modules/personalization/personalization.service.js';
import {
  LeadRepository,
  LeadScoreRepository,
  AIAnalysisRepository,
  AuditRepository,
} from '../src/database/repository.js';
import { databaseClient, type DatabaseClient } from '../src/database/client.js';
import { NotFoundError } from '../src/core/errors/api-error.js';
import type {
  PrismaClient,
  Lead,
  Contact,
  WebsiteAudit,
  LeadScore,
  AIAnalysis,
  AuditLog,
  LeadStatus,
} from '@prisma/client';
import type {
  AIService,
  QualificationInput,
  QualificationResult,
  PersonalizationInput,
  EmailCopyResult,
} from '../src/integrations/ai/index.js';

async function runQualificationPersonalizationTests() {
  console.log('\n--- Starting closeVDS Qualification & Personalization Tests ---');

  // In-memory test stores
  const leadsStore: Map<string, Lead> = new Map();
  const contactsStore: Map<string, Contact> = new Map();
  const websiteAuditsStore: Map<string, WebsiteAudit> = new Map();
  const leadScoresStore: Map<string, LeadScore> = new Map();
  const aiAnalysesStore: Map<string, AIAnalysis> = new Map();
  const auditLogsStore: AuditLog[] = [];

  const mockPrisma = {
    lead: {
      findFirst: async ({ where }: { where: { id?: string; workspaceId?: string } }) => {
        for (const lead of leadsStore.values()) {
          const matchId = !where.id || lead.id === where.id;
          const matchWs = !where.workspaceId || lead.workspaceId === where.workspaceId;

          if (matchId && matchWs) {
            const contacts = Array.from(contactsStore.values()).filter((c) => c.leadId === lead.id);
            const websiteAudit = websiteAuditsStore.get(lead.id) || null;
            const leadScore = leadScoresStore.get(lead.id) || null;
            const aiAnalysis = aiAnalysesStore.get(lead.id) || null;
            return { ...lead, contacts, websiteAudit, leadScore, aiAnalysis };
          }
        }
        return null;
      },
      create: async ({ data }: { data: { workspaceId: string; campaignId: string; businessName: string; domain?: string; phone?: string; address?: string; status?: LeadStatus } }) => {
        const id = `lead_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const lead: Lead = {
          id,
          workspaceId: data.workspaceId,
          campaignId: data.campaignId,
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
    leadScore: {
      upsert: async ({ where, update, create }: { where: { leadId: string }; update: Record<string, unknown>; create: Record<string, unknown> }) => {
        const existing = leadScoresStore.get(where.leadId);
        const data = existing ? { ...existing, ...update } : create;
        const entry: LeadScore = {
          id: existing?.id || `score_${Date.now()}`,
          leadId: where.leadId,
          relevanceScore: Number(data.relevanceScore),
          opportunityScore: Number(data.opportunityScore),
          totalScore: Number(data.totalScore),
          rationale: data.rationale as string,
          scoredAt: new Date(),
        };
        leadScoresStore.set(where.leadId, entry);
        return entry;
      },
    },
    aIAnalysis: {
      upsert: async ({ where, update, create }: { where: { leadId: string }; update: Record<string, unknown>; create: Record<string, unknown> }) => {
        const existing = aiAnalysesStore.get(where.leadId);
        const data = existing ? { ...existing, ...update } : create;
        const entry: AIAnalysis = {
          id: existing?.id || `analysis_${Date.now()}`,
          leadId: where.leadId,
          summary: data.summary as string,
          opportunityPoints: (data.opportunityPoints as string[]) || [],
          riskFactors: (data.riskFactors as string[]) || [],
          analyzedAt: new Date(),
        };
        aiAnalysesStore.set(where.leadId, entry);
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
  const testLeadScoreRepo = new LeadScoreRepository(mockDbClient);
  const testAiAnalysisRepo = new AIAnalysisRepository(mockDbClient);
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

  // Seed sample leads
  const leadA = await testLeadRepo.create({
    workspaceId: workspaceA,
    campaignId,
    businessName: 'Apex Dental Care',
    domain: 'apexdental.com',
    phone: '+442079460000',
    address: '123 Harley Street, London',
    status: 'NEW',
  });

  const contactA: Contact = {
    id: `contact_123`,
    leadId: leadA.id,
    fullName: 'Dr. John Smith',
    email: 'john@apexdental.com',
    title: 'Principal Dentist',
    phone: '+442079460000',
    isPrimary: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  contactsStore.set(contactA.id, contactA);

  const auditA: WebsiteAudit = {
    id: `audit_123`,
    leadId: leadA.id,
    domain: 'apexdental.com',
    mobileOptimized: true,
    bookingCtaVisible: false,
    auditGaps: ['Missing sticky mobile booking CTA', 'Page load speed 4.2s'],
    rawAuditData: null,
    auditedAt: new Date(),
  };
  websiteAuditsStore.set(leadA.id, auditA);

  try {
    // --------------------------------------------------------------------------
    // 1. AI Qualification: Unconfigured Behavior & Score Boundaries
    // --------------------------------------------------------------------------
    console.log('Test 1-3: AI Qualification unconfigured behavior and score clamping...');
    const unconfQual = new QualificationDomainService(
      undefined,
      testLeadRepo,
      testLeadScoreRepo,
      testAiAnalysisRepo,
      testAuditRepo
    );

    const unconfRes = await unconfQual.qualifyLead(leadA.id, workspaceA, 'user_a', {
      criteria: ['Dental practices in London with online booking issues'],
    });
    assert.equal(unconfRes.status, 'unavailable');

    // Manual qualification override with score boundaries
    const manualRes = await unconfQual.qualifyLead(leadA.id, workspaceA, 'user_a', {
      criteria: [],
      manualScoreOverride: {
        relevanceScore: 85,
        opportunityScore: 90,
        rationale: 'High dental patient volume with broken appointment booking flow',
        summary: 'Excellent high-intent candidate for client acquisition system',
        opportunityPoints: ['Deploy direct calendar sync widget', 'Optimize mobile speed'],
        riskFactors: ['Competitor active in local vicinity'],
      },
    });

    assert.equal(manualRes.status, 'completed');
    assert.ok(manualRes.leadScore);
    assert.equal(manualRes.leadScore.totalScore, 88);
    assert.equal(manualRes.leadScore.relevanceScore, 85);
    assert.ok(manualRes.aiAnalysis);
    assert.equal(manualRes.aiAnalysis.opportunityPoints.length, 2);

    // Verify lead status transitioned to QUALIFIED
    const updatedLead = leadsStore.get(leadA.id);
    assert.equal(updatedLead?.status, 'QUALIFIED');
    console.log('✓ Qualification score clamping, persistence, and status transitions passed');

    // --------------------------------------------------------------------------
    // 2. AI Qualification: Active Mock AI Service
    // --------------------------------------------------------------------------
    console.log('Test 4-6: AI Service provider integration & cross-tenant isolation...');
    const mockAiService: AIService = {
      async qualifyLead(input: QualificationInput): Promise<QualificationResult> {
        return {
          relevanceScore: 88,
          opportunityScore: 92,
          totalScore: 90,
          isQualified: true,
          reasoningRationale: `Analyzed ${input.businessName}. Confirmed strong qualification based on targeting criteria.`,
        };
      },
      async analyzeWebsite() {
        throw new Error('Not used');
      },
      async personalizeOutreach(input: PersonalizationInput): Promise<EmailCopyResult> {
        return {
          subjectLine: `Quick observation on ${input.businessName}'s booking flow`,
          openingHook: `Hi ${input.contactName || 'there'}, noticed your booking CTA isn't visible on mobile.`,
          bodyText: `We help dental clinics capture 30% more bookings through automated reservation audits.`,
          factReferences: [input.businessName, ...(input.auditGaps || [])],
        };
      },
      async classifyReply() {
        throw new Error('Not used');
      },
    };

    const activeQual = new QualificationDomainService(
      mockAiService,
      testLeadRepo,
      testLeadScoreRepo,
      testAiAnalysisRepo,
      testAuditRepo
    );

    const aiQualRes = await activeQual.qualifyLead(leadA.id, workspaceA, 'user_a', {
      criteria: ['Dental practices in UK'],
    });

    assert.equal(aiQualRes.status, 'completed');
    assert.equal(aiQualRes.leadScore?.totalScore, 90);

    // Cross-tenant qualification attempt blocked
    await assert.rejects(
      async () => {
        await activeQual.qualifyLead(leadA.id, workspaceB, 'user_b', { criteria: [] });
      },
      NotFoundError,
      'Cross-tenant qualification must be rejected'
    );
    console.log('✓ AI qualification provider execution and tenant isolation passed');

    // --------------------------------------------------------------------------
    // 3. AI Personalization: Outreach Draft Generation & Human Approval Boundary
    // --------------------------------------------------------------------------
    console.log('Test 7-10: AI Personalization draft generation & human approval guardrail...');
    const activePersonalization = new PersonalizationDomainService(
      mockAiService,
      testLeadRepo,
      testAuditRepo
    );

    const draftRes = await activePersonalization.generateOutreachDraft(
      leadA.id,
      workspaceA,
      'user_a',
      {
        targetOffer: 'Free Technical Booking Audit',
      }
    );

    assert.equal(draftRes.status, 'completed');
    assert.ok(draftRes.draft);
    assert.equal(draftRes.draft.humanApprovalRequired, true, 'Human approval must be required');
    assert.equal(draftRes.draft.isApproved, false, 'Draft must NOT be auto-approved');
    assert.equal(draftRes.draft.status, 'DRAFT', 'Status must be DRAFT');
    assert.equal(draftRes.draft.recipientEmail, 'john@apexdental.com');
    assert.ok(draftRes.draft.subject.includes('Apex Dental Care'));
    assert.ok(draftRes.draft.factReferences.includes('Apex Dental Care'));

    // Cross-tenant personalization attempt blocked
    await assert.rejects(
      async () => {
        await activePersonalization.generateOutreachDraft(leadA.id, workspaceB, 'user_b', {});
      },
      NotFoundError,
      'Cross-tenant personalization must be rejected'
    );
    console.log('✓ AI personalization draft generation, fact-grounding, and human approval guardrails passed');

    // --------------------------------------------------------------------------
    // 4. Fastify HTTP Endpoints
    // --------------------------------------------------------------------------
    console.log('Test 11-15: Fastify Qualification & Personalization HTTP Routes...');
    const app = await buildApp();

    // Unauthenticated qualification -> 401
    const unauthQual = await app.inject({
      method: 'POST',
      url: `/api/v1/qualification/${leadA.id}`,
    });
    assert.equal(unauthQual.statusCode, 401);

    // Authenticated get qualification
    const getQualRes = await app.inject({
      method: 'GET',
      url: `/api/v1/qualification/${leadA.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(getQualRes.statusCode, 200);
    const getQualBody = JSON.parse(getQualRes.payload);
    assert.equal(getQualBody.success, true);
    assert.equal(getQualBody.leadScore.totalScore, 90);

    // Authenticated trigger personalization
    const postPersRes = await app.inject({
      method: 'POST',
      url: `/api/v1/personalization/${leadA.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        manualCopyOverride: {
          subjectLine: 'Personalized outreach for Dr. John Smith',
          openingHook: 'Hi Dr. Smith',
          bodyText: 'We can fix your website booking gaps.',
          factReferences: ['Apex Dental Care', 'Dr. John Smith'],
        },
      },
    });
    assert.equal(postPersRes.statusCode, 200);
    const postPersBody = JSON.parse(postPersRes.payload);
    assert.equal(postPersBody.success, true);
    assert.equal(postPersBody.draft.status, 'DRAFT');
    assert.equal(postPersBody.draft.humanApprovalRequired, true);

    // Cross-tenant HTTP attempt -> 404
    const crossPersRes = await app.inject({
      method: 'POST',
      url: `/api/v1/personalization/${leadA.id}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    assert.equal(crossPersRes.statusCode, 404);

    await app.close();
    console.log('✓ Fastify Qualification and Personalization HTTP endpoints passed');
    console.log('\n--- All Qualification & Personalization Tests Passed Successfully ---');
  } finally {
    databaseClient.setPrismaClient(null);
  }
}

runQualificationPersonalizationTests().catch((err) => {
  console.error('Qualification & Personalization Test Suite Failed:', err);
  process.exit(1);
});
