import { z } from 'zod';

export const ListOperationsTasksQuerySchema = z.object({
  category: z
    .enum(['all', 'approvals', 'calling', 'research', 'qualification', 'followup', 'crm', 'system'])
    .default('all'),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'ROUTINE']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  page: z.coerce.number().int().min(1).default(1),
});

export const TaskActionBodySchema = z.object({
  reason: z.string().max(500).optional(),
});

export const PrioritizeQueueItemBodySchema = z.object({
  priority: z.number().int().min(1).max(100).default(10),
});
