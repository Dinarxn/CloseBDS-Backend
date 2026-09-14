import {
  CampaignRepository,
  campaignRepository as defaultCampaignRepo,
} from '../../database/repository.js';
import { databaseClient, type DatabaseClient } from '../../database/client.js';
import { NotFoundError } from '../../core/errors/api-error.js';
import type {
  OverviewMetrics,
  LeadsAnalytics,
  CampaignAnalytics,
  CampaignsAnalyticsSummary,
  OutreachAnalytics,
  ActivityTrends,
  ScoreSummary,
  VoiceAnalytics,
} from './analytics.types.js';
import type { DateRangeFilter } from './analytics.schema.js';
import type { CanonicalLeadStatus } from '../voice/voice.types.js';
import type { CampaignStatus, CRMActivityType, TaskStatus, Prisma } from '@prisma/client';

export class AnalyticsService {
  constructor(
    private campaignRepo: CampaignRepository = defaultCampaignRepo,
    private db: DatabaseClient = databaseClient
  ) {}

  private get prisma() {
    return this.db.getPrismaClient();
  }

  private buildCreatedAtFilter(filter?: DateRangeFilter): Prisma.DateTimeFilter | undefined {
    if (!filter?.from && !filter?.to) return undefined;
    const createdAt: Prisma.DateTimeFilter = {};
    if (filter.from) createdAt.gte = new Date(filter.from);
    if (filter.to) createdAt.lte = new Date(filter.to);
    return createdAt;
  }

  /**
   * Computes high-level overview metrics across leads, campaigns, outreach, CRM, and tasks.
   */
  async getOverview(workspaceId: string, filter?: DateRangeFilter): Promise<OverviewMetrics> {
    const createdAt = this.buildCreatedAtFilter(filter);

    const [leads, campaigns, emailMessages, crmActivities, tasks] = await Promise.all([
      this.prisma.lead.findMany({
        where: {
          workspaceId,
          ...(filter?.campaignId ? { campaignId: filter.campaignId } : {}),
          ...(createdAt ? { createdAt } : {}),
        },
        select: { status: true },
      }),
      this.prisma.campaign.findMany({
        where: {
          workspaceId,
          ...(createdAt ? { createdAt } : {}),
        },
        select: { status: true },
      }),
      this.prisma.emailMessage.findMany({
        where: {
          emailCampaign: {
            campaign: {
              workspaceId,
              ...(filter?.campaignId ? { id: filter.campaignId } : {}),
            },
          },
          ...(createdAt ? { createdAt } : {}),
        },
        select: { status: true, isApproved: true },
      }),
      this.prisma.cRMActivity.findMany({
        where: {
          lead: {
            workspaceId,
            ...(filter?.campaignId ? { campaignId: filter.campaignId } : {}),
          },
          ...(createdAt ? { createdAt } : {}),
        },
        select: { type: true },
      }),
      this.prisma.task.findMany({
        where: {
          lead: {
            workspaceId,
            ...(filter?.campaignId ? { campaignId: filter.campaignId } : {}),
          },
          ...(createdAt ? { createdAt } : {}),
        },
        select: { status: true },
      }),
    ]);

    // 1. Leads breakdown
    const leadCounts: Record<CanonicalLeadStatus, number> = {
      DISCOVERED: 0,
      IMPORTED: 0,
      NEW: 0,
      RESEARCH_PENDING: 0,
      RESEARCHED: 0,
      QUALIFICATION_PENDING: 0,
      QUALIFIED: 0,
      CALL_READY: 0,
      CONTACTED: 0,
      REPLIED: 0,
      INTERESTED: 0,
      MEETING: 0,
      WON: 0,
      LOST: 0,
      DISQUALIFIED: 0,
      OPT_OUT: 0,
    };
    for (const lead of leads) {
      const s = lead.status as CanonicalLeadStatus;
      if (leadCounts[s] !== undefined) {
        leadCounts[s]++;
      }
    }
    const totalLeads = leads.length;
    const qualifiedCount =
      leadCounts.QUALIFIED +
      leadCounts.CALL_READY +
      leadCounts.CONTACTED +
      leadCounts.REPLIED +
      leadCounts.INTERESTED +
      leadCounts.MEETING +
      leadCounts.WON;
    const qualificationRate = totalLeads > 0 ? Math.round((qualifiedCount / totalLeads) * 10000) / 100 : 0;
    const contactedCount = leadCounts.CONTACTED + leadCounts.REPLIED;
    const replyRate = contactedCount > 0 ? Math.round((leadCounts.REPLIED / contactedCount) * 10000) / 100 : 0;

    // 2. Campaigns breakdown
    const campaignCounts: Record<CampaignStatus, number> = {
      DRAFT: 0,
      ACTIVE: 0,
      PAUSED: 0,
      COMPLETED: 0,
    };
    for (const c of campaigns) {
      if (campaignCounts[c.status] !== undefined) {
        campaignCounts[c.status]++;
      }
    }

    // 3. Outreach breakdown
    let draftOutreach = 0;
    let approvedOutreach = 0;
    let sentOutreach = 0;
    let rejectedOutreach = 0;
    let failedOutreach = 0;

    for (const msg of emailMessages) {
      if (msg.status === 'DRAFT') draftOutreach++;
      else if (msg.status === 'APPROVED' || msg.isApproved) approvedOutreach++;
      else if (msg.status === 'SENT') sentOutreach++;
      else if (msg.status === 'REJECTED') rejectedOutreach++;
      else if (msg.status === 'FAILED') failedOutreach++;
    }

    const totalOutreach = emailMessages.length;
    const approvalRate =
      totalOutreach > 0
        ? Math.round(((approvedOutreach + sentOutreach) / totalOutreach) * 10000) / 100
        : 0;

    // 4. CRM activities breakdown
    const crmCounts: Record<CRMActivityType, number> = {
      STAGE_CHANGE: 0,
      NOTE: 0,
      CALL_LOG: 0,
      EMAIL_SENT: 0,
      EMAIL_REPLIED: 0,
    };
    for (const act of crmActivities) {
      if (crmCounts[act.type] !== undefined) {
        crmCounts[act.type]++;
      }
    }

    // 5. Tasks breakdown
    const taskCounts: Record<TaskStatus, number> = {
      PENDING: 0,
      IN_PROGRESS: 0,
      COMPLETED: 0,
      CANCELLED: 0,
    };
    for (const t of tasks) {
      if (taskCounts[t.status] !== undefined) {
        taskCounts[t.status]++;
      }
    }

    return {
      leads: {
        total: totalLeads,
        byStatus: leadCounts,
        qualificationRate,
        replyRate,
      },
      campaigns: {
        total: campaigns.length,
        byStatus: campaignCounts,
      },
      outreach: {
        total: totalOutreach,
        draft: draftOutreach,
        approved: approvedOutreach,
        sent: sentOutreach,
        rejected: rejectedOutreach,
        failed: failedOutreach,
        approvalRate,
      },
      crm: {
        totalActivities: crmActivities.length,
        byType: crmCounts,
      },
      tasks: {
        total: tasks.length,
        pending: taskCounts.PENDING,
        inProgress: taskCounts.IN_PROGRESS,
        completed: taskCounts.COMPLETED,
        cancelled: taskCounts.CANCELLED,
      },
    };
  }

  /**
   * Computes detailed lead funnel and scoring analytics.
   */
  async getLeadsAnalytics(workspaceId: string, filter?: DateRangeFilter): Promise<LeadsAnalytics> {
    const createdAt = this.buildCreatedAtFilter(filter);

    const leads = await this.prisma.lead.findMany({
      where: {
        workspaceId,
        ...(filter?.campaignId ? { campaignId: filter.campaignId } : {}),
        ...(createdAt ? { createdAt } : {}),
      },
      select: {
        status: true,
        leadScore: {
          select: {
            relevanceScore: true,
            opportunityScore: true,
            totalScore: true,
          },
        },
      },
    });

    const totalLeads = leads.length;
    const stages: CanonicalLeadStatus[] = [
      'DISCOVERED',
      'IMPORTED',
      'NEW',
      'RESEARCH_PENDING',
      'RESEARCHED',
      'QUALIFICATION_PENDING',
      'QUALIFIED',
      'CALL_READY',
      'CONTACTED',
      'REPLIED',
      'INTERESTED',
      'MEETING',
      'WON',
      'LOST',
      'DISQUALIFIED',
      'OPT_OUT',
    ];
    const counts: Record<CanonicalLeadStatus, number> = {
      DISCOVERED: 0,
      IMPORTED: 0,
      NEW: 0,
      RESEARCH_PENDING: 0,
      RESEARCHED: 0,
      QUALIFICATION_PENDING: 0,
      QUALIFIED: 0,
      CALL_READY: 0,
      CONTACTED: 0,
      REPLIED: 0,
      INTERESTED: 0,
      MEETING: 0,
      WON: 0,
      LOST: 0,
      DISQUALIFIED: 0,
      OPT_OUT: 0,
    };
    for (const lead of leads) {
      const s = lead.status as CanonicalLeadStatus;
      if (counts[s] !== undefined) {
        counts[s]++;
      }
    }
    let totalRelevance = 0;
    let totalOpportunity = 0;
    let totalScoreSum = 0;
    let scoredCount = 0;

    let highScores = 0;
    let mediumScores = 0;
    let lowScores = 0;

    for (const lead of leads) {
      counts[lead.status]++;
      if (lead.leadScore) {
        scoredCount++;
        totalRelevance += lead.leadScore.relevanceScore;
        totalOpportunity += lead.leadScore.opportunityScore;
        totalScoreSum += lead.leadScore.totalScore;

        if (lead.leadScore.totalScore >= 75) highScores++;
        else if (lead.leadScore.totalScore >= 40) mediumScores++;
        else lowScores++;
      }
    }

    const breakdown = stages.map((stage) => ({
      stage,
      count: counts[stage],
      percentage: totalLeads > 0 ? Math.round((counts[stage] / totalLeads) * 10000) / 100 : 0,
    }));

    const qualifiedCount = counts.QUALIFIED + counts.CONTACTED + counts.REPLIED;
    const qualificationRate = totalLeads > 0 ? Math.round((qualifiedCount / totalLeads) * 10000) / 100 : 0;
    const contactedCount = counts.CONTACTED + counts.REPLIED;
    const replyRate = contactedCount > 0 ? Math.round((counts.REPLIED / contactedCount) * 10000) / 100 : 0;

    const scoreSummary: ScoreSummary = {
      averageRelevance: scoredCount > 0 ? Math.round((totalRelevance / scoredCount) * 10) / 10 : 0,
      averageOpportunity: scoredCount > 0 ? Math.round((totalOpportunity / scoredCount) * 10) / 10 : 0,
      averageTotalScore: scoredCount > 0 ? Math.round((totalScoreSum / scoredCount) * 10) / 10 : 0,
      distribution: {
        high: highScores,
        medium: mediumScores,
        low: lowScores,
      },
    };

    return {
      totalLeads,
      stages: breakdown as any,
      qualificationRate,
      replyRate,
      scoreSummary,
    };
  }

  /**
   * Computes campaign performance summaries across all workspace campaigns.
   */
  async getCampaignsAnalytics(
    workspaceId: string,
    filter?: DateRangeFilter
  ): Promise<CampaignsAnalyticsSummary> {
    const createdAt = this.buildCreatedAtFilter(filter);

    const campaigns = await this.prisma.campaign.findMany({
      where: {
        workspaceId,
        ...(filter?.campaignId ? { id: filter.campaignId } : {}),
        ...(createdAt ? { createdAt } : {}),
      },
      include: {
        leads: { select: { status: true } },
        emailCampaign: {
          include: {
            emailMessages: { select: { status: true, isApproved: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const byStatus: Record<CampaignStatus, number> = {
      DRAFT: 0,
      ACTIVE: 0,
      PAUSED: 0,
      COMPLETED: 0,
    };

    const campaignItems: CampaignAnalytics[] = [];

    for (const c of campaigns) {
      byStatus[c.status]++;

      const leadsTotal = c.leads.length;
      let leadsQualified = 0;
      let leadsContacted = 0;
      let leadsReplied = 0;

      for (const l of c.leads) {
        if (['QUALIFIED', 'CONTACTED', 'REPLIED'].includes(l.status)) leadsQualified++;
        if (['CONTACTED', 'REPLIED'].includes(l.status)) leadsContacted++;
        if (l.status === 'REPLIED') leadsReplied++;
      }

      const qualificationRate = leadsTotal > 0 ? Math.round((leadsQualified / leadsTotal) * 10000) / 100 : 0;
      const responseRate = leadsContacted > 0 ? Math.round((leadsReplied / leadsContacted) * 10000) / 100 : 0;

      const messages = c.emailCampaign?.emailMessages || [];
      let outreachApproved = 0;
      let outreachSent = 0;

      for (const m of messages) {
        if (m.isApproved || m.status === 'APPROVED') outreachApproved++;
        if (m.status === 'SENT') outreachSent++;
      }

      campaignItems.push({
        campaignId: c.id,
        campaignName: c.name,
        niche: c.niche,
        location: c.location,
        status: c.status,
        dailyCap: c.dailyCap,
        leadsTotal,
        leadsQualified,
        leadsContacted,
        leadsReplied,
        qualificationRate,
        responseRate,
        outreachDraftsTotal: messages.length,
        outreachApproved,
        outreachSent,
      });
    }

    return {
      totalCampaigns: campaigns.length,
      byStatus,
      campaigns: campaignItems,
    };
  }

  /**
   * Computes analytics for a single specific campaign.
   */
  async getCampaignAnalytics(campaignId: string, workspaceId: string): Promise<CampaignAnalytics> {
    const campaign = await this.campaignRepo.findById(campaignId, workspaceId);
    if (!campaign) {
      throw new NotFoundError('Campaign not found or access denied for this workspace');
    }

    const [leads, emailMessages] = await Promise.all([
      this.prisma.lead.findMany({
        where: { campaignId, workspaceId },
        select: { status: true },
      }),
      this.prisma.emailMessage.findMany({
        where: {
          emailCampaign: { campaignId },
        },
        select: { status: true, isApproved: true },
      }),
    ]);

    const totalLeads = leads.length;
    let qualifiedLeads = 0;
    let contactedLeads = 0;
    let repliedLeads = 0;

    for (const lead of leads) {
      if (['QUALIFIED', 'CONTACTED', 'REPLIED'].includes(lead.status)) qualifiedLeads++;
      if (['CONTACTED', 'REPLIED'].includes(lead.status)) contactedLeads++;
      if (lead.status === 'REPLIED') repliedLeads++;
    }

    const qualificationRate = totalLeads > 0 ? Math.round((qualifiedLeads / totalLeads) * 10000) / 100 : 0;
    const responseRate = contactedLeads > 0 ? Math.round((repliedLeads / contactedLeads) * 10000) / 100 : 0;

    let outreachApproved = 0;
    let outreachSent = 0;

    for (const msg of emailMessages) {
      if (msg.isApproved || msg.status === 'APPROVED') outreachApproved++;
      if (msg.status === 'SENT') outreachSent++;
    }

    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      niche: campaign.niche,
      location: campaign.location,
      status: campaign.status,
      dailyCap: campaign.dailyCap,
      leadsTotal: totalLeads,
      leadsQualified: qualifiedLeads,
      leadsContacted: contactedLeads,
      leadsReplied: repliedLeads,
      qualificationRate,
      responseRate,
      outreachDraftsTotal: emailMessages.length,
      outreachApproved,
      outreachSent,
    };
  }

  /**
   * Computes outreach workflow and human approval metrics.
   */
  async getOutreachAnalytics(
    workspaceId: string,
    filter?: DateRangeFilter
  ): Promise<OutreachAnalytics> {
    const createdAt = this.buildCreatedAtFilter(filter);

    const emailMessages = await this.prisma.emailMessage.findMany({
      where: {
        emailCampaign: {
          campaign: {
            workspaceId,
            ...(filter?.campaignId ? { id: filter.campaignId } : {}),
          },
        },
        ...(createdAt ? { createdAt } : {}),
      },
      select: { status: true, isApproved: true },
    });

    let draft = 0;
    let approved = 0;
    let sent = 0;
    let rejected = 0;
    let failed = 0;

    for (const msg of emailMessages) {
      if (msg.status === 'DRAFT') draft++;
      else if (msg.status === 'APPROVED' || msg.isApproved) approved++;
      else if (msg.status === 'SENT') sent++;
      else if (msg.status === 'REJECTED') rejected++;
      else if (msg.status === 'FAILED') failed++;
    }

    const totalOutreach = emailMessages.length;
    const approvalRate =
      totalOutreach > 0 ? Math.round(((approved + sent) / totalOutreach) * 10000) / 100 : 0;

    return {
      totalOutreach,
      draft,
      approved,
      sent,
      rejected,
      failed,
      approvalRate,
    };
  }

  /**
   * Computes activity timeline volume and trends.
   */
  async getActivityTrends(workspaceId: string, filter?: DateRangeFilter): Promise<ActivityTrends> {
    const createdAt = this.buildCreatedAtFilter(filter);

    const activities = await this.prisma.cRMActivity.findMany({
      where: {
        lead: {
          workspaceId,
          ...(filter?.campaignId ? { campaignId: filter.campaignId } : {}),
        },
        ...(createdAt ? { createdAt } : {}),
      },
      select: { type: true, createdAt: true },
    });

    const breakdown: Record<CRMActivityType, number> = {
      STAGE_CHANGE: 0,
      NOTE: 0,
      CALL_LOG: 0,
      EMAIL_SENT: 0,
      EMAIL_REPLIED: 0,
    };

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    let recentActivitiesCount = 0;

    for (const act of activities) {
      if (breakdown[act.type] !== undefined) {
        breakdown[act.type]++;
      }
      if (act.createdAt >= oneDayAgo) {
        recentActivitiesCount++;
      }
    }

    return {
      totalActivities: activities.length,
      breakdown,
      recentActivitiesCount,
    };
  }

  /**
   * Exports leads / campaign summary in CSV or JSON format.
   */
  async exportReport(
    workspaceId: string,
    format: 'csv' | 'json',
    filter?: DateRangeFilter
  ): Promise<string | Record<string, unknown>> {
    const createdAt = this.buildCreatedAtFilter(filter);

    const leads = await this.prisma.lead.findMany({
      where: {
        workspaceId,
        ...(filter?.campaignId ? { campaignId: filter.campaignId } : {}),
        ...(createdAt ? { createdAt } : {}),
      },
      include: {
        contacts: true,
        campaign: { select: { name: true, niche: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (format === 'json') {
      return {
        workspaceId,
        exportedAt: new Date().toISOString(),
        totalLeads: leads.length,
        leads: leads.map((l) => ({
          id: l.id,
          businessName: l.businessName,
          domain: l.domain,
          phone: l.phone,
          status: l.status,
          campaignName: l.campaign?.name || null,
          niche: l.campaign?.niche || null,
          contactsCount: l.contacts.length,
          primaryContact: l.contacts.find((c) => c.isPrimary)?.fullName || null,
          primaryEmail: l.contacts.find((c) => c.isPrimary)?.email || null,
          createdAt: l.createdAt.toISOString(),
        })),
      };
    }

    // CSV format generation
    const headers = [
      'Lead ID',
      'Business Name',
      'Domain',
      'Phone',
      'Status',
      'Campaign Name',
      'Niche',
      'Primary Contact',
      'Primary Email',
      'Created At',
    ];

    const escapeCsv = (val: unknown): string => {
      if (val === null || val === undefined) return '""';
      let str = String(val).replace(/"/g, '""');
      // Anti-CSV injection / DDE formula execution protection:
      // If cell begins with formula characters (=, +, -, @, \t, \r), prepend apostrophe
      if (/^[=+\-@\t\r]/.test(str)) {
        str = `'${str}`;
      }
      return `"${str}"`;
    };

    const rows = leads.map((l) => [
      escapeCsv(l.id),
      escapeCsv(l.businessName),
      escapeCsv(l.domain),
      escapeCsv(l.phone),
      escapeCsv(l.status),
      escapeCsv(l.campaign?.name),
      escapeCsv(l.campaign?.niche),
      escapeCsv(l.contacts.find((c) => c.isPrimary)?.fullName),
      escapeCsv(l.contacts.find((c) => c.isPrimary)?.email),
      escapeCsv(l.createdAt.toISOString()),
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    return csvContent;
  }

  /**
   * Computes voice outreach and calling analytics.
   */
  async getVoiceAnalytics(workspaceId: string, filter?: DateRangeFilter): Promise<VoiceAnalytics> {
    const createdAt = this.buildCreatedAtFilter(filter);

    const calls = await this.prisma.call.findMany({
      where: {
        workspaceId,
        ...(filter?.campaignId ? { campaignId: filter.campaignId } : {}),
        ...(createdAt ? { createdAt } : {}),
      },
      include: {
        outcome: true,
      },
    });

    const byStatus: Record<string, number> = {};
    const byOutcome: Record<string, number> = {};
    let totalDuration = 0;
    let approvedCalls = 0;
    let meetingsRequested = 0;
    let callbacksRequested = 0;
    let optOutCount = 0;

    for (const call of calls) {
      byStatus[call.status] = (byStatus[call.status] || 0) + 1;
      if (call.isApproved) {
        approvedCalls++;
      }
      if (call.durationSeconds) {
        totalDuration += call.durationSeconds;
      }
      if (call.outcome) {
        byOutcome[call.outcome.outcome] = (byOutcome[call.outcome.outcome] || 0) + 1;
        if (call.outcome.outcome === 'MEETING_REQUESTED') meetingsRequested++;
        if (call.outcome.outcome === 'CALLBACK_REQUESTED') callbacksRequested++;
        if (call.outcome.optOutDetected || call.outcome.outcome === 'OPTED_OUT') optOutCount++;
      }
    }

    const totalCalls = calls.length;
    const completedCalls = byStatus['COMPLETED'] || 0;
    const averageDurationSeconds = completedCalls > 0 ? Math.round(totalDuration / completedCalls) : 0;
    const approvalRate = totalCalls > 0 ? Math.round((approvedCalls / totalCalls) * 10000) / 100 : 0;

    return {
      totalCalls,
      byStatus,
      byOutcome,
      approvalRate,
      averageDurationSeconds,
      meetingsRequested,
      callbacksRequested,
      optOutCount,
    };
  }

  /**
   * Acquisition Funnel Analytics (Campaign-Independent)
   * Tracks the canonical lifecycle:
   * Lead Pool -> Research -> Qualification -> Voice Queue -> Human Approval -> Calling -> Conversion
   */
  async getAcquisitionFunnel(
    workspaceId: string,
    filter?: DateRangeFilter
  ) {
    const createdAt = this.buildCreatedAtFilter(filter);

    const [leads, calls] = await Promise.all([
      this.prisma.lead.findMany({
        where: {
          workspaceId,
          ...(createdAt ? { createdAt } : {}),
        },
        select: { status: true },
      }),
      this.prisma.call.findMany({
        where: {
          workspaceId,
          ...(createdAt ? { createdAt } : {}),
        },
        include: { outcome: true },
      }),
    ]);

    const leadCounts: Record<CanonicalLeadStatus, number> = {
      DISCOVERED: 0,
      IMPORTED: 0,
      NEW: 0,
      RESEARCH_PENDING: 0,
      RESEARCHED: 0,
      QUALIFICATION_PENDING: 0,
      QUALIFIED: 0,
      CALL_READY: 0,
      CONTACTED: 0,
      REPLIED: 0,
      INTERESTED: 0,
      MEETING: 0,
      WON: 0,
      LOST: 0,
      DISQUALIFIED: 0,
      OPT_OUT: 0,
    };

    for (const l of leads as Array<{ status: any }>) {
      const s = l.status as CanonicalLeadStatus;
      if (leadCounts[s] !== undefined) {
        leadCounts[s]++;
      }
    }

    const totalLeads = leads.length;
    const qualifiedLeads =
      leadCounts.QUALIFIED +
      leadCounts.CALL_READY +
      leadCounts.CONTACTED +
      leadCounts.REPLIED +
      leadCounts.INTERESTED +
      leadCounts.MEETING +
      leadCounts.WON;

    const queuedCalls = calls.filter((c: (typeof calls)[number]) =>
      ['QUEUED', 'SAFETY_CHECKING', 'APPROVAL_REQUIRED'].includes(c.status)
    ).length;
    const approvedCalls = calls.filter((c: (typeof calls)[number]) => c.isApproved).length;
    const completedCalls = calls.filter((c: (typeof calls)[number]) => c.status === 'COMPLETED').length;
    const totalCalls = calls.length;

    const connectedCalls = calls.filter(
      (c: (typeof calls)[number]) => c.outcome && !['NO_ANSWER', 'FAILED', 'BUSY'].includes(c.outcome.outcome)
    ).length;
    const connectRate =
      completedCalls > 0 ? Math.round((connectedCalls / completedCalls) * 10000) / 100 : 0;

    const interestedCount =
      leadCounts.INTERESTED +
      calls.filter(
        (c: (typeof calls)[number]) =>
          c.outcome?.outcome === 'CALLBACK_REQUESTED' || c.outcome?.interestLevel === 'HIGH'
      ).length;
    const meetingCount =
      leadCounts.MEETING +
      calls.filter((c: (typeof calls)[number]) => c.outcome?.outcome === 'MEETING_REQUESTED').length;
    const wonCount = leadCounts.WON;

    return {
      leadPool: {
        total: totalLeads,
        byStatus: leadCounts,
        qualified: qualifiedLeads,
      },
      voiceQueue: {
        totalCalls,
        queued: queuedCalls,
        approved: approvedCalls,
        completed: completedCalls,
        connectRate,
      },
      conversions: {
        interested: interestedCount,
        meetings: meetingCount,
        won: wonCount,
      },
    };
  }
}

export const analyticsService = new AnalyticsService();
