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

export const leadAgentAiTestGraph = new StateGraph(LeadAgentAnnotation)
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
