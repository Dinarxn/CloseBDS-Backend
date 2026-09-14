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
  AuditLog,
  EmailMessageStatus,
} from '@prisma/client';

async function runOutreachTests() {
  console.log('\n--- Starting closeVDS Outreach Workflow Tests ---');

  // In-memory test stores
  const campaignsStore: Map<string, Campaign> = new Map();
  const leadsStore: Map<string, Lead> = new Map();
  const contactsStore: Map<string, Contact> = new Map();
  const emailCampaignsStore: Map<string, EmailCampaign> = new Map();
  const emailMessagesStore: Map<string, EmailMessage> = new Map();
  const auditLogsStore: AuditLog[] = [];

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
      create: async ({ data }: { data: { campaignId: string; fromEmail: string; fromName: string; dailyCap: number } }) => {
        const entry: EmailCampaign = {
          id: `ecamp_${Date.now()}`,
          campaignId: data.campaignId,
          fromEmail: data.fromEmail,
          fromName: data.fromName,
          dailyCap: data.dailyCap,
          scheduleConfig: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        emailCampaignsStore.set(data.campaignId, entry);
        return entry;
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
      findMany: async ({ where, skip, take }: { where: { emailCampaign?: { campaign?: { workspaceId?: string; id?: string } }; status?: EmailMessageStatus }; skip?: number; take?: number }) => {
        const results: OutreachWithRelations[] = [];
        for (const msg of emailMessagesStore.values()) {
          const emailCampaign = Array.from(emailCampaignsStore.values()).find((ec) => ec.id === msg.emailCampaignId);
          if (!emailCampaign) continue;
          const campaign = campaignsStore.get(emailCampaign.campaignId);
          if (!campaign) continue;
          if (where.emailCampaign?.campaign?.workspaceId && campaign.workspaceId !== where.emailCampaign.campaign.workspaceId) {
            continue;
          }
          if (where.emailCampaign?.campaign?.id && campaign.id !== where.emailCampaign.campaign.id) {
            continue;
          }
          if (where.status && msg.status !== where.status) {
            continue;
          }
          const contact = contactsStore.get(msg.contactId);
          if (!contact) continue;
          const lead = leadsStore.get(contact.leadId);
          if (!lead) continue;

          results.push({
            ...msg,
            emailCampaign: { ...emailCampaign, campaign },
            contact: { ...contact, lead },
          });
        }
        if (skip !== undefined && take !== undefined) {
          return results.slice(skip, skip + take);
        }
        return results;
      },
      count: async ({ where }: { where: { emailCampaign?: { campaign?: { workspaceId?: string; id?: string } }; status?: EmailMessageStatus } }) => {
        let count = 0;
        for (const msg of emailMessagesStore.values()) {
          const emailCampaign = Array.from(emailCampaignsStore.values()).find((ec) => ec.id === msg.emailCampaignId);
          if (!emailCampaign) continue;
          const campaign = campaignsStore.get(emailCampaign.campaignId);
          if (!campaign) continue;
          if (where.emailCampaign?.campaign?.workspaceId && campaign.workspaceId !== where.emailCampaign.campaign.workspaceId) {
            continue;
          }
          if (where.status && msg.status !== where.status) {
            continue;
          }
          count++;
        }
        return count;
      },
      create: async ({ data }: { data: { emailCampaignId: string; contactId: string; subject: string; bodyText: string; status: EmailMessageStatus; humanApprovalRequired: boolean; isApproved: boolean } }) => {
        const id = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const message: EmailMessage = {
          id,
          emailCampaignId: data.emailCampaignId,
          contactId: data.contactId,
          subject: data.subject,
          bodyText: data.bodyText,
          status: data.status,
          humanApprovalRequired: data.humanApprovalRequired,
          isApproved: data.isApproved,
          approvedByUserId: null,
          approvedAt: null,
          sentAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        emailMessagesStore.set(id, message);

        const emailCampaign = Array.from(emailCampaignsStore.values()).find((ec) => ec.id === message.emailCampaignId)!;
        const campaign = campaignsStore.get(emailCampaign.campaignId)!;
        const contact = contactsStore.get(message.contactId)!;
        const lead = leadsStore.get(contact.leadId)!;

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
    },
    suppression: {
      findFirst: async () => null,
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

  // Seed Campaign, Lead, Contact in Workspace A
  const campaignA: Campaign = {
    id: '11111111-1111-4111-8111-111111111111',
    workspaceId: workspaceA,
    name: 'Harley Street Dental Growth',
    niche: 'Dental',
    location: 'London',
    targetOffer: 'Technical Booking Audit',
    dailyCap: 50,
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  campaignsStore.set(campaignA.id, campaignA);

  const leadA: Lead = {
    id: 'lead_alpha_1',
    workspaceId: workspaceA,
    campaignId: campaignA.id,
    businessName: 'Apex Dental Care',
    domain: 'apexdental.com',
    phone: '+442079460000',
    address: 'London',
    status: 'QUALIFIED',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  leadsStore.set(leadA.id, leadA);

  const contactA: Contact = {
    id: 'contact_alpha_1',
    leadId: leadA.id,
    fullName: 'Dr. John Smith',
    email: 'john@apexdental.com',
    title: 'Principal',
    phone: '+442079460000',
    isPrimary: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  contactsStore.set(contactA.id, contactA);

  try {
    // --------------------------------------------------------------------------
    // 1. Outreach Draft Creation & Locking
    // --------------------------------------------------------------------------
    console.log('Test 1-3: Outreach draft creation in DRAFT status with human approval required...');
    const draft = await testOutreachService.createDraft(workspaceA, 'user_a', {
      campaignId: campaignA.id,
      contactId: contactA.id,
      subject: 'Quick question regarding your online booking widget',
      bodyText: 'Hi Dr. Smith, we noticed your booking CTA has visibility issues on mobile.',
    });

    assert.ok(draft.id);
    assert.equal(draft.status, 'DRAFT');
    assert.equal(draft.humanApprovalRequired, true);
    assert.equal(draft.isApproved, false);
    assert.equal(draft.recipientEmail, 'john@apexdental.com');
    console.log('✓ Outreach draft created with mandatory approval locks');

    // --------------------------------------------------------------------------
    // 2. Multi-Tenant Workspace Isolation
    // --------------------------------------------------------------------------
    console.log('Test 4-6: Multi-tenant draft retrieval, update, and cross-workspace access rejection...');
    // User from Workspace B cannot access draft from Workspace A
    await assert.rejects(
      async () => {
        await testOutreachService.getDraft(draft.id, workspaceB);
      },
      NotFoundError,
      'Cross-tenant outreach read must be blocked'
    );

    // User from Workspace B cannot update draft from Workspace A
    await assert.rejects(
      async () => {
        await testOutreachService.updateDraft(draft.id, workspaceB, 'user_b', {
          subject: 'Unauthorized update',
        });
      },
      NotFoundError,
      'Cross-tenant outreach update must be blocked'
    );
    console.log('✓ Cross-tenant outreach isolation passed');

    // --------------------------------------------------------------------------
    // 3. Draft Lifecycle & Editing Invalidation
    // --------------------------------------------------------------------------
    console.log('Test 7-9: Approved draft editing invalidates approval...');
    // Approve draft first
    const approved = await testOutreachService.approveDraft(draft.id, workspaceA, 'user_a');
    assert.equal(approved.status, 'APPROVED');
    assert.equal(approved.isApproved, true);
    assert.equal(approved.approvedByUserId, 'user_a');

    // Edit content -> Must invalidate approval and reset to DRAFT
    const edited = await testOutreachService.updateDraft(draft.id, workspaceA, 'user_a', {
      bodyText: 'Modified message body with updated proposal terms.',
    });
    assert.equal(edited.status, 'DRAFT', 'Editing must reset status to DRAFT');
    assert.equal(edited.isApproved, false, 'Editing must reset isApproved to false');
    assert.equal(edited.approvedByUserId, null, 'Editing must clear approvedByUserId');
    console.log('✓ Content edits safely invalidate human approval');

    // --------------------------------------------------------------------------
    // 4. Fastify HTTP Endpoints (/api/v1/outreach/*)
    // --------------------------------------------------------------------------
    console.log('Test 10-14: Fastify Outreach HTTP Routes...');
    const app = await buildApp();

    // Unauthenticated request -> 401
    const unauthRes = await app.inject({
      method: 'GET',
      url: '/api/v1/outreach',
    });
    assert.equal(unauthRes.statusCode, 401);

    // Authenticated list drafts
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/outreach',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(listRes.statusCode, 200);
    const listBody = JSON.parse(listRes.payload);
    assert.equal(listBody.success, true);
    assert.ok(listBody.data.length >= 1);

    // Authenticated get draft by ID
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/outreach/${draft.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(getRes.statusCode, 200);
    const getBody = JSON.parse(getRes.payload);
    assert.equal(getBody.draft.recipientEmail, 'john@apexdental.com');

    // Cross-tenant HTTP attempt -> 404
    const crossRes = await app.inject({
      method: 'GET',
      url: `/api/v1/outreach/${draft.id}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    assert.equal(crossRes.statusCode, 404);

    await app.close();
    console.log('✓ Fastify Outreach HTTP routes and tenant guards passed');
    console.log('\n--- All Outreach Workflow Tests Passed Successfully ---');
  } finally {
    databaseClient.setPrismaClient(null);
  }
}

runOutreachTests().catch((err) => {
  console.error('Outreach Test Suite Failed:', err);
  process.exit(1);
});
