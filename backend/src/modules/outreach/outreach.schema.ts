import { z } from 'zod';

export const createOutreachDraftSchema = z.object({
  campaignId: z.string().uuid('Valid campaign ID is required'),
  contactId: z.string().uuid('Valid contact ID is required'),
  channel: z.enum(['EMAIL', 'WHATSAPP', 'CALL']).default('EMAIL'),
  subject: z.string().min(1, 'Subject is required').max(255),
  bodyText: z.string().min(1, 'Body text is required').max(50000),
});

export const updateOutreachDraftSchema = z.object({
  subject: z.string().min(1).max(255).optional(),
  bodyText: z.string().min(1).max(50000).optional(),
});

export const listOutreachQuerySchema = z.object({
  campaignId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  channel: z.enum(['EMAIL', 'WHATSAPP', 'CALL']).optional(),
  status: z.enum(['DRAFT', 'APPROVED', 'QUEUED', 'SENT', 'REJECTED', 'FAILED']).optional(),
  search: z.string().max(100).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type CreateOutreachDraftInput = z.infer<typeof createOutreachDraftSchema>;
export type UpdateOutreachDraftInput = z.infer<typeof updateOutreachDraftSchema>;
export type ListOutreachQueryParams = z.infer<typeof listOutreachQuerySchema>;
