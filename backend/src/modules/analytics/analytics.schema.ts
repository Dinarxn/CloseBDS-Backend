import { z } from 'zod';

export const dateRangeFilterSchema = z.object({
  from: z.string().datetime({ message: 'from must be an ISO 8601 datetime string' }).optional(),
  to: z.string().datetime({ message: 'to must be an ISO 8601 datetime string' }).optional(),
  campaignId: z.string().uuid('Valid campaign ID format required').optional(),
});

export const campaignAnalyticsParamsSchema = z.object({
  campaignId: z.string().uuid('Valid campaign ID is required'),
});

export const exportAnalyticsQuerySchema = z.object({
  campaignId: z.string().uuid('Valid campaign ID format required').optional(),
  from: z.string().datetime({ message: 'from must be an ISO 8601 datetime string' }).optional(),
  to: z.string().datetime({ message: 'to must be an ISO 8601 datetime string' }).optional(),
  format: z.enum(['csv', 'json']).default('json'),
});

export type DateRangeFilter = z.infer<typeof dateRangeFilterSchema>;
export type CampaignAnalyticsParams = z.infer<typeof campaignAnalyticsParamsSchema>;
export type ExportAnalyticsQuery = z.infer<typeof exportAnalyticsQuerySchema>;
