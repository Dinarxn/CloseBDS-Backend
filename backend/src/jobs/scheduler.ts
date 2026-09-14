import type { JobHandler, JobType } from './types.js';

export interface JobScheduler {
  schedule<TPayload>(type: JobType, workspaceId: string, payload: TPayload, runAt?: Date): Promise<string>;
  registerHandler<TPayload>(type: JobType, handler: JobHandler<TPayload>): void;
}

/**
 * Foundation Job Scheduler Placeholder.
 * In backend foundation mode, jobs are neither dispatched nor queued automatically.
 */
export class FoundationJobScheduler implements JobScheduler {
  private handlers = new Map<JobType, JobHandler<unknown>>();

  registerHandler<TPayload>(type: JobType, handler: JobHandler<TPayload>): void {
    this.handlers.set(type, handler as JobHandler<unknown>);
  }

  async schedule<TPayload>(
    _type: JobType,
    _workspaceId: string,
    _payload: TPayload,
    _runAt?: Date
  ): Promise<string> {
    // Foundation boundary: register job request contract without starting workers
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    return jobId;
  }
}

