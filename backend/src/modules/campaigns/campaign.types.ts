import type { Campaign, CampaignStatus, EmailCampaign } from '@prisma/client';

export type CampaignWithDetails = Campaign & {
  emailCampaign?: EmailCampaign | null;
  _count?: {
    leads: number;
  };
};

export interface CampaignFilterParams {
  status?: CampaignStatus;
  search?: string;
  page?: number;
  limit?: number;
}
