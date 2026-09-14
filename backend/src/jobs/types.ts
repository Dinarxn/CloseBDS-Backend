export type JobType =
  | 'JOB_LEAD_DISCOVERY'
  | 'JOB_WEBSITE_AUDIT'
  | 'JOB_AI_QUALIFICATION'
  | 'JOB_AI_PERSONALIZATION'
  | 'JOB_FOLLOW_UP_CHECKER'
  | 'JOB_PERMISSION_GATED_DISPATCH';

export interface JobDefinition<TPayload = unknown> {
  id: string;
  type: JobType;
  workspaceId: string;
  payload: TPayload;
  scheduledFor?: Date;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  createdAt: Date;
}

export interface JobHandler<TPayload = unknown> {
  handle(job: JobDefinition<TPayload>): Promise<void>;
}
