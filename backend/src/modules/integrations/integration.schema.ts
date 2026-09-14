import { z } from 'zod';

export const webhookParamsSchema = z.object({
  provider: z.enum(['resend', 'sendgrid', 'whatsapp', 'generic']),
});

export const webhookPayloadSchema = z.object({
  id: z.string().optional(),
  type: z.string().optional(),
  event: z.string().optional(),
  email: z.string().email().optional(),
  recipient: z.string().optional(),
  data: z.record(z.unknown()).optional(),
  message_id: z.string().optional(),
  created_at: z.string().optional(),
  timestamp: z.union([z.number(), z.string()]).optional(),
}).passthrough();

export const listIntegrationEventsQuerySchema = z.object({
  provider: z.enum(['resend', 'sendgrid', 'whatsapp', 'generic']).optional(),
  eventType: z.enum(['DELIVERED', 'BOUNCED', 'OPENED', 'CLICKED', 'REPLIED', 'OPT_OUT']).optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type WebhookParams = z.infer<typeof webhookParamsSchema>;
export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;
export type ListIntegrationEventsQuery = z.infer<typeof listIntegrationEventsQuerySchema>;
