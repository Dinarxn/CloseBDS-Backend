/// <reference types="node" />
import assert from 'node:assert/strict';
import process from 'node:process';
import dotenv from 'dotenv';
import { databaseClient } from '../src/database/client.js';
import { leadAgentAiTestGraph } from '../src/agents/graphs/lead-agent-ai-test.graph.js';
import type { PrismaClient, Lead, Contact } from '@prisma/client';

// Load environment configuration
dotenv.config();

async function runLangGraphLeadResearchTests() {
  console.log('--- Starting LangGraph Steps 10 & 11: Real Lead Context & AI Research Tests ---');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    console.error('Test Result: GEMINI_API_KEY is missing');
    throw new Error('GEMINI_API_KEY is missing');
  }

  // In-memory test stores simulating database state
  const testLeads = new Map<string, Lead>();
  const testContacts = new Map<string, Contact>();

  const authorizedWorkspaceId = 'workspace_healthcare_001';
  const unauthorizedWorkspaceId = 'workspace_intruder_999';
  const testLeadId = 'lead_apex_dental_001';

  // Seed authorized test lead with contact in store
  const initialLead: Lead = {
    id: testLeadId,
    workspaceId: authorizedWorkspaceId,
    campaignId: null,
    businessName: 'Apex Dental Clinic',
    domain: 'apexdental.example.com',
    phone: '+1-312-555-0199',
    address: '500 N Michigan Ave, Chicago, IL 60611',
    status: 'NEW',
    createdAt: new Date('2026-09-01T10:00:00Z'),
    updatedAt: new Date('2026-09-01T10:00:00Z'),
  };
  testLeads.set(testLeadId, { ...initialLead });

  const primaryContact: Contact = {
    id: 'contact_sarah_001',
    leadId: testLeadId,
    fullName: 'Dr. Sarah Connor',
    email: 'sarah@apexdental.example.com',
    title: 'Lead Dental Surgeon & Partner',
    phone: '+1-312-555-0199',
    isPrimary: true,
    createdAt: new Date('2026-09-01T10:00:00Z'),
    updatedAt: new Date('2026-09-01T10:00:00Z'),
  };
  testContacts.set(primaryContact.id, { ...primaryContact });

  // Mock Prisma client with multi-tenant isolation and zero mutation tracking
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
      create: async () => {
        mutationCount++;
        throw new Error('Read-only workflow violation: lead create is not permitted');
      },
      delete: async () => {
        mutationCount++;
        throw new Error('Read-only workflow violation: lead delete is not permitted');
      },
    },
    contact: {
      findMany: async ({ where }: { where: { leadId: string } }) => {
        return Array.from(testContacts.values()).filter((c) => c.leadId === where.leadId);
      },
    },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(mockPrisma),
  } as unknown as PrismaClient;

  // Bind to server-authoritative database client
  databaseClient.setPrismaClient(mockPrisma);

  // Snapshot before execution to verify zero database mutation
  const leadSnapshotBefore = JSON.stringify(testLeads.get(testLeadId));

  // ==============================================================================
  // A. POSITIVE REAL AI INTEGRATION TEST (Real Gemini + Live Read-Only Lead Context)
  // ==============================================================================
  console.log('\n[Positive Integration Test] Invoking leadAgentAiTestGraph with authorized lead...');
  console.log('Flow: START -> loadLeadContext -> runGeminiAgent -> qualifyLead -> validateAIDecision -> END');

  const positiveInput = {
    leadId: testLeadId,
    workspaceId: authorizedWorkspaceId,
    message: '',
    status: 'pending',
    currentStep: 'initialization',
  };

  const positiveResult = await leadAgentAiTestGraph.invoke(positiveInput);

  console.log('Positive execution completed. Verifying assertions...');

  // 1. Overall pipeline success
  assert.ok(
    positiveResult.status === 'completed' || positiveResult.status === 'awaiting_approval',
    'Pipeline status must be "completed" or "awaiting_approval"'
  );
  assert.ok(
    positiveResult.currentStep === 'ai_decision_validated' ||
      positiveResult.currentStep === 'quality_check_passed' ||
      positiveResult.currentStep === 'quality_check_skipped' ||
      positiveResult.currentStep === 'human_approval_granted' ||
      positiveResult.currentStep === 'human_approval_pending' ||
      positiveResult.currentStep === 'human_approval_skipped',
    `Pipeline must complete valid AI lifecycle step, received: ${positiveResult.currentStep}`
  );

  // 2. Context preservation
  assert.strictEqual(positiveResult.leadId, testLeadId, 'leadId must be preserved in state');
  assert.strictEqual(positiveResult.workspaceId, authorizedWorkspaceId, 'workspaceId must be preserved in state');

  // 3. Step 10: Lead context loaded and verified
  assert.ok(positiveResult.leadContext, 'result.leadContext must be populated');
  assert.strictEqual(positiveResult.leadContext.leadId, testLeadId);
  assert.strictEqual(positiveResult.leadContext.workspaceId, authorizedWorkspaceId);
  assert.strictEqual(positiveResult.leadContext.businessName, 'Apex Dental Clinic');
  assert.strictEqual(positiveResult.leadContext.domain, 'apexdental.example.com');
  assert.strictEqual(positiveResult.leadContext.phone, '+1-312-555-0199');
  assert.strictEqual(positiveResult.leadContext.address, '500 N Michigan Ave, Chicago, IL 60611');
  assert.strictEqual(positiveResult.leadContext.status, 'NEW');
  assert.strictEqual(positiveResult.leadContext.contactName, 'Dr. Sarah Connor');
  assert.strictEqual(positiveResult.leadContext.contactTitle, 'Lead Dental Surgeon & Partner');
  console.log('✓ Step 10: Read-only leadContext loaded accurately:', positiveResult.leadContext);

  // 4. Step 11: Real Gemini AI research result verified
  assert.ok(positiveResult.aiResult, 'result.aiResult must be generated by Gemini');
  assert.strictEqual(typeof positiveResult.aiResult.summary, 'string');
  assert.ok(positiveResult.aiResult.summary.length > 0, 'Research summary must not be empty');
  assert.strictEqual(typeof positiveResult.aiResult.intent, 'string');
  assert.ok(positiveResult.aiResult.intent.length > 0, 'Research intent must not be empty');
  assert.strictEqual(typeof positiveResult.aiResult.confidence, 'number');
  assert.ok(
    positiveResult.aiResult.confidence >= 0 && positiveResult.aiResult.confidence <= 1,
    'Confidence must be between 0 and 1'
  );
  console.log('✓ Step 11: Real Gemini research output generated:', positiveResult.aiResult);

  // 5. Step 8 & Step 9: Qualification and Guard verified
  assert.ok(positiveResult.qualification, 'result.qualification must exist');
  assert.strictEqual(typeof positiveResult.qualification.qualified, 'boolean');
  assert.strictEqual(typeof positiveResult.qualification.score, 'number');
  const expectedScore = Math.round(positiveResult.aiResult.confidence * 100);
  assert.strictEqual(positiveResult.qualification.score, expectedScore, 'Score must match confidence * 100');
  const expectedQualified = positiveResult.aiResult.confidence >= 0.70;
  assert.strictEqual(positiveResult.qualification.qualified, expectedQualified, 'Qualified must match confidence >= 0.70');
  console.log('✓ Step 8 & Step 9: Guard passed and verified qualification decision:', positiveResult.qualification);

  // 6. Zero database mutations verified
  const leadSnapshotAfter = JSON.stringify(testLeads.get(testLeadId));
  assert.strictEqual(leadSnapshotBefore, leadSnapshotAfter, 'Lead database record must NOT be modified');
  assert.strictEqual(mutationCount, 0, 'Zero database mutations must have occurred');
  console.log('✓ Verified: Workflow performed 100% read-only operations (zero DB mutations)');

  // ==============================================================================
  // B. DETERMINISTIC NEGATIVE TESTS (Zero LLM Calls)
  // ==============================================================================
  console.log('\n[Deterministic Failure Tests] Verifying safe failure boundaries without calling Gemini...');

  // Failure Case 1: Missing leadId
  console.log('Test B1: Missing leadId...');
  const missingLeadResult = await leadAgentAiTestGraph.invoke({
    leadId: '',
    workspaceId: authorizedWorkspaceId,
    message: '',
    status: 'pending',
    currentStep: 'initialization',
  });
  assert.strictEqual(missingLeadResult.status, 'failed');
  assert.strictEqual(missingLeadResult.currentStep, 'lead_context_failed');
  assert.ok(missingLeadResult.error?.includes('leadId is missing'));
  assert.strictEqual(missingLeadResult.aiResult, undefined, 'Gemini must NOT be called on missing leadId');
  assert.strictEqual(missingLeadResult.leadContext, undefined);
  console.log('✓ Handled missing leadId safely');

  // Failure Case 2: Missing workspaceId
  console.log('Test B2: Missing workspaceId...');
  const missingWsResult = await leadAgentAiTestGraph.invoke({
    leadId: testLeadId,
    workspaceId: '',
    message: '',
    status: 'pending',
    currentStep: 'initialization',
  });
  assert.strictEqual(missingWsResult.status, 'failed');
  assert.strictEqual(missingWsResult.currentStep, 'lead_context_failed');
  assert.ok(missingWsResult.error?.includes('workspaceId is missing'));
  assert.strictEqual(missingWsResult.aiResult, undefined, 'Gemini must NOT be called on missing workspaceId');
  assert.strictEqual(missingWsResult.leadContext, undefined);
  console.log('✓ Handled missing workspaceId safely');

  // Failure Case 3: Lead not found
  console.log('Test B3: Non-existent lead...');
  const notFoundResult = await leadAgentAiTestGraph.invoke({
    leadId: 'lead_non_existent_999',
    workspaceId: authorizedWorkspaceId,
    message: '',
    status: 'pending',
    currentStep: 'initialization',
  });
  assert.strictEqual(notFoundResult.status, 'failed');
  assert.strictEqual(notFoundResult.currentStep, 'lead_context_failed');
  assert.ok(notFoundResult.error?.includes("Lead 'lead_non_existent_999' not found"));
  assert.strictEqual(notFoundResult.aiResult, undefined, 'Gemini must NOT be called when lead is not found');
  assert.strictEqual(notFoundResult.leadContext, undefined);
  console.log('✓ Handled non-existent lead safely');

  // Failure Case 4: Workspace mismatch (Multi-tenant security violation attempt)
  console.log('Test B4: Workspace mismatch (cross-tenant access attempt)...');
  const mismatchResult = await leadAgentAiTestGraph.invoke({
    leadId: testLeadId,
    workspaceId: unauthorizedWorkspaceId,
    message: '',
    status: 'pending',
    currentStep: 'initialization',
  });
  assert.strictEqual(mismatchResult.status, 'failed');
  assert.strictEqual(mismatchResult.currentStep, 'lead_context_failed');
  assert.ok(
    mismatchResult.error?.includes('Workspace mismatch') &&
      mismatchResult.error?.includes(unauthorizedWorkspaceId)
  );
  assert.strictEqual(mismatchResult.aiResult, undefined, 'Gemini must NOT be called on workspace mismatch');
  assert.strictEqual(mismatchResult.leadContext, undefined, 'Lead context must NOT be exposed across tenants');
  console.log('✓ Handled workspace mismatch securely — tenant data protected and Gemini blocked');

  console.log('\n--- All LangGraph Steps 10 & 11 Tests Passed Successfully ---');
}

runLangGraphLeadResearchTests().catch((err: unknown) => {
  const errorMessage = err instanceof Error ? err.message : String(err);
  console.error('Test Result: LangGraph lead research execution failed —', errorMessage);
  process.exit(1);
});
