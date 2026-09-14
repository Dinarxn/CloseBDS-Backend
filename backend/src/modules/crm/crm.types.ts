import type { CRMActivity, CRMActivityType, Lead, Contact, LeadScore, WebsiteAudit, AIAnalysis, LeadStatus } from '@prisma/client';

export type { CRMActivity, CRMActivityType };

export interface LeadCRMProfile {
  lead: Lead & {
    contacts: Contact[];
    leadScore: LeadScore | null;
    websiteAudit: WebsiteAudit | null;
    aiAnalysis: AIAnalysis | null;
  };
  activities: CRMActivity[];
}

export interface RecordActivityInput {
  type: CRMActivityType;
  description: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateStageInput {
  status: LeadStatus;
  note?: string;
}
