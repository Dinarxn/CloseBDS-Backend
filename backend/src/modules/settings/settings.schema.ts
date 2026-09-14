import { z } from 'zod';

export const updateWorkspaceSettingsSchema = z.object({
  name: z.string().trim().min(1, 'Workspace name cannot be empty').max(100).optional(),
  killSwitchActive: z.boolean().optional(),
  defaultDailyCap: z.coerce.number().int().min(1).max(500).optional(),
  safetyThreshold: z.coerce.number().int().min(0).max(100).optional(),
});

export const updateUserPreferencesSchema = z.object({
  emailNotifications: z.boolean().optional(),
  qualificationAlerts: z.boolean().optional(),
  outreachApprovalAlerts: z.boolean().optional(),
  taskDueAlerts: z.boolean().optional(),
  theme: z.enum(['dark', 'light', 'system']).optional(),
  language: z.string().trim().min(2).max(10).optional(),
});

export const createSuppressionSchema = z.object({
  type: z.enum(['EMAIL', 'DOMAIN']),
  value: z.string().trim().min(1, 'Suppression target value cannot be blank').max(255),
  reason: z.enum(['OPT_OUT', 'HARD_BOUNCE', 'MANUAL_SUPPRESSION']).default('MANUAL_SUPPRESSION'),
});

export const listSuppressionsQuerySchema = z.object({
  type: z.enum(['EMAIL', 'DOMAIN']).optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type UpdateWorkspaceSettingsBody = z.infer<typeof updateWorkspaceSettingsSchema>;
export type UpdateUserPreferencesBody = z.infer<typeof updateUserPreferencesSchema>;
export type CreateSuppressionBody = z.infer<typeof createSuppressionSchema>;
export type ListSuppressionsQueryParams = z.infer<typeof listSuppressionsQuerySchema>;
