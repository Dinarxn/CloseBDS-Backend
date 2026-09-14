import assert from 'node:assert/strict';
import { buildApp } from '../src/server/app.js';
import { signAuthToken } from '../src/modules/auth/token.js';
import { LeadService } from '../src/modules/leads/lead.service.js';
import { LeadRepository, AuditRepository } from '../src/database/repository.js';
import { databaseClient, type DatabaseClient } from '../src/database/client.js';
import { ConflictError, NotFoundError } from '../src/core/errors/api-error.js';
import type { PrismaClient, Lead, Contact, LeadStatus, AuditLog } from '@prisma/client';

async function runLeadTests() {
  console.log('\n--- Starting closeVDS Lead & Contact Domain Tests ---');

  // In-memory test store
  const leadsStore: Map<string, Lead> = new Map();
  const contactsStore: Map<string, Contact> = new Map();
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
            return { ...lead, contacts };
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
        }));
      },
      count: async ({ where }: { where: { workspaceId: string; status?: LeadStatus; campaignId?: string; OR?: unknown[] } }) => {
        let count = Array.from(leadsStore.values()).filter((l) => l.workspaceId === where.workspaceId).length;
        if (where.status) {
          count = Array.from(leadsStore.values()).filter((l) => l.workspaceId === where.workspaceId && l.status === where.status).length;
        }
        return count;
      },
      create: async ({ data }: { data: { workspaceId: string; campaignId: string; businessName: string; domain?: string; phone?: string; address?: string; status?: LeadStatus; contacts?: { create?: Array<{ fullName: string; email: string; title?: string; phone?: string; isPrimary?: boolean }> } } }) => {
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

        const createdContacts: Contact[] = [];
        if (data.contacts?.create) {
          for (const c of data.contacts.create) {
            const cid = `contact_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
            const contact: Contact = {
              id: cid,
              leadId: id,
              fullName: c.fullName,
              email: c.email,
              title: c.title || null,
              phone: c.phone || null,
              isPrimary: c.isPrimary || false,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            contactsStore.set(cid, contact);
            createdContacts.push(contact);
          }
        }

        return { ...lead, contacts: createdContacts };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Lead> }) => {
        const existing = leadsStore.get(where.id);
        if (!existing) throw new Error('Not found');
        const cleanData = Object.fromEntries(Object.entries(data).filter(([_, v]) => v !== undefined));
        const updated: Lead = { ...existing, ...cleanData, updatedAt: new Date() };
        leadsStore.set(where.id, updated);
        return updated;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        leadsStore.delete(where.id);
        for (const [cid, c] of contactsStore.entries()) {
          if (c.leadId === where.id) contactsStore.delete(cid);
        }
        return true;
      },
    },
    contact: {
      findFirst: async ({ where }: { where: { id: string; leadId: string } }) => {
        const contact = contactsStore.get(where.id);
        if (contact && contact.leadId === where.leadId) return contact;
        return null;
      },
      findMany: async ({ where }: { where: { leadId: string } }) => {
        return Array.from(contactsStore.values()).filter((c) => c.leadId === where.leadId);
      },
      create: async ({ data }: { data: { leadId: string; fullName: string; email: string; title?: string; phone?: string; isPrimary?: boolean } }) => {
        const id = `contact_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const contact: Contact = {
          id,
          leadId: data.leadId,
          fullName: data.fullName,
          email: data.email,
          title: data.title || null,
          phone: data.phone || null,
          isPrimary: data.isPrimary || false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        contactsStore.set(id, contact);
        return contact;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Contact> }) => {
        const existing = contactsStore.get(where.id);
        if (!existing) throw new Error('Not found');
        const cleanData = Object.fromEntries(Object.entries(data).filter(([_, v]) => v !== undefined));
        const updated: Contact = { ...existing, ...cleanData, updatedAt: new Date() };
        contactsStore.set(where.id, updated);
        return updated;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        contactsStore.delete(where.id);
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

  const testLeadRepo = new LeadRepository(mockDbClient);
  const testAuditRepo = new AuditRepository(mockDbClient);
  const testLeadService = new LeadService(testLeadRepo, testAuditRepo);

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
    // 1. Domain Service Tests: Create, Deduplication, Update, Delete
    // --------------------------------------------------------------------------
    console.log('Test 1-4: Lead creation with contacts & match-key deduplication...');
    const leadA = await testLeadService.createLead(workspaceA, 'user_a', {
      campaignId,
      businessName: 'Apex Dental Care',
      domain: 'apexdental.com',
      phone: '+442079460000',
      address: '123 Harley Street, London',
      contacts: [
        {
          fullName: 'Dr. John Smith',
          email: 'john@apexdental.com',
          title: 'Practice Principal',
          isPrimary: true,
        },
      ],
    });

    assert.ok(leadA.id, 'Lead ID must exist');
    assert.equal(leadA.businessName, 'Apex Dental Care');
    assert.equal(leadA.contacts.length, 1);
    assert.equal(leadA.contacts[0].fullName, 'Dr. John Smith');

    // Attempting duplicate lead creation in same workspace must throw ConflictError
    await assert.rejects(
      async () => {
        await testLeadService.createLead(workspaceA, 'user_a', {
          campaignId,
          businessName: 'Apex Dental Care',
          domain: 'apexdental.com',
          phone: '+442079460000',
          address: '123 Harley Street, London',
        });
      },
      ConflictError,
      'Duplicate lead with identical match key must throw ConflictError'
    );

    // Creating same business name in a DIFFERENT workspace must succeed (multi-tenant isolated)
    const leadB = await testLeadService.createLead(workspaceB, 'user_b', {
      campaignId,
      businessName: 'Apex Dental Care',
      domain: 'apexdental.com',
      phone: '+442079460000',
      address: '123 Harley Street, London',
    });
    assert.ok(leadB.id);
    assert.equal(leadB.workspaceId, workspaceB);
    console.log('✓ Lead creation, contacts, and deduplication passed');

    // --------------------------------------------------------------------------
    // 2. Cross-Tenant Isolation Tests
    // --------------------------------------------------------------------------
    console.log('Test 5-7: Cross-tenant lead read, update, delete isolation...');
    // User from Workspace B cannot read Lead from Workspace A
    await assert.rejects(
      async () => {
        await testLeadService.getLead(leadA.id, workspaceB);
      },
      NotFoundError,
      'Cross-tenant lead read must be blocked'
    );

    // User from Workspace B cannot update Lead from Workspace A
    await assert.rejects(
      async () => {
        await testLeadService.updateLead(leadA.id, workspaceB, 'user_b', {
          businessName: 'Hacked Dental',
        });
      },
      NotFoundError,
      'Cross-tenant lead update must be blocked'
    );

    // User from Workspace B cannot delete Lead from Workspace A
    await assert.rejects(
      async () => {
        await testLeadService.deleteLead(leadA.id, workspaceB, 'user_b');
      },
      NotFoundError,
      'Cross-tenant lead deletion must be blocked'
    );
    console.log('✓ Cross-tenant lead isolation passed');

    // --------------------------------------------------------------------------
    // 3. Contact Domain Operations
    // --------------------------------------------------------------------------
    console.log('Test 8-10: Contact CRUD operations & scoped isolation...');
    const newContact = await testLeadService.createContact(leadA.id, workspaceA, 'user_a', {
      fullName: 'Sarah Jenkins',
      email: 'sarah@apexdental.com',
      title: 'Practice Manager',
    });
    assert.ok(newContact.id);

    const contactList = await testLeadService.listContacts(leadA.id, workspaceA);
    assert.equal(contactList.length, 2);

    const updatedContact = await testLeadService.updateContact(
      newContact.id,
      leadA.id,
      workspaceA,
      'user_a',
      { title: 'Operations Director' }
    );
    assert.equal(updatedContact.title, 'Operations Director');

    await testLeadService.deleteContact(newContact.id, leadA.id, workspaceA, 'user_a');
    const contactsAfterDelete = await testLeadService.listContacts(leadA.id, workspaceA);
    assert.equal(contactsAfterDelete.length, 1);
    console.log('✓ Contact CRUD operations passed');

    // --------------------------------------------------------------------------
    // 4. Fastify HTTP Endpoints (/api/v1/leads/*)
    // --------------------------------------------------------------------------
    console.log('Test 11-16: Fastify Lead & Contact HTTP Endpoints...');
    const app = await buildApp();

    // Unauthenticated request -> 401
    const unauthRes = await app.inject({
      method: 'GET',
      url: '/api/v1/leads',
    });
    assert.equal(unauthRes.statusCode, 401);

    // Authenticated list leads
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/leads',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(listRes.statusCode, 200);
    const listBody = JSON.parse(listRes.payload);
    assert.equal(listBody.success, true);
    assert.ok(listBody.data.length >= 1);

    // Authenticated get lead by ID
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/leads/${leadA.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(getRes.statusCode, 200);
    const getBody = JSON.parse(getRes.payload);
    assert.equal(getBody.lead.businessName, 'Apex Dental Care');

    // Cross-tenant HTTP attempt -> 404 (NotFoundError masked)
    const crossRes = await app.inject({
      method: 'GET',
      url: `/api/v1/leads/${leadA.id}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    assert.equal(crossRes.statusCode, 404);

    // Malformed body -> 400
    const malformedRes = await app.inject({
      method: 'POST',
      url: '/api/v1/leads',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        campaignId: 'not-a-uuid',
      },
    });
    assert.equal(malformedRes.statusCode, 400);

    // Valid create lead via API
    const createApiRes = await app.inject({
      method: 'POST',
      url: '/api/v1/leads',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        campaignId,
        businessName: 'Boutique Smiles Dental',
        domain: 'boutiquesmiles.com',
        phone: '+442079461111',
      },
    });
    assert.equal(createApiRes.statusCode, 201);

    await app.close();
    console.log('✓ Fastify Lead and Contact HTTP routes passed');
    console.log('\n--- All Lead & Contact Tests Passed Successfully ---');
  } finally {
    databaseClient.setPrismaClient(null);
  }
}

runLeadTests().catch((err) => {
  console.error('Lead Test Suite Failed:', err);
  process.exit(1);
});
