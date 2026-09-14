import { z } from 'zod';

export const generatePersonalizationSchema = z.object({
  contactId: z.string().uuid('Valid contact ID is required').optional(),
  targetOffer: z.string().min(1).max(255).optional(),
  manualCopyOverride: z
    .object({
      subjectLine: z.string().min(1).max(255),
      openingHook: z.string().min(1).max(1000),
      bodyText: z.string().min(1).max(10000),
      factReferences: z.array(z.string().max(255)).default([]),
    })
    .optional(),
});

export type GeneratePersonalizationInput = z.infer<typeof generatePersonalizationSchema>;
