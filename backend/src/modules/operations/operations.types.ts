export type OperationCategory =
  | 'all'
  | 'approvals'
  | 'calling'
  | 'research'
  | 'qualification'
  | 'followup'
  | 'crm'
  | 'system';

export type TaskPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'ROUTINE';

export interface OperationTask {
  id: string;
  category: OperationCategory;
  title: string;
  target: string;
  reason: string;
  priority: TaskPriority;
  timestamp: string;
  actionText: string;
  actionHref: string;
  targetId: string;
  targetType: 'call' | 'lead' | 'task' | 'system';
  metadata?: Record<string, unknown>;
}

export interface OperationsSummary {
  totalOperations: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  routineCount: number;
  approvalsCount: number;
  callReadyCount: number;
  needsResearchCount: number;
  needsQualificationCount: number;
  followUpsDueCount: number;
  telephonyStatus: 'CONNECTED' | 'NOT_CONFIGURED';
  voiceAiStatus: 'CONNECTED' | 'NOT_CONFIGURED';
  closebdsStatus: 'CONNECTED' | 'NOT_CONFIGURED';
  leadPool: {
    total: number;
    discovered: number;
    imported: number;
    researchPending: number;
    researched: number;
    qualificationPending: number;
    qualified: number;
  };
  voicePipeline: {
    callReady: number;
    approvalRequired: number;
    approved: number;
    queued: number;
    inProgress: number;
    completedToday: number;
    blocked: number;
  };
  conversions: {
    interested: number;
    meetings: number;
    won: number;
  };
  systemHealth: {
    callingPolicyActive: boolean;
    dailyLimit: number;
    callsToday: number;
    telephonyConfigured: boolean;
    voiceAiConfigured: boolean;
    agentConfigsCount: number;
  };
}

export interface QueueItem {
  id: string;
  callId: string;
  leadId: string;
  businessName: string;
  recipientPhone: string;
  status: string;
  isApproved: boolean;
  priority: number;
  createdAt: Date;
}
