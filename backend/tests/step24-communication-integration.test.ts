/// <reference types="node" />
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server/app.js';
import { databaseClient } from '../src/database/client.js';
import { signAuthToken } from '../src/modules/auth/token.js';
import { providerRegistry } from '../src/integrations/core/provider.registry.js';
import { StandardEmailAdapter } from '../src/integrations/email/email.adapter.js';
import { StandardWhatsAppAdapter } from '../src/integrations/whatsapp/whatsapp.adapter.js';
import { TwilioVoiceAdapter } from '../src/integrations/calling/twilio.adapter.js';
import { suppressionRepository, auditRepository } from '../src/database/repository.js';
import { integrationService } from '../src/modules/integrations/integration.service.js';
import { outreachService } from '../src/modules/outreach/outreach.service.js';
import { voiceService } from '../src/modules/voice/voice.service.js';
import type { PrismaClient } from '@prisma/client';

async function runStep24Tests() {
  console.log('\n================================================================');
  console.log('--- Stage 5 — Step 24: Communication Providers Integration Tests ---');
  console.log('================================================================\n');

  const testResults: Array<{ name: string; status: 'PASS' | 'FAIL'; details?: string }> = [];

  const recordPass = (name: string) => {
    testResults.push({ name, status: 'PASS' });
    console.log(`✓ PASS: ${name}`);
  };

  const recordFail = (name: string, error: unknown) => {
    const msg = error instanceof Error ? error.message : String(error);
    testResults.push({ name, status: 'FAIL', details: msg });
    console.error(`✗ FAIL: ${name} — ${msg}`);
  };

  // In-memory data stores
  const workspaceAlpha = 'ws_alpha_step24';
  const workspaceBeta = 'ws_beta_step24';

  const userAlphaId = 'user_alpha_step24';
  const userBetaId = 'user_beta_step24';

  const tokenAlpha = signAuthToken({
    userId: userAlphaId,
    workspaceId: workspaceAlpha,
    email: 'admin@alpha.local',
    role: 'ADMIN',
  });

  const tokenBeta = signAuthToken({
    userId: userBetaId,
    workspaceId: workspaceBeta,
    email: 'admin@beta.local',
    role: 'ADMIN',
  });

  const leadsStore = new Map<string, any>();
  const contactsStore = new Map<string, any>();
  const campaignsStore = new Map<string, any>();
  const emailCampaignsStore = new Map<string, any>();
  const emailMessagesStore = new Map<string, any>();
  const emailEventsStore: any[] = [];
  const callsStore = new Map<string, any>();
  const callEventsStore: any[] = [];
  const callAttemptsStore = new Map<string, any>();
  const suppressionsStore: any[] = [];
  const crmActivitiesStore: any[] = [];
  const auditLogsStore: any[] = [];

  // Seed sample tenant data for Workspace Alpha
  const campaignAlpha = {
    id: 'camp_alpha_01',
    workspaceId: workspaceAlpha,
    name: 'B2B Alpha Campaign',
    niche: 'SaaS',
    location: 'US',
    targetOffer: 'Automation OS',
    dailyCap: 50,
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  campaignsStore.set(campaignAlpha.id, campaignAlpha);

  const emailCampAlpha = {
    id: 'ecamp_alpha_01',
    campaignId: campaignAlpha.id,
    fromEmail: 'growth@alpha.local',
    fromName: 'Alpha Growth',
    dailyCap: 50,
    createdAt: new Date(),
    updatedAt: new Date(),
    campaign: campaignAlpha,
  };
  emailCampaignsStore.set(emailCampAlpha.id, emailCampAlpha);

  const leadAlpha = {
    id: 'lead_alpha_01',
    workspaceId: workspaceAlpha,
    campaignId: campaignAlpha.id,
    businessName: 'Alpha Target Inc',
    domain: 'alphatarget.com',
    phone: '+15551234567',
    status: 'NEW',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  leadsStore.set(leadAlpha.id, leadAlpha);

  const contactAlpha = {
    id: 'contact_alpha_01',
    leadId: leadAlpha.id,
    fullName: 'John Target',
    email: 'john@alphatarget.com',
    phone: '+15551234567',
    isPrimary: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    lead: leadAlpha,
  };
  contactsStore.set(contactAlpha.id, contactAlpha);

  // Seed sample tenant data for Workspace Beta
  const campaignBeta = {
    id: 'camp_beta_01',
    workspaceId: workspaceBeta,
    name: 'B2B Beta Campaign',
    niche: 'Dental',
    location: 'UK',
    targetOffer: 'Dental Lead Gen',
    dailyCap: 25,
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  campaignsStore.set(campaignBeta.id, campaignBeta);

  const leadBeta = {
    id: 'lead_beta_01',
    workspaceId: workspaceBeta,
    campaignId: campaignBeta.id,
    businessName: 'Beta Target Ltd',
    domain: 'betatarget.co.uk',
    phone: '+442071234567',
    status: 'NEW',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  leadsStore.set(leadBeta.id, leadBeta);

  const contactBeta = {
    id: 'contact_beta_01',
    leadId: leadBeta.id,
    fullName: 'Alice Beta',
    email: 'alice@betatarget.co.uk',
    phone: '+442071234567',
    isPrimary: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    lead: leadBeta,
  };
  contactsStore.set(contactBeta.id, contactBeta);

  // Mock Prisma Client
  const mockPrisma = {
    campaign: {
      findFirst: async ({ where }: any) => {
        for (const c of campaignsStore.values()) {
          const matchId = !where.id || c.id === where.id;
          const matchWs = !where.workspaceId || c.workspaceId === where.workspaceId;
          if (matchId && matchWs) return c;
        }
        return null;
      },
    },
    emailCampaign: {
      findUnique: async ({ where }: any) => {
        for (const ec of emailCampaignsStore.values()) {
          if (ec.campaignId === where.campaignId) return ec;
        }
        return null;
      },
      create: async ({ data }: any) => {
        const id = `ecamp_${Date.now()}`;
        const ec = { id, ...data, campaign: campaignsStore.get(data.campaignId) };
        emailCampaignsStore.set(id, ec);
        return ec;
      },
    },
    lead: {
      findFirst: async ({ where }: any) => {
        for (const l of leadsStore.values()) {
          const matchId = !where.id || l.id === where.id;
          const matchWs = !where.workspaceId || l.workspaceId === where.workspaceId;
          if (matchId && matchWs) return l;
        }
        return null;
      },
      update: async ({ where, data }: any) => {
        const l = leadsStore.get(where.id);
        if (l) {
          Object.assign(l, data);
          return l;
        }
        throw new Error('Lead not found');
      },
    },
    contact: {
      findFirst: async ({ where }: any) => {
        for (const c of contactsStore.values()) {
          const matchId = !where.id || c.id === where.id;
          const matchEmail = !where.email || c.email?.toLowerCase() === where.email?.toLowerCase();
          const matchLead = !where.leadId || c.leadId === where.leadId;
          const lead = leadsStore.get(c.leadId);
          const matchWs = !where.lead?.workspaceId || (lead && lead.workspaceId === where.lead.workspaceId);
          if (matchId && matchEmail && matchLead && matchWs) {
            return { ...c, lead };
          }
        }
        return null;
      },
    },
    emailMessage: {
      findFirst: async ({ where }: any) => {
        for (const m of emailMessagesStore.values()) {
          const matchId = !where.id || m.id === where.id;
          const ec = emailCampaignsStore.get(m.emailCampaignId);
          const matchWs = !where.emailCampaign?.campaign?.workspaceId || (ec && ec.campaign.workspaceId === where.emailCampaign.campaign.workspaceId);
          if (matchId && matchWs) {
            const contact = contactsStore.get(m.contactId);
            const lead = contact ? leadsStore.get(contact.leadId) : null;
            return {
              ...m,
              emailCampaign: ec,
              contact: { ...contact, lead },
            };
          }
        }
        return null;
      },
      create: async ({ data }: any) => {
        const id = data.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const m = { id, ...data, createdAt: new Date(), updatedAt: new Date() };
        emailMessagesStore.set(id, m);
        const ec = emailCampaignsStore.get(m.emailCampaignId);
        const contact = contactsStore.get(m.contactId);
        const lead = contact ? leadsStore.get(contact.leadId) : null;
        return { ...m, emailCampaign: ec, contact: { ...contact, lead } };
      },
      update: async ({ where, data }: any) => {
        const m = emailMessagesStore.get(where.id);
        if (m) {
          Object.assign(m, data);
          const ec = emailCampaignsStore.get(m.emailCampaignId);
          const contact = contactsStore.get(m.contactId);
          const lead = contact ? leadsStore.get(contact.leadId) : null;
          return { ...m, emailCampaign: ec, contact: { ...contact, lead } };
        }
        throw new Error('EmailMessage not found');
      },
      count: async () => 0,
    },
    emailEvent: {
      create: async ({ data }: any) => {
        const evt = { id: `ee_${Date.now()}`, ...data, createdAt: new Date() };
        emailEventsStore.push(evt);
        return evt;
      },
    },
    call: {
      findFirst: async ({ where }: any) => {
        for (const c of callsStore.values()) {
          const matchId = !where.id || c.id === where.id;
          const matchCallId = !where.providerCallId || c.providerCallId === where.providerCallId;
          const matchWs = !where.workspaceId || c.workspaceId === where.workspaceId;
          if (matchId && matchCallId && matchWs) {
            const lead = leadsStore.get(c.leadId);
            const contact = contactsStore.get(c.contactId);
            return { ...c, lead, contact };
          }
        }
        return null;
      },
      create: async ({ data }: any) => {
        const id = data.id || `call_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const c = { id, ...data, createdAt: new Date(), updatedAt: new Date() };
        callsStore.set(id, c);
        const lead = leadsStore.get(c.leadId);
        const contact = contactsStore.get(c.contactId);
        return { ...c, lead, contact };
      },
      update: async ({ where, data }: any) => {
        const c = callsStore.get(where.id);
        if (c) {
          Object.assign(c, data);
          return c;
        }
        throw new Error('Call not found');
      },
    },
    callEvent: {
      create: async ({ data }: any) => {
        const evt = { id: `ce_${Date.now()}`, ...data, occurredAt: new Date() };
        callEventsStore.push(evt);
        return evt;
      },
    },
    callAttempt: {
      create: async ({ data }: any) => {
        const id = `att_${Date.now()}`;
        const att = { id, ...data };
        callAttemptsStore.set(id, att);
        return att;
      },
      update: async ({ where, data }: any) => {
        const att = callAttemptsStore.get(where.id);
        if (att) {
          Object.assign(att, data);
          return att;
        }
        return { id: where.id, ...data };
      },
    },
    suppression: {
      findFirst: async ({ where }: any) => {
        for (const s of suppressionsStore) {
          const matchWs = s.workspaceId === where.workspaceId;
          let matchVal = false;
          if (where.value?.in) {
            matchVal = where.value.in.map((v: string) => v.toLowerCase().trim()).includes(s.value.toLowerCase().trim());
          } else if (where.value) {
            matchVal = s.value.toLowerCase().trim() === where.value.toLowerCase().trim();
          }
          if (matchWs && matchVal) return s;
        }
        return null;
      },
      upsert: async ({ where, update, create }: any) => {
        const val = (create?.value || where?.unique_workspace_suppression?.value || '').toLowerCase().trim();
        const wsId = create?.workspaceId || where?.unique_workspace_suppression?.workspaceId;
        const existing = suppressionsStore.find(
          (s) => s.workspaceId === wsId && s.value.toLowerCase().trim() === val
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const id = `sup_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const sup = { id, ...(create || update), value: val, createdAt: new Date() };
        suppressionsStore.push(sup);
        return sup;
      },
      create: async ({ data }: any) => {
        const id = `sup_${Date.now()}`;
        const sup = { id, ...data, value: data.value.toLowerCase().trim(), createdAt: new Date() };
        suppressionsStore.push(sup);
        return sup;
      },
    },
    callOutcome: {
      upsert: async ({ where, update, create }: any) => {
        return { id: `out_${Date.now()}`, callId: where.callId, ...(create || update) };
      },
    },
    notification: {
      create: async ({ data }: any) => {
        return { id: `notif_${Date.now()}`, ...data, createdAt: new Date() };
      },
    },
    task: {
      create: async ({ data }: any) => {
        return { id: `task_${Date.now()}`, ...data, createdAt: new Date() };
      },
    },
    crmActivity: {
      create: async ({ data }: any) => {
        const id = `crm_${Date.now()}`;
        const act = { id, ...data, createdAt: new Date() };
        crmActivitiesStore.push(act);
        return act;
      },
    },
    cRMActivity: {
      create: async ({ data }: any) => {
        const id = `crm_${Date.now()}`;
        const act = { id, ...data, createdAt: new Date() };
        crmActivitiesStore.push(act);
        return act;
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        const id = `audit_${Date.now()}`;
        const log = { id, ...data, createdAt: new Date() };
        auditLogsStore.push(log);
        return log;
      },
    },
  };

  // Wire mock client into databaseClient
  (databaseClient as any).getPrismaClient = () => mockPrisma as unknown as PrismaClient;

  // Build Fastify application
  const app = await buildApp();

  try {
    // =========================================================================
    // TEST 1: Unauthenticated Outbound Attempt
    // =========================================================================
    console.log('\n--- Running Test 1: Unauthenticated Outbound Attempt ---');
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/outreach/draft_test_1/dispatch',
      });
      assert.strictEqual(res.statusCode, 401, 'Must return 401 Unauthorized for unauthenticated request');
      recordPass('1. Unauthenticated Outbound Attempt returns 401');
    } catch (err) {
      recordFail('1. Unauthenticated Outbound Attempt', err);
    }

    // =========================================================================
    // TEST 2: Cross-Workspace Outbound Attempt
    // =========================================================================
    console.log('\n--- Running Test 2: Cross-Workspace Outbound Attempt ---');
    try {
      // Create draft in Workspace Alpha
      const draftAlpha = await outreachService.createDraft(workspaceAlpha, userAlphaId, {
        campaignId: campaignAlpha.id,
        contactId: contactAlpha.id,
        channel: 'EMAIL',
        subject: 'Alpha Subject',
        bodyText: 'Alpha Body',
      });

      // Attempt to dispatch Alpha draft using Beta token
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/outreach/${draftAlpha.id}/dispatch`,
        headers: {
          authorization: `Bearer ${tokenBeta}`,
        },
      });
      assert.strictEqual(res.statusCode, 404, 'Must return 404 Not Found for cross-workspace attempt');
      recordPass('2. Cross-Workspace Outbound Attempt returns 404 (tenancy isolation)');
    } catch (err) {
      recordFail('2. Cross-Workspace Outbound Attempt', err);
    }

    // =========================================================================
    // TEST 3: Missing Human Approval
    // =========================================================================
    console.log('\n--- Running Test 3: Missing Approval Gate ---');
    try {
      const unapprovedDraft = await outreachService.createDraft(workspaceAlpha, userAlphaId, {
        campaignId: campaignAlpha.id,
        contactId: contactAlpha.id,
        channel: 'EMAIL',
        subject: 'Unapproved Subject',
        bodyText: 'Unapproved Body',
      });
      assert.strictEqual(unapprovedDraft.isApproved, false);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/outreach/${unapprovedDraft.id}/dispatch`,
        headers: {
          authorization: `Bearer ${tokenAlpha}`,
        },
      });
      assert.strictEqual(res.statusCode, 403, 'Must return 403 Forbidden when human approval is missing');
      const json = JSON.parse(res.body);
      assert.ok(json.error.message.includes('approval'), 'Error must specify human approval requirement');
      recordPass('3. Missing Human Approval returns 403 Forbidden');
    } catch (err) {
      recordFail('3. Missing Human Approval', err);
    }

    // =========================================================================
    // TEST 4: Rejected Approval Gate
    // =========================================================================
    console.log('\n--- Running Test 4: Rejected Approval Gate ---');
    try {
      const rejectedDraft = await outreachService.createDraft(workspaceAlpha, userAlphaId, {
        campaignId: campaignAlpha.id,
        contactId: contactAlpha.id,
        channel: 'EMAIL',
        subject: 'To Reject Subject',
        bodyText: 'To Reject Body',
      });
      await outreachService.rejectDraft(rejectedDraft.id, workspaceAlpha, userAlphaId);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/outreach/${rejectedDraft.id}/dispatch`,
        headers: {
          authorization: `Bearer ${tokenAlpha}`,
        },
      });
      assert.strictEqual(res.statusCode, 403, 'Must return 403 Forbidden for rejected outreach');
      recordPass('4. Rejected Approval returns 403 Forbidden');
    } catch (err) {
      recordFail('4. Rejected Approval', err);
    }

    // =========================================================================
    // TEST 5: DNC / Suppressed Phone
    // =========================================================================
    console.log('\n--- Running Test 5: DNC / Suppressed Phone ---');
    try {
      const suppressedPhone = '+15559998888';
      suppressionsStore.push({
        id: 'sup_phone_1',
        workspaceId: workspaceAlpha,
        type: 'PHONE',
        value: suppressedPhone,
        reason: 'OPT_OUT',
      });

      // Test WhatsApp dispatch with suppressed phone
      let waBlocked = false;
      try {
        await outreachService.dispatchWhatsAppMessage(workspaceAlpha, userAlphaId, {
          leadId: leadAlpha.id,
          contactId: contactAlpha.id,
          messageText: 'Hello',
          isApproved: true,
        });
      } catch (err: any) {
        // Since contactAlpha.phone is +15551234567, suppress that one:
      }

      // Add contactAlpha's phone to suppression
      suppressionsStore.push({
        id: 'sup_phone_alpha',
        workspaceId: workspaceAlpha,
        type: 'PHONE',
        value: contactAlpha.phone,
        reason: 'OPT_OUT',
      });

      try {
        await outreachService.dispatchWhatsAppMessage(workspaceAlpha, userAlphaId, {
          leadId: leadAlpha.id,
          contactId: contactAlpha.id,
          messageText: 'Hello',
          isApproved: true,
        });
      } catch (err: any) {
        waBlocked = true;
        assert.ok(err.message.includes('suppressed'), 'Must indicate phone is suppressed');
      }
      assert.strictEqual(waBlocked, true, 'Outbound to suppressed phone must be blocked');
      recordPass('5. DNC / Suppressed Phone Gate blocks dispatch');
    } catch (err) {
      recordFail('5. DNC / Suppressed Phone', err);
    }

    // =========================================================================
    // TEST 6: Suppressed Email
    // =========================================================================
    console.log('\n--- Running Test 6: Suppressed Email Gate ---');
    try {
      // Add contact email to suppression
      suppressionsStore.push({
        id: 'sup_email_01',
        workspaceId: workspaceAlpha,
        type: 'EMAIL',
        value: contactAlpha.email.toLowerCase().trim(),
        reason: 'OPT_OUT',
      });

      const approvedDraft = await outreachService.createDraft(workspaceAlpha, userAlphaId, {
        campaignId: campaignAlpha.id,
        contactId: contactAlpha.id,
        channel: 'EMAIL',
        subject: 'Approved Subject',
        bodyText: 'Approved Body',
      });
      await outreachService.approveDraft(approvedDraft.id, workspaceAlpha, userAlphaId);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/outreach/${approvedDraft.id}/dispatch`,
        headers: {
          authorization: `Bearer ${tokenAlpha}`,
        },
      });
      assert.strictEqual(res.statusCode, 403, 'Must return 403 when email is suppressed');
      recordPass('6. Suppressed Email Gate blocks dispatch');
    } catch (err) {
      recordFail('6. Suppressed Email', err);
    }

    // =========================================================================
    // TEST 7: Suppressed Domain
    // =========================================================================
    console.log('\n--- Running Test 7: Suppressed Domain Gate ---');
    try {
      // Create a new contact with non-suppressed email but suppressed domain
      const unsuppressedEmail = 'exec@alphatarget.com';
      suppressionsStore.push({
        id: 'sup_dom_01',
        workspaceId: workspaceAlpha,
        type: 'DOMAIN',
        value: 'alphatarget.com',
        reason: 'MANUAL_SUPPRESSION',
      });

      const isDomSuppressed = await suppressionRepository.isSuppressed(
        workspaceAlpha,
        unsuppressedEmail,
        'alphatarget.com'
      );
      assert.strictEqual(isDomSuppressed, true, 'Domain suppression must be identified');
      recordPass('7. Suppressed Domain Gate blocks dispatch');
    } catch (err) {
      recordFail('7. Suppressed Domain', err);
    }

    // =========================================================================
    // TEST 8: OPT_OUT Lead Gate
    // =========================================================================
    console.log('\n--- Running Test 8: OPT_OUT Lead Gate ---');
    try {
      // Create a lead in OPT_OUT status
      const optOutLead = {
        id: 'lead_opt_out_01',
        workspaceId: workspaceAlpha,
        campaignId: campaignAlpha.id,
        businessName: 'Opted Out Corp',
        domain: 'optedout.com',
        phone: '+15559876543',
        status: 'OPT_OUT',
      };
      leadsStore.set(optOutLead.id, optOutLead);

      const optOutContact = {
        id: 'contact_opt_out_01',
        leadId: optOutLead.id,
        fullName: 'Bob OptOut',
        email: 'bob@optedout.com',
        phone: '+15559876543',
        lead: optOutLead,
      };
      contactsStore.set(optOutContact.id, optOutContact);

      const optDraft = await outreachService.createDraft(workspaceAlpha, userAlphaId, {
        campaignId: campaignAlpha.id,
        contactId: optOutContact.id,
        channel: 'EMAIL',
        subject: 'Opt Test',
        bodyText: 'Opt Body',
      });
      await outreachService.approveDraft(optDraft.id, workspaceAlpha, userAlphaId);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/outreach/${optDraft.id}/dispatch`,
        headers: {
          authorization: `Bearer ${tokenAlpha}`,
        },
      });
      assert.strictEqual(res.statusCode, 403, 'Must return 403 when lead is in OPT_OUT status');
      recordPass('8. OPT_OUT Lead Gate blocks dispatch');
    } catch (err) {
      recordFail('8. OPT_OUT Lead', err);
    }

    // =========================================================================
    // TEST 9: Kill Switch Active Gate
    // =========================================================================
    console.log('\n--- Running Test 9: Kill Switch Active Gate ---');
    try {
      process.env.KILL_SWITCH_ACTIVE = 'true';

      // Create a clean lead, contact, approved draft
      const cleanLead = {
        id: 'lead_clean_01',
        workspaceId: workspaceAlpha,
        campaignId: campaignAlpha.id,
        businessName: 'Clean Co',
        domain: 'cleanco.com',
        phone: '+15551112222',
        status: 'NEW',
      };
      leadsStore.set(cleanLead.id, cleanLead);

      const cleanContact = {
        id: 'contact_clean_01',
        leadId: cleanLead.id,
        fullName: 'Charlie Clean',
        email: 'charlie@cleanco.com',
        phone: '+15551112222',
        lead: cleanLead,
      };
      contactsStore.set(cleanContact.id, cleanContact);

      const cleanDraft = await outreachService.createDraft(workspaceAlpha, userAlphaId, {
        campaignId: campaignAlpha.id,
        contactId: cleanContact.id,
        channel: 'EMAIL',
        subject: 'Clean Subject',
        bodyText: 'Clean Body',
      });
      await outreachService.approveDraft(cleanDraft.id, workspaceAlpha, userAlphaId);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/outreach/${cleanDraft.id}/dispatch`,
        headers: {
          authorization: `Bearer ${tokenAlpha}`,
        },
      });
      assert.strictEqual(res.statusCode, 503, 'Must return 503 Service Unavailable when Kill Switch is active');
      const json = JSON.parse(res.body);
      assert.strictEqual(json.error.code, 'KILL_SWITCH_ACTIVE');
      recordPass('9. Kill Switch Active returns 503 KILL_SWITCH_ACTIVE');
    } catch (err) {
      recordFail('9. Kill Switch Active', err);
    } finally {
      process.env.KILL_SWITCH_ACTIVE = 'false';
    }

    // =========================================================================
    // TEST 10: Duplicate / Idempotency Prevention
    // =========================================================================
    console.log('\n--- Running Test 10: Duplicate / Idempotency Prevention ---');
    try {
      // Register test mock adapter that simulates successful dispatch
      const mockEmailAdapter = new StandardEmailAdapter({
        apiKey: 'test-api-key-mock',
        dispatchEnabled: true,
      });
      providerRegistry.register(mockEmailAdapter);

      const freshLead = {
        id: 'lead_fresh_10',
        workspaceId: workspaceAlpha,
        campaignId: campaignAlpha.id,
        businessName: 'Fresh Co',
        domain: 'freshco.com',
        phone: '+15553334444',
        status: 'NEW',
      };
      leadsStore.set(freshLead.id, freshLead);

      const freshContact = {
        id: 'contact_fresh_10',
        leadId: freshLead.id,
        fullName: 'Frank Fresh',
        email: 'frank@freshco.com',
        phone: '+15553334444',
        lead: freshLead,
      };
      contactsStore.set(freshContact.id, freshContact);

      const freshDraft = await outreachService.createDraft(workspaceAlpha, userAlphaId, {
        campaignId: campaignAlpha.id,
        contactId: freshContact.id,
        channel: 'EMAIL',
        subject: 'Idempotency Test',
        bodyText: 'Idempotency Body',
      });
      await outreachService.approveDraft(freshDraft.id, workspaceAlpha, userAlphaId);

      // First dispatch
      const res1 = await app.inject({
        method: 'POST',
        url: `/api/v1/outreach/${freshDraft.id}/dispatch`,
        headers: { authorization: `Bearer ${tokenAlpha}` },
      });
      assert.strictEqual(res1.statusCode, 200);
      const json1 = JSON.parse(res1.body);
      assert.strictEqual(json1.draft.status, 'SENT');

      // Second duplicate dispatch (idempotent replay)
      const res2 = await app.inject({
        method: 'POST',
        url: `/api/v1/outreach/${freshDraft.id}/dispatch`,
        headers: { authorization: `Bearer ${tokenAlpha}` },
      });
      assert.strictEqual(res2.statusCode, 200);
      const json2 = JSON.parse(res2.body);
      assert.strictEqual(json2.draft.status, 'SENT');
      assert.strictEqual(json1.draft.id, json2.draft.id);
      recordPass('10. Duplicate / Idempotency Prevention returns existing sent item safely');
    } catch (err) {
      recordFail('10. Duplicate / Idempotency Prevention', err);
    }

    // =========================================================================
    // TEST 11: Missing Provider Credentials
    // =========================================================================
    console.log('\n--- Running Test 11: Missing Provider Credentials ---');
    try {
      const unconfiguredAdapter = new StandardEmailAdapter({
        apiKey: '',
        dispatchEnabled: true,
      });
      providerRegistry.register(unconfiguredAdapter);

      const credLead = {
        id: 'lead_cred_11',
        workspaceId: workspaceAlpha,
        campaignId: campaignAlpha.id,
        businessName: 'Cred Co',
        domain: 'credco.com',
        phone: '+15555556666',
        status: 'NEW',
      };
      leadsStore.set(credLead.id, credLead);

      const credContact = {
        id: 'contact_cred_11',
        leadId: credLead.id,
        fullName: 'Claire Cred',
        email: 'claire@credco.com',
        phone: '+15555556666',
        lead: credLead,
      };
      contactsStore.set(credContact.id, credContact);

      const credDraft = await outreachService.createDraft(workspaceAlpha, userAlphaId, {
        campaignId: campaignAlpha.id,
        contactId: credContact.id,
        channel: 'EMAIL',
        subject: 'Cred Test',
        bodyText: 'Cred Body',
      });
      await outreachService.approveDraft(credDraft.id, workspaceAlpha, userAlphaId);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/outreach/${credDraft.id}/dispatch`,
        headers: { authorization: `Bearer ${tokenAlpha}` },
      });
      assert.strictEqual(res.statusCode, 400, 'Must return 400 Bad Request when provider credentials are missing');
      recordPass('11. Missing Provider Credentials returns 400 Bad Request');
    } catch (err) {
      recordFail('11. Missing Provider Credentials', err);
    }

    // =========================================================================
    // TEST 12: Provider API Failure Resilience
    // =========================================================================
    console.log('\n--- Running Test 12: Provider API Failure Resilience ---');
    try {
      // Mock adapter that simulates network failure
      const failingAdapter = new StandardEmailAdapter({
        apiKey: 'test-api-key-mock',
        dispatchEnabled: true,
      });
      failingAdapter.sendEmail = async () => {
        throw new Error('500 Internal Server Error: Resend API unreachable');
      };
      providerRegistry.register(failingAdapter);

      const failLead = {
        id: 'lead_fail_12',
        workspaceId: workspaceAlpha,
        campaignId: campaignAlpha.id,
        businessName: 'Fail Co',
        domain: 'failco.com',
        phone: '+15557778888',
        status: 'NEW',
      };
      leadsStore.set(failLead.id, failLead);

      const failContact = {
        id: 'contact_fail_12',
        leadId: failLead.id,
        fullName: 'Fiona Fail',
        email: 'fiona@failco.com',
        phone: '+15557778888',
        lead: failLead,
      };
      contactsStore.set(failContact.id, failContact);

      const failDraft = await outreachService.createDraft(workspaceAlpha, userAlphaId, {
        campaignId: campaignAlpha.id,
        contactId: failContact.id,
        channel: 'EMAIL',
        subject: 'Fail Test',
        bodyText: 'Fail Body',
      });
      await outreachService.approveDraft(failDraft.id, workspaceAlpha, userAlphaId);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/outreach/${failDraft.id}/dispatch`,
        headers: { authorization: `Bearer ${tokenAlpha}` },
      });
      assert.strictEqual(res.statusCode, 500, 'Must return 500 when external provider fails');
      // Verify message was marked FAILED
      const stored = emailMessagesStore.get(failDraft.id);
      assert.strictEqual(stored.status, 'FAILED', 'Draft status must transition to FAILED on provider error');
      recordPass('12. Provider API Failure marks draft FAILED and returns 500');
    } catch (err) {
      recordFail('12. Provider API Failure', err);
    }

    // =========================================================================
    // TEST 13: Invalid Webhook Signature Rejection
    // =========================================================================
    console.log('\n--- Running Test 13: Invalid Webhook Signature Rejection ---');
    try {
      process.env.RESEND_WEBHOOK_SECRET = 'whsec_test_secret_resend_123';

      const payload = {
        type: 'email.delivered',
        data: { email_id: 'msg_test_13', to: ['test@domain.com'] },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/integrations/webhooks/resend',
        headers: {
          'svix-signature': 'v1,forged_invalid_signature_hex_12345',
        },
        payload,
      });
      assert.strictEqual(res.statusCode, 401, 'Must reject invalid signature with 401 Unauthorized');
      recordPass('13. Invalid Webhook Signature rejected with 401');
    } catch (err) {
      recordFail('13. Invalid Webhook Signature', err);
    } finally {
      delete process.env.RESEND_WEBHOOK_SECRET;
    }

    // =========================================================================
    // TEST 14: Duplicate Webhook Replay Protection
    // =========================================================================
    console.log('\n--- Running Test 14: Duplicate Webhook Replay Protection ---');
    try {
      const webhookPayload = {
        id: 'evt_replay_test_14',
        type: 'email.opened',
        data: { email_id: 'msg_opened_14', to: [contactAlpha.email] },
      };

      // Ingest event 1
      const res1 = await integrationService.processWebhook('resend', webhookPayload);
      assert.strictEqual(res1.duplicate, false, 'First event must not be duplicate');

      // Ingest event 2 (same ID)
      const res2 = await integrationService.processWebhook('resend', webhookPayload);
      assert.strictEqual(res2.duplicate, true, 'Second event must be flagged as duplicate');
      assert.strictEqual(res2.action, 'IGNORED_DUPLICATE');
      recordPass('14. Duplicate Webhook Replay Protection passed');
    } catch (err) {
      recordFail('14. Duplicate Webhook Replay Protection', err);
    }

    // =========================================================================
    // TEST 15: Unknown Webhook Event Handling
    // =========================================================================
    console.log('\n--- Running Test 15: Unknown Webhook Event Handling ---');
    try {
      const unknownPayload = {
        id: 'evt_unknown_15',
        type: 'custom.provider.unknown_action_event',
        data: { email_id: 'msg_unknown', to: [contactAlpha.email] },
      };

      const result = await integrationService.processWebhook('generic', unknownPayload);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.action, 'EVENT_RECORDED');
      recordPass('15. Unknown Webhook Event handled gracefully');
    } catch (err) {
      recordFail('15. Unknown Webhook Event', err);
    }

    // =========================================================================
    // TEST 16: Successful Provider Response (Controlled Mock Boundary)
    // =========================================================================
    console.log('\n--- Running Test 16: Successful Provider Response ---');
    try {
      const workingEmailAdapter = new StandardEmailAdapter({
        apiKey: 'test-api-key-mock',
        dispatchEnabled: true,
      });
      providerRegistry.register(workingEmailAdapter);

      const okLead = {
        id: 'lead_ok_16',
        workspaceId: workspaceAlpha,
        campaignId: campaignAlpha.id,
        businessName: 'Success Co',
        domain: 'successco.com',
        phone: '+15559990000',
        status: 'NEW',
      };
      leadsStore.set(okLead.id, okLead);

      const okContact = {
        id: 'contact_ok_16',
        leadId: okLead.id,
        fullName: 'Oliver OK',
        email: 'oliver@successco.com',
        phone: '+15559990000',
        lead: okLead,
      };
      contactsStore.set(okContact.id, okContact);

      const okDraft = await outreachService.createDraft(workspaceAlpha, userAlphaId, {
        campaignId: campaignAlpha.id,
        contactId: okContact.id,
        channel: 'EMAIL',
        subject: 'Success Subject',
        bodyText: 'Success Body',
      });
      await outreachService.approveDraft(okDraft.id, workspaceAlpha, userAlphaId);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/outreach/${okDraft.id}/dispatch`,
        headers: { authorization: `Bearer ${tokenAlpha}` },
      });
      assert.strictEqual(res.statusCode, 200);
      const json = JSON.parse(res.body);
      assert.strictEqual(json.draft.status, 'SENT');
      assert.ok(json.draft.sentAt !== null, 'sentAt must be recorded');
      recordPass('16. Successful Provider Response verified');
    } catch (err) {
      recordFail('16. Successful Provider Response', err);
    }

    // =========================================================================
    // TEST 17: Provider Status Update via Webhook Callback
    // =========================================================================
    console.log('\n--- Running Test 17: Provider Status Update via Webhook Callback ---');
    try {
      // Create a Twilio call in initiating state
      const twilioCall = {
        id: 'call_twilio_17',
        workspaceId: workspaceAlpha,
        leadId: leadAlpha.id,
        contactId: contactAlpha.id,
        recipientPhone: contactAlpha.phone,
        normalizedPhone: contactAlpha.phone,
        providerCallId: 'CA_test_sid_17',
        status: 'IN_PROGRESS',
        humanApprovalRequired: true,
        isApproved: true,
        attempts: [],
        transcripts: [],
      };
      callsStore.set(twilioCall.id, twilioCall);

      // Deliver Twilio status callback payload
      const webhookPayload = {
        CallSid: 'CA_test_sid_17',
        CallStatus: 'completed',
        CallDuration: '45',
      };

      const result = await voiceService.handleProviderWebhook(
        'twilio',
        webhookPayload
      );
      assert.strictEqual(result.processed, true);

      // Verify call status updated to COMPLETED
      const updatedCall = callsStore.get(twilioCall.id);
      assert.strictEqual(updatedCall.status, 'COMPLETED');
      assert.strictEqual(updatedCall.durationSeconds, 45);
      recordPass('17. Provider Status Update via Webhook Callback verified');
    } catch (err) {
      recordFail('17. Provider Status Update via Webhook Callback', err);
    }

    // =========================================================================
    // TEST 18: Audit Failure Resilience
    // =========================================================================
    console.log('\n--- Running Test 18: Audit Failure Resilience ---');
    try {
      // Temporarily mock auditRepository.create to throw
      const originalCreate = auditRepository.create;
      auditRepository.create = async () => {
        throw new Error('Audit database temporary connection lost');
      };

      const auditLead = {
        id: 'lead_audit_18',
        workspaceId: workspaceAlpha,
        campaignId: campaignAlpha.id,
        businessName: 'Audit Co',
        domain: 'auditco.com',
        phone: '+15558889999',
        status: 'NEW',
      };
      leadsStore.set(auditLead.id, auditLead);

      const auditContact = {
        id: 'contact_audit_18',
        leadId: auditLead.id,
        fullName: 'Audrey Audit',
        email: 'audrey@auditco.com',
        phone: '+15558889999',
        lead: auditLead,
      };
      contactsStore.set(auditContact.id, auditContact);

      const workingEmailAdapter = new StandardEmailAdapter({
        apiKey: 'test-api-key-mock',
        dispatchEnabled: true,
      });
      providerRegistry.register(workingEmailAdapter);

      const auditDraft = await outreachService.createDraft(workspaceAlpha, userAlphaId, {
        campaignId: campaignAlpha.id,
        contactId: auditContact.id,
        channel: 'EMAIL',
        subject: 'Audit Resilience',
        bodyText: 'Audit Resilience Body',
      });
      await outreachService.approveDraft(auditDraft.id, workspaceAlpha, userAlphaId);

      // Dispatch must still succeed despite audit logger throwing non-blockingly
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/outreach/${auditDraft.id}/dispatch`,
        headers: { authorization: `Bearer ${tokenAlpha}` },
      });
      assert.strictEqual(res.statusCode, 200, 'Must succeed even when audit logging fails');

      // Restore original auditRepository.create
      auditRepository.create = originalCreate;
      recordPass('18. Audit Failure Resilience verified (non-blocking)');
    } catch (err) {
      recordFail('18. Audit Failure Resilience', err);
    }

    // =========================================================================
    // BONUS: WhatsApp Webhook Handshake (GET Challenge Verification)
    // =========================================================================
    console.log('\n--- Running Bonus Test: Meta WhatsApp Webhook Handshake ---');
    try {
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'meta_verify_token_secret_123';

      // Successful verification
      const resOk = await app.inject({
        method: 'GET',
        url: '/api/v1/integrations/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=meta_verify_token_secret_123&hub.challenge=challenge_token_abc_789',
      });
      assert.strictEqual(resOk.statusCode, 200);
      assert.strictEqual(resOk.body, 'challenge_token_abc_789');

      // Failed verification (mismatched token)
      const resFail = await app.inject({
        method: 'GET',
        url: '/api/v1/integrations/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong_token&hub.challenge=challenge_token_abc_789',
      });
      assert.strictEqual(resFail.statusCode, 403);
      recordPass('Bonus: Meta WhatsApp GET Webhook Handshake verified');
    } catch (err) {
      recordFail('Bonus: Meta WhatsApp GET Webhook Handshake', err);
    } finally {
      delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    }

    // =========================================================================
    // BONUS: WhatsApp Inbound STOP Opt-Out Suppression
    // =========================================================================
    console.log('\n--- Running Bonus Test: WhatsApp Inbound STOP Opt-Out Suppression ---');
    try {
      const stopPayload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: '15551234567',
                      id: 'wamid.inbound_stop_123',
                      text: { body: 'STOP' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const optResult = await integrationService.processWebhook('whatsapp', stopPayload);
      assert.strictEqual(optResult.success, true);
      assert.strictEqual(optResult.action, 'SUPPRESSION_ADDED');

      // Verify phone suppression was created
      const isSuppressed = await suppressionRepository.isPhoneSuppressed(workspaceAlpha, '+15551234567');
      assert.strictEqual(isSuppressed, true, 'Phone number must be added to suppression table upon receiving STOP');

      recordPass('Bonus: WhatsApp Inbound STOP Opt-Out Suppression verified');
    } catch (err) {
      recordFail('Bonus: WhatsApp Inbound STOP Opt-Out Suppression', err);
    }

  } finally {
    await app.close();
  }

  console.log('\n================================================================');
  console.log(`--- Step 24 Integration Test Summary: ${testResults.filter((r) => r.status === 'PASS').length}/${testResults.length} Passed ---`);
  console.log('================================================================\n');

  const failedTests = testResults.filter((r) => r.status === 'FAIL');
  if (failedTests.length > 0) {
    console.error(`Step 24 Tests Encountered ${failedTests.length} Failures:`);
    for (const f of failedTests) {
      console.error(` - ${f.name}: ${f.details}`);
    }
    process.exit(1);
  }
}

runStep24Tests().catch((err) => {
  console.error('Fatal Step 24 Test Runner Exception:', err);
  process.exit(1);
});
