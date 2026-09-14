import { databaseClient } from '../../database/client.js';
import { voiceService } from '../voice/voice.service.js';
import { callingPolicyService } from '../voice/calling-policy.service.js';
import { providerRegistry } from '../../integrations/core/provider.registry.js';
import type { VoiceProviderAdapter } from '../../integrations/calling/index.js';
import { NotFoundError, BadRequestError } from '../../core/errors/api-error.js';
import type {
  OperationsSummary,
  OperationTask,
  QueueItem,
  OperationCategory,
  TaskPriority,
} from './operations.types.js';
import type { CanonicalLeadStatus } from '../voice/voice.types.js';

export class OperationsService {
  /**
   * Computes genuine, real-time metrics across the acquisition pipeline.
   * Zero fabricated metrics or simulated data.
   */
  async getSummary(workspaceId: string): Promise<OperationsSummary> {
    const prisma = databaseClient.getPrismaClient();

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [leads, calls, callingPolicy, agentConfigsCount] = await Promise.all([
      prisma.lead.findMany({
        where: { workspaceId },
        select: { status: true },
      }),
      prisma.call.findMany({
        where: { workspaceId },
        select: { status: true, createdAt: true, isApproved: true },
      }),
      callingPolicyService.getOrCreatePolicy(workspaceId),
      (prisma as any).voiceAgentConfig.count({ where: { workspaceId } }),
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

    for (const lead of leads) {
      const status = lead.status as CanonicalLeadStatus;
      if (leadCounts[status] !== undefined) {
        leadCounts[status]++;
      }
    }

    const callStatusCounts: Record<string, number> = {};
    let completedToday = 0;

    for (const call of calls) {
      callStatusCounts[call.status] = (callStatusCounts[call.status] || 0) + 1;
      if (call.status === 'COMPLETED' && new Date(call.createdAt) >= startOfDay) {
        completedToday++;
      }
    }

    const telephonyAdapter = providerRegistry.getAdapter<VoiceProviderAdapter>('Twilio');
    const telephonyConfigured = telephonyAdapter ? telephonyAdapter.isConfigured() : false;

    const aiAdapter = providerRegistry.getByCategory('AI_LLM')[0];
    const voiceAiConfigured = aiAdapter ? aiAdapter.isConfigured() : false;

    const callsToday = calls.filter(
      (c: any) =>
        new Date(c.createdAt) >= startOfDay &&
        ['INITIATING', 'RINGING', 'IN_PROGRESS', 'COMPLETED'].includes(c.status)
    ).length;

    const closebdsConfigured = Boolean(
      process.env.CLOSEBDS_API_KEY && process.env.CLOSEBDS_API_KEY.trim().length > 0
    );

    const approvalsCount = callStatusCounts['APPROVAL_REQUIRED'] || 0;
    const callReadyCount = leadCounts.CALL_READY;
    const needsResearchCount =
      leadCounts.DISCOVERED + leadCounts.IMPORTED + leadCounts.RESEARCH_PENDING;
    const needsQualificationCount =
      leadCounts.RESEARCHED + leadCounts.QUALIFICATION_PENDING;
    const followUpsDueCount = leadCounts.INTERESTED + leadCounts.MEETING;

    const criticalCount = approvalsCount;
    const highCount = callReadyCount;
    const mediumCount = needsQualificationCount;
    const routineCount = needsResearchCount;
    const totalOperations =
      criticalCount + highCount + mediumCount + routineCount + followUpsDueCount;

    return {
      totalOperations,
      criticalCount,
      highCount,
      mediumCount,
      routineCount,
      approvalsCount,
      callReadyCount,
      needsResearchCount,
      needsQualificationCount,
      followUpsDueCount,
      telephonyStatus: telephonyConfigured ? 'CONNECTED' : 'NOT_CONFIGURED',
      voiceAiStatus: voiceAiConfigured ? 'CONNECTED' : 'NOT_CONFIGURED',
      closebdsStatus: closebdsConfigured ? 'CONNECTED' : 'NOT_CONFIGURED',
      leadPool: {
        total: leads.length,
        discovered: leadCounts.DISCOVERED,
        imported: leadCounts.IMPORTED,
        researchPending: leadCounts.RESEARCH_PENDING,
        researched: leadCounts.RESEARCHED,
        qualificationPending: leadCounts.QUALIFICATION_PENDING,
        qualified: leadCounts.QUALIFIED,
      },
      voicePipeline: {
        callReady: leadCounts.CALL_READY,
        approvalRequired: callStatusCounts['APPROVAL_REQUIRED'] || 0,
        approved: callStatusCounts['APPROVED'] || 0,
        queued: callStatusCounts['QUEUED'] || 0,
        inProgress: (callStatusCounts['INITIATING'] || 0) + (callStatusCounts['RINGING'] || 0) + (callStatusCounts['IN_PROGRESS'] || 0),
        completedToday,
        blocked: (callStatusCounts['BLOCKED'] || 0) + (callStatusCounts['FAILED'] || 0),
      },
      conversions: {
        interested: leadCounts.INTERESTED,
        meetings: leadCounts.MEETING,
        won: leadCounts.WON,
      },
      systemHealth: {
        callingPolicyActive: callingPolicy.isActive,
        dailyLimit: callingPolicy.dailyCallLimit,
        callsToday,
        telephonyConfigured,
        voiceAiConfigured,
        agentConfigsCount,
      },
    };
  }

  /**
   * Returns authoritative operational tasks for human operators across all canonical acquisition stages.
   */
  async getTasks(
    workspaceId: string,
    filter: {
      category?: OperationCategory;
      priority?: TaskPriority;
      limit?: number;
      page?: number;
    }
  ): Promise<OperationTask[]> {
    const prisma = databaseClient.getPrismaClient();
    const tasks: OperationTask[] = [];

    const [calls, leads, crmTasks, callingPolicy] = await Promise.all([
      prisma.call.findMany({
        where: {
          workspaceId,
          status: { in: ['APPROVAL_REQUIRED', 'APPROVED', 'QUEUED'] },
        },
        include: { lead: true, contact: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.lead.findMany({
        where: {
          workspaceId,
          status: { in: ['DISCOVERED', 'IMPORTED', 'RESEARCH_PENDING', 'QUALIFICATION_PENDING', 'CALL_READY', 'INTERESTED', 'MEETING'] as any },
        },
        include: { contacts: true, websiteAudit: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.task.findMany({
        where: {
          lead: { workspaceId },
          status: { in: ['PENDING', 'IN_PROGRESS'] },
        },
        include: { lead: true },
        take: 20,
      }),
      callingPolicyService.getOrCreatePolicy(workspaceId),
    ]);

    // 1. Approvals (Critical: calls requiring human sign-off)
    for (const call of calls) {
      if (call.status === 'APPROVAL_REQUIRED') {
        tasks.push({
          id: `call-approval-${call.id}`,
          category: 'approvals',
          title: 'Outbound Voice Call Authorization Required',
          target: call.lead?.businessName || 'Prospect Lead',
          reason: 'AI dialogue script, target phone, and grounded facts prepared. Awaiting operator authorization.',
          priority: 'CRITICAL',
          timestamp: call.createdAt.toISOString(),
          actionText: 'Authorize Call',
          actionHref: `/operations?tab=queue&callId=${call.id}`,
          targetId: call.id,
          targetType: 'call',
          metadata: {
            phone: call.normalizedPhone,
            contact: call.contact?.fullName,
          },
        });
      }
    }

    // 2. Calling (Approved or Queued ready for dispatch)
    for (const call of calls) {
      if (call.status === 'APPROVED' || call.status === 'QUEUED') {
        tasks.push({
          id: `call-dispatch-${call.id}`,
          category: 'calling',
          title: 'Authorized Call in Queue',
          target: call.lead?.businessName || 'Prospect Lead',
          reason: 'Call is verified and approved. Ready for telephony dispatch.',
          priority: 'HIGH',
          timestamp: call.createdAt.toISOString(),
          actionText: 'Dispatch Outbound',
          actionHref: `/operations?tab=queue&dispatch=${call.id}`,
          targetId: call.id,
          targetType: 'call',
          metadata: {
            phone: call.normalizedPhone,
            isApproved: call.isApproved,
          },
        });
      }
    }

    // 3. Research (Leads awaiting enrichment or research)
    for (const lead of leads) {
      if (['DISCOVERED', 'IMPORTED', 'RESEARCH_PENDING'].includes(lead.status as string)) {
        tasks.push({
          id: `research-${lead.id}`,
          category: 'research',
          title: 'Prospect Intelligence Enrichment Pending',
          target: lead.businessName,
          reason: 'Digital footprint and website audit gaps require research before outreach.',
          priority: 'MEDIUM',
          timestamp: lead.createdAt.toISOString(),
          actionText: 'Open Research',
          actionHref: `/leads/${lead.id}`,
          targetId: lead.id,
          targetType: 'lead',
        });
      }
    }

    // 4. Qualification (Leads pending qualification scoring)
    for (const lead of leads) {
      if ((lead.status as string) === 'QUALIFICATION_PENDING') {
        tasks.push({
          id: `qualify-${lead.id}`,
          category: 'qualification',
          title: 'Lead Qualification Review',
          target: lead.businessName,
          reason: 'Research data complete. Evaluate ICP fit and qualification score.',
          priority: 'HIGH',
          timestamp: lead.createdAt.toISOString(),
          actionText: 'Review Qualification',
          actionHref: `/leads/${lead.id}`,
          targetId: lead.id,
          targetType: 'lead',
        });
      }
    }

    // 5. Follow-Up (Open follow-up tasks)
    for (const t of crmTasks) {
      tasks.push({
        id: `followup-${t.id}`,
        category: 'followup',
        title: t.title,
        target: t.lead?.businessName || 'Contact',
        reason: t.description || 'Action item from recent conversation.',
        priority: 'MEDIUM',
        timestamp: t.dueDate?.toISOString() || t.createdAt.toISOString(),
        actionText: 'View Task',
        actionHref: `/crm/activities`,
        targetId: t.id,
        targetType: 'task',
      });
    }

    // 6. CRM (Pipeline progression)
    for (const lead of leads) {
      if ((lead.status as string) === 'INTERESTED' || (lead.status as string) === 'MEETING') {
        tasks.push({
          id: `crm-${lead.id}`,
          category: 'crm',
          title: (lead.status as string) === 'MEETING' ? 'Scheduled Meeting Follow-Through' : 'Positive Prospect Inquiry',
          target: lead.businessName,
          reason: 'High-intent prospect awaiting human account executive engagement.',
          priority: 'CRITICAL',
          timestamp: lead.createdAt.toISOString(),
          actionText: 'Open CRM Record',
          actionHref: `/leads/${lead.id}`,
          targetId: lead.id,
          targetType: 'lead',
        });
      }
    }

    // 7. System Health Alerts
    const telephonyAdapter = providerRegistry.getAdapter<VoiceProviderAdapter>('Twilio');
    if (!telephonyAdapter || !telephonyAdapter.isConfigured()) {
      tasks.push({
        id: 'system-telephony-unconfigured',
        category: 'system',
        title: 'Telephony Provider Not Configured',
        target: 'Twilio Integration',
        reason: 'Outbound voice calling is held in safe mode until telephony API credentials are provided.',
        priority: 'ROUTINE',
        timestamp: new Date().toISOString(),
        actionText: 'Configure Telephony',
        actionHref: '/settings/providers',
        targetId: 'twilio',
        targetType: 'system',
      });
    }

    if (!callingPolicy.isActive) {
      tasks.push({
        id: 'system-policy-inactive',
        category: 'system',
        title: 'Workspace Calling Policy Inactive',
        target: 'Calling Safeguards',
        reason: 'Voice outreach is disabled by workspace calling policy.',
        priority: 'HIGH',
        timestamp: new Date().toISOString(),
        actionText: 'Activate Policy',
        actionHref: '/settings',
        targetId: callingPolicy.id,
        targetType: 'system',
      });
    }

    // Apply filtering
    let filtered = tasks;
    if (filter.category && filter.category !== 'all') {
      filtered = filtered.filter((t) => t.category === filter.category);
    }
    if (filter.priority) {
      filtered = filtered.filter((t) => t.priority === filter.priority);
    }

    const limit = filter.limit || 50;
    const page = filter.page || 1;
    const skip = (page - 1) * limit;

    return filtered.slice(skip, skip + limit);
  }

  /**
   * Executes an operational task.
   */
  async executeTask(workspaceId: string, taskId: string, _userId: string) {
    if (taskId.startsWith('call-dispatch-') || taskId.startsWith('call-approval-')) {
      const callId = taskId.replace('call-dispatch-', '').replace('call-approval-', '');
      return voiceService.dispatchCall(callId, workspaceId);
    }

    // Direct call ID execution
    const prisma = databaseClient.getPrismaClient();
    const directCall = await prisma.call.findFirst({ where: { id: taskId, workspaceId } });
    if (directCall) {
      return voiceService.dispatchCall(directCall.id, workspaceId);
    }

    throw new BadRequestError(`Task '${taskId}' cannot be executed automatically`);
  }

  /**
   * Authorizes a pending approval task.
   */
  async approveTask(workspaceId: string, taskId: string, userId: string) {
    const callId = taskId.replace('call-approval-', '');
    return voiceService.approveCall(callId, workspaceId, userId);
  }

  /**
   * Rejects an approval task.
   */
  async rejectTask(workspaceId: string, taskId: string, userId: string, reason?: string) {
    const callId = taskId.replace('call-approval-', '');
    return voiceService.rejectCall(callId, workspaceId, userId, reason);
  }

  /**
   * Returns current active calling queue.
   */
  async getQueue(workspaceId: string): Promise<QueueItem[]> {
    const prisma = databaseClient.getPrismaClient();
    const calls = await prisma.call.findMany({
      where: {
        workspaceId,
        status: { in: ['APPROVAL_REQUIRED', 'APPROVED', 'QUEUED', 'INITIATING', 'RINGING', 'IN_PROGRESS'] },
      },
      include: { lead: true },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });

    return calls.map((c, index) => ({
      id: c.id,
      callId: c.id,
      leadId: c.leadId,
      businessName: c.lead?.businessName || 'Prospect',
      recipientPhone: c.normalizedPhone,
      status: c.status,
      isApproved: c.isApproved,
      priority: index + 1,
      createdAt: c.createdAt,
    }));
  }

  /**
   * Updates queue item priority.
   */
  async prioritizeQueueItem(workspaceId: string, itemId: string, priority: number) {
    const prisma = databaseClient.getPrismaClient();
    const call = await prisma.call.findFirst({ where: { id: itemId, workspaceId } });
    if (!call) {
      throw new NotFoundError('Queue item not found');
    }

    const scheduledAt = new Date(Date.now() - priority * 60000);
    const updated = await prisma.call.update({
      where: { id: call.id },
      data: {
        scheduledAt,
      },
    });

    return updated;
  }

  /**
   * Cancels a call in the queue.
   */
  async cancelQueueItem(workspaceId: string, itemId: string, userId: string, reason?: string) {
    return voiceService.cancelCall(itemId, workspaceId, userId, reason);
  }
}

export const operationsService = new OperationsService();
