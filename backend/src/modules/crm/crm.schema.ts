import { z } from 'zod';

export const recordCRMActivitySchema = z.object({
  type: z.enum(['STAGE_CHANGE', 'NOTE', 'CALL_LOG', 'EMAIL_SENT', 'EMAIL_REPLIED']),
  description: z
    .string()
    .trim()
    .min(1, 'Description is required and cannot be blank')
    .max(10000, 'Description cannot exceed 10,000 characters'),
  metadata: z.record(z.unknown()).optional(),
});

export const updateLeadStageSchema = z.preprocess(
  (val: unknown) => {
    if (val && typeof val === 'object') {
      const obj = { ...(val as Record<string, unknown>) };
      if (!('status' in obj) && 'stage' in obj) {
        obj.status = obj.stage;
      }
      if (!('note' in obj) && 'notes' in obj) {
        obj.note = obj.notes;
      }
      if (!('notes' in obj) && 'note' in obj) {
        obj.notes = obj.note;
      }
      return obj;
    }
    return val;
  },
  z.object({
    status: z.enum([
      'DISCOVERED',
      'IMPORTED',
      'NEW',
      'RESEARCH_PENDING',
      'RESEARCHED',
      'QUALIFICATION_PENDING',
      'QUALIFIED',
      'CALL_READY',
      'CONTACTED',
      'REPLIED',
      'INTERESTED',
      'MEETING',
      'WON',
      'LOST',
      'DISQUALIFIED',
      'OPT_OUT',
    ]),
    note: z.string().trim().max(1000, 'Note cannot exceed 1,000 characters').optional(),
    notes: z.string().trim().max(1000, 'Note cannot exceed 1,000 characters').optional(),
  })
);

export type RecordCRMActivityBody = z.infer<typeof recordCRMActivitySchema>;
export type UpdateLeadStageBody = z.infer<typeof updateLeadStageSchema>;
