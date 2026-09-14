import assert from 'node:assert/strict';
import { buildApp } from '../src/server/app.js';
import { databaseClient } from '../src/database/client.js';
import { signAuthToken } from '../src/modules/auth/token.js';
import { LeadAiService } from '../src/modules/leads/lead-ai.service.js';
import { LeadRepository } from '../src/database/repository.js';
import { PrismaClientInitializationError } from '@prisma/client/runtime/library.js';
import type { PrismaClient, Lead, Contact, LeadScore, WebsiteAudit, AIAnalysis, LeadStatus } from '@prisma/client';

async function runStep19Tests() {
  console.log('\n===============================================================');
  console.log('--- Stage 4, Step 19: Lead Pool & AI Results Integration Tests ---');
  console.log('===============================================================\n');

  // In-memory test stores
  const leadsStore: Map<string, Lead> = new Map();
  const contactsStore: Map<string, Contact> = new Map();
  const scoresStore: Map<string, LeadScore> = new Map();
  const auditsStore: Map<string, WebsiteAudit> = new Map();
  const analysesStore: Map<string, AIAnalysis> = new Map();

  const workspaceAlpha = 'ws_alpha_stage4_step19';
  const workspaceBeta = 'ws_beta_stage4_step19';

  // Seed Leads
  const leadAlphaId = 'lead_alpha_dental_01';
  const leadAlpha: Lead = {
    id: leadAlphaId,
    workspaceId: workspaceAlpha,
    campaignId: null,
    businessName: 'Apex Dental Partners',
    domain: 'apexdental.example.com',
    phone: '+1-555-019-2831',
    address: '100 Main St, Austin, TX 78701',
    status: 'QUALIFIED' as LeadStatus,
    createdAt: new Date('2026-09-05T10:00:00Z'),
    updatedAt: new Date('2026-09-05T10:00:00Z'),
  };
  leadsStore.set(leadAlphaId, leadAlpha);

  const contactAlpha: Contact = {
    id: 'contact_alpha_01',
    leadId: leadAlphaId,
    fullName: 'Dr. John Sterling',
    email: 'jsterling@apexdental.example.com',
    title: 'Managing Partner',
    phone: '+1-555-019-2831',
    isPrimary: true,
    createdAt: new Date('2026-09-05T10:00:00Z'),
    updatedAt: new Date('2026-09-05T10:00:00Z'),
  };
  contactsStore.set(contactAlpha.id, contactAlpha);

  const scoreAlpha: LeadScore = {
    id: 'score_alpha_01',
    leadId: leadAlphaId,
    relevanceScore: 88,
    opportunityScore: 84,
    totalScore: 86,
    rationale: 'High dental practice opportunity with missing booking CTA',
    scoredAt: new Date('2026-09-05T10:05:00Z'),
  };
  scoresStore.set(scoreAlpha.id, scoreAlpha);

  const auditAlpha: WebsiteAudit = {
    id: 'audit_alpha_01',
    leadId: leadAlphaId,
    domain: 'apexdental.example.com',
    mobileOptimized: true,
    bookingCtaVisible: false,
    auditGaps: ['Responsive modern site but lacks direct online appointment widget'],
    rawAuditData: null,
    auditedAt: new Date('2026-09-05T10:03:00Z'),
  };
  auditsStore.set(auditAlpha.id, auditAlpha);

  // Seed Lead in Workspace Beta for Cross-Tenant Isolation
  const leadBetaId = 'lead_beta_chiro_02';
  const leadBeta: Lead = {
    id: leadBetaId,
    workspaceId: workspaceBeta,
    campaignId: null,
    businessName: 'Summit Chiropractic Care',
    domain: 'summitchiro.example.com',
    phone: '+1-555-028-4491',
    address: '200 High St, Denver, CO 80202',
    status: 'DISCOVERED' as LeadStatus,
    createdAt: new Date('2026-09-06T11:00:00Z'),
    updatedAt: new Date('2026-09-06T11:00:00Z'),
  };
  leadsStore.set(leadBetaId, leadBeta);

  let simulateDbOffline = false;

  const mockPrisma = {
    lead: {
      findFirst: async ({ where, include }: { where: { id?: string; workspaceId?: string; businessName?: string }; include?: Record<string, boolean> }) => {
        if (simulateDbOffline) {
          throw new PrismaClientInitializationError(
            "Can't reach database server at localhost:5432",
            '6.4.1'
          );
        }

        for (const lead of leadsStore.values()) {
          const matchId = !where.id || lead.id === where.id;
          const matchWs = !where.workspaceId || lead.workspaceId === where.workspaceId;
          const matchBiz = !where.businessName || lead.businessName === where.businessName;

          if (matchId && matchWs && matchBiz) {
            const result: Record<string, unknown> = { ...lead };
            if (include?.contacts) {
              result.contacts = Array.from(contactsStore.values()).filter((c) => c.leadId === lead.id);
            }
            if (include?.leadScore) {
              result.leadScore = Array.from(scoresStore.values()).find((s) => s.leadId === lead.id) || null;
            }
            if (include?.websiteAudit) {
              result.websiteAudit = Array.from(auditsStore.values()).find((a) => a.leadId === lead.id) || null;
            }
            if (include?.aiAnalysis) {
              result.aiAnalysis = Array.from(analysesStore.values()).find((a) => a.leadId === lead.id) || null;
            }
            return result;
          }
        }
        return null;
      },

      findMany: async ({ where, skip, take }: { where: { workspaceId: string; status?: LeadStatus; search?: string }; skip?: number; take?: number }) => {
        if (simulateDbOffline) {
          throw new PrismaClientInitializationError(
            "Can't reach database server at localhost:5432",
            '6.4.1'
          );
        }

        let results = Array.from(leadsStore.values()).filter((l) => l.workspaceId === where.workspaceId);
        if (where.status) {
          results = results.filter((l) => l.status === where.status);
        }
        if (skip !== undefined && take !== undefined) {
          results = results.slice(skip, skip + take);
        }
        return results.map((l) => ({
          ...l,
          contacts: Array.from(contactsStore.values()).filter((c) => c.leadId === l.id),
          leadScore: Array.from(scoresStore.values()).find((s) => s.leadId === l.id) || null,
        }));
      },

      count: async ({ where }: { where: { workspaceId: string; status?: LeadStatus } }) => {
        if (simulateDbOffline) {
          throw new PrismaClientInitializationError(
            "Can't reach database server at localhost:5432",
            '6.4.1'
          );
        }
        let count = Array.from(leadsStore.values()).filter((l) => l.workspaceId === where.workspaceId).length;
        if (where.status) {
          count = Array.from(leadsStore.values()).filter(
            (l) => l.workspaceId === where.workspaceId && l.status === where.status
          ).length;
        }
        return count;
      },
    },

    contact: {
      findMany: async ({ where }: { where: { leadId: string } }) => {
        return Array.from(contactsStore.values()).filter((c) => c.leadId === where.leadId);
      },
    },

    auditLog: {
      create: async () => ({ id: 'audit_log_mock' }),
    },

    suppression: {
      findFirst: async () => null,
      isSuppressed: async () => false,
    },

    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(mockPrisma),
  } as unknown as PrismaClient;

  databaseClient.setPrismaClient(mockPrisma);

  const tokenUserAlpha = signAuthToken({
    userId: 'user_alpha_step19',
    workspaceId: workspaceAlpha,
    email: 'sarah@apexdental.example.com',
    role: 'OWNER',
  });

  const tokenUserBeta = signAuthToken({
    userId: 'user_beta_step19',
    workspaceId: workspaceBeta,
    email: 'david@summitchiro.example.com',
    role: 'OWNER',
  });

  const app = await buildApp();

  try {
    // --------------------------------------------------------------------------
    // Test 1: Unauthenticated Lead Endpoints Protection (401)
    // --------------------------------------------------------------------------
    console.log('Test 1: Verifying unauthenticated requests to Lead endpoints are rejected (401)...');

    const unauthList = await app.inject({ method: 'GET', url: '/api/v1/leads' });
    assert.equal(unauthList.statusCode, 401, 'GET /api/v1/leads must require auth');
    assert.equal(JSON.parse(unauthList.payload).error.code, 'UNAUTHORIZED');

    const unauthDetail = await app.inject({ method: 'GET', url: `/api/v1/leads/${leadAlphaId}` });
    assert.equal(unauthDetail.statusCode, 401, 'GET /api/v1/leads/:id must require auth');

    const unauthAi = await app.inject({ method: 'POST', url: `/api/v1/leads/${leadAlphaId}/ai` });
    assert.equal(unauthAi.statusCode, 401, 'POST /api/v1/leads/:id/ai must require auth');
    console.log('✓ All Lead endpoints strictly require authenticated sessions');

    // --------------------------------------------------------------------------
    // Test 2: Authenticated Lead Pool List Retrieval (GET /api/v1/leads)
    // --------------------------------------------------------------------------
    console.log('\nTest 2: Verifying Lead Pool list API response contract and tenant isolation...');
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/leads',
      headers: { authorization: `Bearer ${tokenUserAlpha}` },
    });
    assert.equal(listRes.statusCode, 200, 'GET /api/v1/leads must return 200');
    const listData = JSON.parse(listRes.payload);

    assert.equal(listData.success, true);
    assert.ok(Array.isArray(listData.data), 'Response data must be an array of leads');
    assert.equal(listData.total, 1, 'Total count must match workspace leads count');
    assert.equal(listData.data[0].id, leadAlphaId, 'Must return lead from user workspace');
    assert.equal(listData.data[0].businessName, 'Apex Dental Partners');
    assert.ok(listData.data[0].contacts.length > 0, 'Must include associated contacts');
    console.log('✓ Lead Pool list contract satisfies Fastify response structure and tenant scoping');

    // --------------------------------------------------------------------------
    // Test 3: Lead Detail Retrieval Contract (GET /api/v1/leads/:id)
    // --------------------------------------------------------------------------
    console.log('\nTest 3: Verifying Lead Detail retrieval with contacts, score, and audit...');
    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/v1/leads/${leadAlphaId}`,
      headers: { authorization: `Bearer ${tokenUserAlpha}` },
    });
    assert.equal(detailRes.statusCode, 200, 'GET /api/v1/leads/:id must return 200');
    const detailData = JSON.parse(detailRes.payload);

    assert.equal(detailData.success, true);
    assert.ok(detailData.lead, 'Must return lead object');
    assert.equal(detailData.lead.id, leadAlphaId);
    assert.equal(detailData.lead.businessName, 'Apex Dental Partners');
    assert.equal(detailData.lead.domain, 'apexdental.example.com');
    assert.equal(detailData.lead.contacts[0].fullName, 'Dr. John Sterling');
    assert.equal(detailData.lead.leadScore.totalScore, 86);
    assert.equal(detailData.lead.websiteAudit.mobileOptimized, true);
    console.log('✓ Lead Detail contract returns complete prospect intelligence attributes');

    // --------------------------------------------------------------------------
    // Test 4: Cross-Workspace Tenant Protection on Detail (404)
    // --------------------------------------------------------------------------
    console.log('\nTest 4: Verifying cross-workspace lead detail access is denied (404)...');
    const crossRes = await app.inject({
      method: 'GET',
      url: `/api/v1/leads/${leadBetaId}`, // Lead in Beta, requested by Alpha
      headers: { authorization: `Bearer ${tokenUserAlpha}` },
    });
    assert.equal(crossRes.statusCode, 404, 'Cross-workspace lead access must return 404');
    const crossData = JSON.parse(crossRes.payload);
    assert.equal(crossData.error.code, 'NOT_FOUND');
    console.log('✓ Cross-tenant lead access denied without data leakage');

    // --------------------------------------------------------------------------
    // Test 5: Cross-Workspace AI Execution Isolation (404)
    // --------------------------------------------------------------------------
    console.log('\nTest 5: Verifying cross-workspace AI workflow execution is rejected (404)...');
    const crossAiRes = await app.inject({
      method: 'POST',
      url: `/api/v1/leads/${leadBetaId}/ai`, // Beta lead, requested by Alpha
      headers: { authorization: `Bearer ${tokenUserAlpha}` },
    });
    assert.equal(crossAiRes.statusCode, 404, 'Cross-workspace AI execution must return 404');
    const crossAiData = JSON.parse(crossAiRes.payload);
    assert.equal(crossAiData.error.code, 'NOT_FOUND');
    console.log('✓ Cross-tenant AI execution securely blocked');

    // --------------------------------------------------------------------------
    // Test 6: AI Workflow Service Contract & Human Approval Invariant
    // --------------------------------------------------------------------------
    console.log('\nTest 6: Verifying deterministic AI Workflow response contract and safety invariants...');
    const deterministicGraph = {
      invoke: async (input: Record<string, unknown>) => ({
        leadId: input.leadId,
        workspaceId: input.workspaceId,
        status: 'awaiting_approval',
        currentStep: 'human_approval_gate',
        aiResult: {
          summary: 'High-intent dental practice with modernization opportunities',
          intent: 'high_fit',
          confidence: 0.92,
        },
        qualification: {
          qualified: true,
          reason: 'Meets ICP dental threshold and lacks online booking',
          score: 88,
        },
        personalizedMessage: {
          subject: 'Modernizing patient booking for Apex Dental Partners',
          body: 'Hello Dr. Sterling, noticed your Austin clinic could benefit from automated scheduling.',
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

    const testLeadRepo = new LeadRepository({
      getPrismaClient: () => mockPrisma,
    } as any);

    const step19AiService = new LeadAiService(testLeadRepo, deterministicGraph as any);

    const aiResult = await step19AiService.executeLeadAiWorkflow(
      leadAlphaId,
      workspaceAlpha,
      'user_alpha_step19'
    );

    // AI Result
    assert.ok(aiResult.aiResult, 'Must contain aiResult');
    assert.equal(aiResult.aiResult.summary, 'High-intent dental practice with modernization opportunities');
    assert.equal(aiResult.aiResult.intent, 'high_fit');
    assert.equal(aiResult.aiResult.confidence, 0.92);

    // Qualification
    assert.ok(aiResult.qualification, 'Must contain qualification');
    assert.equal(aiResult.qualification.qualified, true);
    assert.equal(aiResult.qualification.score, 88);
    assert.ok(aiResult.qualification.reason.length > 0);

    // Personalized Message
    assert.ok(aiResult.personalizedMessage, 'Must contain personalizedMessage');
    assert.equal(aiResult.personalizedMessage.subject, 'Modernizing patient booking for Apex Dental Partners');
    assert.ok(aiResult.personalizedMessage.body.length > 0);

    // Quality Check
    assert.ok(aiResult.qualityCheck, 'Must contain qualityCheck');
    assert.equal(aiResult.qualityCheck.passed, true);
    assert.equal(aiResult.qualityCheck.score, 95);
    assert.equal(aiResult.qualityCheck.issues.length, 0);

    // Human Approval Status (Safety Invariant)
    assert.ok(aiResult.approval, 'Must contain approval object');
    assert.equal(
      aiResult.approval.status,
      'pending',
      'Approval status must be pending (non-bypassable safety invariant)'
    );
    console.log('✓ AI Workflow contract satisfies all 5 Step 19 result structures and human approval safety boundary');

    // --------------------------------------------------------------------------
    // Test 7: Database Offline Error Mapping (503 DATABASE_UNAVAILABLE)
    // --------------------------------------------------------------------------
    console.log('\nTest 7: Verifying Database Unavailable mapping (503 DATABASE_UNAVAILABLE)...');
    simulateDbOffline = true;

    const dbOfflineRes = await app.inject({
      method: 'GET',
      url: '/api/v1/leads',
      headers: { authorization: `Bearer ${tokenUserAlpha}` },
    });
    assert.equal(dbOfflineRes.statusCode, 503, 'Offline DB must return HTTP 503');
    const dbOfflineData = JSON.parse(dbOfflineRes.payload);
    assert.equal(dbOfflineData.error.code, 'DATABASE_UNAVAILABLE');
    assert.ok(
      dbOfflineData.error.message.includes('Cannot reach PostgreSQL database server'),
      'Message must explain database connection status'
    );
    // Secret protection check
    assert.equal(
      dbOfflineRes.payload.includes('closevds_secure_password'),
      false,
      'Database password must NEVER appear in error responses'
    );
    console.log('✓ Database unreachable mapped to safe 503 DATABASE_UNAVAILABLE');

    simulateDbOffline = false;

    console.log('\n===============================================================');
    console.log('ALL 7 STAGE 4 STEP 19 INTEGRATION TESTS PASSED (100%)');
    console.log('===============================================================\n');
  } finally {
    await app.close();
  }
}

runStep19Tests().catch((err) => {
  console.error('\n❌ STEP 19 INTEGRATION TEST SUITE FAILED:', err);
  process.exit(1);
});
