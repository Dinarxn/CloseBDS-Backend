import assert from 'node:assert/strict';
import { buildApp } from '../src/server/app.js';
import { signAuthToken } from '../src/modules/auth/token.js';
import { OutreachService } from '../src/modules/outreach/outreach.service.js';
import {
  OutreachRepository,
  SuppressionRepository,
  AuditRepository,
  type OutreachWithRelations,
} from '../src/database/repository.js';
import { databaseClient, type DatabaseClient } from '../src/database/client.js';
import { NotFoundError } from '../src/core/errors/api-error.js';
import type {
  PrismaClient,
  Campaign,
  Lead,
  Contact,
  EmailCampaign,
  EmailMessage,
  Suppression,
  AuditLog,
  EmailMessageStatus,
} from '@prisma/client';

async function runSafetyApprovalTests() {
  console.log('\n--- Starting closeVDS Human Approval & Safety Checks Tests ---');

  // In-memory test stores
  const campaignsStore: Map<string, Campaign> = new Map();
  const leadsStore: Map<string, Lead> = new Map();
  const contactsStore: Map<string, Contact> = new Map();
  const emailCampaignsStore: Map<string, EmailCampaign> = new Map();
  const emailMessagesStore: Map<string, EmailMessage> = new Map();
  const suppressionsStore: Map<string, Suppression> = new Map();
  const auditLogsStore: AuditLog[] = [];
  let mockSentTodayCount = 0;

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
    },
    contact: {
      findFirst: async ({ where }: { where: { id?: string; lead?: { workspaceId?: string } } }) => {
        const contact = where.id ? contactsStore.get(where.id) : null;
        if (!contact) return null;
        const lead = leadsStore.get(contact.leadId);
        if (!lead) return null;
        if (where.lead?.workspaceId && lead.workspaceId !== where.lead.workspaceId) return null;
        return { ...contact, lead };
      },
    },
    emailCampaign: {
      findUnique: async ({ where }: { where: { campaignId: string } }) => {
        return emailCampaignsStore.get(where.campaignId) || null;
      },
    },
    emailMessage: {
      findFirst: async ({ where }: { where: { id?: string; emailCampaign?: { campaign?: { workspaceId?: string } } } }) => {
        const message = where.id ? emailMessagesStore.get(where.id) : null;
        if (!message) return null;
        const emailCampaign = Array.from(emailCampaignsStore.values()).find((ec) => ec.id === message.emailCampaignId);
        if (!emailCampaign) return null;
        const campaign = campaignsStore.get(emailCampaign.campaignId);
        if (!campaign) return null;
        if (where.emailCampaign?.campaign?.workspaceId && campaign.workspaceId !== where.emailCampaign.campaign.workspaceId) {
          return null;
        }
        const contact = contactsStore.get(message.contactId);
        if (!contact) return null;
        const lead = leadsStore.get(contact.leadId);
        if (!lead) return null;

        return {
          ...message,
          emailCampaign: { ...emailCampaign, campaign },
          contact: { ...contact, lead },
        };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<EmailMessage> }) => {
        const existing = emailMessagesStore.get(where.id);
        if (!existing) throw new Error('Not found');
        const cleanData = Object.fromEntries(Object.entries(data).filter(([_, v]) => v !== undefined));
        const updated: EmailMessage = { ...existing, ...cleanData, updatedAt: new Date() };
        emailMessagesStore.set(where.id, updated);

        const emailCampaign = Array.from(emailCampaignsStore.values()).find((ec) => ec.id === updated.emailCampaignId)!;
        const campaign = campaignsStore.get(emailCampaign.campaignId)!;
        const contact = contactsStore.get(updated.contactId)!;
        const lead = leadsStore.get(contact.leadId)!;

        return {
          ...updated,
          emailCampaign: { ...emailCampaign, campaign },
          contact: { ...contact, lead },
        };
      },
      count: async () => mockSentTodayCount,
    },
    suppression: {
      findFirst: async ({ where }: { where: { workspaceId: string; value: { in: string[] } } }) => {
        for (const s of suppressionsStore.values()) {
          if (s.workspaceId === where.workspaceId && where.value.in.includes(s.value)) {
            return s;
          }
        }
        return null;
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

  const testOutreachRepo = new OutreachRepository(mockDbClient);
  const testSuppressionRepo = new SuppressionRepository(mockDbClient);
  const testAuditRepo = new AuditRepository(mockDbClient);
  const testOutreachService = new OutreachService(
    testOutreachRepo,
    testSuppressionRepo,
    testAuditRepo
  );

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

  // Seed sample hierarchy in Workspace A
  const campaignA: Campaign = {
    id: '11111111-1111-4111-8111-111111111111',
    workspaceId: workspaceA,
    name: 'London Clinics',
    niche: 'Dental',
    location: 'London',
    targetOffer: 'Audit Offer',
    dailyCap: 10,
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
    dailyCap: 10,
    scheduleConfig: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  emailCampaignsStore.set(campaignA.id, emailCampaignA);

  const leadA: Lead = {
    id: 'lead_1',
    workspaceId: workspaceA,
    campaignId: campaignA.id,
    businessName: 'High Street Smiles',
    domain: 'highstreetsmiles.com',
    phone: '+442079462222',
    address: 'London',
    status: 'QUALIFIED',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  leadsStore.set(leadA.id, leadA);

  const contactA: Contact = {
    id: 'contact_1',
    leadId: leadA.id,
    fullName: 'Dr. Sarah Smith',
    email: 'sarah@highstreetsmiles.com',
    title: 'Owner',
    phone: null,
    isPrimary: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  contactsStore.set(contactA.id, contactA);

  const messageA: EmailMessage = {
    id: 'msg_1',
    emailCampaignId: emailCampaignA.id,
    contactId: contactA.id,
    subject: 'Observation on High Street Smiles online presence',
    bodyText: 'Hi Dr. Sarah, we analyzed your website booking flow.',
    status: 'DRAFT',
    humanApprovalRequired: true,
    isApproved: false,
    approvedByUserId: null,
    approvedAt: null,
    sentAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  emailMessagesStore.set(messageA.id, messageA);

  try {
    // --------------------------------------------------------------------------
    // 1. Safety Check: Unapproved Draft Fails Safety
    // --------------------------------------------------------------------------
    console.log('Test 1: Unapproved draft fails safety evaluation...');
    const decision1 = await testOutreachService.checkSafety(messageA.id, workspaceA, 'user_a');
    assert.equal(decision1.allowed, false, 'Unapproved draft must not be allowed');
    assert.equal(decision1.isApproved, false);
    assert.ok(decision1.reasons.some((r) => r.includes('human approval')));
    console.log('✓ Unapproved draft correctly blocked by safety check');

    // --------------------------------------------------------------------------
    // 2. Human Approval Flow
    // --------------------------------------------------------------------------
    console.log('Test 2-4: Explicit human approval, rejection, and cross-tenant block...');
    // Cross-tenant approval attempt must be blocked
    await assert.rejects(
      async () => {
        await testOutreachService.approveDraft(messageA.id, workspaceB, 'user_b');
      },
      NotFoundError,
      'Cross-tenant approval must be blocked'
    );

    // Legitimate approval in Workspace A
    const approvedItem = await testOutreachService.approveDraft(messageA.id, workspaceA, 'user_a');
    assert.equal(approvedItem.isApproved, true);
    assert.equal(approvedItem.status, 'APPROVED');
    assert.equal(approvedItem.approvedByUserId, 'user_a');
    assert.ok(approvedItem.approvedAt);

    // Safety check now passes
    const decision2 = await testOutreachService.checkSafety(messageA.id, workspaceA, 'user_a');
    assert.equal(decision2.allowed, true, 'Approved draft with valid content must be allowed');
    assert.equal(decision2.isApproved, true);
    assert.equal(decision2.isSuppressed, false);
    assert.equal(decision2.withinDailyCap, true);
    console.log('✓ Human approval flow and positive safety evaluation passed');

    // --------------------------------------------------------------------------
    // 3. Suppression Boundary
    // --------------------------------------------------------------------------
    console.log('Test 5-7: Email and Domain Suppression Safety Blocks...');
    // Suppress recipient email
    const suppressionEntry: Suppression = {
      id: 'sup_1',
      workspaceId: workspaceA,
      type: 'EMAIL',
      value: 'sarah@highstreetsmiles.com',
      reason: 'OPT_OUT',
      createdAt: new Date(),
    };
    suppressionsStore.set(suppressionEntry.id, suppressionEntry);

    const decision3 = await testOutreachService.checkSafety(messageA.id, workspaceA, 'user_a');
    assert.equal(decision3.allowed, false, 'Suppressed email must be blocked');
    assert.equal(decision3.isSuppressed, true);
    assert.ok(decision3.reasons.some((r) => r.includes('suppression')));

    // Domain suppression check
    suppressionsStore.clear();
    const domainSuppression: Suppression = {
      id: 'sup_2',
      workspaceId: workspaceA,
      type: 'DOMAIN',
      value: 'highstreetsmiles.com',
      reason: 'MANUAL_SUPPRESSION',
      createdAt: new Date(),
    };
    suppressionsStore.set(domainSuppression.id, domainSuppression);

    const decision4 = await testOutreachService.checkSafety(messageA.id, workspaceA, 'user_a');
    assert.equal(decision4.allowed, false, 'Suppressed domain must be blocked');
    assert.equal(decision4.isSuppressed, true);

    suppressionsStore.clear(); // clear for next tests
    console.log('✓ Email and domain suppression safety blocks passed');

    // --------------------------------------------------------------------------
    // 4. Daily Cap Boundary
    // --------------------------------------------------------------------------
    console.log('Test 8: Campaign Daily Cap velocity limit...');
    mockSentTodayCount = 10; // equals dailyCap of 10
    const decision5 = await testOutreachService.checkSafety(messageA.id, workspaceA, 'user_a');
    assert.equal(decision5.allowed, false, 'Daily cap limit must block execution');
    assert.equal(decision5.withinDailyCap, false);
    assert.ok(decision5.reasons.some((r) => r.includes('daily cap')));
    mockSentTodayCount = 0; // reset
    console.log('✓ Daily cap boundary check passed');

    // --------------------------------------------------------------------------
    // 5. Fastify HTTP Endpoints for Approval & Safety
    // --------------------------------------------------------------------------
    console.log('Test 9-13: Fastify Human Approval & Safety Endpoints...');
    const app = await buildApp();

    // 1. Approve via API
    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/outreach/${messageA.id}/approve`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(approveRes.statusCode, 200);
    const approveBody = JSON.parse(approveRes.payload);
    assert.equal(approveBody.success, true);
    assert.equal(approveBody.draft.isApproved, true);

    // 2. Safety Check via API
    const safetyRes = await app.inject({
      method: 'POST',
      url: `/api/v1/outreach/${messageA.id}/safety-check`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(safetyRes.statusCode, 200);
    const safetyBody = JSON.parse(safetyRes.payload);
    assert.equal(safetyBody.success, true);
    assert.equal(safetyBody.decision.allowed, true);

    // 3. Reject via API
    const rejectRes = await app.inject({
      method: 'POST',
      url: `/api/v1/outreach/${messageA.id}/reject`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(rejectRes.statusCode, 200);
    const rejectBody = JSON.parse(rejectRes.payload);
    assert.equal(rejectBody.draft.status, 'REJECTED');

    // 4. Cancel via API
    const cancelRes = await app.inject({
      method: 'POST',
      url: `/api/v1/outreach/${messageA.id}/cancel`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(cancelRes.statusCode, 200);
    const cancelBody = JSON.parse(cancelRes.payload);
    assert.equal(cancelBody.draft.status, 'FAILED');

    await app.close();
    console.log('✓ Fastify Human Approval and Safety HTTP routes passed');
    console.log('\n--- All Human Approval & Safety Tests Passed Successfully ---');
  } finally {
    databaseClient.setPrismaClient(null);
  }
}

runSafetyApprovalTests().catch((err) => {
  console.error('Safety & Approval Test Suite Failed:', err);
  process.exit(1);
});
