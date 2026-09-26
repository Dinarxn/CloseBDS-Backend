import assert from 'node:assert/strict';
import { GeoapifyDiscoveryAdapter, NICHE_GEOAPIFY_MAP } from '../src/integrations/lead-discovery/geoapify.adapter.js';
import { DiscoveryDomainService } from '../src/modules/lead-discovery/discovery.service.js';
import {
  LeadRepository,
  LeadSourceRepository,
  AuditRepository,
} from '../src/database/repository.js';
import { databaseClient } from '../src/database/client.js';
import { ProviderError } from '../src/integrations/core/provider.types.js';
import type { PrismaClient, Lead, LeadSource, AuditLog } from '@prisma/client';
import type { LeadDiscoveryService, RawLeadCandidate } from '../src/integrations/lead-discovery/index.js';

export async function runGeoapifyDiscoveryTests() {
  console.log('\n--- Starting Geoapify Lead Discovery Tests ---');

  const originalFetch = globalThis.fetch;

  // In-memory test stores
  const leadsStore: Map<string, Lead> = new Map();
  const leadSourcesStore: Map<string, LeadSource> = new Map();
  const auditLogsStore: AuditLog[] = [];

  const mockPrisma = {
    lead: {
      create: async (args: { data: any }) => {
        const id = `lead_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const record = {
          id,
          workspaceId: args.data.workspaceId,
          campaignId: args.data.campaignId ?? null,
          businessName: args.data.businessName,
          domain: args.data.domain ?? null,
          phone: args.data.phone ?? null,
          address: args.data.address ?? null,
          status: args.data.status ?? 'NEW',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Lead;
        leadsStore.set(id, record);
        return record;
      },
      findFirst: async (args: { where: any; include?: any }) => {
        for (const lead of leadsStore.values()) {
          const w = args.where;
          if (w.id && lead.id !== w.id) continue;
          if (w.workspaceId && lead.workspaceId !== w.workspaceId) continue;
          if (w.businessName && lead.businessName !== w.businessName) continue;
          if (w.domain !== undefined && lead.domain !== w.domain) continue;
          if (w.phone !== undefined && lead.phone !== w.phone) continue;
          if (w.address !== undefined && lead.address !== w.address) continue;
          const leadSource = leadSourcesStore.get(lead.id) || null;
          return { ...lead, leadSource };
        }
        return null;
      },
      findMany: async (args: { where: any }) => {
        const results: Lead[] = [];
        for (const lead of leadsStore.values()) {
          const w = args.where;
          if (w.workspaceId && lead.workspaceId !== w.workspaceId) continue;
          if (w.domain) {
            const domVal = typeof w.domain === 'object' && w.domain?.equals ? w.domain.equals : w.domain;
            if (domVal && lead.domain?.toLowerCase() !== String(domVal).toLowerCase()) continue;
          }
          if (w.phone && typeof w.phone === 'object' && 'not' in w.phone) {
            if (w.phone.not === null && !lead.phone) continue;
          }
          if (w.address && typeof w.address === 'object' && 'not' in w.address) {
            if (w.address.not === null && !lead.address) continue;
          }
          if (w.businessName) {
            const bizVal = typeof w.businessName === 'object' && w.businessName?.equals ? w.businessName.equals : w.businessName;
            if (bizVal && lead.businessName.toLowerCase() !== String(bizVal).toLowerCase()) continue;
          }
          results.push(lead);
        }
        return results;
      },
      update: async (args: { where: { id: string }; data: any }) => {
        const existing = leadsStore.get(args.where.id);
        if (!existing) throw new Error('Not found');
        const cleanData = Object.fromEntries(
          Object.entries(args.data).filter(([_, v]) => v !== undefined)
        );
        const updated = { ...existing, ...cleanData, updatedAt: new Date() };
        leadsStore.set(args.where.id, updated);
        return updated;
      },
    },
    leadSource: {
      create: async (args: { data: any }) => {
        const id = `ls_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const record = {
          id,
          leadId: args.data.leadId,
          provider: args.data.provider,
          externalId: args.data.externalId,
          queryPayload: args.data.queryPayload ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as LeadSource;
        leadSourcesStore.set(record.leadId, record);
        return record;
      },
      findFirst: async (args: { where: any }) => {
        if (args.where.leadId) {
          const source = leadSourcesStore.get(args.where.leadId) || null;
          if (source && args.where.lead?.workspaceId) {
            const lead = leadsStore.get(source.leadId);
            if (!lead || lead.workspaceId !== args.where.lead.workspaceId) return null;
          }
          return source;
        }
        for (const ls of leadSourcesStore.values()) {
          if (args.where.lead?.workspaceId) {
            const lead = leadsStore.get(ls.leadId);
            if (!lead || lead.workspaceId !== args.where.lead.workspaceId) continue;
          }
          return ls;
        }
        return null;
      },
      update: async (args: { where: any; data: any }) => {
        const leadId = args.where.leadId || args.where.id;
        const existing = leadSourcesStore.get(leadId);
        if (!existing) throw new Error('Not found');
        const updated = { ...existing, ...args.data, updatedAt: new Date() };
        leadSourcesStore.set(leadId, updated);
        return updated;
      },
      upsert: async (args: { where: { leadId: string }; create: any; update: any }) => {
        const existing = leadSourcesStore.get(args.where.leadId);
        if (existing) {
          const updated = { ...existing, ...args.update, updatedAt: new Date() };
          leadSourcesStore.set(args.where.leadId, updated);
          return updated;
        }
        const record = {
          id: `ls_${Date.now()}`,
          leadId: args.where.leadId,
          provider: args.create.provider,
          externalId: args.create.externalId,
          queryPayload: args.create.queryPayload ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as LeadSource;
        leadSourcesStore.set(record.leadId, record);
        return record;
      },
    },
    auditLog: {
      create: async (args: { data: any }) => {
        const entry = {
          id: `audit_${Date.now()}`,
          ...args.data,
          createdAt: new Date(),
        } as AuditLog;
        auditLogsStore.push(entry);
        return entry;
      },
    },
  };

  databaseClient.setPrismaClient(mockPrisma as unknown as PrismaClient);

  const testLeadRepo = new LeadRepository(databaseClient);
  const testLeadSourceRepo = new LeadSourceRepository(databaseClient);
  const testAuditRepo = new AuditRepository(databaseClient);

  const workspaceA = 'ws_geo_11111111-1111-1111-1111-111111111111';
  const workspaceB = 'ws_geo_22222222-2222-2222-2222-222222222222';

  // Mock Nominatim geocoding response
  const mockNominatimSuccess = JSON.stringify([
    {
      place_id: 99999,
      boundingbox: ['51.48', '51.52', '-0.15', '-0.08'],
      display_name: 'London, Greater London, England, United Kingdom',
    },
  ]);

  // Mock Geoapify Places response
  const mockGeoapifyDentalSuccess = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [-0.1278, 51.5074],
        },
        properties: {
          name: 'St. Pauls Dental Care',
          formatted: '10 Fleet Street, London, EC4Y 1AA, United Kingdom',
          address_line1: '10 Fleet Street',
          address_line2: 'London, EC4Y 1AA',
          city: 'London',
          country: 'United Kingdom',
          country_code: 'gb',
          place_id: 'geo_place_101',
          lat: 51.5074,
          lon: -0.1278,
          contact: {
            phone: '+44 20 7946 0123',
          },
          website: 'https://www.stpaulsdental.co.uk',
          categories: ['healthcare', 'healthcare.dentist'],
        },
      },
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [-0.115, 51.512],
        },
        properties: {
          name: 'City Smile Clinic',
          formatted: '25 Chancery Lane, London, WC2A 1LB',
          place_id: 'geo_place_102',
          lat: 51.512,
          lon: -0.115,
          phone: '+44 20 7946 0456',
          // No website provided
          categories: ['healthcare.dentist'],
        },
      },
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [-0.11, 51.51],
        },
        properties: {
          name: 'Holborn Family Dentistry',
          formatted: '50 High Holborn, London',
          place_id: 'geo_place_103',
          lat: 51.51,
          lon: -0.11,
          website: 'https://holborndental.co.uk',
          // No phone provided
          categories: ['healthcare.dentist'],
        },
      },
    ],
  });

  try {
    // --------------------------------------------------------------------------
    // Test 1: Category Mapping & Validation
    // --------------------------------------------------------------------------
    console.log('Test 1: Category mapping...');
    const adapter = new GeoapifyDiscoveryAdapter({ apiKey: 'geo_test_key_123' });

    assert.equal(adapter.resolveCategory('dentist'), 'healthcare.dentist');
    assert.equal(adapter.resolveCategory('dental'), 'healthcare.dentist');
    assert.equal(adapter.resolveCategory('restaurant'), 'catering.restaurant');
    assert.equal(adapter.resolveCategory('cafe'), 'catering.cafe');
    assert.equal(adapter.resolveCategory('lawyer'), 'office.lawyer');
    assert.equal(adapter.resolveCategory('hotel'), 'accommodation.hotel');
    assert.equal(adapter.resolveCategory('gym'), 'sport.fitness');
    assert.equal(adapter.resolveCategory('plumber'), 'service.plumber');
    assert.equal(adapter.resolveCategory('electrician'), 'service.electrician');
    assert.equal(adapter.resolveCategory('accounting'), 'office.accountant');

    // Unsupported niche throws CONFIGURATION_ERROR
    let thrownUnsupported = false;
    try {
      adapter.resolveCategory('quantum_rocket_launchpad_xyz');
    } catch (err) {
      thrownUnsupported = true;
      assert.ok(err instanceof ProviderError);
      assert.equal((err as ProviderError).code, 'CONFIGURATION_ERROR');
    }
    assert.ok(thrownUnsupported, 'Unsupported niche must throw CONFIGURATION_ERROR');
    console.log('✓ Test 1 Passed: Category mapping and validation verified');

    // --------------------------------------------------------------------------
    // Test 2: Bounding Box Request Format & Candidate Discovery
    // --------------------------------------------------------------------------
    console.log('Test 2: Bounding box format and candidate discovery...');
    let requestedGeoapifyUrl = '';

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const urlStr = input.toString();

      if (urlStr.includes('nominatim.openstreetmap.org')) {
        return new Response(mockNominatimSuccess, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (urlStr.includes('api.geoapify.com')) {
        requestedGeoapifyUrl = urlStr;
        return new Response(mockGeoapifyDentalSuccess, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      throw new Error(`Unexpected test URL: ${urlStr}`);
    };

    const rawCandidates = await adapter.discoverCandidates({
      niche: 'Dentist',
      location: 'London',
      limit: 10,
    });

    assert.equal(rawCandidates.length, 3);
    assert.ok(requestedGeoapifyUrl.includes('categories=healthcare.dentist'));
    // Longitude/latitude ordering check: rect:west,south,east,north
    // Nominatim mock had ['51.48', '51.52', '-0.15', '-0.08'] -> south=51.48, north=51.52, west=-0.15, east=-0.08
    assert.ok(
      requestedGeoapifyUrl.includes('rect%3A-0.15%2C51.48%2C-0.08%2C51.52') ||
        requestedGeoapifyUrl.includes('rect:-0.15,51.48,-0.08,51.52'),
      `Expected rect:-0.15,51.48,-0.08,51.52 in URL, got: ${requestedGeoapifyUrl}`
    );
    console.log('✓ Test 2 Passed: Bounding box filter correctly formatted (rect:west,south,east,north)');

    // --------------------------------------------------------------------------
    // Test 3: Normalization & Missing Field Integrity
    // --------------------------------------------------------------------------
    console.log('Test 3: Normalization and field extraction...');
    const cand1 = adapter.normalizeCandidate(rawCandidates[0]);
    assert.equal(cand1.businessName, 'St. Pauls Dental Care');
    assert.equal(cand1.normalizedAddress, '10 Fleet Street, London, EC4Y 1AA, United Kingdom');
    assert.equal(cand1.normalizedPhone, '+44 20 7946 0123');
    assert.equal(cand1.domain, 'stpaulsdental.co.uk');
    assert.equal(cand1.websiteUrl, 'https://www.stpaulsdental.co.uk');
    assert.equal(cand1.sourceProvider, 'Geoapify');
    assert.equal(cand1.sourceExternalId, 'geoapify_geo_place_101');

    // Candidate 2 has no website
    const cand2 = adapter.normalizeCandidate(rawCandidates[1]);
    assert.equal(cand2.businessName, 'City Smile Clinic');
    assert.equal(cand2.normalizedPhone, '+44 20 7946 0456');
    assert.equal(cand2.domain, undefined);
    assert.equal(cand2.websiteUrl, undefined);

    // Candidate 3 has no phone
    const cand3 = adapter.normalizeCandidate(rawCandidates[2]);
    assert.equal(cand3.businessName, 'Holborn Family Dentistry');
    assert.equal(cand3.normalizedPhone, undefined);
    assert.equal(cand3.domain, 'holborndental.co.uk');
    console.log('✓ Test 3 Passed: Normalization preserves fields and keeps missing fields null/undefined');

    // --------------------------------------------------------------------------
    // Test 4: Limit Enforcement
    // --------------------------------------------------------------------------
    console.log('Test 4: Requested limit is respected...');
    const limitedCandidates = await adapter.discoverCandidates({
      niche: 'Dentist',
      location: 'London',
      limit: 2,
    });
    assert.equal(limitedCandidates.length, 2);
    assert.ok(requestedGeoapifyUrl.includes('limit=2'));
    console.log('✓ Test 4 Passed: Limit is respected');

    // --------------------------------------------------------------------------
    // Test 5: Lead Pool Ingestion via DiscoveryDomainService
    // --------------------------------------------------------------------------
    console.log('Test 5: Lead Pool ingestion with Geoapify provider...');
    const discoveryService = new DiscoveryDomainService(
      {
        geoapify: adapter,
      },
      testLeadRepo,
      testLeadSourceRepo,
      testAuditRepo
    );

    const execResult = await discoveryService.executeDiscovery(workspaceA, 'user_geo_1', {
      niche: 'Dentist',
      location: 'London',
      limit: 10,
      provider: 'geoapify',
    });

    assert.equal(execResult.status, 'completed');
    assert.equal(execResult.discoveredCount, 3);
    assert.equal(execResult.persistedCount, 3);
    assert.equal(execResult.skippedDuplicateCount, 0);

    const storedLead1 = await testLeadRepo.findExistingLeadForDiscovery(workspaceA, {
      businessName: 'St. Pauls Dental Care',
      domain: 'stpaulsdental.co.uk',
    });
    assert.ok(storedLead1, 'Stored lead must exist in workspace');
    assert.equal(storedLead1?.businessName, 'St. Pauls Dental Care');

    const source1 = await testLeadSourceRepo.findByLeadId(storedLead1!.id, workspaceA);
    assert.ok(source1, 'LeadSource must exist');
    assert.equal(source1?.provider, 'Geoapify');
    assert.equal(source1?.externalId, 'geoapify_geo_place_101');
    console.log('✓ Test 5 Passed: Ingested Geoapify leads into Lead Pool with correct source tracking');

    // --------------------------------------------------------------------------
    // Test 6: Cross-Provider Enrichment (OSM Initial -> Geoapify Complete)
    // --------------------------------------------------------------------------
    console.log('Test 6: Cross-provider deduplication & non-destructive enrichment...');
    // Existing OSM Lead has missing phone & domain
    const osmLead = await testLeadRepo.create({
      workspaceId: workspaceA,
      businessName: 'Covent Garden Dental Clinic',
      domain: undefined,
      phone: undefined,
      address: '40 Long Acre, London',
      status: 'NEW',
    });

    await testLeadSourceRepo.recordDiscoverySource(osmLead.id, workspaceA, {
      provider: 'OpenStreetMap',
      externalId: 'osm_node_5555',
      queryPayload: { niche: 'dentist', location: 'London' },
    });

    // Mock Geoapify returning the same business but with domain & phone
    const mockGeoEnrichment = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-0.12, 51.51] },
          properties: {
            name: 'Covent Garden Dental Clinic',
            formatted: '40 Long Acre, London',
            place_id: 'geo_place_5555',
            lat: 51.51,
            lon: -0.12,
            contact: { phone: '+44 20 7123 9999' },
            website: 'https://coventgardendental.co.uk',
            categories: ['healthcare.dentist'],
          },
        },
      ],
    });

    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const urlStr = input.toString();
      if (urlStr.includes('nominatim.openstreetmap.org')) {
        return new Response(mockNominatimSuccess, { status: 200 });
      }
      if (urlStr.includes('api.geoapify.com')) {
        return new Response(mockGeoEnrichment, { status: 200 });
      }
      throw new Error(`Unexpected URL: ${urlStr}`);
    };

    const enrichExec = await discoveryService.executeDiscovery(workspaceA, 'user_geo_1', {
      niche: 'Dentist',
      location: 'London',
      limit: 10,
      provider: 'geoapify',
    });

    assert.equal(enrichExec.discoveredCount, 1);
    assert.equal(enrichExec.persistedCount, 0, 'Must not create a duplicate lead');
    assert.equal(enrichExec.skippedDuplicateCount, 1);

    // Verify existing lead was safely enriched
    const enrichedLead = await testLeadRepo.findById(osmLead.id, workspaceA);
    assert.equal(enrichedLead?.id, osmLead.id);
    assert.equal(enrichedLead?.phone, '+44 20 7123 9999', 'Missing phone should be enriched');
    assert.equal(enrichedLead?.domain, 'coventgardendental.co.uk', 'Missing domain should be enriched');
    assert.equal(enrichedLead?.address, '40 Long Acre, London', 'Existing address preserved');

    // Verify Primary LeadSource remained OpenStreetMap
    const enrichedSource = await testLeadSourceRepo.findByLeadId(osmLead.id, workspaceA);
    assert.equal(enrichedSource?.provider, 'OpenStreetMap', 'Primary provider must remain OpenStreetMap');
    assert.equal(enrichedSource?.externalId, 'osm_node_5555');

    // Verify Geoapify was recorded in additionalSources
    const payload = enrichedSource?.queryPayload as any;
    assert.ok(Array.isArray(payload.additionalSources), 'additionalSources must be an array');
    assert.equal(payload.additionalSources.length, 1);
    assert.equal(payload.additionalSources[0].provider, 'Geoapify');
    assert.equal(payload.additionalSources[0].externalId, 'geoapify_geo_place_5555');
    console.log('✓ Test 6 Passed: Lead safely enriched while preserving primary OSM source');

    // --------------------------------------------------------------------------
    // Test 7: Prevent Duplicate Additional Source
    // --------------------------------------------------------------------------
    console.log('Test 7: Prevent duplicate additional source entries...');
    await discoveryService.executeDiscovery(workspaceA, 'user_geo_1', {
      niche: 'Dentist',
      location: 'London',
      limit: 10,
      provider: 'geoapify',
    });

    const enrichedSourceAgain = await testLeadSourceRepo.findByLeadId(osmLead.id, workspaceA);
    const payloadAgain = enrichedSourceAgain?.queryPayload as any;
    assert.equal(payloadAgain.additionalSources.length, 1, 'Same Geoapify external ID must not be duplicated');
    console.log('✓ Test 7 Passed: Duplicate additional source avoided');

    // --------------------------------------------------------------------------
    // Test 8: Workspace Isolation
    // --------------------------------------------------------------------------
    console.log('Test 8: Workspace isolation with Geoapify discovery...');
    const wsBExec = await discoveryService.executeDiscovery(workspaceB, 'user_geo_2', {
      niche: 'Dentist',
      location: 'London',
      limit: 10,
      provider: 'geoapify',
    });

    assert.equal(wsBExec.persistedCount, 1, 'Same business in Workspace B must create separate lead');
    const wsBLeads = await testLeadRepo.findMany(workspaceB);
    assert.equal(wsBLeads.length, 1);
    assert.notEqual(wsBLeads[0].id, osmLead.id);
    console.log('✓ Test 8 Passed: Workspace isolation strictly maintained');

    // --------------------------------------------------------------------------
    // Test 9: Provider Routing & Google Disabled State
    // --------------------------------------------------------------------------
    console.log('Test 9: Provider routing and disabled Google provider...');
    const googleResult = await discoveryService.executeDiscovery(workspaceA, 'user_geo_1', {
      niche: 'Dentist',
      location: 'London',
      limit: 10,
      provider: 'google',
    });

    assert.equal(googleResult.status, 'unavailable');
    assert.ok(googleResult.message.includes('Google Places provider is currently disabled/unsupported'));

    // Routing by 'source' parameter as alternative to 'provider'
    const googleBySource = await discoveryService.executeDiscovery(workspaceA, 'user_geo_1', {
      niche: 'Dentist',
      location: 'London',
      limit: 10,
      source: 'google',
    });
    assert.equal(googleBySource.status, 'unavailable');
    console.log('✓ Test 9 Passed: Google provider properly disabled and provider/source routing works');

    // --------------------------------------------------------------------------
    // Test 10: Error Handling (Missing Key, 401, 429, 500, Timeout, Malformed JSON)
    // --------------------------------------------------------------------------
    console.log('Test 10: Provider error handling...');

    // 10a: Unconfigured adapter
    const unconfigured = new GeoapifyDiscoveryAdapter({ apiKey: '' });
    assert.equal(unconfigured.isConfigured(), false);
    const health = await unconfigured.healthCheck();
    assert.equal(health.status, 'UNCONFIGURED');
    let unconfThrew = false;
    try {
      await unconfigured.discoverCandidates({ niche: 'dentist', location: 'London', limit: 5 });
    } catch (err) {
      unconfThrew = true;
      assert.ok(err instanceof ProviderError);
      assert.equal((err as ProviderError).code, 'CONFIGURATION_ERROR');
    }
    assert.ok(unconfThrew);

    // 10b: 401 Unauthorized (Invalid API Key)
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const urlStr = input.toString();
      if (urlStr.includes('nominatim')) return new Response(mockNominatimSuccess, { status: 200 });
      return new Response('{"message":"Invalid apiKey"}', { status: 401 });
    };
    let authThrew = false;
    try {
      await adapter.discoverCandidates({ niche: 'dentist', location: 'London', limit: 5 });
    } catch (err) {
      authThrew = true;
      assert.ok(err instanceof ProviderError);
      assert.equal((err as ProviderError).code, 'CONFIGURATION_ERROR');
      assert.ok((err as ProviderError).message.includes('Invalid API key'));
    }
    assert.ok(authThrew);

    // 10c: 429 Rate Limited
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const urlStr = input.toString();
      if (urlStr.includes('nominatim')) return new Response(mockNominatimSuccess, { status: 200 });
      return new Response('Rate limited', { status: 429 });
    };
    let rateThrew = false;
    try {
      await adapter.discoverCandidates({ niche: 'dentist', location: 'London', limit: 5 });
    } catch (err) {
      rateThrew = true;
      assert.ok(err instanceof ProviderError);
      assert.equal((err as ProviderError).code, 'RATE_LIMITED');
      assert.equal((err as ProviderError).isRetryable, true);
    }
    assert.ok(rateThrew);

    // 10d: 500 Server Error
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const urlStr = input.toString();
      if (urlStr.includes('nominatim')) return new Response(mockNominatimSuccess, { status: 200 });
      return new Response('Internal error', { status: 500 });
    };
    let serverThrew = false;
    try {
      await adapter.discoverCandidates({ niche: 'dentist', location: 'London', limit: 5 });
    } catch (err) {
      serverThrew = true;
      assert.ok(err instanceof ProviderError);
      assert.equal((err as ProviderError).code, 'PROVIDER_UNAVAILABLE');
      assert.equal((err as ProviderError).isRetryable, true);
    }
    assert.ok(serverThrew);

    // 10e: Malformed JSON
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const urlStr = input.toString();
      if (urlStr.includes('nominatim')) return new Response(mockNominatimSuccess, { status: 200 });
      return new Response('NOT_JSON_<<<>>>', { status: 200 });
    };
    let jsonThrew = false;
    try {
      await adapter.discoverCandidates({ niche: 'dentist', location: 'London', limit: 5 });
    } catch (err) {
      jsonThrew = true;
      assert.ok(err instanceof ProviderError);
      assert.equal((err as ProviderError).code, 'PARSING_ERROR');
    }
    assert.ok(jsonThrew);

    // 10f: Empty results
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const urlStr = input.toString();
      if (urlStr.includes('nominatim')) return new Response(mockNominatimSuccess, { status: 200 });
      return new Response('{"type":"FeatureCollection","features":[]}', { status: 200 });
    };
    const emptyCandidates = await adapter.discoverCandidates({ niche: 'dentist', location: 'London', limit: 5 });
    assert.equal(emptyCandidates.length, 0);

    console.log('✓ Test 10 Passed: All error conditions handled safely and gracefully');

    console.log('\n--- All Geoapify Lead Discovery Tests Passed Successfully ---');
  } finally {
    globalThis.fetch = originalFetch;
    databaseClient.setPrismaClient(null);
  }
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('geoapify-discovery.test.ts')) {
  runGeoapifyDiscoveryTests().catch((err) => {
    console.error('Geoapify Discovery Tests Failed:', err);
    process.exit(1);
  });
}
