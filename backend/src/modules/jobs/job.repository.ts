import type { PaginationResult } from '../../database/repository.js';
import type { JobItem, JobType, JobStatus } from './job.types.js';

export interface CreateJobInput {
  workspaceId: string;
  userId: string;
  type: JobType;
  payload: Record<string, unknown>;
  idempotencyKey?: string | null;
  maxRetries?: number;
}

export class JobRepository {
  private jobsStore: Map<string, JobItem> = new Map();

  async create(data: CreateJobInput): Promise<JobItem> {
    const id = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date();

    const job: JobItem = {
      id,
      workspaceId: data.workspaceId,
      userId: data.userId,
      type: data.type,
      status: 'QUEUED',
      payload: data.payload,
      result: null,
      errorMessage: null,
      attempts: 0,
      maxRetries: data.maxRetries ?? 3,
      idempotencyKey: data.idempotencyKey || null,
      startedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.jobsStore.set(id, job);
    return job;
  }

  async findById(id: string, workspaceId: string): Promise<JobItem | null> {
    const job = this.jobsStore.get(id);
    if (!job || job.workspaceId !== workspaceId) {
      return null;
    }
    return job;
  }

  async findByIdempotencyKey(
    workspaceId: string,
    idempotencyKey: string
  ): Promise<JobItem | null> {
    for (const job of this.jobsStore.values()) {
      if (job.workspaceId === workspaceId && job.idempotencyKey === idempotencyKey) {
        return job;
      }
    }
    return null;
  }

  async findManyPaginated(
    workspaceId: string,
    filter?: {
      type?: JobType;
      status?: JobStatus;
      page?: number;
      limit?: number;
    }
  ): Promise<PaginationResult<JobItem>> {
    const page = Math.max(1, filter?.page || 1);
    const limit = Math.min(100, Math.max(1, filter?.limit || 20));
    const skip = (page - 1) * limit;

    const results = Array.from(this.jobsStore.values())
      .filter((j) => {
        const matchWs = j.workspaceId === workspaceId;
        const matchType = !filter?.type || j.type === filter.type;
        const matchStatus = !filter?.status || j.status === filter.status;
        return matchWs && matchType && matchStatus;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = results.length;
    const data = results.slice(skip, skip + limit);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async updateStatus(
    id: string,
    workspaceId: string,
    status: JobStatus,
    updates?: {
      result?: Record<string, unknown> | null;
      errorMessage?: string | null;
      attempts?: number;
      startedAt?: Date | null;
      completedAt?: Date | null;
    }
  ): Promise<JobItem | null> {
    const job = await this.findById(id, workspaceId);
    if (!job) return null;

    const updated: JobItem = {
      ...job,
      status,
      ...(updates?.result !== undefined ? { result: updates.result } : {}),
      ...(updates?.errorMessage !== undefined ? { errorMessage: updates.errorMessage } : {}),
      ...(updates?.attempts !== undefined ? { attempts: updates.attempts } : {}),
      ...(updates?.startedAt !== undefined ? { startedAt: updates.startedAt } : {}),
      ...(updates?.completedAt !== undefined ? { completedAt: updates.completedAt } : {}),
      updatedAt: new Date(),
    };

    this.jobsStore.set(id, updated);
    return updated;
  }
}

export const jobRepository = new JobRepository();
