import { z } from 'zod';

export const saveAuditObservationSchema = z.object({
  domain: z.string().min(1, 'Domain is required').max(255),
  mobileOptimized: z.boolean().default(false),
  bookingCtaVisible: z.boolean().default(false),
  auditGaps: z.array(z.string().max(255)).default([]),
  rawAuditData: z.record(z.unknown()).optional(),
});

export const triggerResearchSchema = z.object({
  domain: z.string().max(255).optional(),
  htmlSnippet: z.string().max(50000).optional(),
  manualObservations: saveAuditObservationSchema.optional(),
});

export type SaveAuditObservationInput = z.infer<typeof saveAuditObservationSchema>;
export type TriggerResearchInput = z.infer<typeof triggerResearchSchema>;
