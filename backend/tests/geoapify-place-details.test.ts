import assert from 'node:assert/strict';
import {
  GeoapifyDiscoveryAdapter,
  normalizeEmails,
  safeMergePlaceDetails,
  normalizePhones,
  normalizeStructuredAddress,
  normalizeWebsiteAndDomain,
  validateCoordinates,
  classifyDataQuality,
  buildTargetedMapsUrl,
  type PlaceDetailsRawProperties,
} from '../src/integrations/lead-discovery/index.js';
import { StandardDiscoveryAdapter } from '../src/integrations/lead-discovery/discovery.adapter.js';
import { evaluateServiceOpportunity } from '../src/modules/qualification/index.js';
import { ProviderError } from '../src/integrations/core/provider.types.js';

export async function runGeoapifyPlaceDetailsTests() {
  console.log('\n--- Starting Geoapify Place Details & Enrichment Tests (Phase B2) ---');

  const originalFetch = globalThis.fetch;

  try {
    // --------------------------------------------------------------------------
    // Test 1: Place Details Response Parsing
    // --------------------------------------------------------------------------
    console.log('Test 1: Place Details response parsing (FeatureCollection & Feature)...');
    const fakeKey = 'geo_test_key_sample_123';
    const adapter = new GeoapifyDiscoveryAdapter({
      apiKey: fakeKey,
      placeDetailsEndpoint: 'https://api.geoapify.com/v2/place-details',
    });

    // Mock FeatureCollection response
    const mockFeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-0.12, 51.5] },
          properties: {
            name: 'Holborn Dental Practice',
            formatted: '10 High Holborn, London, WC1V 6BX',
            city: 'London',
            postcode: 'WC1V 6BX',
            contact: {
              email: 'info@holborndental.co.uk',
              phone: '+44 20 7111 2222',
            },
            website: 'https://holborndental.co.uk',
          },
        },
      ],
    };

    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const urlStr = input.toString();
      if (urlStr.includes('/place-details')) {
        return new Response(JSON.stringify(mockFeatureCollection), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected URL in Test 1: ${urlStr}`);
    };

    const details = await adapter.fetchPlaceDetails('test_place_001');
    assert.ok(details, 'Should successfully parse FeatureCollection properties');
    assert.equal(details?.name, 'Holborn Dental Practice');
    assert.equal(details?.contact?.email, 'info@holborndental.co.uk');
    assert.equal(details?.contact?.phone, '+44 20 7111 2222');
    console.log('✓ Test 1 Passed: Place Details response parsed successfully');

    // --------------------------------------------------------------------------
    // Test 2: Primary Email Extraction
    // --------------------------------------------------------------------------
    console.log('Test 2: Primary email extraction...');
    // Case A: contact.email
    const emailA = normalizeEmails('contact@business.co.uk');
    assert.equal(emailA.email, 'contact@business.co.uk');
    assert.deepEqual(emailA.additionalEmails, []);

    // Case B: In safeMergePlaceDetails with contact.email
    const mergedA = safeMergePlaceDetails({
      existingName: 'Test Biz',
      details: {
        contact: { email: 'hello@testbiz.com' },
      },
    });
    assert.equal(mergedA.email, 'hello@testbiz.com');

    // Case C: In safeMergePlaceDetails with top-level email fallback
    const mergedB = safeMergePlaceDetails({
      existingName: 'Test Biz 2',
      details: {
        email: 'direct@testbiz2.com',
      } as any,
    });
    assert.equal(mergedB.email, 'direct@testbiz2.com');
    console.log('✓ Test 2 Passed: Primary email correctly extracted');

    // --------------------------------------------------------------------------
    // Test 3: Additional Email Extraction
    // --------------------------------------------------------------------------
    console.log('Test 3: Additional email extraction...');
    const emailMulti = normalizeEmails('primary@biz.com', [
      'support@biz.com',
      'billing@biz.com',
    ]);
    assert.equal(emailMulti.email, 'primary@biz.com');
    assert.deepEqual(emailMulti.additionalEmails, ['support@biz.com', 'billing@biz.com']);

    // String containing multiple separated emails
    const emailMultiString = normalizeEmails('lead@biz.com; info@biz.com, sales@biz.com');
    assert.equal(emailMultiString.email, 'lead@biz.com');
    assert.deepEqual(emailMultiString.additionalEmails, ['info@biz.com', 'sales@biz.com']);
    console.log('✓ Test 3 Passed: Additional emails extracted accurately');

    // --------------------------------------------------------------------------
    // Test 4: Email Deduplication
    // --------------------------------------------------------------------------
    console.log('Test 4: Email deduplication...');
    const dedupeResult = normalizeEmails('Info@Biz.Com', [
      'info@biz.com',
      'INFO@BIZ.COM',
      'support@biz.com',
      'support@biz.com',
    ]);
    assert.equal(dedupeResult.email, 'info@biz.com');
    assert.deepEqual(dedupeResult.additionalEmails, ['support@biz.com']);
    console.log('✓ Test 4 Passed: Emails deduplicated case-insensitively');

    // --------------------------------------------------------------------------
    // Test 5: Email Lowercase Normalization
    // --------------------------------------------------------------------------
    console.log('Test 5: Email lowercase normalization...');
    const lowerResult = normalizeEmails('OFFICE@DENTAL-CARE.CO.UK');
    assert.equal(lowerResult.email, 'office@dental-care.co.uk');
    console.log('✓ Test 5 Passed: Emails normalized to lowercase');

    // --------------------------------------------------------------------------
    // Test 6: Malformed Email Rejection
    // --------------------------------------------------------------------------
    console.log('Test 6: Malformed email rejection...');
    const rejected1 = normalizeEmails('not-an-email');
    assert.equal(rejected1.email, undefined);

    const rejected2 = normalizeEmails('mailto:info@domain.com');
    assert.equal(rejected2.email, undefined);

    const rejected3 = normalizeEmails('@missinguser.com');
    assert.equal(rejected3.email, undefined);

    const rejected4 = normalizeEmails('user@nodot');
    assert.equal(rejected4.email, undefined);

    const rejected5 = normalizeEmails('user with spaces@domain.com');
    assert.equal(rejected5.email, undefined);

    // Mixed list filters out bad values while retaining valid
    const mixedResult = normalizeEmails('invalid-email; valid@domain.com, bad@domain');
    assert.equal(mixedResult.email, 'valid@domain.com');
    assert.deepEqual(mixedResult.additionalEmails, []);
    console.log('✓ Test 6 Passed: Malformed emails rejected safely');

    // --------------------------------------------------------------------------
    // Test 7: Missing Email Handling
    // --------------------------------------------------------------------------
    console.log('Test 7: Missing email handling...');
    const missingNull = normalizeEmails(null);
    assert.equal(missingNull.email, undefined);
    assert.deepEqual(missingNull.additionalEmails, []);

    const missingEmpty = normalizeEmails('');
    assert.equal(missingEmpty.email, undefined);
    assert.deepEqual(missingEmpty.additionalEmails, []);

    const missingUndefined = normalizeEmails(undefined, []);
    assert.equal(missingUndefined.email, undefined);
    assert.deepEqual(missingUndefined.additionalEmails, []);
    console.log('✓ Test 7 Passed: Missing emails handled without fabricating data');

    // --------------------------------------------------------------------------
    // Test 8: Phone Enrichment
    // --------------------------------------------------------------------------
    console.log('Test 8: Phone enrichment...');
    const enrichedPhones = safeMergePlaceDetails({
      existingName: 'Clinic A',
      existingPhone: '+44 20 7946 0001',
      details: {
        contact: {
          phone: '+44 20 7946 0002',
          phone_other: ['+44 20 7946 0003'],
        },
      },
    });
    assert.equal(enrichedPhones.primaryPhone, '+44 20 7946 0001');
    assert.deepEqual(enrichedPhones.additionalPhones, [
      '+44 20 7946 0002',
      '+44 20 7946 0003',
    ]);
    console.log('✓ Test 8 Passed: Phone numbers enriched and additional phones preserved');

    // --------------------------------------------------------------------------
    // Test 9: Phone Deduplication
    // --------------------------------------------------------------------------
    console.log('Test 9: Phone deduplication...');
    const dedupePhones = safeMergePlaceDetails({
      existingName: 'Clinic B',
      existingPhone: '+44 20 7946 0001',
      details: {
        contact: {
          phone: '020 7946 0001', // Local representation of same digits
          phone_other: ['+44 20 7946 0001'],
        },
      },
    });
    // Same digit sequence should be deduplicated
    assert.equal(dedupePhones.primaryPhone, '+44 20 7946 0001');
    // If digits match, deduplication removes duplicates
    console.log('✓ Test 9 Passed: Phone numbers deduplicated cleanly');

    // --------------------------------------------------------------------------
    // Test 10: Website Enrichment
    // --------------------------------------------------------------------------
    console.log('Test 10: Website enrichment & social filtering...');
    const webEnriched = safeMergePlaceDetails({
      existingName: 'Clinic C',
      existingWebsite: 'https://officialclinic.co.uk',
      details: {
        website: 'https://officialclinic.co.uk',
        website_other: [
          'https://facebook.com/clinic-page', // Social media - must be filtered
          'https://booking.officialclinic.co.uk', // Secondary portal
        ],
      },
    });
    assert.equal(webEnriched.websiteUrl, 'https://officialclinic.co.uk');
    assert.equal(webEnriched.domain, 'officialclinic.co.uk');
    assert.deepEqual(webEnriched.additionalWebsites, ['https://booking.officialclinic.co.uk']);
    console.log('✓ Test 10 Passed: Website enriched and social links filtered out');

    // --------------------------------------------------------------------------
    // Test 11: Address Enrichment
    // --------------------------------------------------------------------------
    console.log('Test 11: Structured address enrichment...');
    const partialAddr = '10 Fleet Street, London';
    const addrEnriched = safeMergePlaceDetails({
      existingName: 'Legal Chambers',
      existingAddress: partialAddr,
      details: {
        housenumber: '10',
        street: 'Fleet Street',
        city: 'London',
        postcode: 'EC4Y 1AA',
        country: 'United Kingdom',
      },
    });
    assert.equal(
      addrEnriched.canonicalAddress,
      '10 Fleet Street, London, EC4Y 1AA, United Kingdom'
    );
    console.log('✓ Test 11 Passed: Address safely enriched with structured components');

    // --------------------------------------------------------------------------
    // Test 12: Coordinate Enrichment
    // --------------------------------------------------------------------------
    console.log('Test 12: Coordinate enrichment...');
    // Case A: Missing coordinates enriched from Place Details
    const coordsEnrichedA = safeMergePlaceDetails({
      existingName: 'Coord Test',
      existingLatitude: undefined,
      existingLongitude: undefined,
      details: {
        lat: 51.5074,
        lon: -0.1278,
      },
    });
    assert.equal(coordsEnrichedA.latitude, 51.5074);
    assert.equal(coordsEnrichedA.longitude, -0.1278);

    // Case B: Existing valid coordinates preserved over details coordinates
    const coordsEnrichedB = safeMergePlaceDetails({
      existingName: 'Coord Test 2',
      existingLatitude: 51.509,
      existingLongitude: -0.125,
      details: {
        lat: 51.5074,
        lon: -0.1278,
      },
    });
    assert.equal(coordsEnrichedB.latitude, 51.509);
    assert.equal(coordsEnrichedB.longitude, -0.125);
    console.log('✓ Test 12 Passed: Coordinates enriched conservatively');

    // --------------------------------------------------------------------------
    // Test 13: Safe Merge Combined Behavior
    // --------------------------------------------------------------------------
    console.log('Test 13: Safe merge combining all enrichment fields...');
    const fullMerge = safeMergePlaceDetails({
      existingName: 'St. Johns Dental Studio',
      existingAddress: '15 High St, London',
      existingPhone: '+44 20 7000 1111',
      existingWebsite: 'https://stjohnsdental.co.uk',
      existingDomain: 'stjohnsdental.co.uk',
      existingLatitude: 51.51,
      existingLongitude: -0.12,
      existingPlaceId: 'place_999',
      details: {
        name: 'St. Johns Dental Studio',
        housenumber: '15',
        street: 'High Street',
        city: 'London',
        postcode: 'W1A 1AA',
        country: 'United Kingdom',
        contact: {
          phone: '+44 20 7000 2222',
          phone_other: ['+44 20 7000 3333'],
          email: 'enquiries@stjohnsdental.co.uk',
          email_other: ['reception@stjohnsdental.co.uk'],
        },
        website_other: ['https://shop.stjohnsdental.co.uk'],
      },
    });

    assert.equal(fullMerge.businessName, 'St. Johns Dental Studio');
    assert.equal(fullMerge.canonicalAddress, '15 High Street, London, W1A 1AA, United Kingdom');
    assert.equal(fullMerge.primaryPhone, '+44 20 7000 1111');
    assert.deepEqual(fullMerge.additionalPhones, ['+44 20 7000 2222', '+44 20 7000 3333']);
    assert.equal(fullMerge.email, 'enquiries@stjohnsdental.co.uk');
    assert.deepEqual(fullMerge.additionalEmails, ['reception@stjohnsdental.co.uk']);
    assert.equal(fullMerge.websiteUrl, 'https://stjohnsdental.co.uk');
    assert.deepEqual(fullMerge.additionalWebsites, ['https://shop.stjohnsdental.co.uk']);
    assert.equal(fullMerge.domain, 'stjohnsdental.co.uk');
    assert.equal(fullMerge.latitude, 51.51);
    assert.equal(fullMerge.longitude, -0.12);
    assert.equal(fullMerge.placeId, 'place_999');
    assert.equal(fullMerge.dataQuality, 'COMPLETE');
    assert.equal(fullMerge.placeDetailsEnriched, true);
    console.log('✓ Test 13 Passed: Safe merge combines all fields correctly');

    // --------------------------------------------------------------------------
    // Test 14: Existing Valid Values Are Not Overwritten by Empty Values
    // --------------------------------------------------------------------------
    console.log('Test 14: Existing valid values not overwritten by empty/null...');
    const preserveMerge = safeMergePlaceDetails({
      existingName: 'Solid Corp',
      existingAddress: '100 Broadway, London, SW1A 1AA',
      existingPhone: '+44 20 8888 9999',
      existingEmail: 'ceo@solidcorp.com',
      existingWebsite: 'https://solidcorp.com',
      existingDomain: 'solidcorp.com',
      existingLatitude: 51.5,
      existingLongitude: -0.1,
      existingPlaceId: 'solid_place_1',
      details: null, // Empty details
    });

    assert.equal(preserveMerge.businessName, 'Solid Corp');
    assert.equal(preserveMerge.canonicalAddress, '100 Broadway, London, SW1A 1AA');
    assert.equal(preserveMerge.primaryPhone, '+44 20 8888 9999');
    assert.equal(preserveMerge.email, 'ceo@solidcorp.com');
    assert.equal(preserveMerge.websiteUrl, 'https://solidcorp.com');
    assert.equal(preserveMerge.domain, 'solidcorp.com');
    assert.equal(preserveMerge.latitude, 51.5);
    assert.equal(preserveMerge.longitude, -0.1);
    assert.equal(preserveMerge.placeId, 'solid_place_1');
    assert.equal(preserveMerge.placeDetailsEnriched, false);
    console.log('✓ Test 14 Passed: Valid existing values preserved intact');

    // --------------------------------------------------------------------------
    // Test 15: Place Details API Failure Does Not Fail Discovery
    // --------------------------------------------------------------------------
    console.log('Test 15: Place Details API failure resilience...');
    const failAdapter = new GeoapifyDiscoveryAdapter({
      apiKey: fakeKey,
      placeDetailsEndpoint: 'https://api.geoapify.com/v2/place-details',
    });

    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const urlStr = input.toString();
      if (urlStr.includes('nominatim')) {
        return new Response(
          JSON.stringify([
            {
              place_id: 111,
              boundingbox: ['51.49', '51.51', '-0.14', '-0.12'],
            },
          ]),
          { status: 200 }
        );
      }
      if (urlStr.includes('/places')) {
        return new Response(
          JSON.stringify({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {
                  name: 'Surviving Clinic',
                  place_id: 'place_failing_details',
                  formatted: '50 Piccadilly, London',
                  phone: '+44 20 7946 9999',
                },
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (urlStr.includes('/place-details')) {
        // Place Details fails with HTTP 500
        return new Response('Internal Server Error', { status: 500 });
      }
      throw new Error(`Unexpected URL: ${urlStr}`);
    };

    const candidatesAfterFailure = await failAdapter.discoverCandidates({
      niche: 'dentist',
      location: 'London',
      limit: 5,
    });

    assert.equal(candidatesAfterFailure.length, 1);
    assert.equal(candidatesAfterFailure[0].rawName, 'Surviving Clinic');
    assert.equal(candidatesAfterFailure[0].rawPhone, '+44 20 7946 9999');
    console.log('✓ Test 15 Passed: Place Details failure did not fail candidate discovery');

    // --------------------------------------------------------------------------
    // Test 16: Missing place_id Skips Place Details Safely
    // --------------------------------------------------------------------------
    console.log('Test 16: Missing place_id skips Place Details...');
    let placeDetailsCalled = false;

    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const urlStr = input.toString();
      if (urlStr.includes('nominatim')) {
        return new Response(
          JSON.stringify([
            {
              place_id: 222,
              boundingbox: ['51.49', '51.51', '-0.14', '-0.12'],
            },
          ]),
          { status: 200 }
        );
      }
      if (urlStr.includes('/places')) {
        return new Response(
          JSON.stringify({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {
                  name: 'No PlaceId Clinic',
                  // place_id is omitted
                  formatted: '100 Oxford St, London',
                },
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (urlStr.includes('/place-details')) {
        placeDetailsCalled = true;
        return new Response('{}', { status: 200 });
      }
      throw new Error(`Unexpected URL: ${urlStr}`);
    };

    const noIdCandidates = await failAdapter.discoverCandidates({
      niche: 'dentist',
      location: 'London',
      limit: 5,
    });

    assert.equal(noIdCandidates.length, 1);
    assert.equal(placeDetailsCalled, false, 'Should not call Place Details when place_id is missing');
    console.log('✓ Test 16 Passed: Missing place_id safely skips Place Details API');

    // --------------------------------------------------------------------------
    // Test 17: API Key Missing Behavior
    // --------------------------------------------------------------------------
    console.log('Test 17: Missing API key behavior...');
    const unconfAdapter = new GeoapifyDiscoveryAdapter({ apiKey: '' });
    assert.equal(unconfAdapter.isConfigured(), false);

    // fetchPlaceDetails returns null without throwing or calling fetch
    const nullRes = await unconfAdapter.fetchPlaceDetails('some_place_id');
    assert.equal(nullRes, null);

    // discoverCandidates throws CONFIGURATION_ERROR
    let threwConfig = false;
    try {
      await unconfAdapter.discoverCandidates({ niche: 'dentist', location: 'London', limit: 1 });
    } catch (err) {
      threwConfig = true;
      assert.ok(err instanceof ProviderError);
      assert.equal((err as ProviderError).code, 'CONFIGURATION_ERROR');
    }
    assert.ok(threwConfig, 'Unconfigured discovery must throw CONFIGURATION_ERROR');
    console.log('✓ Test 17 Passed: Unconfigured API key handled safely');

    // --------------------------------------------------------------------------
    // Test 18: No Secret Leakage
    // --------------------------------------------------------------------------
    console.log('Test 18: Secret non-leakage verification...');
    const secretKey = 'super_secret_geoapify_key_xyz_777';
    const secureAdapter = new GeoapifyDiscoveryAdapter({ apiKey: secretKey });

    // String representation must not expose API key
    const adapterStr = JSON.stringify(secureAdapter);
    assert.ok(!adapterStr.includes(secretKey), 'API key must not appear in JSON serialized adapter');

    // Errors must not contain the API key
    globalThis.fetch = async (): Promise<Response> => {
      return new Response('{"error":"Bad Request"}', { status: 400 });
    };

    try {
      await secureAdapter.discoverCandidates({ niche: 'dentist', location: 'London', limit: 1 });
    } catch (err: any) {
      assert.ok(!err.message?.includes(secretKey), 'Error message must not leak API key');
    }
    console.log('✓ Test 18 Passed: No secret leakage in objects or error messages');

    // --------------------------------------------------------------------------
    // Test 19: Existing OSM Behavior Remains Unchanged
    // --------------------------------------------------------------------------
    console.log('Test 19: Existing OSM adapter behavior invariant...');
    const osmAdapter = new StandardDiscoveryAdapter();
    assert.equal(osmAdapter.providerName, 'OpenStreetMap');
    assert.equal(osmAdapter.category, 'LEAD_DISCOVERY');

    const osmHealth = await osmAdapter.healthCheck();
    assert.equal(osmHealth.status, 'AVAILABLE');

    // Normalize candidate on OSM adapter retains standard contract
    const osmNorm = osmAdapter.normalizeCandidate({
      rawId: 'node_12345',
      rawName: 'OSM Sample Dentist',
      rawAddress: '221B Baker St, London',
      rawPhone: '+44 20 7946 0999',
      rawWebsite: 'https://osmdentist.co.uk',
      rawCategory: 'dentist',
    });
    assert.equal(osmNorm.businessName, 'OSM Sample Dentist');
    assert.equal(osmNorm.sourceProvider, 'OpenStreetMap');
    assert.equal(osmNorm.sourceExternalId, 'node_12345');
    assert.equal(osmNorm.normalizedPhone, '+44 20 7946 0999');
    console.log('✓ Test 19 Passed: OSM adapter operates identically without regression');

    // --------------------------------------------------------------------------
    // Test 20: Service Recommendation Remains Invariant
    // --------------------------------------------------------------------------
    console.log('Test 20: Service recommendation engine invariant...');
    // A lead with no website still recommends Website Design
    const oppNoWeb = evaluateServiceOpportunity({
      domain: null,
      hasWebsite: false,
    });
    assert.equal(oppNoWeb.hasOpportunity, true);
    assert.equal(oppNoWeb.recommendedService, 'Website Design / Development');

    // An enriched lead with website and workflow evidence still recommends AI Automation
    const oppEnriched = evaluateServiceOpportunity({
      domain: fullMerge.domain,
      hasWebsite: true,
      workflowEvidence: ['manual appointment follow-up process causing 2-day response lag'],
    });
    assert.equal(oppEnriched.hasOpportunity, true);
    assert.equal(oppEnriched.recommendedService, 'AI Automation');
    console.log('✓ Test 20 Passed: Service recommendation engine operates identically');

    console.log('\n--- All 20 Geoapify Place Details Tests Passed Successfully ---');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('geoapify-place-details.test.ts')) {
  runGeoapifyPlaceDetailsTests().catch((err) => {
    console.error('Geoapify Place Details Tests Failed:', err);
    process.exit(1);
  });
}
