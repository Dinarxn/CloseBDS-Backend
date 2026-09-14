/// <reference types="node" />
import assert from 'node:assert/strict';
import { buildApp } from '../src/server/app.js';
import { databaseClient } from '../src/database/client.js';
import { signAuthToken } from '../src/modules/auth/token.js';
import { config } from '../src/config/index.js';
import { PrismaClientInitializationError } from '@prisma/client/runtime/library.js';
import type {
  PrismaClient,
  Lead,
  Contact,
  LeadSource,
  AuditLog,
  LeadStatus,
  Prisma,
} from '@prisma/client';

async function runStep23CloseBDSTests() {
  console.log('\n================================================================');
  console.log('--- Stage 5 — Step 23: closeBDS Connection Integration Tests ---');
  console.log('================================================================\n');

  const testResults: Array<{ name: string; category: string; status: 'PASS' | 'FAIL' | 'BLOCKED'; details?: string }> = [];

  // In-memory mock stores
  const leadsStore: Map<string, Lead> = new Map();
  const contactsStore: Map<string, Contact> = new Map();
  const leadSourcesStore: Map<string, LeadSource> = new Map(); // key: leadId
  const auditLogsStore: AuditLog[] = [];

  const workspaceAlpha = 'ws_alpha_step23';
  const workspaceBeta = 'ws_beta_step23';

  const userAlphaId = 'user_alpha_bds_01';
  const userBetaId = 'user_beta_bds_02';

  const tokenAlpha = signAuthToken({
    userId: userAlphaId,
    workspaceId: workspaceAlpha,
    email: 'operator@alpha.local',
    role: 'ADMIN',
  });

  const tokenBeta = signAuthToken({
    userId: userBetaId,
    workspaceId: workspaceBeta,
    email: 'operator@beta.local',
    role: 'ADMIN',
  });

  let simulateDbOffline = false;
  let simulateAuditFailure = false;

  // Mock Prisma client with multi-tenant store logic
  const mockPrisma = {
    lead: {
      findFirst: async ({ where, include }: { where: { id?: string; workspaceId?: string; businessName?: string; domain?: string | null; phone?: string | null; address?: string | null }; include?: Record<string, boolean> }) => {
        if (simulateDbOffline) {
          throw new PrismaClientInitializationError("Can't reach database server at localhost:5432", '5.0.0');
        }
        for (const l of leadsStore.values()) {
          const matchId = !where.id || l.id === where.id;
          const matchWs = !where.workspaceId || l.workspaceId === where.workspaceId;
          const matchBusiness = !where.businessName || l.businessName.toLowerCase() === where.businessName.toLowerCase();
          const matchDomain = where.domain === undefined || (l.domain ?? null) === (where.domain ?? null);
          const matchPhone = where.phone === undefined || (l.phone ?? null) === (where.phone ?? null);
          const matchAddress = where.address === undefined || (l.address ?? null) === (where.address ?? null);

          if (matchId && matchWs && matchBusiness && matchDomain && matchPhone && matchAddress) {
            const contacts = Array.from(contactsStore.values()).filter((c) => c.leadId === l.id);
            const source = leadSourcesStore.get(l.id) ?? null;
            return {
              ...l,
              contacts,
              leadSource: source,
              leadScore: null,
              websiteAudit: null,
              aiAnalysis: null,
            };
          }
        }
        return null;
      },
      findMany: async ({ where, skip, take }: { where: { workspaceId: string; status?: any; campaignId?: string }; skip?: number; take?: number }) => {
        if (simulateDbOffline) {
          throw new PrismaClientInitializationError("Can't reach database server at localhost:5432", '5.0.0');
        }
        const filtered = Array.from(leadsStore.values()).filter((l) => {
          if (l.workspaceId !== where.workspaceId) return false;
          if (where.status) {
            if (typeof where.status === 'object' && where.status.in) {
              return where.status.in.includes(l.status);
            }
            return l.status === where.status;
          }
          return true;
        });
        const paged = filtered.slice(skip || 0, (skip || 0) + (take || 50));
        return paged.map((l) => ({
          ...l,
          contacts: Array.from(contactsStore.values()).filter((c) => c.leadId === l.id),
          leadSource: leadSourcesStore.get(l.id) ?? null,
          leadScore: null,
          websiteAudit: null,
        }));
      },
      count: async ({ where }: { where: { workspaceId: string; status?: any; campaignId?: string } }) => {
        if (simulateDbOffline) {
          throw new PrismaClientInitializationError("Can't reach database server at localhost:5432", '5.0.0');
        }
        return Array.from(leadsStore.values()).filter((l) => l.workspaceId === where.workspaceId).length;
      },
      create: async ({ data }: { data: Prisma.LeadUncheckedCreateInput }) => {
        if (simulateDbOffline) {
          throw new PrismaClientInitializationError("Can't reach database server at localhost:5432", '5.0.0');
        }
        const id = `lead_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const now = new Date();
        const lead: Lead = {
          id,
          workspaceId: data.workspaceId,
          campaignId: data.campaignId ?? null,
          businessName: data.businessName,
          domain: data.domain ?? null,
          phone: data.phone ?? null,
          address: data.address ?? null,
          status: data.status ?? 'DISCOVERED',
          createdAt: now,
          updatedAt: now,
        };
        leadsStore.set(id, lead);
        return lead;
      },
      update: async ({ where, data }: { where: { id: string }; data: Prisma.LeadUpdateInput }) => {
        if (simulateDbOffline) {
          throw new PrismaClientInitializationError("Can't reach database server at localhost:5432", '5.0.0');
        }
        const existing = leadsStore.get(where.id);
        if (!existing) throw new Error(`Lead ${where.id} not found`);
        const updated: Lead = {
          ...existing,
          ...(data.businessName !== undefined ? { businessName: data.businessName as string } : {}),
          ...(data.domain !== undefined ? { domain: data.domain as string | null } : {}),
          ...(data.phone !== undefined ? { phone: data.phone as string | null } : {}),
          ...(data.address !== undefined ? { address: data.address as string | null } : {}),
          ...(data.status !== undefined ? { status: data.status as LeadStatus } : {}),
          updatedAt: new Date(),
        };
        leadsStore.set(where.id, updated);
        return updated;
      },
    },
    contact: {
      findFirst: async ({ where }: { where: { id?: string; leadId?: string; email?: string } }) => {
        if (simulateDbOffline) {
          throw new PrismaClientInitializationError("Can't reach database server at localhost:5432", '5.0.0');
        }
        for (const c of contactsStore.values()) {
          const matchLead = !where.leadId || c.leadId === where.leadId;
          const matchEmail = !where.email || c.email === where.email;
          const matchId = !where.id || c.id === where.id;
          if (matchLead && matchEmail && matchId) return c;
        }
        return null;
      },
      findMany: async ({ where }: { where: { leadId: string } }) => {
        if (simulateDbOffline) {
          throw new PrismaClientInitializationError("Can't reach database server at localhost:5432", '5.0.0');
        }
        return Array.from(contactsStore.values()).filter((c) => c.leadId === where.leadId);
      },
      create: async ({ data }: { data: Prisma.ContactUncheckedCreateInput }) => {
        if (simulateDbOffline) {
          throw new PrismaClientInitializationError("Can't reach database server at localhost:5432", '5.0.0');
        }
        const id = `contact_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const now = new Date();
        const contact: Contact = {
          id,
          leadId: data.leadId,
          fullName: data.fullName,
          email: data.email,
          title: data.title ?? null,
          phone: data.phone ?? null,
          isPrimary: data.isPrimary ?? true,
          createdAt: now,
          updatedAt: now,
        };
        contactsStore.set(id, contact);
        return contact;
      },
      update: async ({ where, data }: { where: { id: string }; data: Prisma.ContactUpdateInput }) => {
        if (simulateDbOffline) {
          throw new PrismaClientInitializationError("Can't reach database server at localhost:5432", '5.0.0');
        }
        const existing = contactsStore.get(where.id);
        if (!existing) throw new Error(`Contact ${where.id} not found`);
        const updated: Contact = {
          ...existing,
          ...(data.fullName !== undefined ? { fullName: data.fullName as string } : {}),
          ...(data.email !== undefined ? { email: data.email as string } : {}),
          ...(data.title !== undefined ? { title: data.title as string | null } : {}),
          ...(data.phone !== undefined ? { phone: data.phone as string | null } : {}),
          updatedAt: new Date(),
        };
        contactsStore.set(where.id, updated);
        return updated;
      },
    },
    leadSource: {
      findFirst: async ({ where }: { where: { provider?: string; externalId?: string; lead?: { workspaceId?: string } } }) => {
        if (simulateDbOffline) {
          throw new PrismaClientInitializationError("Can't reach database server at localhost:5432", '5.0.0');
        }
        for (const ls of leadSourcesStore.values()) {
          const matchProvider = !where.provider || ls.provider === where.provider;
          const matchExtId = !where.externalId || ls.externalId === where.externalId;
          const lead = leadsStore.get(ls.leadId);
          const matchWs = !where.lead?.workspaceId || (lead && lead.workspaceId === where.lead.workspaceId);
          if (matchProvider && matchExtId && matchWs) {
            return { ...ls, lead };
          }
        }
        return null;
      },
      create: async ({ data }: { data: Prisma.LeadSourceUncheckedCreateInput }) => {
        if (simulateDbOffline) {
          throw new PrismaClientInitializationError("Can't reach database server at localhost:5432", '5.0.0');
        }
        const id = `ls_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const source: LeadSource = {
          id,
          leadId: data.leadId,
          provider: data.provider,
          externalId: (data.externalId as string) || '',
          queryPayload: (data.queryPayload as Prisma.JsonValue) ?? {},
          createdAt: new Date(),
        };
        leadSourcesStore.set(data.leadId, source);
        return source;
      },
      update: async ({ where, data }: { where: { leadId: string }; data: Prisma.LeadSourceUpdateInput }) => {
        if (simulateDbOffline) {
          throw new PrismaClientInitializationError("Can't reach database server at localhost:5432", '5.0.0');
        }
        const existing = leadSourcesStore.get(where.leadId);
        if (!existing) throw new Error(`LeadSource for lead ${where.leadId} not found`);
        const updated: LeadSource = {
          ...existing,
          ...(data.provider !== undefined ? { provider: data.provider as string } : {}),
          ...(data.externalId !== undefined ? { externalId: (data.externalId as string) || '' } : {}),
          ...(data.queryPayload !== undefined ? { queryPayload: data.queryPayload as Prisma.JsonValue } : {}),
        };
        leadSourcesStore.set(where.leadId, updated);
        return updated;
      },
      upsert: async ({ where, create, update }: { where: { leadId: string }; create: Prisma.LeadSourceUncheckedCreateInput; update: Prisma.LeadSourceUpdateInput }) => {
        if (simulateDbOffline) {
          throw new PrismaClientInitializationError("Can't reach database server at localhost:5432", '5.0.0');
        }
        const existing = leadSourcesStore.get(where.leadId);
        if (existing) {
          const updated: LeadSource = {
            ...existing,
            ...(update.provider !== undefined ? { provider: update.provider as string } : {}),
            ...(update.externalId !== undefined ? { externalId: (update.externalId as string) || '' } : {}),
            ...(update.queryPayload !== undefined ? { queryPayload: update.queryPayload as Prisma.JsonValue } : {}),
          };
          leadSourcesStore.set(where.leadId, updated);
          return updated;
        } else {
          const id = `ls_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
          const source: LeadSource = {
            id,
            leadId: create.leadId,
            provider: create.provider,
            externalId: (create.externalId as string) || '',
            queryPayload: (create.queryPayload as Prisma.JsonValue) ?? {},
            createdAt: new Date(),
          };
          leadSourcesStore.set(create.leadId, source);
          return source;
        }
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (simulateAuditFailure) {
          throw new Error('Simulated audit store transient failure');
        }
        const entry = { id: `audit_${Date.now()}_${Math.random()}`, ...data, createdAt: new Date() } as unknown as AuditLog;
        auditLogsStore.push(entry);
        return entry;
      },
      findMany: async ({ where }: { where: { workspaceId: string } }) => {
        return auditLogsStore.filter((a) => a.workspaceId === where.workspaceId);
      },
    },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(mockPrisma),
  } as unknown as PrismaClient;

  databaseClient.setPrismaClient(mockPrisma);

  const app = await buildApp();
  await app.ready();

  try {
    // --------------------------------------------------------------------------
    // Test 1: Valid Authenticated closeBDS Lead Import
    // --------------------------------------------------------------------------
    console.log('Test 1: Importing valid batch of closeBDS leads...');
    const importPayload = {
      leads: [
        {
          externalId: 'bds-lead-001',
          businessName: 'Summit Health Clinic',
          domain: 'https://www.summithealth.example.com/',
          phone: '+1-555-019-1001',
          address: '100 Medical Parkway, Austin, TX 78705',
          contact: {
            fullName: 'Dr. Evelyn Reed',
            email: 'EVELYN.REED@summithealth.example.com',
            title: 'Chief Medical Officer',
            phone: '+1-555-019-1001',
            isPrimary: true,
          },
          metadata: {
            sourceScore: 92,
            targetIndustry: 'Healthcare',
            campaignBatch: 'bds_q3_campaign',
          },
        },
        {
          externalId: 'bds-lead-002',
          businessName: 'Pinecrest Family Dental',
          domain: 'pinecrestfamily.example.com',
          phone: '+1-555-019-1002',
          address: '250 Oak Ridge Lane, Austin, TX 78704',
          contact: {
            fullName: 'Marcus Vance',
            email: 'mvance@pinecrestfamily.example.com',
            title: 'Clinic Manager',
          },
          metadata: {
            sourceScore: 87,
            targetIndustry: 'Dental',
          },
        },
      ],
    };

    const res1 = await app.inject({
      method: 'POST',
      url: '/api/v1/lead-discovery/import-closebds',
      headers: {
        authorization: `Bearer ${tokenAlpha}`,
        'content-type': 'application/json',
      },
      payload: importPayload,
    });

    assert.equal(res1.statusCode, 200, 'Import must return HTTP 200');
    const data1 = JSON.parse(res1.payload);
    assert.equal(data1.success, true, 'Response must indicate success');
    assert.equal(data1.importedCount, 2, 'Should have imported 2 leads');
    assert.equal(data1.updatedCount, 0, 'Should have 0 updated leads');
    assert.equal(data1.skippedDuplicateCount, 0, 'Should have 0 skipped duplicates');
    assert.equal(data1.leads.length, 2, 'Returned leads list length must match');

    // Verify stored lead 1
    const storedLead1Id = data1.leads[0].id;
    const storedLead1 = leadsStore.get(storedLead1Id);
    assert.ok(storedLead1, 'Lead 1 must be persisted in store');
    assert.equal(storedLead1.workspaceId, workspaceAlpha, 'Lead 1 must belong to Workspace Alpha');
    assert.equal(storedLead1.businessName, 'Summit Health Clinic');
    assert.equal(storedLead1.domain, 'summithealth.example.com', 'Domain must be normalized (no protocol or www)');
    assert.equal(storedLead1.status, 'DISCOVERED', 'Initial lead status must be DISCOVERED');

    // Verify stored contact
    const storedContact1 = Array.from(contactsStore.values()).find((c) => c.leadId === storedLead1Id);
    assert.ok(storedContact1, 'Contact 1 must be persisted');
    assert.equal(storedContact1.fullName, 'Dr. Evelyn Reed');
    assert.equal(storedContact1.email, 'evelyn.reed@summithealth.example.com', 'Contact email must be lowercased');

    // Verify stored leadSource
    const storedSource1 = leadSourcesStore.get(storedLead1Id);
    assert.ok(storedSource1, 'LeadSource 1 must be persisted');
    assert.equal(storedSource1.provider, 'closeBDS', 'Provider must be closeBDS');
    assert.equal(storedSource1.externalId, 'bds-lead-001', 'External ID must match');

    console.log('✓ Valid authenticated closeBDS lead import verified');
    testResults.push({ name: 'Valid Authenticated Lead Import', category: 'Functional', status: 'PASS' });

    // --------------------------------------------------------------------------
    // Test 2: Missing or Invalid Authentication Rejected
    // --------------------------------------------------------------------------
    console.log('\nTest 2: Verifying unauthenticated / invalid requests rejection...');

    // 2a: No token
    const res2a = await app.inject({
      method: 'POST',
      url: '/api/v1/lead-discovery/import-closebds',
      headers: { 'content-type': 'application/json' },
      payload: importPayload,
    });
    assert.equal(res2a.statusCode, 401, 'Missing token must return HTTP 401');

    // 2b: Invalid / fake token
    const res2b = await app.inject({
      method: 'POST',
      url: '/api/v1/lead-discovery/import-closebds',
      headers: {
        authorization: 'Bearer invalid.bogus.jwt.token',
        'content-type': 'application/json',
      },
      payload: importPayload,
    });
    assert.equal(res2b.statusCode, 401, 'Invalid token must return HTTP 401');

    console.log('✓ Missing and invalid authentication properly rejected with HTTP 401');
    testResults.push({ name: 'Authentication & Security Rejection', category: 'Security', status: 'PASS' });

    // --------------------------------------------------------------------------
    // Test 3: Cross-Workspace Tenant Isolation
    // --------------------------------------------------------------------------
    console.log('\nTest 3: Verifying server-authoritative workspace isolation...');

    // User Beta imports a lead for Workspace Beta
    const betaPayload = {
      leads: [
        {
          externalId: 'bds-beta-001',
          businessName: 'Rocky Mountain Pediatric Care',
          domain: 'rockykids.example.com',
          phone: '+1-555-028-9001',
        },
      ],
    };

    const res3a = await app.inject({
      method: 'POST',
      url: '/api/v1/lead-discovery/import-closebds',
      headers: {
        authorization: `Bearer ${tokenBeta}`,
        'content-type': 'application/json',
      },
      payload: betaPayload,
    });
    assert.equal(res3a.statusCode, 200, 'Beta import should succeed');
    const data3a = JSON.parse(res3a.payload);
    const betaLead = leadsStore.get(data3a.leads[0].id);
    assert.equal(betaLead?.workspaceId, workspaceBeta, 'Imported lead must strictly belong to Beta workspace');

    // Attempt cross-workspace spoofing via header: Beta token attempting to inject for Alpha workspace
    const res3b = await app.inject({
      method: 'POST',
      url: '/api/v1/lead-discovery/import-closebds',
      headers: {
        authorization: `Bearer ${tokenBeta}`,
        'x-workspace-id': workspaceAlpha,
        'content-type': 'application/json',
      },
      payload: betaPayload,
    });
    assert.equal(res3b.statusCode, 403, 'Cross-workspace header mismatch must return HTTP 403 Forbidden');

    // Query leads as User Beta - must not see Alpha's leads
    const res3c = await app.inject({
      method: 'GET',
      url: '/api/v1/leads',
      headers: { authorization: `Bearer ${tokenBeta}` },
    });
    assert.equal(res3c.statusCode, 200);
    const betaList = JSON.parse(res3c.payload);
    const betaItems = betaList.data || betaList.items || [];
    const alphaLeadLeaked = betaItems.some((l: Lead) => l.workspaceId === workspaceAlpha);
    assert.equal(alphaLeadLeaked, false, 'Workspace Alpha leads must NEVER leak to Workspace Beta');

    console.log('✓ Multi-tenant server-authoritative isolation fully verified');
    testResults.push({ name: 'Cross-Workspace Tenant Isolation', category: 'Security', status: 'PASS' });

    // --------------------------------------------------------------------------
    // Test 4: 4-Factor Match Key Deduplication (Layer 2)
    // --------------------------------------------------------------------------
    console.log('\nTest 4: Verifying 4-factor match key deduplication...');

    // Pre-existing lead in Workspace Alpha
    const preExistingLeadId = 'lead_existing_alpha_099';
    const preExistingLead: Lead = {
      id: preExistingLeadId,
      workspaceId: workspaceAlpha,
      campaignId: null,
      businessName: 'Lone Star Orthodontics',
      domain: 'lonestarortho.example.com',
      phone: '+1-555-019-7700',
      address: '700 Congress Ave, Austin, TX',
      status: 'QUALIFIED',
      createdAt: new Date('2026-09-01T00:00:00Z'),
      updatedAt: new Date('2026-09-01T00:00:00Z'),
    };
    leadsStore.set(preExistingLeadId, preExistingLead);

    // CloseBDS imports same lead under a new closeBDS externalId
    const duplicatePayload = {
      leads: [
        {
          externalId: 'bds-new-ext-999',
          businessName: 'Lone Star Orthodontics',
          domain: 'https://lonestarortho.example.com',
          phone: '+1-555-019-7700',
          address: '700 Congress Ave, Austin, TX',
          contact: {
            fullName: 'Dr. Jane Austin',
            email: 'jaustin@lonestarortho.example.com',
          },
        },
      ],
    };

    const initialLeadCount = Array.from(leadsStore.values()).filter((l) => l.workspaceId === workspaceAlpha).length;

    const res4 = await app.inject({
      method: 'POST',
      url: '/api/v1/lead-discovery/import-closebds',
      headers: {
        authorization: `Bearer ${tokenAlpha}`,
        'content-type': 'application/json',
      },
      payload: duplicatePayload,
    });

    assert.equal(res4.statusCode, 200);
    const data4 = JSON.parse(res4.payload);
    assert.equal(data4.importedCount, 0, 'Should not import a new lead');
    assert.equal(data4.skippedDuplicateCount, 1, 'Should record 1 skipped duplicate');
    assert.equal(data4.leads[0].id, preExistingLeadId, 'Returned lead ID must match pre-existing lead ID');

    const finalLeadCount = Array.from(leadsStore.values()).filter((l) => l.workspaceId === workspaceAlpha).length;
    assert.equal(finalLeadCount, initialLeadCount, 'Total lead count in Alpha must not increase');

    // Operational status must be preserved
    const afterLead = leadsStore.get(preExistingLeadId);
    assert.equal(afterLead?.status, 'QUALIFIED', 'Existing operational status (QUALIFIED) must not be overwritten');

    // LeadSource must now be linked
    const linkedSource = leadSourcesStore.get(preExistingLeadId);
    assert.ok(linkedSource, 'Existing lead must now be linked to LeadSource');
    assert.equal(linkedSource.externalId, 'bds-new-ext-999');

    console.log('✓ 4-Factor deduplication prevented duplicate row creation and preserved status');
    testResults.push({ name: '4-Factor Deduplication (Layer 2)', category: 'Deduplication', status: 'PASS' });

    // --------------------------------------------------------------------------
    // Test 5: Idempotency on Re-import (Layer 1 - Same externalId)
    // --------------------------------------------------------------------------
    console.log('\nTest 5: Verifying idempotent re-import of same closeBDS externalId...');

    // Advance storedLead1 to CALL_READY
    const lead1BeforeReimport = leadsStore.get(storedLead1Id)!;
    leadsStore.set(storedLead1Id, {
      ...lead1BeforeReimport,
      status: 'CALL_READY',
      updatedAt: new Date(),
    });

    // Re-import the exact same externalId with updated address
    const reimportPayload = {
      leads: [
        {
          externalId: 'bds-lead-001',
          businessName: 'Summit Health Clinic (Austin Suite)',
          domain: 'summithealth.example.com',
          phone: '+1-555-019-1001',
          address: '100 Medical Parkway, Suite 400, Austin, TX 78705',
          contact: {
            fullName: 'Dr. Evelyn Reed',
            email: 'evelyn.reed@summithealth.example.com',
            title: 'Chief Medical Officer & Founder',
          },
          metadata: {
            sourceScore: 95,
            syncVersion: 'v2',
          },
        },
      ],
    };

    const res5 = await app.inject({
      method: 'POST',
      url: '/api/v1/lead-discovery/import-closebds',
      headers: {
        authorization: `Bearer ${tokenAlpha}`,
        'content-type': 'application/json',
      },
      payload: reimportPayload,
    });

    assert.equal(res5.statusCode, 200);
    const data5 = JSON.parse(res5.payload);
    assert.equal(data5.importedCount, 0, 'Re-import should not create a new lead');
    assert.equal(data5.updatedCount, 1, 'Re-import should count as updated');
    assert.equal(data5.skippedDuplicateCount, 0);

    const lead1AfterReimport = leadsStore.get(storedLead1Id)!;
    assert.equal(lead1AfterReimport.status, 'CALL_READY', 'CALL_READY status must be preserved across re-imports');
    assert.equal(lead1AfterReimport.address, '100 Medical Parkway, Suite 400, Austin, TX 78705', 'Address should be updated');

    console.log('✓ Idempotency verified: status preserved and attributes updated safely');
    testResults.push({ name: 'Idempotency on Re-Import (Layer 1)', category: 'Idempotency', status: 'PASS' });

    // --------------------------------------------------------------------------
    // Test 6: Zod Schema Validation Failure (HTTP 400)
    // --------------------------------------------------------------------------
    console.log('\nTest 6: Verifying Zod schema validation...');

    // 6a: Empty leads array
    const res6a = await app.inject({
      method: 'POST',
      url: '/api/v1/lead-discovery/import-closebds',
      headers: {
        authorization: `Bearer ${tokenAlpha}`,
        'content-type': 'application/json',
      },
      payload: { leads: [] },
    });
    assert.equal(res6a.statusCode, 400, 'Empty leads array must return HTTP 400');

    // 6b: Missing externalId
    const res6b = await app.inject({
      method: 'POST',
      url: '/api/v1/lead-discovery/import-closebds',
      headers: {
        authorization: `Bearer ${tokenAlpha}`,
        'content-type': 'application/json',
      },
      payload: {
        leads: [
          {
            businessName: 'No External ID Care',
          },
        ],
      },
    });
    assert.equal(res6b.statusCode, 400, 'Missing externalId must return HTTP 400');

    // 6c: Invalid contact email
    const res6c = await app.inject({
      method: 'POST',
      url: '/api/v1/lead-discovery/import-closebds',
      headers: {
        authorization: `Bearer ${tokenAlpha}`,
        'content-type': 'application/json',
      },
      payload: {
        leads: [
          {
            externalId: 'bds-invalid-email-01',
            businessName: 'Invalid Email Practice',
            contact: {
              fullName: 'Bad Email User',
              email: 'not-a-valid-email',
            },
          },
        ],
      },
    });
    assert.equal(res6c.statusCode, 400, 'Invalid email must return HTTP 400');

    console.log('✓ Malformed payloads rejected cleanly with HTTP 400');
    testResults.push({ name: 'Zod Schema Validation Failure Handling', category: 'Validation', status: 'PASS' });

    // --------------------------------------------------------------------------
    // Test 7: Database Offline Error Mapping (503 DATABASE_UNAVAILABLE)
    // --------------------------------------------------------------------------
    console.log('\nTest 7: Verifying Database Unavailable mapping (503 DATABASE_UNAVAILABLE)...');
    simulateDbOffline = true;

    const res7 = await app.inject({
      method: 'POST',
      url: '/api/v1/lead-discovery/import-closebds',
      headers: {
        authorization: `Bearer ${tokenAlpha}`,
        'content-type': 'application/json',
      },
      payload: {
        leads: [
          {
            externalId: 'bds-offline-test',
            businessName: 'Offline Test Care',
          },
        ],
      },
    });

    assert.equal(res7.statusCode, 503, 'Database offline must return HTTP 503');
    const data7 = JSON.parse(res7.payload);
    assert.equal(data7.error.code, 'DATABASE_UNAVAILABLE');
    assert.ok(
      data7.error.message.includes('Cannot reach PostgreSQL database server'),
      'Message must explain database connection status'
    );
    assert.equal(
      res7.payload.includes('closevds_secure_password'),
      false,
      'Internal credentials must NEVER leak in error messages'
    );

    simulateDbOffline = false;
    console.log('✓ Database offline mapped to 503 DATABASE_UNAVAILABLE without secret leaks');
    testResults.push({ name: 'PostgreSQL Offline Handling (503)', category: 'Resilience', status: 'PASS' });

    // --------------------------------------------------------------------------
    // Test 8: Audit Logging for CloseBDS Imports and Updates
    // --------------------------------------------------------------------------
    console.log('\nTest 8: Verifying audit logging records...');

    const importEvents = auditLogsStore.filter((a) => a.eventType === 'closebds_lead:imported');
    const updateEvents = auditLogsStore.filter((a) => a.eventType === 'closebds_lead:updated');

    assert.ok(importEvents.length >= 2, 'Must have recorded at least 2 import audit events');
    assert.ok(updateEvents.length >= 1, 'Must have recorded at least 1 update audit event');

    const firstAudit = importEvents[0];
    assert.equal(firstAudit.workspaceId, workspaceAlpha);
    assert.equal(firstAudit.userId, userAlphaId);
    assert.equal(firstAudit.entityType, 'Lead');
    assert.ok((firstAudit as any).metadata?.externalId, 'Audit metadata must include externalId');

    console.log('✓ Audit logging successfully verified for both imported and updated leads');
    testResults.push({ name: 'Audit Logging for Imports & Updates', category: 'Audit', status: 'PASS' });

    // --------------------------------------------------------------------------
    // Test 9: Resilience / Non-blocking Audit Failure
    // --------------------------------------------------------------------------
    console.log('\nTest 9: Verifying non-blocking audit failure resilience...');
    simulateAuditFailure = true;

    const res9 = await app.inject({
      method: 'POST',
      url: '/api/v1/lead-discovery/import-closebds',
      headers: {
        authorization: `Bearer ${tokenAlpha}`,
        'content-type': 'application/json',
      },
      payload: {
        leads: [
          {
            externalId: 'bds-lead-resilience-009',
            businessName: 'Resilient Medical Partners',
            phone: '+1-555-019-9900',
          },
        ],
      },
    });

    assert.equal(res9.statusCode, 200, 'Import must succeed even if audit write fails');
    const data9 = JSON.parse(res9.payload);
    assert.equal(data9.success, true);
    assert.equal(data9.importedCount, 1);

    simulateAuditFailure = false;
    console.log('✓ Lead import succeeded despite transient audit store failure');
    testResults.push({ name: 'Audit Failure Non-Blocking Resilience', category: 'Resilience', status: 'PASS' });

    // --------------------------------------------------------------------------
    // Test 10: Downstream Pipeline Continuity (Lead Pool & Lead Query Integration)
    // --------------------------------------------------------------------------
    console.log('\nTest 10: Verifying downstream pipeline continuity in Lead Pool...');

    const res10List = await app.inject({
      method: 'GET',
      url: '/api/v1/leads',
      headers: { authorization: `Bearer ${tokenAlpha}` },
    });
    assert.equal(res10List.statusCode, 200);
    const leadList = JSON.parse(res10List.payload);
    const leadItems = leadList.data || leadList.items || [];
    assert.ok(leadItems.length >= 3, 'Imported leads must appear in closeVDS lead list');

    // Fetch individual lead
    const res10Single = await app.inject({
      method: 'GET',
      url: `/api/v1/leads/${storedLead1Id}`,
      headers: { authorization: `Bearer ${tokenAlpha}` },
    });
    assert.equal(res10Single.statusCode, 200);
    const singleLeadPayload = JSON.parse(res10Single.payload);
    const singleLead = singleLeadPayload.lead || singleLeadPayload;
    assert.equal(singleLead.id, storedLead1Id);
    assert.equal(singleLead.workspaceId, workspaceAlpha);
    assert.ok(singleLead.contacts && singleLead.contacts.length > 0, 'Contacts must be present');

    console.log('✓ closeBDS leads seamlessly integrate with closeVDS Lead Pool');
    testResults.push({ name: 'Downstream Lead Pool Continuity', category: 'Pipeline', status: 'PASS' });

    // --------------------------------------------------------------------------
    // Assessment 11: Truthful Live closeBDS Provider Connection Assessment
    // --------------------------------------------------------------------------
    console.log('\nAssessment 11: Assessing Live closeBDS external connection...');
    const hasCloseBdsKey = Boolean(config.CLOSEBDS_API_KEY && config.CLOSEBDS_API_KEY.trim() !== '');
    const hasCloseBdsUrl = Boolean(config.CLOSEBDS_BASE_URL && config.CLOSEBDS_BASE_URL.trim() !== '');

    console.log(`- CLOSEBDS_API_KEY configured: ${hasCloseBdsKey}`);
    console.log(`- CLOSEBDS_BASE_URL configured: ${hasCloseBdsUrl}`);

    if (hasCloseBdsKey && hasCloseBdsUrl) {
      console.log('ℹ Status: CONFIGURATION VERIFIED — LIVE REQUEST NOT EXECUTED');
      testResults.push({
        name: 'Live closeBDS External Provider Connection',
        category: 'External Integration',
        status: 'BLOCKED',
        details: 'CONFIGURATION VERIFIED — LIVE REQUEST NOT EXECUTED (Provider credentials configured, awaiting external closeBDS live sandbox host)',
      });
    } else {
      console.log('ℹ Status: BLOCKED — REQUIRED CLOSEBDS CONTRACT/CREDENTIALS UNAVAILABLE');
      testResults.push({
        name: 'Live closeBDS External Provider Connection',
        category: 'External Integration',
        status: 'BLOCKED',
        details: 'BLOCKED — REQUIRED CLOSEBDS CONTRACT/CREDENTIALS UNAVAILABLE (CLOSEBDS_API_KEY and CLOSEBDS_BASE_URL not set in local environment)',
      });
    }

    // --------------------------------------------------------------------------
    // Summary Table
    // --------------------------------------------------------------------------
    console.log('\n================================================================');
    console.log('--- STAGE 5 — STEP 23 TEST RESULTS SUMMARY ---');
    console.log('================================================================');
    console.table(testResults);

    const passedCount = testResults.filter((t) => t.status === 'PASS').length;
    const blockedCount = testResults.filter((t) => t.status === 'BLOCKED').length;
    const failedCount = testResults.filter((t) => t.status === 'FAIL').length;

    console.log(`\nPASSED:  ${passedCount}/${testResults.length}`);
    console.log(`BLOCKED: ${blockedCount}/${testResults.length}`);
    console.log(`FAILED:  ${failedCount}/${testResults.length}`);

    assert.equal(failedCount, 0, 'No tests should fail');
    assert.equal(passedCount, 10, 'All 10 contract and safety tests must PASS');
  } finally {
    await app.close();
  }
}

runStep23CloseBDSTests().catch((err) => {
  console.error('\n❌ STEP 23 CLOSEBDS INTEGRATION TEST SUITE FAILED:', err);
  process.exit(1);
});
