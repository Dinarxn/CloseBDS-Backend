/// <reference types="node" />
import assert from 'node:assert/strict';
import process from 'node:process';
import dotenv from 'dotenv';
import { leadAgentAiTestGraph } from '../src/agents/graphs/lead-agent-ai-test.graph.js';
import { qualifyLead, validateAIDecision } from '../src/agents/nodes/lead-agent-ai.nodes.js';
import type { LeadAgentState } from '../src/agents/state/lead-agent.state.js';

import { databaseClient } from '../src/database/client.js';
import type { PrismaClient, Lead } from '@prisma/client';

// Load environment configuration
dotenv.config();

async function runLangGraphGeminiTest() {
  console.log('--- Starting LangGraph + Gemini Step 9 AI Decision Guard Test ---');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    console.error('Test Result: GEMINI_API_KEY is missing');
    throw new Error('GEMINI_API_KEY is missing');
  }

  // Setup mock lead for Step 9 regression test
  const syntheticLead: Lead = {
    id: 'test-lead-001',
    workspaceId: 'test-workspace-001',
    campaignId: null,
    businessName: 'Synthetic Test Enterprise',
    domain: 'synthetic.example.com',
    phone: '+1-555-0100',
    address: '100 Innovation Way',
    status: 'NEW',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPrisma = {
    lead: {
      findFirst: async ({ where }: { where: { id?: string; workspaceId?: string } }) => {
        if (where.id === 'test-lead-001' && (!where.workspaceId || where.workspaceId === 'test-workspace-001')) {
          return { ...syntheticLead, contacts: [] };
        }
        return null;
      },
    },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(mockPrisma),
  } as unknown as PrismaClient;

  databaseClient.setPrismaClient(mockPrisma);

  // Pure synthetic test state — zero production records
  const initialState = {
    message: '',
    status: 'pending',
    leadId: 'test-lead-001',
    workspaceId: 'test-workspace-001',
    currentStep: 'initialization',
  };

  console.log('Invoking leadAgentAiTestGraph with synthetic state (START -> loadLeadContext -> runGeminiAgent -> qualifyLead -> validateAIDecision -> END)...');
  const result = await leadAgentAiTestGraph.invoke(initialState);

  // 1 & 5: Graph completed successfully through guard
  assert.ok(
    result.status === 'completed' || result.status === 'awaiting_approval',
    'Graph status must be "completed" or "awaiting_approval"'
  );
  assert.ok(
    result.currentStep === 'ai_decision_validated' ||
      result.currentStep === 'quality_check_passed' ||
      result.currentStep === 'quality_check_skipped' ||
      result.currentStep === 'human_approval_granted' ||
      result.currentStep === 'human_approval_pending' ||
      result.currentStep === 'human_approval_skipped',
    `currentStep must be a valid completed step, received: ${result.currentStep}`
  );

  // 10 & 11: State context preservation
  assert.strictEqual(result.leadId, 'test-lead-001', 'leadId must be preserved in state');
  assert.strictEqual(result.workspaceId, 'test-workspace-001', 'workspaceId must be preserved in state');

  // 2, 7: aiResult exists and validated
  assert.ok(result.aiResult, 'result.aiResult must exist and be defined');
  assert.strictEqual(typeof result.aiResult.summary, 'string', 'aiResult.summary must be a string');
  assert.ok(result.aiResult.summary.length > 0, 'aiResult.summary must not be empty');
  assert.strictEqual(typeof result.aiResult.intent, 'string', 'aiResult.intent must be a string');
  assert.ok(result.aiResult.intent.length > 0, 'aiResult.intent must not be empty');
  assert.strictEqual(typeof result.aiResult.confidence, 'number', 'aiResult.confidence must be a number');
  assert.ok(result.aiResult.confidence >= 0 && result.aiResult.confidence <= 1, 'confidence must be between 0 and 1');

  // 3, 6: qualification exists and validated
  assert.ok(result.qualification, 'result.qualification must exist and be defined');
  assert.strictEqual(typeof result.qualification.qualified, 'boolean', 'qualification.qualified must be a boolean');
  assert.strictEqual(typeof result.qualification.reason, 'string', 'qualification.reason must be a string');
  assert.ok(result.qualification.reason.length > 0, 'qualification.reason must not be empty');
  assert.strictEqual(typeof result.qualification.score, 'number', 'qualification.score must be a number');
  assert.ok(result.qualification.score >= 0 && result.qualification.score <= 100, 'qualification.score must be between 0 and 100');

  // 8 & 9: Consistency checks verified by guard
  const expectedScore = Math.round(result.aiResult.confidence * 100);
  assert.strictEqual(result.qualification.score, expectedScore);
  const expectedQualified = result.aiResult.confidence >= 0.70;
  assert.strictEqual(result.qualification.qualified, expectedQualified);

  console.log('✓ End-to-end graph executed and validated successfully');
  console.log('✓ Verified structured aiResult:', result.aiResult);
  console.log('✓ Verified guarded qualification decision:', result.qualification);
  console.log(`✓ Verified preserved state fields: leadId="${result.leadId}", workspaceId="${result.workspaceId}"`);

  // --- Negative Unit-Level Tests for Guard Node (No Extra Gemini Calls) ---
  console.log('Running deterministic negative failure tests for validateAIDecision guard node...');

  // Failure Case 1: Inconsistent score (confidence 0.85, score 50)
  const inconsistentScoreState: LeadAgentState = {
    message: '',
    status: 'completed',
    currentStep: 'qualification_completed',
    leadId: 'test-lead-001',
    workspaceId: 'test-workspace-001',
    error: undefined,
    leadContext: undefined,
    aiResult: {
      summary: 'Valid synthetic summary',
      intent: 'test',
      confidence: 0.85,
    },
    qualification: {
      qualified: true,
      reason: 'AI confidence meets the qualification threshold.',
      score: 50, // Should be 85!
    },
    personalizedMessage: undefined,
    qualityCheck: undefined,
    approval: undefined,
  };
  const scoreFailResult = await validateAIDecision(inconsistentScoreState);
  assert.strictEqual(scoreFailResult.status, 'failed');
  assert.strictEqual(scoreFailResult.currentStep, 'ai_decision_validation_failed');
  assert.ok(scoreFailResult.error?.includes('qualification score (50) is inconsistent with confidence score (85)'));
  console.log('✓ Guard detected and rejected inconsistent score');

  // Failure Case 2: Inconsistent qualified status (confidence 0.85, qualified false)
  const inconsistentQualifiedState: LeadAgentState = {
    message: '',
    status: 'completed',
    currentStep: 'qualification_completed',
    leadId: 'test-lead-001',
    workspaceId: 'test-workspace-001',
    error: undefined,
    leadContext: undefined,
    aiResult: {
      summary: 'Valid synthetic summary',
      intent: 'test',
      confidence: 0.85,
    },
    qualification: {
      qualified: false, // Should be true for 0.85 >= 0.70!
      reason: 'Mismatch test',
      score: 85,
    },
    personalizedMessage: undefined,
    qualityCheck: undefined,
    approval: undefined,
  };
  const qualifiedFailResult = await validateAIDecision(inconsistentQualifiedState);
  assert.strictEqual(qualifiedFailResult.status, 'failed');
  assert.strictEqual(qualifiedFailResult.currentStep, 'ai_decision_validation_failed');
  assert.ok(qualifiedFailResult.error?.includes('qualification status (false) is inconsistent with confidence threshold (true)'));
  console.log('✓ Guard detected and rejected inconsistent qualified status');

  // Failure Case 3: Missing aiResult
  const missingAiState: LeadAgentState = {
    message: '',
    status: 'completed',
    currentStep: 'qualification_completed',
    leadId: 'test-lead-001',
    workspaceId: 'test-workspace-001',
    error: undefined,
    leadContext: undefined,
    aiResult: undefined,
    qualification: {
      qualified: true,
      reason: 'No AI test',
      score: 80,
    },
    personalizedMessage: undefined,
    qualityCheck: undefined,
    approval: undefined,
  };
  const missingAiFail = await validateAIDecision(missingAiState);
  assert.strictEqual(missingAiFail.status, 'failed');
  assert.ok(missingAiFail.error?.includes('aiResult is missing'));
  console.log('✓ Guard detected and rejected missing aiResult');

  // Failure Case 4: Missing qualification
  const missingQualState: LeadAgentState = {
    message: '',
    status: 'completed',
    currentStep: 'gemini_agent_completed',
    leadId: 'test-lead-001',
    workspaceId: 'test-workspace-001',
    error: undefined,
    leadContext: undefined,
    aiResult: {
      summary: 'Valid summary',
      intent: 'test',
      confidence: 0.80,
    },
    qualification: undefined,
    personalizedMessage: undefined,
    qualityCheck: undefined,
    approval: undefined,
  };
  const missingQualFail = await validateAIDecision(missingQualState);
  assert.strictEqual(missingQualFail.status, 'failed');
  assert.ok(missingQualFail.error?.includes('qualification is missing'));
  console.log('✓ Guard detected and rejected missing qualification');

  console.log('--- LangGraph + Gemini Step 9 AI Decision Guard Tests Passed Successfully ---');
}

runLangGraphGeminiTest().catch((err: unknown) => {
  const errorMessage = err instanceof Error ? err.message : String(err);
  if (errorMessage.includes('GEMINI_API_KEY is missing')) {
    console.error('Test Result: GEMINI_API_KEY is missing');
  } else {
    console.error('Test Result: LangGraph Gemini guard execution failed —', errorMessage);
  }
  process.exit(1);
});
