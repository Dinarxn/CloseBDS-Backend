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

export const appointmentStatusEnum = z.enum([
  'SCHEDULED',
  'CONFIRMED',
  'CANCELLED',
  'COMPLETED',
  'RESCHEDULED',
  'NO_SHOW',
]);

export const createAppointmentSchema = z
  .object({
    leadId: z.string().uuid('Valid lead ID is required').optional(),
    contactId: z.string().uuid().optional(),
    title: z.string().min(1).max(200).default('Meeting').optional(),
    scheduledStartTime: z.string().datetime(),
    scheduledEndTime: z.string().datetime(),
    meetingLink: z.string().url().max(500).optional(),
    notes: z.string().max(2000).optional(),
    status: appointmentStatusEnum.default('SCHEDULED').optional(),
  })
  .refine(
    (data) => new Date(data.scheduledEndTime) > new Date(data.scheduledStartTime),
    { message: 'scheduledEndTime must be after scheduledStartTime', path: ['scheduledEndTime'] }
  );

export const updateAppointmentSchema = z
  .object({
    contactId: z.string().uuid().optional(),
    title: z.string().min(1).max(200).optional(),
    scheduledStartTime: z.string().datetime().optional(),
    scheduledEndTime: z.string().datetime().optional(),
    meetingLink: z.string().url().max(500).optional(),
    status: appointmentStatusEnum.optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine(
    (data) => {
      if (data.scheduledStartTime && data.scheduledEndTime) {
        return new Date(data.scheduledEndTime) > new Date(data.scheduledStartTime);
      }
      return true;
    },
    { message: 'scheduledEndTime must be after scheduledStartTime', path: ['scheduledEndTime'] }
  );

export const listAppointmentsQuerySchema = z.object({
  leadId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  status: appointmentStatusEnum.optional(),
  startDate: z.string().datetime().optional().transform((val) => (val ? new Date(val) : undefined)),
  endDate: z.string().datetime().optional().transform((val) => (val ? new Date(val) : undefined)),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type CreateAppointmentBody = z.infer<typeof createAppointmentSchema>;
export type UpdateAppointmentBody = z.infer<typeof updateAppointmentSchema>;
export type ListAppointmentsQueryParams = z.infer<typeof listAppointmentsQuerySchema>;
