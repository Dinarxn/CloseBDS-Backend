import assert from 'node:assert/strict';
import { createInMemoryPrismaClient } from '../src/database/in-memory.js';
import { databaseClient } from '../src/database/client.js';
import {
  voiceAgentReadinessService,
  PROVIDER_MODELS,
  PROVIDER_VOICES,
  DEFAULT_SAFETY_GUARDRAILS,
} from '../src/modules/voice/voice-agent-readiness.service.js';
import {
  ALLOWED_AGENT_LIFECYCLE_TRANSITIONS,
  isValidAgentLifecycleTransition,
  assertValidAgentLifecycleTransition,
} from '../src/modules/voice/voice.lifecycle.js';
import { phoneNumbersService } from '../src/modules/voice/phone-numbers.service.js';
import type {
  VoiceAgentLifecycleStatus,
  VoiceAgentStudioConfig,
  CreateVoiceAgentStudioInput,
} from '../src/modules/voice/voice.types.js';

async function runVoiceAgentStudioTests() {
  databaseClient.setPrismaClient(createInMemoryPrismaClient());
  try {
  console.log('\n--- Starting closeVDS Voice Agent Studio & Lifecycle Management Tests (Milestone 4 / R4) ---');

  const testWorkspaceId = `ws_studio_test_${Date.now()}`;

  // =========================================================================
  // Test 1: Provider Model & Voice Discovery Catalogs
  // =========================================================================
  console.log('Test 1: Provider-Filtered Model and Voice Catalogs...');

  // Retell models & voices
  const retellModels = PROVIDER_MODELS.retell;
  assert.ok(retellModels.length >= 3, 'Retell must offer at least 3 models');
  assert.ok(retellModels.some((m) => m.id === 'gpt-4o-mini-realtime'), 'Must include gpt-4o-mini-realtime');
  assert.ok(retellModels.every((m) => m.provider === 'retell'), 'All Retell models must have provider=retell');

  const retellVoices = PROVIDER_VOICES.retell;
  assert.ok(retellVoices.length >= 3, 'Retell must offer at least 3 voices');
  assert.ok(retellVoices.some((v) => v.accent === 'Indian'), 'Must offer regional Indian accent voice for Hindi presets');

  // Vapi models & voices
  const vapiModels = PROVIDER_MODELS.vapi;
  assert.ok(vapiModels.some((m) => m.id === 'vapi-gpt-4o-realtime'), 'Must include vapi-gpt-4o-realtime');
  assert.ok(vapiModels.every((m) => m.provider === 'vapi'), 'All Vapi models must have provider=vapi');

  // Mock engine models & voices
  const mockModels = PROVIDER_MODELS.mock;
  assert.ok(mockModels.length >= 2, 'Mock must offer offline test models');
  assert.equal(mockModels[0].isDefault, true);

  console.log('✓ Provider model and voice discovery catalogs verified');

  // =========================================================================
  // Test 2: Lifecycle State Machine Transitions & Invariant Enforcement
  // =========================================================================
  console.log('Test 2: Lifecycle State Machine Transition Matrix & Invariants...');

  // 2a. Verify transition matrix entries
  const expectedStatuses: VoiceAgentLifecycleStatus[] = [
    'DRAFT',
    'INCOMPLETE',
    'READY_FOR_TEST',
    'TESTED',
    'ACTIVE',
    'PAUSED',
    'ERROR',
  ];

  for (const status of expectedStatuses) {
    assert.ok(ALLOWED_AGENT_LIFECYCLE_TRANSITIONS[status] !== undefined, `Status ${status} must exist in matrix`);
  }

  // 2b. Verify valid transitions
  assert.equal(isValidAgentLifecycleTransition('DRAFT', 'READY_FOR_TEST'), true);
  assert.equal(isValidAgentLifecycleTransition('DRAFT', 'INCOMPLETE'), true);
  assert.equal(isValidAgentLifecycleTransition('READY_FOR_TEST', 'TESTED'), true);
  assert.equal(isValidAgentLifecycleTransition('TESTED', 'ACTIVE'), true);
  assert.equal(isValidAgentLifecycleTransition('ACTIVE', 'PAUSED'), true);
  assert.equal(isValidAgentLifecycleTransition('PAUSED', 'ACTIVE'), true);

  // 2c. Verify idempotent self-transitions
  assert.equal(isValidAgentLifecycleTransition('DRAFT', 'DRAFT'), true);
  assert.equal(isValidAgentLifecycleTransition('TESTED', 'TESTED'), true);
  assert.equal(isValidAgentLifecycleTransition('ACTIVE', 'ACTIVE'), true);

  // 2d. Verify ILLEGAL transitions: Direct activation bypass is STRICTLY prohibited!
  assert.equal(isValidAgentLifecycleTransition('DRAFT', 'ACTIVE'), false, 'DRAFT -> ACTIVE is prohibited');
  assert.equal(isValidAgentLifecycleTransition('INCOMPLETE', 'ACTIVE'), false, 'INCOMPLETE -> ACTIVE is prohibited');
  assert.equal(isValidAgentLifecycleTransition('READY_FOR_TEST', 'ACTIVE'), false, 'READY_FOR_TEST -> ACTIVE is prohibited without TESTED');

  assert.throws(
    () => assertValidAgentLifecycleTransition('DRAFT', 'ACTIVE'),
    /Invalid voice agent lifecycle transition from 'DRAFT' to 'ACTIVE'/,
    'Must throw BadRequestError on illegal direct activation'
  );

  console.log('✓ Lifecycle state machine matrix and invalid transition prevention verified');

  // =========================================================================
  // Test 3: Phone Number Registration for Studio Tests
  // =========================================================================
  console.log('Test 3: Phone Number Setup & Capabilities Verification...');

  const voiceNumber = await phoneNumbersService.importPhoneNumber(testWorkspaceId, {
    phoneNumber: '+15125550188',
    friendlyName: 'Studio Carrier Line 1',
  });
  assert.equal(voiceNumber.capabilities.voice, true, 'Imported number must support voice');

  const voiceNumber2 = await phoneNumbersService.importPhoneNumber(testWorkspaceId, {
    phoneNumber: '+15125550199',
    friendlyName: 'Studio Carrier Line 2',
  });
  assert.equal(voiceNumber2.capabilities.voice, true);

  console.log('✓ Carrier phone numbers registered and capability verified');

  // =========================================================================
  // Test 4: Guided 11-Step Studio Agent Creation & Deserialization
  // =========================================================================
  console.log('Test 4: Complete 11-Step Studio Agent Creation & Configuration...');

  const validObjective =
    'Introduce closeVDS sovereign outbound voice capabilities to practice decision makers, discover booking dropoff, and schedule an operational audit.';
  assert.ok(validObjective.length > 50, 'Test objective must exceed 50 chars');

  const createInput: CreateVoiceAgentStudioInput = {
    name: 'Sarah - Healthcare Intake Director',
    provider: 'retell',
    modelId: 'gpt-4o-mini-realtime',
    voiceId: 'retell-eleven-sarah',
    callObjective: validObjective,
    openingScript: 'Hi, this is Sarah with CloseVDS. Am I speaking with the clinical operations director?',
    agentPersona: 'Empathetic, efficient, and clinically compliant specialist',
    speakingStyle: 'Professional, calm, and articulate',
    approvedTalkingPoints: [
      '24/7 automated booking ingestion without front-desk staff burnout',
      'Integration with EHR appointment calendars and SMS reminders',
      'Factual grounding guarantees zero fabricated pricing or doctor credentials',
    ],
    knowledgePoints: [
      {
        id: 'kp-1',
        category: 'Compliance',
        title: 'HIPAA & Consent',
        content: 'Consent obtained at call start; calls recorded under workspace consent policy.',
        isMandatory: true,
      },
    ],
    prohibitedClaims: [
      'Never guarantee specific patient volume or diagnostic outcomes',
      'Never offer unapproved fee discounts',
    ],
    objectionRules: [
      {
        id: 'obj-1',
        category: 'Timing',
        triggerPhrases: ['We are too busy', 'Call back next month'],
        responseGuidance: 'Acknowledge clinic load, offer a 3-minute executive summary via email or off-peak slot.',
        priority: 1,
      },
    ],
    qualificationQuestions: [
      'Are you currently accepting new outpatient consultations?',
      'Do you use an automated system for after-hours patient intake?',
    ],
    structuredQuestions: [
      {
        id: 'q-1',
        questionText: 'Are you currently accepting new outpatient consultations?',
        required: true,
        expectedAnswerType: 'BOOLEAN',
      },
    ],
    assignedPhoneNumberId: voiceNumber.id,
    safety: {
      ...DEFAULT_SAFETY_GUARDRAILS,
      maxDurationSeconds: 420,
      optOutKeywords: ['stop', 'unsubscribe', 'do not call', 'remove me'],
      emergencyKillSwitch: true,
    },
    escalationConditions: [
      'Caller requests human physician',
      'Caller reports clinical emergency',
    ],
    fallbackBehavior: 'Immediately offer operator transfer or disconnect gracefully',
  };

  const agent = await voiceAgentReadinessService.createAgentStudio(testWorkspaceId, createInput, 'user-admin');

  assert.ok(agent.id, 'Agent ID must be generated');
  assert.equal(agent.name, 'Sarah - Healthcare Intake Director');
  assert.equal(agent.status, 'DRAFT', 'Initial agent status must be DRAFT');
  assert.equal(agent.provider, 'retell');
  assert.equal(agent.modelId, 'gpt-4o-mini-realtime');
  assert.equal(agent.voiceId, 'retell-eleven-sarah');
  assert.equal(agent.assignedPhoneNumberId, voiceNumber.id);
  assert.equal(agent.safety.maxDurationSeconds, 420);
  assert.equal(agent.approvedTalkingPoints.length, 3);
  assert.equal(agent.objectionRules.length, 1);
  assert.equal(agent.qualificationQuestions.length, 2);

  console.log('✓ 11-Step Studio Agent created and deserialized with full configuration');

  // =========================================================================
  // Test 5: Pre-Activation Readiness Gate Audit
  // =========================================================================
  console.log('Test 5: Pre-Activation Readiness Gate Evaluation...');

  // 5a. Initial Draft State: Readiness report should indicate canActivate === false because not yet tested!
  const draftReport = await voiceAgentReadinessService.evaluateReadiness(agent, testWorkspaceId);
  assert.equal(draftReport.checks.length, 11, 'Readiness report must evaluate all 11 steps');
  assert.equal(draftReport.canActivate, false, 'DRAFT agent cannot activate without test call');
  assert.ok(
    draftReport.blockers.some((b) => b.includes('Step 10')),
    'Must block activation until test call is verified'
  );

  // 5b. Check Prompt Length Hard Constraint (> 50 chars)
  const shortPromptAgent: VoiceAgentStudioConfig = {
    ...agent,
    id: 'test-short-prompt',
    callObjective: 'Too short objective.', // 20 chars
  };
  const shortReport = await voiceAgentReadinessService.evaluateReadiness(shortPromptAgent, testWorkspaceId);
  const step4 = shortReport.checks.find((c) => c.stepNumber === 4);
  assert.equal(step4?.passed, false, 'Step 4 must fail if objective <= 50 chars');
  assert.ok(
    shortReport.blockers.some((b) => b.includes('50 characters')),
    'Blockers must cite 50 character minimum threshold'
  );

  // 5c. Check Qualification Questions Constraint
  const noQuestionsAgent: VoiceAgentStudioConfig = {
    ...agent,
    id: 'test-no-questions',
    qualificationQuestions: [],
    structuredQuestions: [],
  };
  const noQReport = await voiceAgentReadinessService.evaluateReadiness(noQuestionsAgent, testWorkspaceId);
  const step7 = noQReport.checks.find((c) => c.stepNumber === 7);
  assert.equal(step7?.passed, false, 'Step 7 must fail if zero qualification questions');

  // 5d. Check Safety Guardrails Constraint
  const noSafetyAgent: VoiceAgentStudioConfig = {
    ...agent,
    id: 'test-no-safety',
    safety: {
      ...DEFAULT_SAFETY_GUARDRAILS,
      maxDurationSeconds: 10, // Invalid (< 30s)
      optOutKeywords: [],
    },
    escalationConditions: [],
  };
  const noSafetyReport = await voiceAgentReadinessService.evaluateReadiness(noSafetyAgent, testWorkspaceId);
  const step9 = noSafetyReport.checks.find((c) => c.stepNumber === 9);
  assert.equal(step9?.passed, false, 'Step 9 must fail if safety guardrails missing or duration invalid');

  console.log('✓ Pre-activation readiness report rules, thresholds, and blockers verified');

  // =========================================================================
  // Test 6: Provider-Agent-Number Compatibility Engine
  // =========================================================================
  console.log('Test 6: Provider-Agent-Number Compatibility Engine...');

  // 6a. Valid number compatibility
  const compatResult = await voiceAgentReadinessService.validateNumberCompatibility(
    testWorkspaceId,
    voiceNumber.id,
    agent.id
  );
  assert.equal(compatResult.compatible, true, 'Registered voice number must be compatible');

  // 6b. Non-existent number ID
  const invalidResult = await voiceAgentReadinessService.validateNumberCompatibility(
    testWorkspaceId,
    'num_does_not_exist',
    agent.id
  );
  assert.equal(invalidResult.compatible, false);
  assert.ok(invalidResult.reason?.includes('not registered'));

  console.log('✓ Provider-Agent-Number compatibility engine verified');

  // =========================================================================
  // Test 7: Diagnostic Test Call Execution & State Progression (TESTED)
  // =========================================================================
  console.log('Test 7: Diagnostic Test Call Simulation & Progression to TESTED...');

  // Advance from DRAFT to READY_FOR_TEST first
  await voiceAgentReadinessService.transitionStatus(agent.id, testWorkspaceId, 'READY_FOR_TEST');
  const readyAgent = await voiceAgentReadinessService.getAgentStudio(agent.id, testWorkspaceId);
  assert.equal(readyAgent.status, 'READY_FOR_TEST');

  // Run test call
  const testRunResult = await voiceAgentReadinessService.simulateTestCall(agent.id, testWorkspaceId, {
    testPhoneNumber: '+15125550188',
  });

  assert.equal(testRunResult.success, true);
  assert.equal(testRunResult.status, 'TESTED');
  assert.ok(testRunResult.diagnosticLogs.length >= 6);
  assert.ok(testRunResult.testedAt);

  // Verify agent state is now TESTED
  const testedAgent = await voiceAgentReadinessService.getAgentStudio(agent.id, testWorkspaceId);
  assert.equal(testedAgent.status, 'TESTED', 'Agent status must progress to TESTED');
  assert.ok(testedAgent.lastTestedAt);

  // Evaluate readiness now that it is TESTED
  const testedReport = await voiceAgentReadinessService.evaluateReadiness(testedAgent, testWorkspaceId);
  if (!testedReport.checks.every((c) => c.passed)) {
    console.log('Failed checks:', testedReport.checks.filter((c) => !c.passed));
    console.log('Blockers:', testedReport.blockers);
  }
  assert.equal(testedReport.checks.every((c) => c.passed), true, 'All 11 checks must pass');
  assert.equal(testedReport.blockers.length, 0, 'Zero blockers');
  assert.equal(testedReport.canActivate, true, 'Agent is now eligible for activation');

  console.log('✓ Diagnostic test call executed, diagnostics captured, and status advanced to TESTED');

  // =========================================================================
  // Test 8: Pre-Activation Gate Enforcement & Activation
  // =========================================================================
  console.log('Test 8: Pre-Activation Gate Enforcement & Activation...');

  // 8a. Activation requires passing readiness check
  const activationResult = await voiceAgentReadinessService.transitionStatus(
    agent.id,
    testWorkspaceId,
    'ACTIVE',
    'user-admin'
  );

  assert.equal(activationResult.agent.status, 'ACTIVE', 'Agent must transition to ACTIVE');
  assert.ok(activationResult.readinessReport?.canActivate);

  // 8b. Active Number Collision Prevention:
  // Create a second agent and attempt to activate it with the SAME phone number!
  const agent2 = await voiceAgentReadinessService.createAgentStudio(
    testWorkspaceId,
    {
      ...createInput,
      name: 'Duplicate Number Candidate Agent',
      assignedPhoneNumberId: voiceNumber.id, // SAME NUMBER as active agent!
    },
    'user-admin'
  );

  // Advance agent2 to TESTED
  await voiceAgentReadinessService.simulateTestCall(agent2.id, testWorkspaceId);

  // Attempting to activate agent2 with same number must be blocked!
  await assert.rejects(
    async () => {
      await voiceAgentReadinessService.transitionStatus(agent2.id, testWorkspaceId, 'ACTIVE', 'user-admin');
    },
    (err: any) => {
      assert.ok(
        err.message.includes('Cannot assign to multiple active agents') ||
          err.message.includes('already actively assigned'),
        `Expected collision blocker error, got: ${err.message}`
      );
      return true;
    },
    'Activation must be rejected due to duplicate active number collision'
  );

  // 8c. Pause active agent
  const pauseResult = await voiceAgentReadinessService.transitionStatus(
    agent.id,
    testWorkspaceId,
    'PAUSED',
    'user-admin'
  );
  assert.equal(pauseResult.agent.status, 'PAUSED', 'Agent status must transition to PAUSED');

  // 8d. Resume paused agent back to ACTIVE
  const resumeResult = await voiceAgentReadinessService.transitionStatus(
    agent.id,
    testWorkspaceId,
    'ACTIVE',
    'user-admin'
  );
  assert.equal(resumeResult.agent.status, 'ACTIVE', 'Paused agent must resume to ACTIVE');

  console.log('✓ Activation gate enforcement, number collision prevention, pause, and resume verified');

  console.log('\n--- All CloseVDS Voice Agent Studio & Lifecycle Management Tests Passed Successfully! ---');
  } finally {
    databaseClient.setPrismaClient(null);
  }
}

runVoiceAgentStudioTests().catch((err) => {
  console.error('\n❌ Voice Agent Studio Tests Failed:', err);
  process.exit(1);
});
