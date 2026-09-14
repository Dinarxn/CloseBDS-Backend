import { z } from 'zod';

export const listNotificationsQuerySchema = z.object({
  isRead: z
    .enum(['true', 'false'])
    .transform((val) => val === 'true')
    .optional(),
  type: z.enum(['INFO', 'SUCCESS', 'WARNING', 'ERROR']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const createNotificationSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  message: z.string().trim().min(1, 'Message is required').max(2000),
  type: z.enum(['INFO', 'SUCCESS', 'WARNING', 'ERROR']).default('INFO'),
  targetUserId: z.string().uuid('Valid target user ID required').optional(),
});

export type ListNotificationsQueryParams = z.infer<typeof listNotificationsQuerySchema>;
export type CreateNotificationBody = z.infer<typeof createNotificationSchema>;
