import { z } from 'zod';

export const jobTypeSchema = z.enum([
  'LEAD_DEDUPLICATION_JOB',
  'WEBSITE_AUDIT_JOB',
  'AI_QUALIFICATION_JOB',
  'AI_PERSONALIZATION_JOB',
  'ANALYTICS_AGGREGATION_JOB',
  'CLEANUP_JOB',
]);

export const jobStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'RETRYING',
  'CANCELLED',
]);

export const createJobSchema = z.object({
  type: jobTypeSchema,
  payload: z.record(z.unknown()).default({}),
  idempotencyKey: z.string().trim().max(100).optional(),
  maxRetries: z.coerce.number().int().min(0).max(5).default(3),
});

export const listJobsQuerySchema = z.object({
  type: jobTypeSchema.optional(),
  status: jobStatusSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type CreateJobBody = z.infer<typeof createJobSchema>;
export type ListJobsQueryParams = z.infer<typeof listJobsQuerySchema>;
