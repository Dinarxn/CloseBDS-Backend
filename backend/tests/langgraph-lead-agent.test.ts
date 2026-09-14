/// <reference types="node" />
import assert from 'node:assert/strict';
import process from 'node:process';
import { leadAgentGraph } from '../src/agents/graphs/lead-agent.graph.js';
import type { LeadAgentState } from '../src/agents/state/lead-agent.state.js';
import {
  runLeadAgent,
  researchLead,
  qualifyLead,
  personalizeLead,
} from '../src/agents/nodes/lead-agent.nodes.js';
import { getLeadContext } from '../src/agents/tools/lead-agent.tools.js';

async function runLangGraphFoundationTest() {
  console.log('--- Starting LangGraph Lead Agent Step 4 Multi-Node Tests ---');

  // Test 1: Minimal initial state execution on multi-node graph
  // Flow: START -> runLeadAgent -> researchLead -> qualifyLead -> personalizeLead -> END
  const initialState = {
    message: '',
    status: 'pending',
    currentStep: 'initialization',
  };

  const result = await leadAgentGraph.invoke(initialState);

  assert.strictEqual(result.status, 'completed', 'Graph execution status should be "completed"');
  assert.strictEqual(
    result.currentStep,
    'personalization',
    'Graph execution currentStep should be "personalization"'
  );
  assert.ok(
    typeof result.message === 'string' && result.message.length > 0,
    'Graph execution message should reflect successful execution'
  );
  console.log('✓ Multi-node sequential graph execution passed with output:', result);

  // Test 2: Multi-node graph execution with optional fields preserved
  const stateWithOptional = {
    message: '',
    status: 'pending',
    currentStep: 'initialization',
    leadId: 'lead_123',
    workspaceId: 'ws_456',
  };

  const resultWithOptional = await leadAgentGraph.invoke(stateWithOptional);
  assert.strictEqual(resultWithOptional.status, 'completed');
  assert.strictEqual(resultWithOptional.currentStep, 'personalization');
  assert.strictEqual(resultWithOptional.leadId, 'lead_123');
  assert.strictEqual(resultWithOptional.workspaceId, 'ws_456');
  console.log('✓ Multi-node execution with optional fields passed with output:', resultWithOptional);

  // Test 3: Individual node direct executions
  const nodeState: LeadAgentState = {
    message: '',
    status: 'pending',
    currentStep: 'initialization',
    leadId: undefined,
    workspaceId: undefined,
    error: undefined,
    leadContext: undefined,
    aiResult: undefined,
    qualification: undefined,
    personalizedMessage: undefined,
    qualityCheck: undefined,
    approval: undefined,
  };

  const runAgentRes = await runLeadAgent(nodeState);
  assert.strictEqual(runAgentRes.status, 'completed');
  assert.strictEqual(runAgentRes.currentStep, 'completed');

  const researchRes = await researchLead(nodeState);
  assert.strictEqual(researchRes.currentStep, 'research');

  const qualifyRes = await qualifyLead(nodeState);
  assert.strictEqual(qualifyRes.currentStep, 'qualification');

  const personalizeRes = await personalizeLead(nodeState);
  assert.strictEqual(personalizeRes.currentStep, 'personalization');
  console.log('✓ Direct node foundation executions verified');

  // Test 4: Standalone tool execution
  const toolResult = await getLeadContext('lead_test_step4');
  assert.strictEqual(toolResult.leadId, 'lead_test_step4');
  assert.strictEqual(toolResult.available, false);
  console.log('✓ Standalone tool getLeadContext verified');

  console.log('--- All Step 4 Multi-Node Graph Tests Passed Successfully ---');
}

runLangGraphFoundationTest().catch((err) => {
  console.error('LangGraph Foundation Test Failed:', err);
  process.exit(1);
});
