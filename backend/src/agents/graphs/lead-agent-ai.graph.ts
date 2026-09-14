import { StateGraph, START, END } from '@langchain/langgraph';
import { LeadAgentAnnotation } from '../state/lead-agent.state.js';
import {
  loadLeadContext,
  runGeminiAgent,
  qualifyLead,
  validateAIDecision,
  generatePersonalizedMessage,
  qualityCheckMessage,
  humanApprovalGate,
} from '../nodes/lead-agent-ai.nodes.js';

/**
 * Production LangGraph AI Workflow for Lead Outreach.
 * Represents the complete Stage 2 validated pipeline:
 * START
 *  ↓
 * loadLeadContext
 *  ↓
 * runGeminiAgent
 *  ↓
 * qualifyLead
 *  ↓
 * validateAIDecision
 *  ↓
 * generatePersonalizedMessage
 *  ↓
 * qualityCheckMessage
 *  ↓
 * humanApprovalGate
 *  ↓
 * END
 */
export const leadAgentAiGraph = new StateGraph(LeadAgentAnnotation)
  .addNode('loadLeadContext', loadLeadContext)
  .addNode('runGeminiAgent', runGeminiAgent)
  .addNode('qualifyLead', qualifyLead)
  .addNode('validateAIDecision', validateAIDecision)
  .addNode('generatePersonalizedMessage', generatePersonalizedMessage)
  .addNode('qualityCheckMessage', qualityCheckMessage)
  .addNode('humanApprovalGate', humanApprovalGate)
  .addEdge(START, 'loadLeadContext')
  .addEdge('loadLeadContext', 'runGeminiAgent')
  .addEdge('runGeminiAgent', 'qualifyLead')
  .addEdge('qualifyLead', 'validateAIDecision')
  .addEdge('validateAIDecision', 'generatePersonalizedMessage')
  .addEdge('generatePersonalizedMessage', 'qualityCheckMessage')
  .addEdge('qualityCheckMessage', 'humanApprovalGate')
  .addEdge('humanApprovalGate', END)
  .compile();

export type LeadAgentAiGraph = typeof leadAgentAiGraph;
