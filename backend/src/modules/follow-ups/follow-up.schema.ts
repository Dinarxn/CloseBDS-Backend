import { z } from 'zod';

export const createTaskSchema = z.object({
  leadId: z.string().uuid('Valid lead ID is required'),
  assignedToUserId: z.string().uuid('Valid assigned user ID format required').optional(),
  title: z
    .string()
    .trim()
    .min(1, 'Title is required and cannot be blank')
    .max(255, 'Title cannot exceed 255 characters'),
  description: z.string().trim().max(5000, 'Description cannot exceed 5000 characters').optional(),
  dueDate: z.coerce.date().optional(),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).default('PENDING'),
});

export const updateTaskSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title cannot be blank')
    .max(255, 'Title cannot exceed 255 characters')
    .optional(),
  description: z
    .string()
    .trim()
    .max(5000, 'Description cannot exceed 5000 characters')
    .nullable()
    .optional(),
  dueDate: z.coerce.date().nullable().optional(),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  assignedToUserId: z.string().uuid('Valid assigned user ID format required').nullable().optional(),
});

export const listTasksQuerySchema = z.object({
  leadId: z.string().uuid().optional(),
  assignedToUserId: z.string().uuid().optional(),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type CreateTaskBody = z.input<typeof createTaskSchema>;
export type UpdateTaskBody = z.input<typeof updateTaskSchema>;
export type ListTasksQueryParams = z.input<typeof listTasksQuerySchema>;
