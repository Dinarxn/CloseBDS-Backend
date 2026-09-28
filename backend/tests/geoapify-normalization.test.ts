/// <reference types="node" />
import assert from 'node:assert/strict';
import process from 'node:process';
import {
  normalizeStructuredAddress,
  validateCoordinates,
  normalizePhones,
  normalizeWebsiteAndDomain,
  buildTargetedMapsUrl,
  classifyDataQuality,
} from '../src/integrations/lead-discovery/lead-normalization.js';
import { GeoapifyDiscoveryAdapter } from '../src/integrations/lead-discovery/geoapify.adapter.js';

export async function runGeoapifyNormalizationTests() {
  console.log('\n--- Starting Geoapify Lead Data Quality & Normalization Tests ---');

  // --------------------------------------------------------------------------
  // Test 1: Complete structured Geoapify address
  // --------------------------------------------------------------------------
  console.log('Test 1: Complete structured Geoapify address...');
  const addr1 = normalizeStructuredAddress({
    housenumber: '10',
    street: 'Fleet Street',
    address_line1: '10 Fleet Street',
    address_line2: 'City of London',
    city: 'London',
    state: 'Greater London',
    postcode: 'EC4Y 1AA',
    country: 'United Kingdom',
    formatted: '10 Fleet Street, London, EC4Y 1AA, United Kingdom',
  });
  assert.equal(
    addr1,
    '10 Fleet Street, City of London, London, Greater London, EC4Y 1AA, United Kingdom'
  );
  console.log('✓ Test 1 Passed: Complete structured address assembled canonically');

  // --------------------------------------------------------------------------
  // Test 2: Partial structured address
  // --------------------------------------------------------------------------
  console.log('Test 2: Partial structured address...');
  const addr2 = normalizeStructuredAddress({
    street: 'Sheikh Zayed Road',
    city: 'Dubai',
    country: 'United Arab Emirates',
  });
  assert.equal(addr2, 'Sheikh Zayed Road, Dubai, United Arab Emirates');
  console.log('✓ Test 2 Passed: Partial structured address assembled accurately without missing fields');

  // --------------------------------------------------------------------------
  // Test 3: Formatted-address fallback
  // --------------------------------------------------------------------------
  console.log('Test 3: Formatted-address fallback...');
  const addr3 = normalizeStructuredAddress({
    formatted: '   Al Wasl Road, Jumeirah 1, Dubai, UAE   ',
  });
  assert.equal(addr3, 'Al Wasl Road, Jumeirah 1, Dubai, UAE');

  const addr3Empty = normalizeStructuredAddress({});
  assert.equal(addr3Empty, undefined);
  console.log('✓ Test 3 Passed: Formatted address fallback used when structured fields missing');

  // --------------------------------------------------------------------------
  // Test 4: Duplicate address component removal
  // --------------------------------------------------------------------------
  console.log('Test 4: Duplicate address component removal...');
  const addr4 = normalizeStructuredAddress({
    housenumber: '25',
    street: '25 Chancery Lane', // Street already includes housenumber
    address_line1: '25 Chancery Lane',
    address_line2: 'London, WC2A 1LB', // Repeated city & postcode
    city: 'London',
    postcode: 'WC2A 1LB',
    country: 'United Kingdom',
    formatted: '25 Chancery Lane, London, WC2A 1LB, United Kingdom',
  });
  assert.equal(addr4, '25 Chancery Lane, London, WC2A 1LB, United Kingdom');
  console.log('✓ Test 4 Passed: Duplicate components removed without repetitive tokens');

  // --------------------------------------------------------------------------
  // Test 5: Valid latitude/longitude
  // --------------------------------------------------------------------------
  console.log('Test 5: Valid latitude/longitude...');
  const coords1 = validateCoordinates(51.5074, -0.1278);
  assert.equal(coords1.latitude, 51.5074);
  assert.equal(coords1.longitude, -0.1278);

  const coords2 = validateCoordinates('25.2048', '55.2708');
  assert.equal(coords2.latitude, 25.2048);
  assert.equal(coords2.longitude, 55.2708);

  const coordsEdge = validateCoordinates(-90, 180);
  assert.equal(coordsEdge.latitude, -90);
  assert.equal(coordsEdge.longitude, 180);
  console.log('✓ Test 5 Passed: Valid coordinates properly recognized and parsed');

  // --------------------------------------------------------------------------
  // Test 6: Invalid coordinates
  // --------------------------------------------------------------------------
  console.log('Test 6: Invalid coordinates...');
  const coordsInv1 = validateCoordinates(95.0, 10.0); // lat > 90
  assert.equal(coordsInv1.latitude, undefined);
  assert.equal(coordsInv1.longitude, 10.0);

  const coordsInv2 = validateCoordinates(10.0, -190.0); // lon < -180
  assert.equal(coordsInv2.latitude, 10.0);
  assert.equal(coordsInv2.longitude, undefined);

  const coordsInv3 = validateCoordinates('not_a_num', NaN);
  assert.equal(coordsInv3.latitude, undefined);
  assert.equal(coordsInv3.longitude, undefined);

  const coordsInv4 = validateCoordinates(undefined, null);
  assert.equal(coordsInv4.latitude, undefined);
  assert.equal(coordsInv4.longitude, undefined);
  console.log('✓ Test 6 Passed: Invalid coordinates correctly rejected as undefined');

  // --------------------------------------------------------------------------
  // Test 7: Single phone normalization
  // --------------------------------------------------------------------------
  console.log('Test 7: Single phone normalization...');
  const p1 = normalizePhones('  +971 4 269 9947  ');
  assert.equal(p1.primaryPhone, '+971 4 269 9947');
  assert.equal(p1.additionalPhones.length, 0);

  const p2 = normalizePhones('+44-20-7946-0123');
  assert.equal(p2.primaryPhone, '+44-20-7946-0123');
  assert.equal(p2.additionalPhones.length, 0);
  console.log('✓ Test 7 Passed: Single phone cleaned and primary phone assigned');

  // --------------------------------------------------------------------------
  // Test 8: Multiple phone normalization
  // --------------------------------------------------------------------------
  console.log('Test 8: Multiple phone normalization (semicolon, slash, comma, newline)...');
  // Semicolon separator (the exact observed problem in user prompt)
  const pMulti1 = normalizePhones('+971 4 269 9947;+971 55 497 1986');
  assert.equal(pMulti1.primaryPhone, '+971 4 269 9947');
  assert.deepEqual(pMulti1.additionalPhones, ['+971 55 497 1986']);

  // Slash separator
  const pMulti2 = normalizePhones('+1 415 555 0100 / +1 415 555 0199');
  assert.equal(pMulti2.primaryPhone, '+1 415 555 0100');
  assert.deepEqual(pMulti2.additionalPhones, ['+1 415 555 0199']);

  // Comma and newline separator
  const pMulti3 = normalizePhones('+33 1 42 68 55 00,\n+33 6 12 34 56 78');
  assert.equal(pMulti3.primaryPhone, '+33 1 42 68 55 00');
  assert.deepEqual(pMulti3.additionalPhones, ['+33 6 12 34 56 78']);
  console.log('✓ Test 8 Passed: Multiple phones split cleanly into primary and additional phones');

  // --------------------------------------------------------------------------
  // Test 9: Duplicate phone removal
  // --------------------------------------------------------------------------
  console.log('Test 9: Duplicate phone removal...');
  const pDup = normalizePhones('+971 4 269 9947; +971 4 269 9947; +971 55 497 1986');
  assert.equal(pDup.primaryPhone, '+971 4 269 9947');
  assert.deepEqual(pDup.additionalPhones, ['+971 55 497 1986']);
  console.log('✓ Test 9 Passed: Duplicate phone values removed cleanly');

  // --------------------------------------------------------------------------
  // Test 10: Missing phone
  // --------------------------------------------------------------------------
  console.log('Test 10: Missing phone...');
  const pMissing1 = normalizePhones(undefined);
  assert.equal(pMissing1.primaryPhone, undefined);
  assert.deepEqual(pMissing1.additionalPhones, []);

  const pMissing2 = normalizePhones('   ');
  assert.equal(pMissing2.primaryPhone, undefined);
  assert.deepEqual(pMissing2.additionalPhones, []);

  const pMissing3 = normalizePhones('abc-no-phone');
  assert.equal(pMissing3.primaryPhone, undefined);
  assert.deepEqual(pMissing3.additionalPhones, []);
  console.log('✓ Test 10 Passed: Missing phone returns undefined without inventing placeholders');

  // --------------------------------------------------------------------------
  // Test 11: Website normalization
  // --------------------------------------------------------------------------
  console.log('Test 11: Website normalization...');
  const web1 = normalizeWebsiteAndDomain('https://www.stpaulsdental.co.uk/services');
  assert.equal(web1.websiteUrl, 'https://www.stpaulsdental.co.uk/services');
  assert.equal(web1.domain, 'stpaulsdental.co.uk');

  // Missing protocol normalized
  const web2 = normalizeWebsiteAndDomain('citysmile.ae/booking');
  assert.equal(web2.websiteUrl, 'https://citysmile.ae/booking');
  assert.equal(web2.domain, 'citysmile.ae');
  console.log('✓ Test 11 Passed: Website and domain normalized with protocol preservation');

  // --------------------------------------------------------------------------
  // Test 12: Invalid website handling & social media filtering
  // --------------------------------------------------------------------------
  console.log('Test 12: Invalid website handling & social media filtering...');
  const webInvalid1 = normalizeWebsiteAndDomain('javascript:alert(1)');
  assert.equal(webInvalid1.websiteUrl, undefined);
  assert.equal(webInvalid1.domain, undefined);

  const webInvalid2 = normalizeWebsiteAndDomain('not a valid url');
  assert.equal(webInvalid2.websiteUrl, undefined);
  assert.equal(webInvalid2.domain, undefined);

  // Social media domain filtered out from business website
  const webSocial = normalizeWebsiteAndDomain('https://www.facebook.com/mybusiness');
  assert.equal(webSocial.websiteUrl, undefined);
  assert.equal(webSocial.domain, undefined);

  const webInsta = normalizeWebsiteAndDomain('https://instagram.com/clinic');
  assert.equal(webInsta.websiteUrl, undefined);
  assert.equal(webInsta.domain, undefined);
  console.log('✓ Test 12 Passed: Invalid URLs and generic social media filtered out');

  // --------------------------------------------------------------------------
  // Test 13: Geoapify place_id preservation
  // --------------------------------------------------------------------------
  console.log('Test 13: Geoapify place_id preservation...');
  const adapter = new GeoapifyDiscoveryAdapter({ apiKey: 'test_key' });
  const normalizedCandidate = adapter.normalizeCandidate({
    rawId: 'geoapify_51cb0321ae272e0ec059d04b6b1cb1a1',
    rawName: 'Apex Dental Care',
    rawAddress: '10 Fleet Street, London',
    metadata: {
      placeId: '51cb0321ae272e0ec059d04b6b1cb1a1',
    },
  });
  assert.equal(normalizedCandidate.sourceExternalId, 'geoapify_51cb0321ae272e0ec059d04b6b1cb1a1');
  assert.equal(normalizedCandidate.placeId, '51cb0321ae272e0ec059d04b6b1cb1a1');
  console.log('✓ Test 13 Passed: Geoapify place_id preserved as geoapify_<place_id>');

  // --------------------------------------------------------------------------
  // Test 14: Maps URL generation
  // --------------------------------------------------------------------------
  console.log('Test 14: Maps URL generation...');
  const maps1 = buildTargetedMapsUrl({
    businessName: 'St. Pauls Dental Care',
    address: '10 Fleet Street, London, EC4Y 1AA, United Kingdom',
    latitude: 51.5074,
    longitude: -0.1278,
  });
  assert.ok(maps1?.startsWith('https://www.google.com/maps/search/?api=1&query='));
  assert.ok(maps1?.includes('St.%20Pauls%20Dental%20Care%2C%2010%20Fleet%20Street'));

  // Without address, using coordinates
  const maps2 = buildTargetedMapsUrl({
    businessName: 'Holborn Family Dentistry',
    latitude: 51.51,
    longitude: -0.11,
  });
  assert.ok(maps2?.includes('Holborn%20Family%20Dentistry%2051.51%2C-0.11'));
  console.log('✓ Test 14 Passed: Deterministic targeted Maps URL generated without claiming Google Place ID');

  // --------------------------------------------------------------------------
  // Test 15: Data quality classification
  // --------------------------------------------------------------------------
  console.log('Test 15: Data quality classification (COMPLETE, PARTIAL, MINIMAL)...');
  // COMPLETE: Name + usable address + valid coordinates + phone/web
  const qComplete = classifyDataQuality({
    businessName: 'City Smile Clinic',
    address: '25 Chancery Lane, London, WC2A 1LB',
    latitude: 51.512,
    longitude: -0.115,
    phone: '+44 20 7946 0456',
  });
  assert.equal(qComplete, 'COMPLETE');

  // PARTIAL: Name + address, but missing coordinates and contact
  const qPartial1 = classifyDataQuality({
    businessName: 'City Smile Clinic',
    address: '25 Chancery Lane, London',
  });
  assert.equal(qPartial1, 'PARTIAL');

  // PARTIAL: Name + phone, but missing address
  const qPartial2 = classifyDataQuality({
    businessName: 'City Smile Clinic',
    phone: '+44 20 7946 0456',
  });
  assert.equal(qPartial2, 'PARTIAL');

  // MINIMAL: Name only
  const qMinimal = classifyDataQuality({
    businessName: 'Unknown Business',
  });
  assert.equal(qMinimal, 'MINIMAL');
  console.log('✓ Test 15 Passed: Data quality classified objectively');

  // --------------------------------------------------------------------------
  // Test 16: No fake values when fields are missing
  // --------------------------------------------------------------------------
  console.log('Test 16: No fake values when fields are missing...');
  const emptyNorm = adapter.normalizeCandidate({
    rawId: 'geoapify_empty_123',
    rawName: 'Minimal Business',
  });
  assert.equal(emptyNorm.businessName, 'Minimal Business');
  assert.equal(emptyNorm.normalizedAddress, undefined);
  assert.equal(emptyNorm.normalizedPhone, undefined);
  assert.equal(emptyNorm.additionalPhones, undefined);
  assert.equal(emptyNorm.email, undefined);
  assert.equal(emptyNorm.domain, undefined);
  assert.equal(emptyNorm.websiteUrl, undefined);
  assert.equal(emptyNorm.latitude, undefined);
  assert.equal(emptyNorm.longitude, undefined);
  assert.equal(emptyNorm.dataQuality, 'MINIMAL');
  console.log('✓ Test 16 Passed: Missing fields remain strictly undefined without synthetic values');

  console.log('\n--- All 16 Geoapify Lead Normalization Tests Passed Successfully ---');
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('geoapify-normalization.test.ts')) {
  runGeoapifyNormalizationTests().catch((err) => {
    console.error('Geoapify Normalization Tests Failed:', err);
    process.exit(1);
  });
}
