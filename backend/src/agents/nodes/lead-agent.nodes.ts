import type { LeadAgentState } from '../state/lead-agent.state.js';

export async function runLeadAgent(_state: LeadAgentState): Promise<Partial<LeadAgentState>> {
  return {
    status: 'completed',
    message: 'Lead agent graph executed successfully',
    currentStep: 'completed',
  };
}

export async function researchLead(_state: LeadAgentState): Promise<Partial<LeadAgentState>> {
  return {
    currentStep: 'research',
    message: 'Lead research node executed successfully',
  };
}

export async function qualifyLead(_state: LeadAgentState): Promise<Partial<LeadAgentState>> {
  return {
    currentStep: 'qualification',
    message: 'Lead qualification node executed successfully',
  };
}

export async function personalizeLead(_state: LeadAgentState): Promise<Partial<LeadAgentState>> {
  return {
    currentStep: 'personalization',
    message: 'Lead personalization node executed successfully',
  };
}
