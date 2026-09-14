import type { CampaignStatus, CRMActivityType } from '@prisma/client';
import type { CanonicalLeadStatus } from '../voice/voice.types.js';

export interface OverviewMetrics {
  leads: {
    total: number;
    byStatus: Record<CanonicalLeadStatus, number>;
    qualificationRate: number; // percentage
    replyRate: number; // percentage
  };
  campaigns: {
    total: number;
    byStatus: Record<CampaignStatus, number>;
  };
  outreach: {
    total: number;
    draft: number;
    approved: number;
    sent: number;
    rejected: number;
    failed: number;
    approvalRate: number; // percentage
  };
  crm: {
    totalActivities: number;
    byType: Record<CRMActivityType, number>;
  };
  tasks: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    cancelled: number;
  };
}

export interface PipelineStageBreakdown {
  stage: CanonicalLeadStatus;
  count: number;
  percentage: number;
}

export interface ScoreSummary {
  averageRelevance: number;
  averageOpportunity: number;
  averageTotalScore: number;
  distribution: {
    high: number; // >= 75
    medium: number; // 40-74
    low: number; // < 40
  };
}

export interface LeadsAnalytics {
  totalLeads: number;
  stages: PipelineStageBreakdown[];
  qualificationRate: number;
  replyRate: number;
  scoreSummary: ScoreSummary;
}

export interface CampaignAnalytics {
  campaignId: string;
  campaignName: string;
  niche: string;
  location: string;
  status: CampaignStatus;
  dailyCap: number;
  leadsTotal: number;
  leadsQualified: number;
  leadsContacted: number;
  leadsReplied: number;
  qualificationRate: number;
  responseRate: number;
  outreachDraftsTotal: number;
  outreachApproved: number;
  outreachSent: number;
}

export interface CampaignsAnalyticsSummary {
  totalCampaigns: number;
  byStatus: Record<CampaignStatus, number>;
  campaigns: CampaignAnalytics[];
}

export interface OutreachAnalytics {
  totalOutreach: number;
  draft: number;
  approved: number;
  sent: number;
  rejected: number;
  failed: number;
  approvalRate: number;
}

export interface ActivityTrends {
  totalActivities: number;
  breakdown: Record<CRMActivityType, number>;
  recentActivitiesCount: number;
}

export interface VoiceAnalytics {
  totalCalls: number;
  byStatus: Record<string, number>;
  byOutcome: Record<string, number>;
  approvalRate: number;
  averageDurationSeconds: number;
  meetingsRequested: number;
  callbacksRequested: number;
  optOutCount: number;
}
