export interface LeadContextResult {
  leadId: string;
  available: boolean;
}

export async function getLeadContext(leadId: string): Promise<LeadContextResult> {
  return {
    leadId,
    available: false,
  };
}
