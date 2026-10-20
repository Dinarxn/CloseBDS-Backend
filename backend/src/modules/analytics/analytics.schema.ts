import { z } from 'zod';

const normalizeDate = (val: unknown): string | undefined => {
  if (typeof val !== 'string' || !val.trim()) return undefined;
  const d = new Date(val);
  if (!isNaN(d.getTime())) {
    return d.toISOString();
  }
  return val;
};

const preprocessDateRange = (raw: unknown) => {
  if (typeof raw !== 'object' || raw === null) return raw;
  const obj = { ...(raw as Record<string, unknown>) };
  if (!obj.from && obj.startDate) {
    obj.from = obj.startDate;
  }
  if (!obj.to && obj.endDate) {
    obj.to = obj.endDate;
  }
  if (typeof obj.from === 'string') {
    obj.from = normalizeDate(obj.from);
  }
  if (typeof obj.to === 'string') {
    obj.to = normalizeDate(obj.to);
  }
  return obj;
};

export const dateRangeFilterSchema = z.preprocess(
  preprocessDateRange,
  z.object({
    from: z.string().datetime({ message: 'from must be an ISO 8601 datetime string' }).optional(),
    to: z.string().datetime({ message: 'to must be an ISO 8601 datetime string' }).optional(),
    campaignId: z.string().uuid('Valid campaign ID format required').optional(),
  })
);

export const campaignAnalyticsParamsSchema = z.object({
  campaignId: z.string().uuid('Valid campaign ID is required'),
});

export const exportAnalyticsQuerySchema = z.preprocess(
  preprocessDateRange,
  z.object({
    campaignId: z.string().uuid('Valid campaign ID format required').optional(),
    from: z.string().datetime({ message: 'from must be an ISO 8601 datetime string' }).optional(),
    to: z.string().datetime({ message: 'to must be an ISO 8601 datetime string' }).optional(),
    format: z.enum(['csv', 'json']).default('json'),
  })
);

export type DateRangeFilter = z.infer<typeof dateRangeFilterSchema>;
export type CampaignAnalyticsParams = z.infer<typeof campaignAnalyticsParamsSchema>;
export type ExportAnalyticsQuery = z.infer<typeof exportAnalyticsQuerySchema>;
