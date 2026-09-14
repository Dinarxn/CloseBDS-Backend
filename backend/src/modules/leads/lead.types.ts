import type { Lead, Contact, LeadStatus, LeadScore, WebsiteAudit, AIAnalysis } from '@prisma/client';

export type LeadWithDetails = Lead & {
  contacts?: Contact[];
  leadScore?: LeadScore | null;
  websiteAudit?: WebsiteAudit | null;
  aiAnalysis?: AIAnalysis | null;
};

export interface LeadFilterParams {
  campaignId?: string;
  status?: LeadStatus;
  search?: string;
  page?: number;
  limit?: number;
}
