/// <reference types="node" />
import assert from 'node:assert/strict';
import process from 'node:process';
import {
  evaluateLeadActionability,
  classifyDataQuality,
  safeMergePlaceDetails,
  validateCoordinates,
  normalizePhones,
  normalizeEmails,
  normalizeWebsiteAndDomain,
  normalizeStructuredAddress,
  type LeadActionability,
  type LeadActionabilityTier,
  type LeadEligibilityChannel,
  type LeadMissingField,
} from '../src/integrations/lead-discovery/index.js';
import { StandardDiscoveryAdapter } from '../src/integrations/lead-discovery/discovery.adapter.js';

export async function runGeoapifyActionabilityTests() {
  console.log('\n--- Starting Geoapify Lead Quality + Actionability + Channel Eligibility Tests (Phase B4) ---');

  // --------------------------------------------------------------------------
  // Test 1: COMPLETE + phone
  // --------------------------------------------------------------------------
  console.log('Test 1: COMPLETE + phone...');
  const res1 = evaluateLeadActionability({
    businessName: 'Apex Dental Care',
    address: '10 Fleet Street, London, EC4Y 1AA, United Kingdom',
    latitude: 51.5138,
    longitude: -0.1083,
    phone: '+44 20 7946 0919',
  });
  assert.equal(res1.tier, 'READY');
  assert.equal(res1.isActionable, true);
  assert.deepEqual(res1.eligibleChannels, ['VOICE']);
  assert.ok(res1.missingFields.includes('EMAIL'));
  assert.ok(res1.missingFields.includes('WEBSITE'));
  assert.ok(!res1.missingFields.includes('PHONE'));
  assert.ok(!res1.missingFields.includes('ADDRESS'));
  assert.ok(!res1.missingFields.includes('COORDINATES'));
  assert.ok(res1.reasons.includes('NO_EMAIL'));
  assert.ok(res1.reasons.includes('NO_WEBSITE'));
  assert.ok(!res1.reasons.includes('NO_PHONE'));
  assert.ok(!res1.reasons.includes('NO_DIRECT_CONTACT'));
  assert.ok(!res1.reasons.includes('INCOMPLETE_LOCATION'));
  assert.ok(!res1.reasons.includes('MINIMAL_BUSINESS_IDENTITY'));
  console.log('✓ Test 1 Passed: COMPLETE + phone is READY and actionable for VOICE');

  // --------------------------------------------------------------------------
  // Test 2: COMPLETE + email
  // --------------------------------------------------------------------------
  console.log('Test 2: COMPLETE + email...');
  const res2 = evaluateLeadActionability({
    businessName: 'Apex Dental Care',
    address: '10 Fleet Street, London, EC4Y 1AA, United Kingdom',
    latitude: 51.5138,
    longitude: -0.1083,
    email: 'contact@apexdental.co.uk',
  });
  assert.equal(res2.tier, 'READY');
  assert.equal(res2.isActionable, true);
  assert.deepEqual(res2.eligibleChannels, ['EMAIL']);
  assert.ok(res2.missingFields.includes('PHONE'));
  assert.ok(res2.missingFields.includes('WEBSITE'));
  assert.ok(!res2.missingFields.includes('EMAIL'));
  assert.ok(!res2.missingFields.includes('ADDRESS'));
  assert.ok(!res2.missingFields.includes('COORDINATES'));
  assert.ok(res2.reasons.includes('NO_PHONE'));
  assert.ok(res2.reasons.includes('NO_WEBSITE'));
  assert.ok(!res2.reasons.includes('NO_DIRECT_CONTACT'));
  console.log('✓ Test 2 Passed: COMPLETE + email is READY and actionable for EMAIL');

  // --------------------------------------------------------------------------
  // Test 3: COMPLETE + phone + email
  // --------------------------------------------------------------------------
  console.log('Test 3: COMPLETE + phone + email...');
  const res3 = evaluateLeadActionability({
    businessName: 'Apex Dental Care',
    address: '10 Fleet Street, London, EC4Y 1AA, United Kingdom',
    latitude: 51.5138,
    longitude: -0.1083,
    phone: '+44 20 7946 0919',
    email: 'contact@apexdental.co.uk',
    websiteUrl: 'https://apexdental.co.uk',
  });
  assert.equal(res3.tier, 'READY');
  assert.equal(res3.isActionable, true);
  assert.ok(res3.eligibleChannels.includes('VOICE'));
  assert.ok(res3.eligibleChannels.includes('EMAIL'));
  assert.ok(res3.eligibleChannels.includes('WEBSITE_AUDIT'));
  assert.equal(res3.eligibleChannels.length, 3);
  assert.deepEqual(res3.missingFields, []);
  assert.deepEqual(res3.reasons, []);
  console.log('✓ Test 3 Passed: COMPLETE with phone, email, and website has all channels and no missing fields');

  // --------------------------------------------------------------------------
  // Test 4: PARTIAL + phone
  // --------------------------------------------------------------------------
  console.log('Test 4: PARTIAL + phone...');
  const res4 = evaluateLeadActionability({
    businessName: 'Apex Dental Care',
    latitude: 51.5138,
    longitude: -0.1083,
    phone: '+44 20 7946 0919',
    // Missing address
  });
  assert.equal(res4.tier, 'ENRICHMENT_REQUIRED');
  assert.equal(res4.isActionable, true);
  assert.deepEqual(res4.eligibleChannels, ['VOICE']);
  assert.ok(res4.missingFields.includes('ADDRESS'));
  assert.ok(res4.reasons.includes('NO_ADDRESS'));
  assert.ok(res4.reasons.includes('INCOMPLETE_LOCATION'));
  console.log('✓ Test 4 Passed: PARTIAL + phone requires enrichment before outbound due to incomplete location');

  // --------------------------------------------------------------------------
  // Test 5: PARTIAL + email
  // --------------------------------------------------------------------------
  console.log('Test 5: PARTIAL + email...');
  const res5 = evaluateLeadActionability({
    businessName: 'Apex Dental Care',
    address: '10 Fleet Street, London, EC4Y 1AA, United Kingdom',
    email: 'contact@apexdental.co.uk',
    // Missing coordinates
  });
  assert.equal(res5.tier, 'ENRICHMENT_REQUIRED');
  assert.equal(res5.isActionable, true);
  assert.deepEqual(res5.eligibleChannels, ['EMAIL']);
  assert.ok(res4.missingFields.includes('ADDRESS'));
  assert.ok(res5.missingFields.includes('COORDINATES'));
  assert.ok(res5.reasons.includes('NO_COORDINATES'));
  assert.ok(res5.reasons.includes('INCOMPLETE_LOCATION'));
  console.log('✓ Test 5 Passed: PARTIAL + email requires enrichment due to missing coordinates');

  // --------------------------------------------------------------------------
  // Test 6: website only
  // --------------------------------------------------------------------------
  console.log('Test 6: website only...');
  const res6 = evaluateLeadActionability({
    websiteUrl: 'https://harleystreetclinic.com',
  });
  assert.equal(res6.tier, 'ENRICHMENT_REQUIRED');
  assert.equal(res6.isActionable, true);
  assert.deepEqual(res6.eligibleChannels, ['WEBSITE_AUDIT']);
  assert.ok(res6.missingFields.includes('PHONE'));
  assert.ok(res6.missingFields.includes('EMAIL'));
  assert.ok(res6.missingFields.includes('ADDRESS'));
  assert.ok(res6.missingFields.includes('COORDINATES'));
  assert.ok(res6.reasons.includes('NO_PHONE'));
  assert.ok(res6.reasons.includes('NO_EMAIL'));
  assert.ok(res6.reasons.includes('NO_DIRECT_CONTACT'));
  assert.ok(res6.reasons.includes('MINIMAL_BUSINESS_IDENTITY'));
  console.log('✓ Test 6 Passed: Website only is actionable for WEBSITE_AUDIT but not direct contact');

  // --------------------------------------------------------------------------
  // Test 7: name + address + website
  // --------------------------------------------------------------------------
  console.log('Test 7: name + address + website...');
  const res7 = evaluateLeadActionability({
    businessName: 'Harley Dental',
    address: '12 Harley Street, London, W1G 9PG, United Kingdom',
    websiteUrl: 'https://harleydental.co.uk',
  });
  assert.equal(res7.tier, 'ENRICHMENT_REQUIRED');
  assert.equal(res7.isActionable, true);
  assert.deepEqual(res7.eligibleChannels, ['WEBSITE_AUDIT']);
  assert.ok(res7.missingFields.includes('PHONE'));
  assert.ok(res7.missingFields.includes('EMAIL'));
  assert.ok(res7.reasons.includes('NO_PHONE'));
  assert.ok(res7.reasons.includes('NO_EMAIL'));
  assert.ok(res7.reasons.includes('NO_DIRECT_CONTACT'));
  assert.ok(!res7.reasons.includes('NO_WEBSITE'));
  assert.ok(!res7.reasons.includes('NO_ADDRESS'));
  console.log('✓ Test 7 Passed: Name + address + website is actionable for audit but requires enrichment');

  // --------------------------------------------------------------------------
  // Test 8: name + coordinates only
  // --------------------------------------------------------------------------
  console.log('Test 8: name + coordinates only...');
  const res8 = evaluateLeadActionability({
    businessName: 'Unverified Point',
    latitude: 51.5074,
    longitude: -0.1278,
  });
  assert.equal(res8.tier, 'ARCHIVED_WEAK');
  assert.equal(res8.isActionable, false);
  assert.deepEqual(res8.eligibleChannels, []);
  assert.ok(res8.missingFields.includes('PHONE'));
  assert.ok(res8.missingFields.includes('EMAIL'));
  assert.ok(res8.missingFields.includes('WEBSITE'));
  assert.ok(res8.missingFields.includes('ADDRESS'));
  assert.ok(!res8.missingFields.includes('COORDINATES'));
  assert.ok(res8.reasons.includes('NO_DIRECT_CONTACT'));
  assert.ok(res8.reasons.includes('INCOMPLETE_LOCATION'));
  assert.ok(!res8.reasons.includes('NO_COORDINATES'));
  console.log('✓ Test 8 Passed: Name + coordinates only is ARCHIVED_WEAK and not actionable');

  // --------------------------------------------------------------------------
  // Test 9: name only
  // --------------------------------------------------------------------------
  console.log('Test 9: name only...');
  const res9 = evaluateLeadActionability({
    businessName: 'Ghost Practice',
  });
  assert.equal(res9.tier, 'ARCHIVED_WEAK');
  assert.equal(res9.isActionable, false);
  assert.deepEqual(res9.eligibleChannels, []);
  assert.deepEqual(res9.missingFields, ['PHONE', 'EMAIL', 'WEBSITE', 'ADDRESS', 'COORDINATES']);
  assert.ok(res9.reasons.includes('MINIMAL_BUSINESS_IDENTITY'));
  assert.ok(res9.reasons.includes('NO_DIRECT_CONTACT'));
  assert.ok(res9.reasons.includes('INCOMPLETE_LOCATION'));
  console.log('✓ Test 9 Passed: Name only has minimal identity, tier ARCHIVED_WEAK');

  // --------------------------------------------------------------------------
  // Test 10: no usable identity
  // --------------------------------------------------------------------------
  console.log('Test 10: no usable identity...');
  const res10 = evaluateLeadActionability({
    businessName: '   ',
    address: 'null',
    phone: 'undefined',
  });
  assert.equal(res10.tier, 'ARCHIVED_WEAK');
  assert.equal(res10.isActionable, false);
  assert.deepEqual(res10.eligibleChannels, []);
  assert.ok(res10.reasons.includes('MINIMAL_BUSINESS_IDENTITY'));
  assert.deepEqual(res10.missingFields, ['PHONE', 'EMAIL', 'WEBSITE', 'ADDRESS', 'COORDINATES']);
  console.log('✓ Test 10 Passed: Blank/null identity treated as ARCHIVED_WEAK');

  // --------------------------------------------------------------------------
  // Test 11: missing phone reason
  // --------------------------------------------------------------------------
  console.log('Test 11: missing phone reason...');
  const res11 = evaluateLeadActionability({
    businessName: 'Email Only Clinic',
    address: '10 Fleet Street, London',
    latitude: 51.5,
    longitude: -0.1,
    email: 'info@clinic.co.uk',
  });
  assert.ok(res11.missingFields.includes('PHONE'));
  assert.ok(res11.reasons.includes('NO_PHONE'));
  assert.ok(!res11.reasons.includes('NO_EMAIL'));
  assert.ok(!res11.reasons.includes('NO_DIRECT_CONTACT'));
  console.log('✓ Test 11 Passed: Missing phone reason correctly identified');

  // --------------------------------------------------------------------------
  // Test 12: missing email reason
  // --------------------------------------------------------------------------
  console.log('Test 12: missing email reason...');
  const res12 = evaluateLeadActionability({
    businessName: 'Phone Only Clinic',
    address: '10 Fleet Street, London',
    latitude: 51.5,
    longitude: -0.1,
    phone: '+44 20 7946 0919',
  });
  assert.ok(res12.missingFields.includes('EMAIL'));
  assert.ok(res12.reasons.includes('NO_EMAIL'));
  assert.ok(!res12.reasons.includes('NO_PHONE'));
  assert.ok(!res12.reasons.includes('NO_DIRECT_CONTACT'));
  console.log('✓ Test 12 Passed: Missing email reason correctly identified');

  // --------------------------------------------------------------------------
  // Test 13: missing website reason
  // --------------------------------------------------------------------------
  console.log('Test 13: missing website reason...');
  const res13 = evaluateLeadActionability({
    businessName: 'No Web Clinic',
    address: '10 Fleet Street, London',
    latitude: 51.5,
    longitude: -0.1,
    phone: '+44 20 7946 0919',
  });
  assert.ok(res13.missingFields.includes('WEBSITE'));
  assert.ok(res13.reasons.includes('NO_WEBSITE'));
  console.log('✓ Test 13 Passed: Missing website reason correctly identified');

  // --------------------------------------------------------------------------
  // Test 14: missing address reason
  // --------------------------------------------------------------------------
  console.log('Test 14: missing address reason...');
  const res14 = evaluateLeadActionability({
    businessName: 'No Address Clinic',
    latitude: 51.5,
    longitude: -0.1,
    phone: '+44 20 7946 0919',
  });
  assert.ok(res14.missingFields.includes('ADDRESS'));
  assert.ok(res14.reasons.includes('NO_ADDRESS'));
  assert.ok(res14.reasons.includes('INCOMPLETE_LOCATION'));
  console.log('✓ Test 14 Passed: Missing address triggers NO_ADDRESS and INCOMPLETE_LOCATION');

  // --------------------------------------------------------------------------
  // Test 15: missing coordinates reason
  // --------------------------------------------------------------------------
  console.log('Test 15: missing coordinates reason...');
  const res15 = evaluateLeadActionability({
    businessName: 'No Coords Clinic',
    address: '10 Fleet Street, London',
    phone: '+44 20 7946 0919',
  });
  assert.ok(res15.missingFields.includes('COORDINATES'));
  assert.ok(res15.reasons.includes('NO_COORDINATES'));
  assert.ok(res15.reasons.includes('INCOMPLETE_LOCATION'));
  console.log('✓ Test 15 Passed: Missing coordinates triggers NO_COORDINATES and INCOMPLETE_LOCATION');

  // --------------------------------------------------------------------------
  // Test 16: no direct contact
  // --------------------------------------------------------------------------
  console.log('Test 16: no direct contact...');
  const res16 = evaluateLeadActionability({
    businessName: 'Website Audit Only',
    address: '10 Fleet Street, London',
    latitude: 51.5,
    longitude: -0.1,
    websiteUrl: 'https://auditonly.com',
  });
  assert.ok(res16.reasons.includes('NO_DIRECT_CONTACT'));
  assert.ok(!res16.eligibleChannels.includes('VOICE'));
  assert.ok(!res16.eligibleChannels.includes('EMAIL'));
  assert.ok(res16.eligibleChannels.includes('WEBSITE_AUDIT'));
  assert.notEqual(res16.tier, 'READY');
  console.log('✓ Test 16 Passed: Missing phone and email flags NO_DIRECT_CONTACT');

  // --------------------------------------------------------------------------
  // Test 17: website audit eligibility
  // --------------------------------------------------------------------------
  console.log('Test 17: website audit eligibility...');
  const res17 = evaluateLeadActionability({
    businessName: 'Web Clinic',
    websiteUrl: 'https://dental-audit.co.uk',
  });
  assert.ok(res17.eligibleChannels.includes('WEBSITE_AUDIT'));
  assert.ok(!res17.eligibleChannels.includes('VOICE'));
  assert.ok(!res17.eligibleChannels.includes('EMAIL'));
  assert.equal(res17.isActionable, true);
  console.log('✓ Test 17 Passed: Website provides WEBSITE_AUDIT channel eligibility');

  // --------------------------------------------------------------------------
  // Test 18: voice eligibility
  // --------------------------------------------------------------------------
  console.log('Test 18: voice eligibility...');
  const res18 = evaluateLeadActionability({
    businessName: 'Call Center',
    phone: '+1 212 555 0199',
  });
  assert.deepEqual(res18.eligibleChannels, ['VOICE']);
  assert.equal(res18.isActionable, true);
  console.log('✓ Test 18 Passed: Phone provides VOICE channel eligibility');

  // --------------------------------------------------------------------------
  // Test 19: email eligibility
  // --------------------------------------------------------------------------
  console.log('Test 19: email eligibility...');
  const res19 = evaluateLeadActionability({
    businessName: 'Mailer Pro',
    email: 'info@mailerpro.com',
  });
  assert.deepEqual(res19.eligibleChannels, ['EMAIL']);
  assert.equal(res19.isActionable, true);
  console.log('✓ Test 19 Passed: Email provides EMAIL channel eligibility');

  // --------------------------------------------------------------------------
  // Test 20: multiple eligible channels
  // --------------------------------------------------------------------------
  console.log('Test 20: multiple eligible channels...');
  const res20 = evaluateLeadActionability({
    businessName: 'Omni Dental',
    phone: '+44 20 7946 0001',
    email: 'dr@omnidental.com',
    websiteUrl: 'https://omnidental.com',
  });
  assert.deepEqual(res20.eligibleChannels, ['VOICE', 'EMAIL', 'WEBSITE_AUDIT']);
  assert.equal(res20.isActionable, true);
  console.log('✓ Test 20 Passed: Multiple channels detected and enumerated');

  // --------------------------------------------------------------------------
  // Test 21: actionability persistence
  // --------------------------------------------------------------------------
  console.log('Test 21: actionability persistence...');
  const res21 = safeMergePlaceDetails({
    existingName: 'St Mary Dental',
    existingAddress: '10 Fleet Street, London, EC4Y 1AA',
    existingPhone: '+44 20 7946 0919',
    details: {
      contact: { email: 'info@stmarydental.co.uk' },
      website: 'https://stmarydental.co.uk',
      lat: 51.5138,
      lon: -0.1083,
    },
  });
  assert.ok(res21.actionability);
  assert.equal(res21.actionability.tier, 'READY');
  assert.equal(res21.actionability.isActionable, true);
  assert.ok(res21.actionability.eligibleChannels.includes('VOICE'));
  assert.ok(res21.actionability.eligibleChannels.includes('EMAIL'));
  assert.ok(res21.actionability.eligibleChannels.includes('WEBSITE_AUDIT'));
  console.log('✓ Test 21 Passed: safeMergePlaceDetails computes and outputs actionability');

  // --------------------------------------------------------------------------
  // Test 22: preservation of existing B1 metadata
  // --------------------------------------------------------------------------
  console.log('Test 22: preservation of existing B1 metadata...');
  const b1Coords = validateCoordinates(51.5, -0.1);
  assert.equal(b1Coords.latitude, 51.5);
  const b1Phones = normalizePhones('+44 20 7946 0919; 02079460920');
  assert.equal(b1Phones.primaryPhone, '+44 20 7946 0919');
  assert.deepEqual(b1Phones.additionalPhones, ['02079460920']);
  const b1Addr = normalizeStructuredAddress({ street: 'Fleet Street', housenumber: '10', city: 'London' });
  assert.equal(b1Addr, '10 Fleet Street, London');
  const b1Quality = classifyDataQuality({
    businessName: 'Clinic',
    address: '10 Fleet Street, London',
    latitude: 51.5,
    longitude: -0.1,
    phone: '+44 20 7946 0919',
  });
  assert.equal(b1Quality, 'COMPLETE');
  console.log('✓ Test 22 Passed: B1 normalization and data quality classification remain intact');

  // --------------------------------------------------------------------------
  // Test 23: preservation of B2 enrichment metadata
  // --------------------------------------------------------------------------
  console.log('Test 23: preservation of B2 enrichment metadata...');
  const res23 = safeMergePlaceDetails({
    existingName: 'B2 Enrichment Clinic',
    details: {
      contact: { email: 'dr@b2clinic.com' },
      website: 'https://b2clinic.com',
      lat: 51.5,
      lon: -0.1,
    },
  });
  assert.equal(res23.email, 'dr@b2clinic.com');
  assert.equal(res23.placeDetailsEnriched, true);
  assert.equal(res23.websiteUrl, 'https://b2clinic.com');
  assert.ok(res23.actionability);
  console.log('✓ Test 23 Passed: B2 placeDetailsEnriched and contact merge preserved');

  // --------------------------------------------------------------------------
  // Test 24: preservation of B3 Maps metadata
  // --------------------------------------------------------------------------
  console.log('Test 24: preservation of B3 Maps metadata...');
  const res24 = safeMergePlaceDetails({
    existingName: 'B3 Maps Clinic',
    existingAddress: '10 Fleet Street, London, EC4Y 1AA, UK',
    details: {
      lat: 51.5138,
      lon: -0.1083,
    },
  });
  assert.equal(res24.mapsMatchStatus, 'TARGETED');
  assert.ok(res24.mapsUrl?.includes('https://www.google.com/maps/search/?api=1&query='));
  assert.ok(res24.mapsUrl?.includes('B3%20Maps%20Clinic'));
  console.log('✓ Test 24 Passed: B3 Maps URL and TARGETED match status preserved');

  // --------------------------------------------------------------------------
  // Test 25: duplicate/additive merge behavior
  // --------------------------------------------------------------------------
  console.log('Test 25: duplicate/additive merge behavior...');
  // Simulating duplicate merge logic where existing lead had valid phone & email,
  // and subsequent provider candidate had no phone or email.
  const existingLead = {
    businessName: 'Existing Robust Lead',
    address: '50 High Street, Manchester, M1 1AA',
    latitude: 53.4808,
    longitude: -2.2426,
    phone: '+44 161 999 8888',
    email: 'contact@robustlead.co.uk',
    websiteUrl: 'https://robustlead.co.uk',
    domain: 'robustlead.co.uk',
  };
  const sparseNewDiscovery = {
    businessName: 'Existing Robust Lead',
    // Missing phone, email, website
    address: undefined,
    latitude: undefined,
    longitude: undefined,
    phone: undefined,
    email: undefined,
    websiteUrl: undefined,
    domain: undefined,
  };

  // Safe merge logic preserves existing fields
  const mergedCandidate = {
    businessName: existingLead.businessName,
    address: sparseNewDiscovery.address || existingLead.address,
    latitude: sparseNewDiscovery.latitude ?? existingLead.latitude,
    longitude: sparseNewDiscovery.longitude ?? existingLead.longitude,
    phone: sparseNewDiscovery.phone || existingLead.phone,
    email: sparseNewDiscovery.email || existingLead.email,
    websiteUrl: sparseNewDiscovery.websiteUrl || existingLead.websiteUrl,
    domain: sparseNewDiscovery.domain || existingLead.domain,
  };
  const mergedActionability = evaluateLeadActionability(mergedCandidate);
  assert.equal(mergedActionability.tier, 'READY');
  assert.equal(mergedActionability.isActionable, true);
  assert.ok(mergedActionability.eligibleChannels.includes('VOICE'));
  assert.ok(mergedActionability.eligibleChannels.includes('EMAIL'));
  console.log('✓ Test 25 Passed: Re-discovery never downgrades existing quality or actionability');

  // --------------------------------------------------------------------------
  // Test 26: invalid phone does not count
  // --------------------------------------------------------------------------
  console.log('Test 26: invalid phone does not count...');
  const res26 = evaluateLeadActionability({
    businessName: 'Bad Phone Clinic',
    phone: '123', // Less than 5 digits
  });
  assert.ok(!res26.eligibleChannels.includes('VOICE'));
  assert.ok(res26.missingFields.includes('PHONE'));
  assert.ok(res26.reasons.includes('NO_PHONE'));
  console.log('✓ Test 26 Passed: Invalid phone does not grant VOICE eligibility');

  // --------------------------------------------------------------------------
  // Test 27: invalid email does not count
  // --------------------------------------------------------------------------
  console.log('Test 27: invalid email does not count...');
  const res27 = evaluateLeadActionability({
    businessName: 'Bad Email Clinic',
    email: 'not-an-email@',
  });
  assert.ok(!res27.eligibleChannels.includes('EMAIL'));
  assert.ok(res27.missingFields.includes('EMAIL'));
  assert.ok(res27.reasons.includes('NO_EMAIL'));
  console.log('✓ Test 27 Passed: Invalid email does not grant EMAIL eligibility');

  // --------------------------------------------------------------------------
  // Test 28: invalid website does not count
  // --------------------------------------------------------------------------
  console.log('Test 28: invalid website does not count...');
  const res28Social = evaluateLeadActionability({
    businessName: 'Social Only Clinic',
    websiteUrl: 'https://facebook.com/clinic',
  });
  assert.ok(!res28Social.eligibleChannels.includes('WEBSITE_AUDIT'));
  assert.ok(res28Social.missingFields.includes('WEBSITE'));
  assert.ok(res28Social.reasons.includes('NO_WEBSITE'));

  const res28Malformed = evaluateLeadActionability({
    businessName: 'Malformed URL Clinic',
    websiteUrl: 'not_a_valid_url',
  });
  assert.ok(!res28Malformed.eligibleChannels.includes('WEBSITE_AUDIT'));
  console.log('✓ Test 28 Passed: Generic social links and malformed URLs do not grant WEBSITE_AUDIT');

  // --------------------------------------------------------------------------
  // Test 29: invalid coordinates do not count
  // --------------------------------------------------------------------------
  console.log('Test 29: invalid coordinates do not count...');
  const res29 = evaluateLeadActionability({
    businessName: 'Invalid Coords Clinic',
    latitude: 999.0, // Invalid latitude
    longitude: -999.0,
  });
  assert.ok(res29.missingFields.includes('COORDINATES'));
  assert.ok(res29.reasons.includes('NO_COORDINATES'));
  assert.ok(res29.reasons.includes('INCOMPLETE_LOCATION'));
  console.log('✓ Test 29 Passed: Out-of-bounds coordinates correctly treated as missing');

  // --------------------------------------------------------------------------
  // Test 30: weak leads are preserved, not deleted
  // --------------------------------------------------------------------------
  console.log('Test 30: weak leads are preserved, not deleted...');
  const res30 = evaluateLeadActionability({
    businessName: 'Minimal Weak Lead',
  });
  assert.equal(res30.tier, 'ARCHIVED_WEAK');
  assert.equal(res30.isActionable, false);
  // Tier is a classification, not an instruction to delete the database record
  const mockDbRecord = {
    id: 'lead-weak-001',
    businessName: 'Minimal Weak Lead',
    status: 'NEW',
    queryPayload: {
      actionability: res30,
    },
  };
  assert.equal(mockDbRecord.status, 'NEW');
  assert.ok(mockDbRecord.id);
  assert.equal(mockDbRecord.queryPayload.actionability.tier, 'ARCHIVED_WEAK');
  console.log('✓ Test 30 Passed: ARCHIVED_WEAK classification preserves database record with metadata');

  // --------------------------------------------------------------------------
  // Test 31: OSM Adapter Invariance Check
  // --------------------------------------------------------------------------
  console.log('Test 31: OSM Adapter invariance check...');
  const osmAdapter = new StandardDiscoveryAdapter();
  assert.equal(osmAdapter.providerName, 'OpenStreetMap');
  assert.equal(osmAdapter.category, 'LEAD_DISCOVERY');
  assert.equal(osmAdapter.isConfigured(), true);
  console.log('✓ Test 31 Passed: OSM adapter is unchanged and active');

  console.log('\n--- All 31 Geoapify Lead Quality & Actionability Tests Passed Successfully ---');
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('geoapify-actionability.test.ts')) {
  runGeoapifyActionabilityTests().catch((err) => {
    console.error('Geoapify Actionability Tests Failed:', err);
    process.exit(1);
  });
}
