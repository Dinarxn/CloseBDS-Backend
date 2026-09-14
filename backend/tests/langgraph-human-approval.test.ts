/// <reference types="node" />
import assert from 'node:assert/strict';
import { humanApprovalGate } from '../src/agents/nodes/lead-agent-ai.nodes.js';
import type { LeadAgentState } from '../src/agents/state/lead-agent.state.js';

async function runLangGraphHumanApprovalTests() {
  console.log('--- Starting LangGraph Step 14: Human Approval / Permission Gate Tests ---');

  // Baseline verified synthetic draft state
  const baseValidState: LeadAgentState = {
    message: 'Outreach analysis complete',
    status: 'completed',
    currentStep: 'quality_check_passed',
    leadId: 'test-lead-approval-001',
    workspaceId: 'test-workspace-001',
    error: undefined,
    leadContext: {
      leadId: 'test-lead-approval-001',
      workspaceId: 'test-workspace-001',
      businessName: 'Apex Dental Care',
      domain: 'apexdental.example.com',
      phone: '+1-312-555-0100',
      address: '100 Michigan Ave, Chicago, IL',
      status: 'NEW',
      contactName: 'Dr. Sarah Connor',
      contactTitle: 'Managing Partner',
    },
    aiResult: {
      summary: 'High fit dental practice with verified decision maker.',
      intent: 'high_fit',
      confidence: 0.9,
    },
    qualification: {
      qualified: true,
      reason: 'Verified healthcare provider with complete contact information.',
      score: 90,
    },
    personalizedMessage: {
      subject: 'Enhancing Patient Communications at Apex Dental Care',
      body: 'Hi Dr. Connor, noticed Apex Dental Care is expanding in Chicago. Would love to discuss streamlining your patient communications.',
    },
    qualityCheck: {
      passed: true,
      score: 95,
      issues: [],
    },
    approval: undefined,
  };

  // ==============================================================================
  // 1. POSITIVE APPROVAL TEST (Explicit human approval granted)
  // ==============================================================================
  console.log('\n[Test 1] Positive explicit human approval...');
  const approvalTimestamp = '2026-09-06T12:00:00.000Z';
  const approvedInputState: LeadAgentState = {
    ...baseValidState,
    approval: {
      status: 'approved',
      approvedBy: 'user-test-001',
      approvedAt: approvalTimestamp,
      reason: 'Approved for outreach dispatch',
    },
  };

  const approvedResult = await humanApprovalGate(approvedInputState);
  assert.strictEqual(approvedResult.status, 'completed', 'Approved workflow status must be completed');
  assert.strictEqual(approvedResult.currentStep, 'human_approval_granted', 'currentStep must be human_approval_granted');
  assert.ok(approvedResult.approval, 'approval object must exist');
  assert.strictEqual(approvedResult.approval.status, 'approved', 'approval status must be approved');
  assert.strictEqual(approvedResult.approval.approvedBy, 'user-test-001', 'approvedBy identifier must be preserved');
  assert.strictEqual(approvedResult.approval.approvedAt, approvalTimestamp, 'approvedAt timestamp must be preserved');
  console.log('✓ Positive approval test passed:', approvedResult);

  // ==============================================================================
  // 2. PENDING APPROVAL TEST (Explicit pending approval)
  // ==============================================================================
  console.log('\n[Test 2] Pending approval state (pending != approved)...');
  const pendingInputState: LeadAgentState = {
    ...baseValidState,
    approval: {
      status: 'pending',
    },
  };

  const pendingResult = await humanApprovalGate(pendingInputState);
  assert.strictEqual(pendingResult.status, 'awaiting_approval', 'Status must be awaiting_approval');
  assert.strictEqual(pendingResult.currentStep, 'human_approval_pending', 'currentStep must be human_approval_pending');
  assert.ok(pendingResult.approval, 'approval must be present');
  assert.strictEqual(pendingResult.approval.status, 'pending', 'approval.status must be pending');
  console.log('✓ Pending approval test passed (pending != approved):', pendingResult);

  // ==============================================================================
  // 3. SAFE DEFAULT TEST (Missing approval property defaults to pending)
  // ==============================================================================
  console.log('\n[Test 3] Missing approval property defaults safely to pending...');
  const missingApprovalState: LeadAgentState = {
    ...baseValidState,
    approval: undefined,
  };

  const missingResult = await humanApprovalGate(missingApprovalState);
  assert.strictEqual(missingResult.status, 'awaiting_approval', 'Missing approval must yield awaiting_approval');
  assert.strictEqual(missingResult.currentStep, 'human_approval_pending', 'currentStep must be human_approval_pending');
  assert.strictEqual(missingResult.approval?.status, 'pending', 'Approval must default to pending');
  console.log('✓ Missing approval default test passed');

  // ==============================================================================
  // 4. REJECTED APPROVAL TEST (Explicit human rejection)
  // ==============================================================================
  console.log('\n[Test 4] Explicit human rejection...');
  const rejectionReason = 'Message tone requires revision for enterprise client.';
  const rejectedInputState: LeadAgentState = {
    ...baseValidState,
    approval: {
      status: 'rejected',
      reason: rejectionReason,
      approvedBy: 'reviewer-user-002',
    },
  };

  const rejectedResult = await humanApprovalGate(rejectedInputState);
  assert.strictEqual(rejectedResult.status, 'rejected', 'Status must be rejected');
  assert.strictEqual(rejectedResult.currentStep, 'human_approval_rejected', 'currentStep must be human_approval_rejected');
  assert.strictEqual(rejectedResult.approval?.status, 'rejected');
  assert.strictEqual(rejectedResult.approval?.reason, rejectionReason, 'Rejection reason must be preserved');
  console.log('✓ Rejection test passed:', rejectedResult);

  // ==============================================================================
  // 5. CRITICAL SAFETY TEST: FAILED QC CANNOT BE BYPASSED BY APPROVAL
  // ==============================================================================
  console.log('\n[Test 5] Security bypass test: Failed QC cannot be approved...');
  const failedQcState: LeadAgentState = {
    ...baseValidState,
    status: 'failed',
    error: 'AI quality check failed: truthfulness violation detected',
    qualityCheck: {
      passed: false,
      score: 30,
      issues: ['Hallucinated prior relationship'],
    },
    approval: {
      status: 'approved',
      approvedBy: 'attacker-or-rogue-call',
      approvedAt: approvalTimestamp,
    },
  };

  const failedQcResult = await humanApprovalGate(failedQcState);
  assert.strictEqual(failedQcResult.status, 'failed', 'Status must remain failed');
  assert.strictEqual(
    failedQcResult.currentStep,
    'human_approval_blocked_by_qc',
    'currentStep must be human_approval_blocked_by_qc'
  );
  assert.ok(failedQcResult.error, 'Error must explain approval blockage');
  console.log('✓ Failed QC bypass prevented successfully:', failedQcResult);

  // ==============================================================================
  // 6. SECURITY INVARIANTS: AI OUTPUT / QUALIFIED / QC CANNOT APPROVE THEMSELVES
  // ==============================================================================
  console.log('\n[Test 6] Security invariant verification...');
  
  // A. QC passed alone != approved
  const qcPassedOnlyState: LeadAgentState = {
    ...baseValidState,
    approval: undefined,
  };
  const qcAheadResult = await humanApprovalGate(qcPassedOnlyState);
  assert.notStrictEqual(qcAheadResult.status, 'completed', 'QC passed alone must NOT result in completed');
  assert.notStrictEqual(qcAheadResult.currentStep, 'human_approval_granted', 'QC passed cannot grant approval');

  // B. Qualified alone != approved
  const qualifiedOnlyState: LeadAgentState = {
    ...baseValidState,
    qualityCheck: undefined,
    personalizedMessage: undefined,
    approval: undefined,
  };
  const qualAheadResult = await humanApprovalGate(qualifiedOnlyState);
  assert.notStrictEqual(qualAheadResult.currentStep, 'human_approval_granted', 'Qualified cannot grant approval');

  // C. AI Result alone != approved
  const aiResultOnlyState: LeadAgentState = {
    ...baseValidState,
    qualification: undefined,
    qualityCheck: undefined,
    personalizedMessage: undefined,
    approval: undefined,
  };
  const aiAheadResult = await humanApprovalGate(aiResultOnlyState);
  assert.notStrictEqual(aiAheadResult.currentStep, 'human_approval_granted', 'AI result cannot grant approval');

  console.log('✓ All security invariants verified: AI, QC, and Qualification cannot self-authorize');

  // ==============================================================================
  // 7. UNQUALIFIED LEAD TEST (Approval skipped cleanly)
  // ==============================================================================
  console.log('\n[Test 7] Unqualified lead interaction...');
  const unqualifiedState: LeadAgentState = {
    ...baseValidState,
    qualification: {
      qualified: false,
      reason: 'Low confidence / missing business records',
      score: 40,
    },
    personalizedMessage: undefined,
    qualityCheck: undefined,
    approval: undefined,
  };

  const unqualifiedResult = await humanApprovalGate(unqualifiedState);
  assert.strictEqual(unqualifiedResult.currentStep, 'human_approval_skipped');
  console.log('✓ Unqualified lead approval skipped cleanly');

  // ==============================================================================
  // 8. STATE INTEGRITY CHECK
  // ==============================================================================
  console.log('\n[Test 8] State integrity check...');
  const preStateJson = JSON.stringify({
    leadContext: baseValidState.leadContext,
    aiResult: baseValidState.aiResult,
    qualification: baseValidState.qualification,
    personalizedMessage: baseValidState.personalizedMessage,
    qualityCheck: baseValidState.qualityCheck,
  });

  await humanApprovalGate({
    ...baseValidState,
    approval: { status: 'approved', approvedBy: 'user-001' },
  });

  const postStateJson = JSON.stringify({
    leadContext: baseValidState.leadContext,
    aiResult: baseValidState.aiResult,
    qualification: baseValidState.qualification,
    personalizedMessage: baseValidState.personalizedMessage,
    qualityCheck: baseValidState.qualityCheck,
  });

  assert.strictEqual(preStateJson, postStateJson, 'humanApprovalGate must never mutate external state channels');
  console.log('✓ State integrity verified: Prior channels strictly preserved');

  console.log('\n==================================================');
  console.log('ALL STEP 14 HUMAN APPROVAL TESTS PASSED (8/8)');
  console.log('==================================================');
}

runLangGraphHumanApprovalTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
