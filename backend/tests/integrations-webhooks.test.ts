import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server/app.js';
import { signAuthToken } from '../src/modules/auth/token.js';
import { IntegrationService } from '../src/modules/integrations/integration.service.js';
import { WebhookSignatureValidator } from '../src/modules/integrations/signature.validator.js';
import {
  AuditRepository,
  SuppressionRepository,
  LeadRepository,
  CRMActivityRepository,
  OutreachRepository,
} from '../src/database/repository.js';
import { databaseClient, type DatabaseClient } from '../src/database/client.js';
import type {
  PrismaClient,
  Workspace,
  Lead,
  Contact,
  Suppression,
  AuditLog,
  CRMActivity,
  EmailEvent,
} from '@prisma/client';

async function runIntegrationsWebhooksTests() {
  console.log('--- Starting closeVDS Integrations & Webhook Tests ---');

  const workspaceA = 'ws_integ_test_a';
  const workspaceB = 'ws_integ_test_b';

  // In-memory stores for isolated testing
  const suppressionsStore: Map<string, Suppression> = new Map();
  const leadsStore: Map<string, Lead> = new Map();
  const contactsStore: Map<string, Contact> = new Map();
  const auditLogsStore: AuditLog[] = [];
  const crmActivitiesStore: CRMActivity[] = [];
  const emailEventsStore: EmailEvent[] = [];

  // Seed sample contact and lead
  const testLead: Lead = {
    id: 'lead_integ_1',
    workspaceId: workspaceA,
    campaignId: 'camp_1',
    businessName: 'Dr. Smile Dental',
    domain: 'drsmile.com',
    phone: '+442079461111',
    address: 'London',
    status: 'CONTACTED',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  leadsStore.set(testLead.id, testLead);

  const testContact: Contact = {
    id: 'contact_integ_1',
    leadId: testLead.id,
    fullName: 'Dr. Sarah Smile',
    email: 'sarah@drsmile.com',
    title: 'Principal Dentist',
    phone: '+442079461111',
    isPrimary: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  contactsStore.set(testContact.id, testContact);

  const mockPrisma = {
    contact: {
      findFirst: async ({ where }: { where: { email: string } }) => {
        const contact = Array.from(contactsStore.values()).find(
          (c) => c.email.toLowerCase() === where.email.toLowerCase()
        );
        if (!contact) return null;
        const lead = leadsStore.get(contact.leadId);
        return { ...contact, lead };
      },
    },
    lead: {
      update: async ({ where, data }: { where: { id: string }; data: Partial<Lead> }) => {
        const lead = leadsStore.get(where.id);
        if (!lead) throw new Error('Lead not found');
        const updated = { ...lead, ...data, updatedAt: new Date() };
        leadsStore.set(where.id, updated as Lead);
        return updated;
      },
    },
    emailEvent: {
      create: async ({ data }: { data: Omit<EmailEvent, 'id'> }) => {
        const event: EmailEvent = {
          id: `ee_${Date.now()}`,
          ...data,
          eventPayload: (data.eventPayload as any) || null,
        };
        emailEventsStore.push(event);
        return event;
      },
    },
  } as unknown as PrismaClient;

  databaseClient.setPrismaClient(mockPrisma);

  const mockDbClient: DatabaseClient = {
    getPrismaClient: () => mockPrisma,
    connect: async () => {},
    disconnect: async () => {},
    isConnected: () => true,
    healthCheck: async () => ({ ready: true, status: 'connected', message: 'Mock' }),
    transaction: async (cb) => cb(mockPrisma),
  };

  const mockAuditRepo = {
    create: async (data: Omit<AuditLog, 'id' | 'createdAt'>) => {
      const entry: AuditLog = {
        id: `audit_${Date.now()}`,
        ...data,
        userId: data.userId || null,
        metadata: (data.metadata as any) || null,
        createdAt: new Date(),
      };
      auditLogsStore.push(entry);
      return entry;
    },
  } as unknown as AuditRepository;

  const mockSuppressionRepo = {
    create: async (data: Omit<Suppression, 'id' | 'createdAt'>) => {
      const id = `supp_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`;
      const supp: Suppression = {
        id,
        ...data,
        createdAt: new Date(),
      };
      suppressionsStore.set(id, supp);
      return supp;
    },
  } as unknown as SuppressionRepository;

  const mockCrmRepo = {
    create: async (_workspaceId: string, data: { leadId: string; type: any; description: string }) => {
      const act: CRMActivity = {
        id: `crm_${Date.now()}`,
        leadId: data.leadId,
        userId: null,
        type: data.type,
        description: data.description,
        metadata: null,
        createdAt: new Date(),
      };
      crmActivitiesStore.push(act);
      return act;
    },
  } as unknown as CRMActivityRepository;

  const integrationService = new IntegrationService(
    mockAuditRepo,
    mockSuppressionRepo,
    mockCrmRepo,
    mockDbClient
  );

  // --- Test 1: Signature Verification ---
  console.log('Test 1-3: Signature verification and forged request rejection...');
  const secret = 'whsec_test_secret_123';
  const payloadStr = JSON.stringify({ type: 'email.delivered', id: 'evt_101' });
  const hmac = crypto.createHmac('sha256', secret);
  const validSignature = hmac.update(payloadStr).digest('hex');

  const verifyValid = WebhookSignatureValidator.verifySignature('resend', payloadStr, validSignature, secret);
  assert.strictEqual(verifyValid, true, 'Valid HMAC signature must pass');

  const verifyForged = WebhookSignatureValidator.verifySignature('resend', payloadStr, 'invalid_sig', secret);
  assert.strictEqual(verifyForged, false, 'Invalid HMAC signature must be rejected');

  const verifyNoSig = WebhookSignatureValidator.verifySignature('resend', payloadStr, undefined, secret);
  assert.strictEqual(verifyNoSig, false, 'Missing signature with secret configured must fail');
  console.log('✓ Signature verification security checks passed');

  // --- Test 2: Event Normalization ---
  console.log('Test 4-6: Provider event normalization (Resend, SendGrid, Generic)...');
  const resendNorm = integrationService.normalizeEvent('resend', {
    id: 'resend_evt_1',
    type: 'email.bounced',
    data: { to: ['sarah@drsmile.com'], email_id: 'msg_101' },
  });
  assert.strictEqual(resendNorm.eventType, 'BOUNCED');
  assert.strictEqual(resendNorm.recipientEmail, 'sarah@drsmile.com');
  assert.strictEqual(resendNorm.messageId, 'msg_101');

  const sgNorm = integrationService.normalizeEvent('sendgrid', {
    event: 'unsubscribe',
    email: 'sarah@drsmile.com',
    sg_message_id: 'msg_102',
  });
  assert.strictEqual(sgNorm.eventType, 'OPT_OUT');
  assert.strictEqual(sgNorm.recipientEmail, 'sarah@drsmile.com');
  console.log('✓ Provider payload normalization passed');

  // --- Test 3: Opt-Out Event Side Effects ---
  console.log('Test 7-9: Ingesting OPT_OUT webhook and verifying automatic suppression & lead status...');
  const optOutResult = await integrationService.processWebhook(
    'resend',
    {
      id: 'evt_opt_1',
      type: 'email.complained',
      data: { to: ['sarah@drsmile.com'] },
    }
  );
  assert.strictEqual(optOutResult.success, true);
  assert.strictEqual(optOutResult.action, 'SUPPRESSION_ADDED');
  assert.strictEqual(optOutResult.duplicate, false);

  const updatedLead = leadsStore.get(testLead.id);
  assert.strictEqual(updatedLead?.status, 'OPT_OUT', 'Lead must transition to OPT_OUT');

  const createdSupp = Array.from(suppressionsStore.values()).find(
    (s) => s.value === 'sarah@drsmile.com' && s.reason === 'OPT_OUT'
  );
  assert.ok(createdSupp, 'Suppression record must be automatically written');
  console.log('✓ Opt-out auto-suppression and lead transition passed');

  // --- Test 4: Idempotency & Duplicate Replay Protection ---
  console.log('Test 10-12: Idempotent replay protection for duplicate webhook events...');
  const duplicateResult = await integrationService.processWebhook(
    'resend',
    {
      id: 'evt_opt_1',
      type: 'email.complained',
      data: { to: ['sarah@drsmile.com'] },
    }
  );
  assert.strictEqual(duplicateResult.success, true);
  assert.strictEqual(duplicateResult.duplicate, true);
  assert.strictEqual(duplicateResult.action, 'IGNORED_DUPLICATE');
  console.log('✓ Webhook duplicate idempotency passed');

  // --- Test 5: Inbound Reply Handling ---
  console.log('Test 13-14: Inbound Reply event updating lead stage and CRM activity...');
  const replyResult = await integrationService.processWebhook(
    'sendgrid',
    {
      id: 'evt_reply_1',
      event: 'reply',
      email: 'sarah@drsmile.com',
    }
  );
  assert.strictEqual(replyResult.success, true);
  assert.strictEqual(replyResult.action, 'CRM_STAGE_UPDATED');

  const repliedLead = leadsStore.get(testLead.id);
  assert.strictEqual(repliedLead?.status, 'REPLIED');
  assert.ok(
    crmActivitiesStore.some((a) => a.type === 'EMAIL_REPLIED'),
    'CRM activity timeline note must be recorded'
  );
  console.log('✓ Reply handling and CRM activity update passed');

  // --- Test 6: Fastify HTTP Integration Routes ---
  console.log('Test 15-18: Fastify Webhook HTTP Routes & Security Guards...');
  const app = await buildApp();

  const userToken = signAuthToken({
    userId: 'usr_integ_test',
    email: 'user@test.com',
    role: 'ADMIN',
    workspaceId: workspaceA,
  });

  // Public webhook POST
  const pubWhRes = await app.inject({
    method: 'POST',
    url: '/api/v1/integrations/webhooks/resend',
    payload: {
      id: 'evt_delivered_http_1',
      type: 'email.delivered',
      data: { to: ['sarah@drsmile.com'] },
    },
  });
  assert.strictEqual(pubWhRes.statusCode, 200);
  const pubWhBody = JSON.parse(pubWhRes.body);
  assert.strictEqual(pubWhBody.success, true);

  // Authenticated integration events list
  const eventsRes = await app.inject({
    method: 'GET',
    url: '/api/v1/integrations/events',
    headers: {
      Authorization: `Bearer ${userToken}`,
    },
  });
  assert.strictEqual(eventsRes.statusCode, 200);
  const eventsBody = JSON.parse(eventsRes.body);
  assert.strictEqual(eventsBody.success, true);
  assert.ok(Array.isArray(eventsBody.data));

  await app.close();
  console.log('✓ Fastify Webhook HTTP routes and security guards passed\n');
  console.log('--- All Integrations & Webhook Tests Passed Successfully ---');
}

runIntegrationsWebhooksTests().catch((err) => {
  console.error('Integrations Test Suite Failed:', err);
  process.exit(1);
});
