import type { EmailEventType } from '@prisma/client';

export type WebhookProvider = 'resend' | 'sendgrid' | 'whatsapp' | 'generic';

export type NormalizedEventType = EmailEventType;

export interface NormalizedWebhookEvent {
  eventId: string;
  provider: WebhookProvider;
  eventType: NormalizedEventType;
  recipientEmail?: string;
  recipientPhone?: string;
  messageId?: string;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
}

export interface WebhookProcessingResult {
  success: boolean;
  action: 'EVENT_RECORDED' | 'SUPPRESSION_ADDED' | 'CRM_STAGE_UPDATED' | 'IGNORED_DUPLICATE';
  eventId: string;
  normalizedType: NormalizedEventType;
  duplicate: boolean;
  message?: string;
}

export interface StoredIntegrationEvent {
  id: string;
  workspaceId?: string;
  provider: WebhookProvider;
  eventId: string;
  eventType: NormalizedEventType;
  recipientEmail?: string;
  recipientPhone?: string;
  status: 'PROCESSED' | 'FAILED' | 'DUPLICATE';
  occurredAt: Date;
  createdAt: Date;
}
