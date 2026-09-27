import type { Lead, Contact, LeadStatus, LeadScore, WebsiteAudit, AIAnalysis } from '@prisma/client';
import type { ServiceRecommendation } from '../qualification/service-opportunity.types.js';

export type LeadWithDetails = Lead & {
  contacts?: Contact[];
  leadScore?: LeadScore | null;
  websiteAudit?: WebsiteAudit | null;
  aiAnalysis?: AIAnalysis | null;
  serviceRecommendation?: ServiceRecommendation;
};

export interface LeadFilterParams {
  campaignId?: string;
  status?: LeadStatus;
  search?: string;
  page?: number;
  limit?: number;
}
