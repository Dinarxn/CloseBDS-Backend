import type { Lead, Contact, LeadStatus, LeadScore, WebsiteAudit, AIAnalysis } from '@prisma/client';
import type { ServiceRecommendation } from '../qualification/service-opportunity.types.js';

export type LeadWithDetails = Lead & {
  contacts?: Contact[];
  leadScore?: LeadScore | null;
  websiteAudit?: WebsiteAudit | null;
  aiAnalysis?: AIAnalysis | null;
  serviceRecommendation?: ServiceRecommendation;
  campaign?: { id: string; name: string } | null;
  source?: string;
  dataQuality?: string;
  additionalPhones?: string[];
  latitude?: number;
  longitude?: number;
  email?: string;
  additionalEmails?: string[];
  additionalWebsites?: string[];
  placeDetailsEnriched?: boolean;
  mapsUrl?: string;
  mapsMatchStatus?: string;
  placeId?: string;
  rating?: number;
  userRatingsTotal?: number;
  metadata?: Record<string, unknown> | null;
  actionability?: any;
};

export interface LeadFilterParams {
  campaignId?: string;
  status?: LeadStatus;
  search?: string;
  page?: number;
  limit?: number;
}
