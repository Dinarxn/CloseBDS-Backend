/// <reference types="node" />
import assert from 'node:assert/strict';
import process from 'node:process';
import dotenv from 'dotenv';
import { databaseClient } from '../src/database/client.js';
import { leadAgentAiTestGraph } from '../src/agents/graphs/lead-agent-ai-test.graph.js';
import {
  generatePersonalizedMessage,
  qualityCheckMessage,
} from '../src/agents/nodes/lead-agent-ai.nodes.js';
import type { LeadAgentState } from '../src/agents/state/lead-agent.state.js';
import type { PrismaClient, Lead, Contact } from '@prisma/client';

// Load environment configuration
dotenv.config();

async function runLangGraphPersonalizationQcTests() {
  console.log('--- Starting LangGraph Steps 12 & 13: Personalization & Quality Control Tests ---');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    console.error('Test Result: GEMINI_API_KEY is missing');
    throw new Error('GEMINI_API_KEY is missing');
  }

  // In-memory test stores
  const testLeads = new Map<string, Lead>();
  const testContacts = new Map<string, Contact>();

  const authorizedWorkspaceId = 'workspace_dentistry_002';
  const testLeadId = 'lead_chicago_dental_002';

  const qualifiedLead: Lead = {
    id: testLeadId,
    workspaceId: authorizedWorkspaceId,
    campaignId: null,
    businessName: 'Lakeshore Family Dentistry',
    domain: 'lakeshoredental.example.com',
    phone: '+1-312-555-0244',
    address: '840 N Michigan Ave, Chicago, IL 60611',
    status: 'NEW',
    createdAt: new Date('2026-09-02T09:00:00Z'),
    updatedAt: new Date('2026-09-02T09:00:00Z'),
  };
  testLeads.set(testLeadId, { ...qualifiedLead });

  const leadContact: Contact = {
    id: 'contact_marcus_002',
    leadId: testLeadId,
    fullName: 'Dr. Marcus Vance',
    email: 'marcus@lakeshoredental.example.com',
    title: 'Clinic Director & Principal Dentist',
    phone: '+1-312-555-0244',
    isPrimary: true,
    createdAt: new Date('2026-09-02T09:00:00Z'),
    updatedAt: new Date('2026-09-02T09:00:00Z'),
  };
  testContacts.set(leadContact.id, { ...leadContact });

  let mutationCount = 0;
  const mockPrisma = {
    lead: {
      findFirst: async ({ where }: { where: { id?: string; workspaceId?: string } }) => {
        for (const lead of testLeads.values()) {
          const matchId = !where.id || lead.id === where.id;
          const matchWs = !where.workspaceId || lead.workspaceId === where.workspaceId;
          if (matchId && matchWs) {
            const contacts = Array.from(testContacts.values()).filter((c) => c.leadId === lead.id);
            return { ...lead, contacts };
          }
        }
        return null;
      },
      update: async () => {
        mutationCount++;
        throw new Error('Read-only workflow violation: lead update is not permitted');
      },
    },
    contact: {
      findMany: async ({ where }: { where: { leadId: string } }) => {
        return Array.from(testContacts.values()).filter((c) => c.leadId === where.leadId);
      },
    },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(mockPrisma),
  } as unknown as PrismaClient;

  databaseClient.setPrismaClient(mockPrisma);

  // ==============================================================================
  // A. POSITIVE REAL AI INTEGRATION TEST (Real Gemini: Message Gen + Quality Control)
  // ==============================================================================
  console.log('\n[Positive Integration Test] Invoking leadAgentAiTestGraph through Steps 12 & 13...');
  console.log(
    'Flow: START -> loadLeadContext -> runGeminiAgent -> qualifyLead -> validateAIDecision -> generatePersonalizedMessage -> qualityCheckMessage -> END'
  );

  const initialInput = {
    leadId: testLeadId,
    workspaceId: authorizedWorkspaceId,
    message: '',
    status: 'pending',
    currentStep: 'initialization',
  };

  const result = await leadAgentAiTestGraph.invoke(initialInput);

  console.log('Positive execution completed. Result:', result);
  console.log('Verifying assertions...');

  // 1. Context and status checks
  assert.strictEqual(result.leadId, testLeadId);
  assert.strictEqual(result.workspaceId, authorizedWorkspaceId);
  assert.ok(result.leadContext, 'result.leadContext must exist');
  assert.ok(result.aiResult, 'result.aiResult must exist');
  assert.ok(result.qualification, 'result.qualification must exist');

  // If the lead was qualified, verify Steps 12 and 13
  if (result.qualification.qualified) {
    assert.ok(
      result.status === 'completed' || result.status === 'awaiting_approval',
      'Result status must be completed or awaiting_approval'
    );
    assert.ok(
      result.currentStep === 'quality_check_passed' ||
        result.currentStep === 'human_approval_pending' ||
        result.currentStep === 'human_approval_granted',
      `Pipeline must complete a valid lifecycle step, received: ${result.currentStep}`
    );

    // Step 12: Personalized message verified
    assert.ok(result.personalizedMessage, 'result.personalizedMessage must exist');
    assert.strictEqual(typeof result.personalizedMessage.body, 'string');
    assert.ok(result.personalizedMessage.body.length > 20, 'Message body must be non-trivial');
    console.log('✓ Step 12: Personalized outreach draft generated:\n', result.personalizedMessage);

    // Step 13: Quality control audit verified
    assert.ok(result.qualityCheck, 'result.qualityCheck must exist');
    assert.strictEqual(typeof result.qualityCheck.passed, 'boolean');
    assert.strictEqual(result.qualityCheck.passed, true, 'Quality check should pass for grounded draft');
    assert.strictEqual(typeof result.qualityCheck.score, 'number');
    assert.ok(result.qualityCheck.score >= 70, 'Quality check score must be >= 70');
    assert.ok(Array.isArray(result.qualityCheck.issues), 'issues must be an array');
    console.log('✓ Step 13: Quality control audit passed:\n', result.qualityCheck);
  } else {
    // If Gemini assessed low confidence on synthetic name, generation was skipped safely
    assert.ok(
      result.currentStep === 'quality_check_skipped' ||
        result.currentStep === 'human_approval_skipped',
      `currentStep must indicate skipped, received: ${result.currentStep}`
    );
    console.log('✓ Lead was not qualified; message generation and QC skipped cleanly');
  }

  // Zero DB mutation assertion
  assert.strictEqual(mutationCount, 0, 'Zero database mutations must have occurred');
  console.log('✓ Verified: Pipeline performed 0 database writes (strictly read-only)');

  // ==============================================================================
  // A2. REAL GEMINI QUALIFIED TEST (Live Message Generation + Live Quality Control)
  // ==============================================================================
  console.log('\n[Real Qualified Lead Test] Invoking generatePersonalizedMessage and qualityCheckMessage with real Gemini...');
  const qualifiedState: LeadAgentState = {
    message: '',
    status: 'completed',
    currentStep: 'ai_decision_validated',
    leadId: testLeadId,
    workspaceId: authorizedWorkspaceId,
    error: undefined,
    leadContext: {
      leadId: testLeadId,
      workspaceId: authorizedWorkspaceId,
      businessName: 'Lakeshore Family Dentistry',
      domain: 'lakeshoredental.example.com',
      phone: '+1-312-555-0244',
      address: '840 N Michigan Ave, Chicago, IL 60611',
      status: 'NEW',
      contactName: 'Dr. Marcus Vance',
      contactTitle: 'Clinic Director & Principal Dentist',
    },
    aiResult: {
      summary: 'Lakeshore Family Dentistry is a premier dental practice in Chicago.',
      intent: 'high_fit',
      confidence: 0.88,
    },
    qualification: {
      qualified: true,
      reason: 'AI confidence meets the qualification threshold.',
      score: 88,
    },
    personalizedMessage: undefined,
    qualityCheck: undefined,
    approval: undefined,
  };

  const realMessageResult = await generatePersonalizedMessage(qualifiedState);
  assert.strictEqual(realMessageResult.currentStep, 'message_generated');
  assert.ok(realMessageResult.personalizedMessage, 'personalizedMessage must be generated');
  assert.strictEqual(typeof realMessageResult.personalizedMessage.body, 'string');
  assert.ok(realMessageResult.personalizedMessage.body.length > 20, 'Message body must be non-empty and non-trivial');
  console.log('✓ Real Gemini generated personalized outreach draft:\n', realMessageResult.personalizedMessage);

  const realQcResult = await qualityCheckMessage({
    ...qualifiedState,
    ...realMessageResult,
  });
  assert.strictEqual(realQcResult.status, 'completed');
  assert.strictEqual(realQcResult.currentStep, 'quality_check_passed');
  assert.ok(realQcResult.qualityCheck, 'qualityCheck result must exist');
  assert.strictEqual(realQcResult.qualityCheck.passed, true, 'Quality check should pass for grounded message');
  assert.ok(realQcResult.qualityCheck.score >= 70, 'Quality score must be >= 70');
  assert.ok(Array.isArray(realQcResult.qualityCheck.issues), 'issues must be an array');
  console.log('✓ Real Gemini Quality Control verified the draft:\n', realQcResult.qualityCheck);

  // ==============================================================================
  // B. DETERMINISTIC UNQUALIFIED LEAD TEST (Zero LLM Calls for Message & QC)
  // ==============================================================================
  console.log('\n[Deterministic Unqualified Lead Test] Testing safe skip when lead is not qualified...');

  const unqualifiedState: LeadAgentState = {
    message: '',
    status: 'completed',
    currentStep: 'ai_decision_validated',
    leadId: 'unqualified_lead_001',
    workspaceId: 'workspace_test',
    error: undefined,
    leadContext: {
      leadId: 'unqualified_lead_001',
      workspaceId: 'workspace_test',
      businessName: 'Incomplete Practice',
      domain: null,
      phone: null,
      address: null,
      status: 'NEW',
      contactName: null,
      contactTitle: null,
    },
    aiResult: {
      summary: 'Incomplete data with missing phone and domain.',
      intent: 'low_fit',
      confidence: 0.40,
    },
    qualification: {
      qualified: false,
      reason: 'AI confidence is below the qualification threshold.',
      score: 40,
    },
    personalizedMessage: undefined,
    qualityCheck: undefined,
    approval: undefined,
  };

  const messageSkipResult = await generatePersonalizedMessage(unqualifiedState);
  assert.strictEqual(messageSkipResult.currentStep, 'message_generation_skipped');
  assert.strictEqual(messageSkipResult.personalizedMessage, undefined);
  console.log('✓ generatePersonalizedMessage cleanly skipped generation for unqualified lead');

  const qcSkipResult = await qualityCheckMessage({
    ...unqualifiedState,
    currentStep: messageSkipResult.currentStep || 'message_generation_skipped',
  });
  assert.strictEqual(qcSkipResult.currentStep, 'quality_check_skipped');
  assert.strictEqual(qcSkipResult.qualityCheck, undefined);
  console.log('✓ qualityCheckMessage cleanly skipped review for unqualified lead');

  // ==============================================================================
  // C. DETERMINISTIC NEGATIVE QC UNIT TESTS (No Extra LLM Calls)
  // ==============================================================================
  console.log('\n[Deterministic QC Negative Tests] Verifying safe QC failure boundaries...');

  // Failure Case 1: Missing personalizedMessage
  const missingMsgState: LeadAgentState = {
    ...unqualifiedState,
    qualification: { qualified: true, reason: 'Qualified', score: 80 },
    currentStep: 'message_generated',
    personalizedMessage: undefined,
  };
  const missingMsgQc = await qualityCheckMessage(missingMsgState);
  assert.strictEqual(missingMsgQc.status, 'failed');
  assert.strictEqual(missingMsgQc.currentStep, 'quality_check_failed');
  assert.ok(missingMsgQc.error?.includes('personalizedMessage is missing'));
  console.log('✓ QC rejected missing personalizedMessage');

  // Failure Case 2: Empty message body
  const emptyBodyState: LeadAgentState = {
    ...unqualifiedState,
    qualification: { qualified: true, reason: 'Qualified', score: 80 },
    currentStep: 'message_generated',
    personalizedMessage: { body: '   ' },
  };
  const emptyBodyQc = await qualityCheckMessage(emptyBodyState);
  assert.strictEqual(emptyBodyQc.status, 'failed');
  assert.strictEqual(emptyBodyQc.currentStep, 'quality_check_failed');
  assert.ok(emptyBodyQc.error?.includes('message body is empty'));
  console.log('✓ QC rejected empty message body');

  // Failure Case 3: Sensitive secret leakage pattern in draft
  const leakedSecretState: LeadAgentState = {
    ...unqualifiedState,
    qualification: { qualified: true, reason: 'Qualified', score: 80 },
    currentStep: 'message_generated',
    personalizedMessage: {
      body: 'Hi Dr. Marcus, please use our secret api_key: sk-1234567890abcdef1234567890 to connect.',
    },
  };
  const leakedSecretQc = await qualityCheckMessage(leakedSecretState);
  assert.strictEqual(leakedSecretQc.status, 'failed');
  assert.strictEqual(leakedSecretQc.currentStep, 'quality_check_failed');
  assert.strictEqual(leakedSecretQc.qualityCheck?.passed, false);
  assert.ok(leakedSecretQc.error?.includes('security credential detected'));
  console.log('✓ QC detected and blocked sensitive credential in message draft');

  console.log('\n--- All LangGraph Steps 12 & 13 Tests Passed Successfully ---');
}

runLangGraphPersonalizationQcTests().catch((err: unknown) => {
  const errorMessage = err instanceof Error ? err.message : String(err);
  console.error('Test Result: Personalization & QC execution failed —', errorMessage);
  process.exit(1);
});
