import { z } from 'zod';

export const leadDiscoveryQuerySchema = z.object({
  campaignId: z.string().uuid('Valid campaign ID is required'),
  niche: z.string().min(1, 'Niche is required').max(100),
  location: z.string().min(1, 'Location is required').max(100),
  limit: z.coerce.number().int().positive().max(50).default(10),
  countryCode: z.string().max(10).optional(),
});

export type LeadDiscoveryQueryInput = z.infer<typeof leadDiscoveryQuerySchema>;

export const closeBDSContactSchema = z.object({
  fullName: z.string().min(1, 'Contact full name is required').max(200),
  email: z.string().email('Valid contact email is required').max(255),
  title: z.string().max(100).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  isPrimary: z.boolean().optional().default(true),
});

export type CloseBDSContactInput = z.infer<typeof closeBDSContactSchema>;

export const closeBDSLeadSchema = z.object({
  externalId: z.string().min(1, 'External lead ID is required').max(200),
  businessName: z.string().min(1, 'Business name is required').max(255),
  domain: z.string().max(255).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  contact: closeBDSContactSchema.optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

export type CloseBDSLeadInput = z.infer<typeof closeBDSLeadSchema>;

export const closeBDSImportBodySchema = z.object({
  leads: z
    .array(closeBDSLeadSchema)
    .min(1, 'At least one lead is required in the import batch')
    .max(100, 'Maximum batch size is 100 leads per import request'),
});

export type CloseBDSImportBodyInput = z.infer<typeof closeBDSImportBodySchema>;
