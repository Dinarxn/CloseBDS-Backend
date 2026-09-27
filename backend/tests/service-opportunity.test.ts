import assert from 'node:assert/strict';
import {
  evaluateServiceOpportunity,
  type ServiceOpportunityInput,
} from '../src/modules/qualification/index.js';

async function runServiceOpportunityEngineTests() {
  console.log('\n--- Starting closeVDS Service Opportunity Engine Tests (Phase A1) ---');

  // ==============================================================================
  // Test 1: No website -> YES, Website Design / Development
  // ==============================================================================
  console.log('Test 1: Lead with no website...');
  const noSiteResult1 = evaluateServiceOpportunity({
    domain: null,
    hasWebsite: false,
  });
  assert.equal(noSiteResult1.hasOpportunity, true);
  assert.equal(noSiteResult1.serviceOpportunity, 'YES');
  assert.equal(noSiteResult1.recommendedService, 'Website Design / Development');
  assert.equal(noSiteResult1.reason, 'No business website found.');
  assert.equal(noSiteResult1.evidence, 'No business website found.');

  // Test 1b: Domain is empty string
  const noSiteResult2 = evaluateServiceOpportunity({
    domain: '   ',
  });
  assert.equal(noSiteResult2.hasOpportunity, true);
  assert.equal(noSiteResult2.serviceOpportunity, 'YES');
  assert.equal(noSiteResult2.recommendedService, 'Website Design / Development');

  // Test 1c: Domain is placeholder
  const noSiteResult3 = evaluateServiceOpportunity({
    domain: 'unknown-domain.com',
  });
  assert.equal(noSiteResult3.hasOpportunity, true);
  assert.equal(noSiteResult3.serviceOpportunity, 'YES');
  assert.equal(noSiteResult3.recommendedService, 'Website Design / Development');

  console.log('✓ Test 1: No website correctly recommends Website Design / Development');

  // ==============================================================================
  // Test 2: Concrete manual/repetitive workflow evidence -> YES, AI Automation
  // ==============================================================================
  console.log('Test 2: Concrete manual/repetitive workflow evidence...');
  const workflowInput: ServiceOpportunityInput = {
    domain: 'bakerstreetdental.co.uk',
    workflowEvidence: ['manual appointment follow-up process causing 2-day response lag'],
  };
  const workflowResult = evaluateServiceOpportunity(workflowInput);
  assert.equal(workflowResult.hasOpportunity, true);
  assert.equal(workflowResult.serviceOpportunity, 'YES');
  assert.equal(workflowResult.recommendedService, 'AI Automation');
  assert.ok(workflowResult.reason.includes('manual appointment follow-up'));
  assert.equal(workflowResult.evidence, 'manual appointment follow-up process causing 2-day response lag');

  // Test 2b: From auditGaps
  const auditGapInput: ServiceOpportunityInput = {
    domain: 'apexlaw.com',
    websiteAudit: {
      auditGaps: ['manual customer inquiry handling via generic inbox without automated ticketing'],
    },
  };
  const auditGapResult = evaluateServiceOpportunity(auditGapInput);
  assert.equal(auditGapResult.hasOpportunity, true);
  assert.equal(auditGapResult.serviceOpportunity, 'YES');
  assert.equal(auditGapResult.recommendedService, 'AI Automation');
  assert.equal(auditGapResult.evidence, 'manual customer inquiry handling via generic inbox without automated ticketing');

  console.log('✓ Test 2: Concrete automation evidence correctly recommends AI Automation');

  // ==============================================================================
  // Test 3: Concrete customer acquisition evidence -> YES, Customer Acquisition System
  // ==============================================================================
  console.log('Test 3: Concrete customer acquisition evidence...');
  const acquisitionInput: ServiceOpportunityInput = {
    domain: 'cityphysio.co.uk',
    acquisitionEvidence: ['low customer inquiry volume with no consistent lead generation channel'],
  };
  const acquisitionResult = evaluateServiceOpportunity(acquisitionInput);
  assert.equal(acquisitionResult.hasOpportunity, true);
  assert.equal(acquisitionResult.serviceOpportunity, 'YES');
  assert.equal(acquisitionResult.recommendedService, 'Customer Acquisition System');
  assert.ok(acquisitionResult.reason.includes('low customer inquiry volume'));
  assert.equal(acquisitionResult.evidence, 'low customer inquiry volume with no consistent lead generation channel');

  console.log('✓ Test 3: Concrete acquisition evidence correctly recommends Customer Acquisition System');

  // ==============================================================================
  // Test 4: Insufficient evidence -> NONE, NONE
  // ==============================================================================
  console.log('Test 4: Insufficient evidence...');
  const emptyInput: ServiceOpportunityInput = {
    domain: 'establishedclinic.com',
    observations: [],
    workflowEvidence: [],
    acquisitionEvidence: [],
  };
  const emptyResult = evaluateServiceOpportunity(emptyInput);
  assert.equal(emptyResult.hasOpportunity, false);
  assert.equal(emptyResult.serviceOpportunity, 'NONE');
  assert.equal(emptyResult.recommendedService, 'NONE');
  assert.equal(emptyResult.reason, 'Not enough evidence for a specific service opportunity.');
  assert.equal(emptyResult.evidence, 'Insufficient evidence.');

  console.log('✓ Test 4: Insufficient evidence returns NONE / NONE');

  // ==============================================================================
  // Test 5: Functioning website + no opportunity -> NONE, NONE
  // ==============================================================================
  console.log('Test 5: Functioning website with no operational bottleneck...');
  const functioningInput: ServiceOpportunityInput = {
    domain: 'premierhospital.org',
    websiteAudit: {
      mobileOptimized: true,
      bookingCtaVisible: true,
      auditGaps: ['SSL certificate renews in 60 days'],
    },
  };
  const functioningResult = evaluateServiceOpportunity(functioningInput);
  assert.equal(functioningResult.hasOpportunity, false);
  assert.equal(functioningResult.serviceOpportunity, 'NONE');
  assert.equal(functioningResult.recommendedService, 'NONE');

  console.log('✓ Test 5: Functioning website with no opportunity returns NONE / NONE');

  // ==============================================================================
  // Test 6: Generic / weak evidence must NOT trigger AI Automation
  // ==============================================================================
  console.log('Test 6: Generic/weak evidence rejection...');
  const weakInputs = [
    'business exists',
    'growing company',
    'potential for technology',
    'could be improved',
    'good business',
    'high rating',
    'standard local business',
  ];

  for (const weakText of weakInputs) {
    const res = evaluateServiceOpportunity({
      domain: 'somelocalbiz.co.uk',
      observations: [weakText],
    });
    assert.notEqual(
      res.recommendedService,
      'AI Automation',
      `Generic phrase "${weakText}" must NOT trigger AI Automation`
    );
    assert.equal(res.serviceOpportunity, 'NONE');
    assert.equal(res.recommendedService, 'NONE');
  }

  console.log('✓ Test 6: Generic/weak evidence strictly rejected from triggering AI Automation');

  // ==============================================================================
  // Test 7: Positive recommendation must contain non-empty reason + evidence
  // ==============================================================================
  console.log('Test 7: Verification that positive recommendations include reason and evidence...');
  const positiveCases: ServiceOpportunityInput[] = [
    { domain: null },
    { domain: 'testsite.com', workflowEvidence: ['repetitive data entry required across multiple portals'] },
    { domain: 'testsite2.com', acquisitionEvidence: ['missing customer acquisition system for private consultations'] },
  ];

  for (const testCase of positiveCases) {
    const res = evaluateServiceOpportunity(testCase);
    assert.equal(res.hasOpportunity, true);
    assert.equal(res.serviceOpportunity, 'YES');
    assert.ok(res.reason && res.reason.trim().length > 0, 'Reason must be non-empty string');
    assert.ok(res.evidence && res.evidence.trim().length > 0, 'Evidence must be non-empty string');
  }

  console.log('✓ Test 7: All positive recommendations contain valid reason and evidence');

  // ==============================================================================
  // Test 8: Evaluator must not invent evidence
  // ==============================================================================
  console.log('Test 8: Evaluator does not invent evidence...');
  const verifiableEvidence = 'clearly documented repetitive operational task: staff spends 4 hours daily copying leads from email to CRM';
  const groundedInput: ServiceOpportunityInput = {
    domain: 'groundedbiz.com',
    workflowEvidence: [verifiableEvidence],
  };
  const groundedResult = evaluateServiceOpportunity(groundedInput);
  assert.equal(groundedResult.evidence, verifiableEvidence, 'Evidence must match input observation verbatim');

  console.log('✓ Test 8: Evaluator preserves verbatim grounding without fabricating evidence');

  console.log('\n--- ALL A1 SERVICE OPPORTUNITY TESTS PASSED ---\n');
}

runServiceOpportunityEngineTests().catch((err) => {
  console.error('Service Opportunity Test Failed:', err);
  process.exit(1);
});
