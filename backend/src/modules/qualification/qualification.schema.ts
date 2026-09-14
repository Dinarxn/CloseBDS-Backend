import { z } from 'zod';

export const qualifyLeadSchema = z.object({
  criteria: z.array(z.string().max(255)).default([]),
  manualScoreOverride: z
    .object({
      relevanceScore: z.number().min(0).max(100),
      opportunityScore: z.number().min(0).max(100),
      rationale: z.string().min(1).max(1000),
      summary: z.string().min(1).max(1000),
      opportunityPoints: z.array(z.string().max(255)).default([]),
      riskFactors: z.array(z.string().max(255)).default([]),
    })
    .optional(),
});

export type QualifyLeadInput = z.infer<typeof qualifyLeadSchema>;
