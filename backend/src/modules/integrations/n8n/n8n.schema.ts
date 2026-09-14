import { z } from 'zod';

export const N8nScopeEnum = z.enum([
  'voice:read',
  'voice:prepare',
  'voice:request',
  'leads:read',
  'leads:trigger-ai',
  'outreach:read',
  'outreach:prepare',
  'follow_ups:write',
  'crm:write',
]);

export const CreateN8nIntegrationSchema = z.object({
  name: z.string().min(2).max(100),
  scopes: z.array(N8nScopeEnum).min(1),
  webhookUrl: z.string().url().optional(),
});

export const N8nPrepareCallSchema = z.object({
  campaignId: z.string().min(1).optional(),
  leadId: z.string().min(1),
  contactId: z.string().min(1),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const N8nRequestCallSchema = z.object({
  campaignId: z.string().min(1).optional(),
  leadId: z.string().min(1),
  contactId: z.string().min(1),
  agentConfigId: z.string().min(1).optional().nullable(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const N8nTriggerAiParamsSchema = z.object({
  id: z.string().min(1),
});

export const N8nPrepareOutreachSchema = z.object({
  campaignId: z.string().min(1).optional(),
  contactId: z.string().min(1),
  channel: z.enum(['EMAIL', 'WHATSAPP', 'CALL']).default('EMAIL'),
  subject: z.string().max(255).optional(),
  bodyText: z.string().min(1).max(10000),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const N8nCreateFollowUpTaskSchema = z.object({
  leadId: z.string().min(1),
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  dueDate: z.string().datetime().optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});
