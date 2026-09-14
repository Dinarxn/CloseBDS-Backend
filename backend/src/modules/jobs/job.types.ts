export type JobType =
  | 'LEAD_DEDUPLICATION_JOB'
  | 'WEBSITE_AUDIT_JOB'
  | 'AI_QUALIFICATION_JOB'
  | 'AI_PERSONALIZATION_JOB'
  | 'ANALYTICS_AGGREGATION_JOB'
  | 'CLEANUP_JOB';

export type JobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'RETRYING'
  | 'CANCELLED';

export interface JobItem {
  id: string;
  workspaceId: string;
  userId: string;
  type: JobType;
  status: JobStatus;
  payload: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  errorMessage?: string | null;
  attempts: number;
  maxRetries: number;
  idempotencyKey?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
