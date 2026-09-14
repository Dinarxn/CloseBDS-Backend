import { StateGraph, START, END } from '@langchain/langgraph';
import { LeadAgentAnnotation } from '../state/lead-agent.state.js';
import {
  runLeadAgent,
  researchLead,
  qualifyLead,
  personalizeLead,
} from '../nodes/lead-agent.nodes.js';

export const leadAgentGraph = new StateGraph(LeadAgentAnnotation)
  .addNode('runLeadAgent', runLeadAgent)
  .addNode('researchLead', researchLead)
  .addNode('qualifyLead', qualifyLead)
  .addNode('personalizeLead', personalizeLead)
  .addEdge(START, 'runLeadAgent')
  .addEdge('runLeadAgent', 'researchLead')
  .addEdge('researchLead', 'qualifyLead')
  .addEdge('qualifyLead', 'personalizeLead')
  .addEdge('personalizeLead', END)
  .compile();
