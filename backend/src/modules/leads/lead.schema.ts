import { z } from 'zod';

export const leadStatusEnum = z.enum([
  'NEW',
  'QUALIFIED',
  'CALL_READY',
  'DISQUALIFIED',
  'CONTACTED',
  'REPLIED',
  'OPT_OUT',
]);

export const leadApprovalBodySchema = z.object({
  reason: z.string().max(500).optional(),
});

export const createContactSchema = z.object({
  fullName: z.string().min(1, 'Contact full name is required').max(100),
  email: z.string().email('Invalid contact email address'),
  title: z.string().max(100).optional(),
  phone: z.string().max(50).optional(),
  isPrimary: z.boolean().default(false).optional(),
});

export const updateContactSchema = z.object({
  fullName: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  title: z.string().max(100).optional(),
  phone: z.string().max(50).optional(),
  isPrimary: z.boolean().optional(),
});

export const createLeadSchema = z.object({
  campaignId: z.string().uuid('Valid campaign ID is required'),
  businessName: z.string().min(1, 'Business name is required').max(150),
  domain: z.string().max(255).optional(),
  phone: z.string().max(50).optional(),
  address: z.string().max(255).optional(),
  status: leadStatusEnum.default('NEW').optional(),
  contacts: z.array(createContactSchema).optional(),
});

export const updateLeadSchema = z.object({
  businessName: z.string().min(1).max(150).optional(),
  domain: z.string().max(255).optional(),
  phone: z.string().max(50).optional(),
  address: z.string().max(255).optional(),
  status: leadStatusEnum.optional(),
});

export const leadQuerySchema = z.object({
  campaignId: z.string().uuid().optional(),
  status: leadStatusEnum.optional(),
  search: z.string().max(100).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const leadAiParamsSchema = z.object({
  id: z.string().min(1, 'Lead ID is required'),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type LeadQueryInput = z.infer<typeof leadQuerySchema>;
export type LeadAiParamsInput = z.infer<typeof leadAiParamsSchema>;

