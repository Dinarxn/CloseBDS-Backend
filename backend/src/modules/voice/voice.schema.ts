import { z } from 'zod';

export const CreateVoiceCampaignSchema = z.object({
  campaignId: z.string().uuid(),
  dailyCallCap: z.number().int().min(1).max(500).default(25),
  maxAttemptsPerLead: z.number().int().min(1).max(10).default(3),
  retryDelayMinutes: z.number().int().min(15).max(10080).default(120),
  allowedCallingDays: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  callingWindowStart: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid 24h format HH:MM').default('09:00'),
  callingWindowEnd: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid 24h format HH:MM').default('17:00'),
  recordingConsent: z.boolean().default(false),
  agentConfigId: z.string().uuid().optional().nullable(),
});

export const UpdateCallingPolicySchema = z.object({
  dailyCallLimit: z.number().int().min(1).max(500).optional(),
  maxConcurrentCalls: z.number().int().min(1).max(50).optional(),
  maxAttemptsPerLead: z.number().int().min(1).max(20).optional(),
  retryDelayMinutes: z.number().int().min(5).max(10080).optional(),
  allowedCallingDays: z.array(z.number().int().min(0).max(6)).optional(),
  callingWindowStart: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid 24h format HH:MM').optional(),
  callingWindowEnd: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Invalid 24h format HH:MM').optional(),
  recordingConsent: z.boolean().optional(),
  humanApprovalRequired: z.boolean().optional(),
  providerRestrictions: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

export const CreateVoiceAgentConfigSchema = z.object({
  name: z.string().min(2).max(100),
  callObjective: z.string().min(10).max(500),
  openingScript: z.string().min(10).max(2000),
  qualificationQuestions: z.array(z.string().min(5)).default([]),
  approvedTalkingPoints: z.array(z.string().min(5)).default([]),
  objectionHandling: z.record(z.string()).optional(),
  prohibitedClaims: z.array(z.string().min(5)).default([]),
  escalationConditions: z.array(z.string().min(5)).default([]),
  fallbackBehavior: z.string().max(1000).optional(),
  maxDurationSeconds: z.number().int().min(30).max(1800).default(300),
});

export const PrepareCallSchema = z.object({
  campaignId: z.string().uuid().optional(),
  leadId: z.string().uuid(),
  contactId: z.string().uuid(),
  agentConfigId: z.string().uuid().optional().nullable(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const CreateCallSchema = z.object({
  campaignId: z.string().uuid().optional(),
  leadId: z.string().uuid(),
  contactId: z.string().uuid(),
  agentConfigId: z.string().uuid().optional().nullable(),
  humanApprovalRequired: z.boolean().default(true),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const ApproveCallSchema = z.object({
  callId: z.string().uuid(),
});

export const RejectCallSchema = z.object({
  callId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

export const CancelCallSchema = z.object({
  callId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

export const DispatchCallSchema = z.object({
  callId: z.string().uuid(),
  streamUrl: z.string().url().optional(),
});

export const RecordCallTurnSchema = z.object({
  turnIndex: z.number().int().min(0),
  speaker: z.enum(['agent', 'lead', 'system']),
  text: z.string().min(1).max(5000),
  confidence: z.number().min(0).max(1).optional(),
  timestampMs: z.number().int().min(0).optional(),
});

export const ListCallsQuerySchema = z.object({
  campaignId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  status: z.enum([
    'QUEUED',
    'SAFETY_CHECKING',
    'APPROVAL_REQUIRED',
    'APPROVED',
    'INITIATING',
    'RINGING',
    'IN_PROGRESS',
    'COMPLETED',
    'BLOCKED',
    'FAILED',
    'CANCELLED',
    'NO_ANSWER',
    'BUSY',
    'VOICEMAIL',
    'OPTED_OUT',
  ]).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const TwilioWebhookSchema = z.record(z.string());
