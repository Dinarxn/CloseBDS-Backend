/// <reference types="node" />
import assert from 'node:assert/strict';
import process from 'node:process';
import {
  buildTargetedMapsDetails,
  buildTargetedMapsUrl,
  safeMergePlaceDetails,
  validateCoordinates,
  type TargetedMapsUrlInput,
  type MapsMatchStatus,
  normalizeEmails,
  normalizePhones,
  normalizeStructuredAddress,
} from '../src/integrations/lead-discovery/index.js';
import { StandardDiscoveryAdapter } from '../src/integrations/lead-discovery/discovery.adapter.js';

export async function runGeoapifyMapsTargetingTests() {
  console.log('\n--- Starting Geoapify Google Maps Targeting Tests (Phase B3) ---');

  // --------------------------------------------------------------------------
  // Test 1: Business Name + Full Address (No coordinates)
  // --------------------------------------------------------------------------
  console.log('Test 1: Business name + full address...');
  const res1 = buildTargetedMapsDetails({
    businessName: 'Covent Garden Dental Clinic',
    address: '40 Long Acre, London, WC2E 9JT, United Kingdom',
  });
  assert.equal(res1.mapsMatchStatus, 'TARGETED');
  assert.ok(res1.mapsUrl?.startsWith('https://www.google.com/maps/search/?api=1&query='));
  assert.ok(res1.mapsUrl?.includes('Covent%20Garden%20Dental%20Clinic'));
  assert.ok(res1.mapsUrl?.includes('40%20Long%20Acre'));
  assert.ok(res1.mapsUrl?.includes('WC2E%209JT'));
  assert.ok(!res1.mapsUrl?.includes('undefined'));
  console.log('✓ Test 1 Passed: Business name + full address produces TARGETED query');

  // --------------------------------------------------------------------------
  // Test 2: Business Name + Address + Coordinates (Strongest targeting)
  // --------------------------------------------------------------------------
  console.log('Test 2: Business name + address + coordinates...');
  const res2 = buildTargetedMapsDetails({
    businessName: 'DentoBeauty Clinic',
    address: '26 London Road, Grays, England, RM17 5XY, United Kingdom',
    latitude: 51.4784202,
    longitude: 0.3214259,
  });
  assert.equal(res2.mapsMatchStatus, 'TARGETED');
  assert.ok(res2.mapsUrl?.includes('DentoBeauty%20Clinic'));
  assert.ok(res2.mapsUrl?.includes('26%20London%20Road'));
  assert.ok(res2.mapsUrl?.includes('RM17%205XY'));
  assert.ok(res2.mapsUrl?.includes('51.4784202%2C0.3214259'));
  console.log('✓ Test 2 Passed: Business name + address + coordinates produces strongest TARGETED query');

  // --------------------------------------------------------------------------
  // Test 3: Business Name + Coordinates (No address)
  // --------------------------------------------------------------------------
  console.log('Test 3: Business name + coordinates...');
  const res3 = buildTargetedMapsDetails({
    businessName: 'Holborn Family Dentistry',
    latitude: 51.51,
    longitude: -0.11,
  });
  assert.equal(res3.mapsMatchStatus, 'TARGETED');
  assert.ok(res3.mapsUrl?.includes('Holborn%20Family%20Dentistry%2051.51%2C-0.11'));
  console.log('✓ Test 3 Passed: Business name + coordinates produces TARGETED query');

  // --------------------------------------------------------------------------
  // Test 4: Coordinates-Only Fallback (No name, no address)
  // --------------------------------------------------------------------------
  console.log('Test 4: Coordinates-only fallback...');
  const res4 = buildTargetedMapsDetails({
    latitude: 51.5074,
    longitude: -0.1278,
  });
  assert.equal(res4.mapsMatchStatus, 'UNVERIFIED');
  assert.ok(res4.mapsUrl?.includes('query=51.5074%2C-0.1278'));
  console.log('✓ Test 4 Passed: Coordinates-only fallback produces UNVERIFIED query');

  // --------------------------------------------------------------------------
  // Test 5: Missing Identity (Empty/whitespace name with address & coords)
  // --------------------------------------------------------------------------
  console.log('Test 5: Missing business name with address & coords...');
  const res5 = buildTargetedMapsDetails({
    businessName: '   ',
    address: '10 Fleet Street, London',
    latitude: 51.5074,
    longitude: -0.1278,
  });
  assert.equal(res5.mapsMatchStatus, 'UNVERIFIED');
  assert.ok(res5.mapsUrl?.includes('10%20Fleet%20Street'));
  assert.ok(!res5.mapsUrl?.includes('undefined'));
  console.log('✓ Test 5 Passed: Missing identity falls back safely without literal undefined');

  // --------------------------------------------------------------------------
  // Test 6: Missing Address
  // --------------------------------------------------------------------------
  console.log('Test 6: Missing address with name & coords...');
  const res6 = buildTargetedMapsDetails({
    businessName: 'Apex Dental Care',
    address: undefined,
    latitude: 51.5074,
    longitude: -0.1278,
  });
  assert.equal(res6.mapsMatchStatus, 'TARGETED');
  assert.ok(res6.mapsUrl?.includes('Apex%20Dental%20Care'));
  assert.ok(res6.mapsUrl?.includes('51.5074'));
  console.log('✓ Test 6 Passed: Missing address handled cleanly');

  // --------------------------------------------------------------------------
  // Test 7: Missing Coordinates
  // --------------------------------------------------------------------------
  console.log('Test 7: Missing coordinates with name & address...');
  const res7 = buildTargetedMapsDetails({
    businessName: 'Baker Street Dental Clinic',
    address: '221B Baker Street, London, NW1 6XE',
    latitude: undefined,
    longitude: undefined,
  });
  assert.equal(res7.mapsMatchStatus, 'TARGETED');
  assert.ok(res7.mapsUrl?.includes('Baker%20Street%20Dental%20Clinic'));
  assert.ok(res7.mapsUrl?.includes('NW1%206XE'));
  console.log('✓ Test 7 Passed: Missing coordinates handled cleanly');

  // --------------------------------------------------------------------------
  // Test 8: Invalid Coordinates Rejection
  // --------------------------------------------------------------------------
  console.log('Test 8: Invalid coordinates rejection...');
  const res8a = buildTargetedMapsDetails({
    businessName: 'Out Of Bounds Practice',
    address: '10 High St, London',
    latitude: 95.0, // Invalid lat > 90
    longitude: -0.1,
  });
  // Should reject invalid latitude and fall back to address only
  assert.equal(res8a.mapsMatchStatus, 'TARGETED');
  assert.ok(!res8a.mapsUrl?.includes('95'));
  assert.ok(res8a.mapsUrl?.includes('Out%20Of%20Bounds%20Practice%2C%2010%20High%20St%2C%20London'));

  const res8b = buildTargetedMapsDetails({
    businessName: 'NaN Coords Practice',
    latitude: NaN,
    longitude: -0.1,
  });
  // Without address and with invalid coords, business name only
  assert.equal(res8b.mapsMatchStatus, 'UNVERIFIED');
  assert.ok(res8b.mapsUrl?.includes('NaN%20Coords%20Practice'));
  console.log('✓ Test 8 Passed: Invalid coordinates correctly rejected');

  // --------------------------------------------------------------------------
  // Test 9: Latitude / Longitude Ordering (lat,lon never swapped)
  // --------------------------------------------------------------------------
  console.log('Test 9: Latitude / longitude ordering...');
  const testLat = 51.5074;
  const testLon = -0.1278;
  const res9 = buildTargetedMapsDetails({
    latitude: testLat,
    longitude: testLon,
  });
  const decodedQuery9 = decodeURIComponent(res9.mapsUrl!.split('query=')[1]);
  assert.equal(decodedQuery9, '51.5074,-0.1278', 'Latitude must precede longitude');
  assert.notEqual(decodedQuery9, '-0.1278,51.5074', 'Coordinates must not be swapped');
  console.log('✓ Test 9 Passed: Coordinates strictly ordered as latitude, longitude');

  // --------------------------------------------------------------------------
  // Test 10: URL Encoding
  // --------------------------------------------------------------------------
  console.log('Test 10: URL encoding verification...');
  const res10 = buildTargetedMapsDetails({
    businessName: 'Smile & Shine Dental Care',
    address: '10 Fleet St, London',
  });
  assert.ok(res10.mapsUrl?.includes('%20'), 'Spaces must be encoded as %20');
  assert.ok(res10.mapsUrl?.includes('%26'), '& must be encoded as %26');
  assert.ok(res10.mapsUrl?.includes('%2C'), 'Commas must be encoded as %2C');
  console.log('✓ Test 10 Passed: Special characters properly URL encoded');

  // --------------------------------------------------------------------------
  // Test 11: No Double Encoding
  // --------------------------------------------------------------------------
  console.log('Test 11: No double encoding...');
  const alreadyEncodedName = 'Smile%20%26%20Shine%20Dental';
  const res11 = buildTargetedMapsDetails({
    businessName: alreadyEncodedName,
    address: '10%20Fleet%20St',
  });
  assert.ok(!res11.mapsUrl?.includes('%2520'), 'Must not double encode %20 to %2520');
  assert.ok(!res11.mapsUrl?.includes('%2526'), 'Must not double encode %26 to %2526');
  console.log('✓ Test 11 Passed: Double encoding prevented');

  // --------------------------------------------------------------------------
  // Test 12: No Undefined Query
  // --------------------------------------------------------------------------
  console.log('Test 12: No undefined query...');
  const res12a = buildTargetedMapsDetails({
    businessName: 'undefined',
    address: 'undefined',
  });
  assert.equal(res12a.mapsUrl, undefined);
  assert.equal(res12a.mapsMatchStatus, undefined);

  const res12b = buildTargetedMapsDetails({
    businessName: 'Valid Clinic',
    address: undefined,
    latitude: undefined,
  });
  assert.ok(!res12b.mapsUrl?.includes('undefined'), 'Maps URL must not contain the word undefined');
  console.log('✓ Test 12 Passed: Literal undefined excluded from URL');

  // --------------------------------------------------------------------------
  // Test 13: No Empty Query
  // --------------------------------------------------------------------------
  console.log('Test 13: No empty query...');
  const res13a = buildTargetedMapsDetails({});
  assert.equal(res13a.mapsUrl, undefined);
  assert.equal(res13a.mapsMatchStatus, undefined);

  const res13b = buildTargetedMapsDetails({
    businessName: '',
    address: '   ',
  });
  assert.equal(res13b.mapsUrl, undefined);
  assert.equal(res13b.mapsMatchStatus, undefined);
  console.log('✓ Test 13 Passed: Empty inputs produce undefined without empty query URL');

  // --------------------------------------------------------------------------
  // Test 14: Special Characters in Business Name
  // --------------------------------------------------------------------------
  console.log('Test 14: Special characters in business name...');
  const res14 = buildTargetedMapsDetails({
    businessName: "Dr. O'Connor & Sons / Dental #1 + Co.",
    address: '15 High St, London',
  });
  assert.ok(res14.mapsUrl?.startsWith('https://www.google.com/maps/search/?api=1&query='));
  const decoded14 = decodeURIComponent(res14.mapsUrl!.split('query=')[1]);
  assert.ok(decoded14.includes("Dr. O'Connor & Sons / Dental #1 + Co."));
  console.log('✓ Test 14 Passed: Complex business names with special characters handled accurately');

  // --------------------------------------------------------------------------
  // Test 15: Special Characters in Address
  // --------------------------------------------------------------------------
  console.log('Test 15: Special characters in address...');
  const res15 = buildTargetedMapsDetails({
    businessName: 'City Dental',
    address: "Unit 3B, St. John's Court #10-12, Fleet St.",
  });
  const decoded15 = decodeURIComponent(res15.mapsUrl!.split('query=')[1]);
  assert.ok(decoded15.includes("Unit 3B, St. John's Court #10-12, Fleet St."));
  console.log('✓ Test 15 Passed: Special characters in address safely encoded');

  // --------------------------------------------------------------------------
  // Test 16: Postcode Handling
  // --------------------------------------------------------------------------
  console.log('Test 16: Postcode handling...');
  const res16 = buildTargetedMapsDetails({
    businessName: 'West End Dental',
    address: '10 Piccadilly, London, W1J 7NT, United Kingdom',
  });
  assert.ok(res16.mapsUrl?.includes('W1J%207NT'));
  console.log('✓ Test 16 Passed: Postcode correctly formatted in Maps URL');

  // --------------------------------------------------------------------------
  // Test 17: Country Handling
  // --------------------------------------------------------------------------
  console.log('Test 17: Country handling...');
  const res17 = buildTargetedMapsDetails({
    businessName: 'UK Smile Centre',
    address: '25 Oxford Street, London, W1D 2DW, United Kingdom',
  });
  assert.ok(res17.mapsUrl?.includes('United%20Kingdom'));
  console.log('✓ Test 17 Passed: Country properly preserved in query');

  // --------------------------------------------------------------------------
  // Test 18: Existing mapsUrl Preservation in Safe Merge
  // --------------------------------------------------------------------------
  console.log('Test 18: Existing mapsUrl preservation...');
  const existingUrl = 'https://www.google.com/maps/search/?api=1&query=Existing%20Targeted%20Clinic';
  const mergeResult18 = safeMergePlaceDetails({
    existingName: 'Existing Clinic',
    existingMapsUrl: existingUrl,
    existingMapsMatchStatus: 'TARGETED',
    details: null, // Empty details
  });
  assert.equal(mergeResult18.mapsUrl, existingUrl, 'Must preserve existing valid mapsUrl');
  assert.equal(mergeResult18.mapsMatchStatus, 'TARGETED');
  console.log('✓ Test 18 Passed: Existing mapsUrl preserved non-destructively');

  // --------------------------------------------------------------------------
  // Test 19: Deterministic Output
  // --------------------------------------------------------------------------
  console.log('Test 19: Deterministic output verification...');
  const input19: TargetedMapsUrlInput = {
    businessName: 'Deterministic Smile Studio',
    address: '10 Fleet Street, London, EC4Y 1AA',
    latitude: 51.5074,
    longitude: -0.1278,
  };
  const run1 = buildTargetedMapsDetails(input19);
  const run2 = buildTargetedMapsDetails(input19);
  const run3 = buildTargetedMapsUrl(input19);
  assert.equal(run1.mapsUrl, run2.mapsUrl);
  assert.equal(run1.mapsUrl, run3);
  assert.equal(run1.mapsMatchStatus, run2.mapsMatchStatus);
  console.log('✓ Test 19 Passed: Deterministic output verified');

  // --------------------------------------------------------------------------
  // Test 20: No Fake Google Place ID
  // --------------------------------------------------------------------------
  console.log('Test 20: No fake Google Place ID...');
  const res20 = buildTargetedMapsDetails({
    businessName: 'Place ID Guard Test',
    address: '50 Strand, London',
    latitude: 51.5,
    longitude: -0.12,
  });
  assert.ok(!res20.mapsUrl?.includes('query_place_id'), 'Must not claim a Google Place ID');
  assert.ok(!res20.mapsUrl?.includes('place_id='), 'Must not append fake place_id');
  console.log('✓ Test 20 Passed: No fake Google Place ID attached');

  // --------------------------------------------------------------------------
  // Test 21: No Fake Google CID
  // --------------------------------------------------------------------------
  console.log('Test 21: No fake Google CID...');
  assert.ok(!res20.mapsUrl?.includes('cid='), 'Must not append fake cid parameter');
  assert.ok(!res20.mapsUrl?.includes('ludocid='), 'Must not append fake ludocid parameter');
  console.log('✓ Test 21 Passed: No fake Google CID attached');

  // --------------------------------------------------------------------------
  // Test 22: mapsMatchStatus Behavior
  // --------------------------------------------------------------------------
  console.log('Test 22: mapsMatchStatus behavior matrix...');
  // Name + Address -> TARGETED
  assert.equal(
    buildTargetedMapsDetails({ businessName: 'Biz', address: 'Addr' }).mapsMatchStatus,
    'TARGETED'
  );
  // Name + Coords -> TARGETED
  assert.equal(
    buildTargetedMapsDetails({ businessName: 'Biz', latitude: 51.5, longitude: -0.1 }).mapsMatchStatus,
    'TARGETED'
  );
  // Coords only -> UNVERIFIED
  assert.equal(
    buildTargetedMapsDetails({ latitude: 51.5, longitude: -0.1 }).mapsMatchStatus,
    'UNVERIFIED'
  );
  // Address only -> UNVERIFIED
  assert.equal(
    buildTargetedMapsDetails({ address: '10 Fleet St' }).mapsMatchStatus,
    'UNVERIFIED'
  );
  // Name only -> UNVERIFIED
  assert.equal(
    buildTargetedMapsDetails({ businessName: 'Unanchored Name' }).mapsMatchStatus,
    'UNVERIFIED'
  );
  // Empty -> undefined
  assert.equal(buildTargetedMapsDetails({}).mapsMatchStatus, undefined);
  console.log('✓ Test 22 Passed: mapsMatchStatus strictly classifies TARGETED vs UNVERIFIED');

  // --------------------------------------------------------------------------
  // Test 23: OSM Provider Invariance
  // --------------------------------------------------------------------------
  console.log('Test 23: OSM provider invariance...');
  const osm = new StandardDiscoveryAdapter();
  assert.equal(osm.providerName, 'OpenStreetMap');
  const osmCandidate = osm.normalizeCandidate({
    rawId: 'osm_123',
    rawName: 'OSM Dentist',
    rawAddress: '10 Baker St, London',
    rawPhone: '+44 20 7000 0000',
  });
  assert.equal(osmCandidate.businessName, 'OSM Dentist');
  assert.equal(osmCandidate.sourceProvider, 'OpenStreetMap');
  console.log('✓ Test 23 Passed: OSM adapter operates identically without regression');

  // --------------------------------------------------------------------------
  // Test 24: B1 Normalization Invariance
  // --------------------------------------------------------------------------
  console.log('Test 24: B1 normalization invariance...');
  const normPhones = normalizePhones('+44 20 7946 0123 / +44 20 7946 0456');
  assert.equal(normPhones.primaryPhone, '+44 20 7946 0123');
  assert.deepEqual(normPhones.additionalPhones, ['+44 20 7946 0456']);

  const normAddr = normalizeStructuredAddress({
    housenumber: '10',
    street: 'Fleet Street',
    city: 'London',
    postcode: 'EC4Y 1AA',
    country: 'United Kingdom',
  });
  assert.equal(normAddr, '10 Fleet Street, London, EC4Y 1AA, United Kingdom');
  console.log('✓ Test 24 Passed: B1 phone and address normalization preserved');

  // --------------------------------------------------------------------------
  // Test 25: B2 Place Details Invariance
  // --------------------------------------------------------------------------
  console.log('Test 25: B2 Place Details invariance...');
  const normEmails = normalizeEmails('INFO@CLINIC.CO.UK', ['support@clinic.co.uk', 'info@clinic.co.uk']);
  assert.equal(normEmails.email, 'info@clinic.co.uk');
  assert.deepEqual(normEmails.additionalEmails, ['support@clinic.co.uk']);

  const mergeB2 = safeMergePlaceDetails({
    existingName: 'B2 Clinic',
    details: {
      contact: { email: 'dr@b2clinic.com' },
      lat: 51.5,
      lon: -0.1,
    },
  });
  assert.equal(mergeB2.email, 'dr@b2clinic.com');
  assert.equal(mergeB2.placeDetailsEnriched, true);
  assert.equal(mergeB2.mapsMatchStatus, 'TARGETED');
  console.log('✓ Test 25 Passed: B2 email extraction and Place Details merge preserved');

  console.log('\n--- All 25 Geoapify Google Maps Targeting Tests Passed Successfully ---');
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('geoapify-maps-targeting.test.ts')) {
  runGeoapifyMapsTargetingTests().catch((err) => {
    console.error('Geoapify Maps Targeting Tests Failed:', err);
    process.exit(1);
  });
}
