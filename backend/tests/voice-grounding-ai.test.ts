import assert from 'node:assert/strict';
import { StandardVoiceAIAdapter } from '../src/integrations/voice-ai/voice-ai.adapter.js';
import type { VoiceTurn, GroundedLeadData } from '../src/integrations/voice-ai/index.js';

async function runVoiceGroundingAITests() {
  console.log('\n--- Starting closeVDS Voice AI Grounding & Anti-Hallucination Tests ---');

  const voiceAI = new StandardVoiceAIAdapter({
    apiKey: 'mock_openai_or_groq_key_for_testing',
  });

  // =========================================================================
  // Test 1: Grounded Context Synthesis & Strict Partitioning
  // =========================================================================
  console.log('Test 1: Grounded Context Synthesis & Strict Partitioning...');

  const leadData: GroundedLeadData = {
    leadId: 'lead_smile_123',
    businessName: 'Austin Smile Design',
    domain: 'austinsmiledesign.com',
    phone: '+15125550188',
    address: '400 Congress Ave, Austin, TX',
    contactName: 'Dr. Sarah Connor',
    contactTitle: 'Lead Prosthodontist',
    auditGaps: [
      'Observed 4.2-second mobile load time on appointment booking page',
      'Missing SSL on the mobile booking subdomain',
    ],
    campaignNiche: 'Dental Clinic',
    campaignOffer: 'Comprehensive Patient Retention System',
    qualificationScore: 88,
    qualificationRationale: 'High-ticket practice with critical online booking conversion leaks',
  };

  const agentConfig = {
    callObjective: 'Verify patient inquiry drop-off and schedule brief diagnostic review',
    approvedTalkingPoints: [
      'Observed 4.2-second mobile load time on appointment page',
      'Missing SSL on the mobile booking subdomain',
    ],
    prohibitedClaims: [
      'Guaranteed 10x ROI',
      'Never claim to be Google or Dentrix representatives',
      'Do not quote specific dollar pricing on the phone',
    ],
  };

  const groundedContext = voiceAI.generateGroundedContext(leadData, agentConfig);

  // 1a. Verified Facts assertions
  assert.equal(groundedContext.verifiedFacts.businessName, 'Austin Smile Design');
  assert.equal(groundedContext.verifiedFacts.contactPerson, 'Dr. Sarah Connor');
  assert.equal(groundedContext.verifiedFacts.websiteUrl, 'austinsmiledesign.com');
  assert.equal(groundedContext.verifiedFacts.contactRole, 'Lead Prosthodontist');
  assert.equal(groundedContext.verifiedFacts.relevanceScore, '88/100');

  // 1b. Observed Website Gaps assertions
  assert.ok(groundedContext.observedWebsiteGaps.length >= 2);
  const gapsString = groundedContext.observedWebsiteGaps.join(' ');
  assert.match(gapsString, /load time/i);
  assert.match(gapsString, /SSL/i);

  // 1c. Offer & Strict Boundaries
  assert.equal(groundedContext.campaignOffer, 'Comprehensive Patient Retention System');
  assert.ok(agentConfig.prohibitedClaims.every((claim) => groundedContext.prohibitedClaims.includes(claim)));
  assert.ok(groundedContext.prohibitedClaims.some((c) => c.includes('fabricate reviews')));
  assert.deepEqual(groundedContext.approvedTalkingPoints, agentConfig.approvedTalkingPoints);

  // 1d. Unknown Fields Isolation (Anti-Hallucination)
  assert.ok(groundedContext.unknownFields.length > 0);
  assert.ok(groundedContext.unknownFields.includes('pricing_quotes'));
  assert.ok(groundedContext.unknownFields.includes('competitor_comparisons'));

  console.log('✓ Grounded Context correctly partitioned facts and prohibited ungrounded assertions');

  // =========================================================================
  // Test 2: In-Call Turn Generation with Anti-Hallucination Guardrails
  // =========================================================================
  console.log('Test 2: In-Call Turn Generation with Anti-Hallucination Guardrails...');

  const session = await voiceAI.createVoiceSession('call_test_sess_1', groundedContext);
  assert.equal(session.status, 'ACTIVE');
  assert.equal(session.callId, 'call_test_sess_1');

  // Turn 1: Normal conversation
  const turn1: VoiceTurn = {
    turnIndex: 0,
    speaker: 'lead',
    text: 'Hello, what is this regarding?',
  };
  const response1 = await voiceAI.handleTurn(session, turn1);
  assert.ok(response1.textResponse.length > 0);
  assert.equal(response1.shouldEndCall, false);

  // Turn 2: Explicit Opt-Out / Do Not Call Request
  const turnOptOut: VoiceTurn = {
    turnIndex: 1,
    speaker: 'lead',
    text: 'Please stop calling me! Put me on your do not call list immediately.',
  };
  const responseOptOut = await voiceAI.handleTurn(session, turnOptOut);
  assert.equal(responseOptOut.shouldEndCall, true);
  assert.match(responseOptOut.textResponse, /remove|apologize|list/i);

  console.log('✓ In-call turn generator correctly detected opt-outs and triggered shouldEndCall');

  // =========================================================================
  // Test 3: Grounded Outcome Classification & Summarization
  // =========================================================================
  console.log('Test 3: Grounded Outcome Classification & Summarization...');

  // 3a. Opt-Out Classification
  const optOutTurns: VoiceTurn[] = [
    { turnIndex: 0, speaker: 'agent', text: 'Hello, Dr. Connor?' },
    { turnIndex: 1, speaker: 'lead', text: 'Take me off your list and do not call again.' },
    { turnIndex: 2, speaker: 'agent', text: 'Understood, removing your number now.' },
  ];
  const optOutResult = await voiceAI.classifyOutcome(optOutTurns);

  assert.equal(optOutResult.outcome, 'OPTED_OUT');
  assert.equal(optOutResult.optOutDetected, true);
  assert.equal(optOutResult.interestLevel, 'NONE');
  assert.equal(optOutResult.sentiment, 'NEGATIVE');

  // 3b. Meeting Booked Classification
  const meetingTurns: VoiceTurn[] = [
    { turnIndex: 0, speaker: 'agent', text: 'Hi Dr. Connor' },
    { turnIndex: 1, speaker: 'lead', text: 'Yes, let us schedule a meeting for Friday morning at 10am.' },
    { turnIndex: 2, speaker: 'agent', text: 'Great, I will send the calendar invite.' },
  ];
  const meetingResult = await voiceAI.classifyOutcome(meetingTurns);

  assert.equal(meetingResult.outcome, 'MEETING_REQUESTED');
  assert.equal(meetingResult.optOutDetected, false);
  assert.equal(meetingResult.interestLevel, 'HIGH');
  assert.equal(meetingResult.sentiment, 'POSITIVE');

  // 3c. Callback Requested Classification
  const callbackTurns: VoiceTurn[] = [
    { turnIndex: 0, speaker: 'agent', text: 'Hi Dr. Connor' },
    { turnIndex: 1, speaker: 'lead', text: 'I am with a patient right now, please call me back tomorrow afternoon.' },
    { turnIndex: 2, speaker: 'agent', text: 'Understood, I will call you back tomorrow.' },
  ];
  const callbackResult = await voiceAI.classifyOutcome(callbackTurns);

  assert.equal(callbackResult.outcome, 'CALLBACK_REQUESTED');
  assert.equal(callbackResult.optOutDetected, false);
  assert.equal(callbackResult.interestLevel, 'MEDIUM');

  // 3d. Summary Extraction
  const summary = await voiceAI.summarizeCall(meetingTurns, 95);

  assert.ok(summary.summary.length > 10);
  assert.ok(Array.isArray(summary.keyPoints));
  assert.ok(Array.isArray(summary.objectionsRaised));
  assert.equal(summary.sentiment, 'POSITIVE');

  console.log('✓ Outcome classification and structured summary extraction verified');

  console.log('--- All Voice AI Grounding Tests Passed Successfully ---\n');
}

runVoiceGroundingAITests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
