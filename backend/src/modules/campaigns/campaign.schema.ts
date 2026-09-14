import { z } from 'zod';

export const campaignStatusEnum = z.enum([
  'DRAFT',
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
]);

export const createCampaignSchema = z.object({
  name: z.string().min(1, 'Campaign name is required').max(150),
  niche: z.string().min(1, 'Niche is required').max(100),
  location: z.string().min(1, 'Target location is required').max(100),
  targetOffer: z.string().min(1, 'Target offer is required').max(255),
  dailyCap: z.coerce.number().int().positive().max(500).default(50).optional(),
});

export const updateCampaignSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  niche: z.string().min(1).max(100).optional(),
  location: z.string().min(1).max(100).optional(),
  targetOffer: z.string().min(1).max(255).optional(),
  dailyCap: z.coerce.number().int().positive().max(500).optional(),
  status: campaignStatusEnum.optional(),
});

export const campaignQuerySchema = z.object({
  status: campaignStatusEnum.optional(),
  search: z.string().max(100).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
export type CampaignQueryInput = z.infer<typeof campaignQuerySchema>;
