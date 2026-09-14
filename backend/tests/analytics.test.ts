import assert from 'node:assert/strict';
import { buildApp } from '../src/server/app.js';
import { signAuthToken } from '../src/modules/auth/token.js';
import { AnalyticsService } from '../src/modules/analytics/analytics.service.js';
import { CampaignRepository } from '../src/database/repository.js';
import { databaseClient, type DatabaseClient } from '../src/database/client.js';
import { NotFoundError } from '../src/core/errors/api-error.js';
import type {
  PrismaClient,
  Campaign,
  Lead,
  Contact,
  EmailCampaign,
  EmailMessage,
  CRMActivity,
  Task,
  LeadScore,
  Prisma,
} from '@prisma/client';

async function runAnalyticsTests() {
  console.log('\n--- Starting closeVDS Analytics & Reporting Tests ---');

  // In-memory test stores
  const campaignsStore: Map<string, Campaign> = new Map();
  const leadsStore: Map<string, Lead> = new Map();
  const leadScoresStore: Map<string, LeadScore> = new Map();
  const contactsStore: Map<string, Contact> = new Map();
  const emailCampaignsStore: Map<string, EmailCampaign> = new Map();
  const emailMessagesStore: Map<string, EmailMessage> = new Map();
  const crmActivitiesStore: Map<string, CRMActivity> = new Map();
  const tasksStore: Map<string, Task> = new Map();

  const mockPrisma = {
    campaign: {
      findFirst: async ({ where }: { where: { id?: string; workspaceId?: string } }) => {
        for (const c of campaignsStore.values()) {
          const matchId = !where.id || c.id === where.id;
          const matchWs = !where.workspaceId || c.workspaceId === where.workspaceId;
          if (matchId && matchWs) return c;
        }
        return null;
      },
      findMany: async ({ where }: { where: { workspaceId?: string; id?: string; createdAt?: Prisma.DateTimeFilter } }) => {
        return Array.from(campaignsStore.values())
          .filter((c) => {
            const matchWs = !where.workspaceId || c.workspaceId === where.workspaceId;
            const matchId = !where.id || c.id === where.id;
            return matchWs && matchId;
          })
          .map((c) => {
            const leads = Array.from(leadsStore.values()).filter((l) => l.campaignId === c.id);
            const emailCampaign = Array.from(emailCampaignsStore.values()).find((ec) => ec.campaignId === c.id) || null;
            const messages = emailCampaign
              ? Array.from(emailMessagesStore.values()).filter((m) => m.emailCampaignId === emailCampaign.id)
              : [];
            return {
              ...c,
              leads,
              emailCampaign: emailCampaign
                ? {
                    ...emailCampaign,
                    messages,
                  }
                : null,
            };
          });
      },
    },
    lead: {
      findMany: async ({ where }: { where: { workspaceId?: string; campaignId?: string; createdAt?: Prisma.DateTimeFilter } }) => {
        return Array.from(leadsStore.values())
          .filter((l) => {
            const matchWs = !where.workspaceId || l.workspaceId === where.workspaceId;
            const matchCamp = !where.campaignId || l.campaignId === where.campaignId;
            return matchWs && matchCamp;
          })
          .map((l) => {
            const contacts = Array.from(contactsStore.values()).filter((c) => c.leadId === l.id);
            const score = leadScoresStore.get(l.id) || null;
            const campaign = l.campaignId ? campaignsStore.get(l.campaignId) || null : null;
            return {
              ...l,
              contacts,
              leadScore: score,
              campaign,
            };
          });
      },
    },
    emailMessage: {
      findMany: async ({ where }: { where: { emailCampaign?: { campaign?: { workspaceId?: string; id?: string }; campaignId?: string }; createdAt?: Prisma.DateTimeFilter } }) => {
        const results: EmailMessage[] = [];
        for (const msg of emailMessagesStore.values()) {
          const emailCamp = Array.from(emailCampaignsStore.values()).find((ec) => ec.id === msg.emailCampaignId);
          if (!emailCamp) continue;
          const campaign = campaignsStore.get(emailCamp.campaignId);
          if (!campaign) continue;

          if (where.emailCampaign?.campaign?.workspaceId && campaign.workspaceId !== where.emailCampaign.campaign.workspaceId) {
            continue;
          }
          if (where.emailCampaign?.campaign?.id && campaign.id !== where.emailCampaign.campaign.id) {
            continue;
          }
          if (where.emailCampaign?.campaignId && campaign.id !== where.emailCampaign.campaignId) {
            continue;
          }
          results.push(msg);
        }
        return results;
      },
    },
    cRMActivity: {
      findMany: async ({ where }: { where: { lead?: { workspaceId?: string; campaignId?: string }; createdAt?: Prisma.DateTimeFilter } }) => {
        const results: CRMActivity[] = [];
        for (const act of crmActivitiesStore.values()) {
          const lead = leadsStore.get(act.leadId);
          if (!lead) continue;
          if (where.lead?.workspaceId && lead.workspaceId !== where.lead.workspaceId) continue;
          if (where.lead?.campaignId && lead.campaignId !== where.lead.campaignId) continue;
          results.push(act);
        }
        return results;
      },
    },
    task: {
      findMany: async ({ where }: { where: { lead?: { workspaceId?: string; campaignId?: string }; createdAt?: Prisma.DateTimeFilter } }) => {
        const results: Task[] = [];
        for (const t of tasksStore.values()) {
          const lead = leadsStore.get(t.leadId);
          if (!lead) continue;
          if (where.lead?.workspaceId && lead.workspaceId !== where.lead.workspaceId) continue;
          if (where.lead?.campaignId && lead.campaignId !== where.lead.campaignId) continue;
          results.push(t);
        }
        return results;
      },
    },
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
  const testAnalyticsService = new AnalyticsService(testCampaignRepo, mockDbClient);

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

  // Seed sample data in Workspace A
  const campaignA: Campaign = {
    id: '11111111-1111-4111-8111-111111111111',
    workspaceId: workspaceA,
    name: 'Harley St Orthodontics',
    niche: 'Dental',
    location: 'London',
    targetOffer: 'Audit Booking Widget',
    dailyCap: 50,
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  campaignsStore.set(campaignA.id, campaignA);

  const emailCampaignA: EmailCampaign = {
    id: 'ecamp_1',
    campaignId: campaignA.id,
    fromEmail: 'growth@closevds.local',
    fromName: 'Growth Team',
    dailyCap: 50,
    scheduleConfig: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  emailCampaignsStore.set(campaignA.id, emailCampaignA);

  const leadA1: Lead = {
    id: 'lead_1',
    workspaceId: workspaceA,
    campaignId: campaignA.id,
    businessName: 'Apex Dental',
    domain: 'apexdental.co.uk',
    phone: '+442079461111',
    address: 'London',
    status: 'QUALIFIED',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  leadsStore.set(leadA1.id, leadA1);

  const scoreA1: LeadScore = {
    id: 'score_1',
    leadId: leadA1.id,
    relevanceScore: 85,
    opportunityScore: 90,
    totalScore: 88,
    rationale: 'Strong online presence with booking gap',
    scoredAt: new Date(),
  };
  leadScoresStore.set(leadA1.id, scoreA1);

  const leadA2: Lead = {
    id: 'lead_2',
    workspaceId: workspaceA,
    campaignId: campaignA.id,
    businessName: 'Crown Dental',
    domain: 'crowndental.co.uk',
    phone: '+442079462222',
    address: 'London',
    status: 'REPLIED',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  leadsStore.set(leadA2.id, leadA2);

  const scoreA2: LeadScore = {
    id: 'score_2',
    leadId: leadA2.id,
    relevanceScore: 70,
    opportunityScore: 60,
    totalScore: 65,
    rationale: 'Medium match',
    scoredAt: new Date(),
  };
  leadScoresStore.set(leadA2.id, scoreA2);

  const contactA1: Contact = {
    id: 'contact_1',
    leadId: leadA1.id,
    fullName: 'Dr. John Apex',
    email: 'john@apexdental.co.uk',
    title: 'Principal',
    phone: null,
    isPrimary: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  contactsStore.set(contactA1.id, contactA1);

  const msg1: EmailMessage = {
    id: 'msg_1',
    emailCampaignId: emailCampaignA.id,
    contactId: contactA1.id,
    subject: 'Booking audit review',
    bodyText: 'Hi Dr. John, your booking widget audit.',
    status: 'APPROVED',
    humanApprovalRequired: true,
    isApproved: true,
    approvedByUserId: 'user_a',
    approvedAt: new Date(),
    sentAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  emailMessagesStore.set(msg1.id, msg1);

  const act1: CRMActivity = {
    id: 'act_1',
    leadId: leadA1.id,
    userId: 'user_a',
    type: 'NOTE',
    description: 'Initial review completed',
    metadata: null,
    createdAt: new Date(),
  };
  crmActivitiesStore.set(act1.id, act1);

  const task1: Task = {
    id: 'task_1',
    leadId: leadA1.id,
    assignedToUserId: 'user_a',
    title: 'Follow up call on Tuesday',
    description: null,
    dueDate: null,
    status: 'PENDING',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  tasksStore.set(task1.id, task1);

  try {
    // --------------------------------------------------------------------------
    // 1. Overview Metrics & Rates
    // --------------------------------------------------------------------------
    console.log('Test 1-3: Computing overview metrics and conversion rates...');
    const overview = await testAnalyticsService.getOverview(workspaceA);
    assert.equal(overview.leads.total, 2);
    assert.equal(overview.leads.byStatus.QUALIFIED, 1);
    assert.equal(overview.leads.byStatus.REPLIED, 1);
    assert.equal(overview.leads.qualificationRate, 100);
    assert.equal(overview.campaigns.total, 1);
    assert.equal(overview.campaigns.byStatus.ACTIVE, 1);
    assert.equal(overview.outreach.approved, 1);
    assert.equal(overview.outreach.approvalRate, 100);
    assert.equal(overview.crm.totalActivities, 1);
    assert.equal(overview.tasks.pending, 1);
    console.log('✓ Overview metrics calculation passed');

    // --------------------------------------------------------------------------
    // 2. Leads Analytics & Score Distribution
    // --------------------------------------------------------------------------
    console.log('Test 4-6: Leads funnel and scoring averages breakdown...');
    const leadsAnalytics = await testAnalyticsService.getLeadsAnalytics(workspaceA);
    assert.equal(leadsAnalytics.totalLeads, 2);
    assert.equal(leadsAnalytics.scoreSummary.averageTotalScore, 76.5);
    assert.equal(leadsAnalytics.scoreSummary.distribution.high, 1);
    assert.equal(leadsAnalytics.scoreSummary.distribution.medium, 1);
    console.log('✓ Leads analytics and score summary passed');

    // --------------------------------------------------------------------------
    // 3. Campaigns Analytics Summaries
    // --------------------------------------------------------------------------
    console.log('Test 7-9: Campaigns summary and single campaign deep-dive...');
    const allCampaigns = await testAnalyticsService.getCampaignsAnalytics(workspaceA);
    assert.equal(allCampaigns.totalCampaigns, 1);
    assert.equal(allCampaigns.campaigns[0].campaignId, campaignA.id);

    const singleCamp = await testAnalyticsService.getCampaignAnalytics(campaignA.id, workspaceA);
    assert.equal(singleCamp.campaignId, campaignA.id);
    assert.equal(singleCamp.leadsTotal, 2);

    // Cross-tenant campaign check
    await assert.rejects(
      async () => {
        await testAnalyticsService.getCampaignAnalytics(campaignA.id, workspaceB);
      },
      NotFoundError,
      'Cross-tenant campaign analytics must be rejected'
    );
    console.log('✓ Campaigns analytics and tenant isolation passed');

    // --------------------------------------------------------------------------
    // 4. Outreach & Activity Analytics
    // --------------------------------------------------------------------------
    console.log('Test 10-12: Outreach stats, activity trends, and CSV export...');
    const outreachStats = await testAnalyticsService.getOutreachAnalytics(workspaceA);
    assert.equal(outreachStats.totalOutreach, 1);
    assert.equal(outreachStats.approved, 1);

    const activityStats = await testAnalyticsService.getActivityTrends(workspaceA);
    assert.equal(activityStats.totalActivities, 1);
    assert.equal(activityStats.breakdown.NOTE, 1);

    const csvExport = (await testAnalyticsService.exportReport(workspaceA, 'csv')) as string;
    assert.ok(csvExport.includes('Lead ID,Business Name'));
    assert.ok(csvExport.includes('Apex Dental'));
    console.log('✓ Outreach, activity stats, and CSV export passed');

    // --------------------------------------------------------------------------
    // 5. Fastify HTTP Endpoints (/api/v1/analytics/*)
    // --------------------------------------------------------------------------
    console.log('Test 13-18: Fastify Analytics HTTP Routes...');
    const app = await buildApp();

    // 1. GET /api/v1/analytics/overview
    const getOverviewRes = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/overview',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(getOverviewRes.statusCode, 200);

    // 2. GET /api/v1/analytics/leads
    const getLeadsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/leads',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(getLeadsRes.statusCode, 200);

    // 3. GET /api/v1/analytics/campaigns
    const getCampsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/campaigns',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(getCampsRes.statusCode, 200);

    // 4. GET /api/v1/analytics/campaigns/:id
    const getCampIdRes = await app.inject({
      method: 'GET',
      url: `/api/v1/analytics/campaigns/${campaignA.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(getCampIdRes.statusCode, 200);

    // 5. GET /api/v1/analytics/outreach
    const getOutreachRes = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/outreach',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(getOutreachRes.statusCode, 200);

    // 6. GET /api/v1/analytics/activity
    const getActRes = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/activity',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(getActRes.statusCode, 200);

    // 7. GET /api/v1/analytics/export?format=csv
    const exportCsvRes = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/export?format=csv',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(exportCsvRes.statusCode, 200);

    // Cross-tenant empty check for workspace B
    const wsBRes = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/overview',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    assert.equal(wsBRes.statusCode, 200);
    const wsBBody = JSON.parse(wsBRes.payload);
    assert.equal(wsBBody.metrics.leads.total, 0);

    await app.close();
    console.log('✓ Fastify Analytics HTTP routes and security guards passed');
    console.log('\n--- All Analytics & Reporting Tests Passed Successfully ---');
  } finally {
    databaseClient.setPrismaClient(null);
  }
}

runAnalyticsTests().catch((err) => {
  console.error('Analytics Test Suite Failed:', err);
  process.exit(1);
});
