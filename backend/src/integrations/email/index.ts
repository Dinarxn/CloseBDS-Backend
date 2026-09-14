/**
 * Email Service Provider Types & Contract matching Phase 0 TECH-STACK.md
 */

export interface EmailMessagePayload {
  messageId: string;
  workspaceId: string;
  campaignId: string;
  toEmail: string;
  toName?: string;
  fromEmail: string;
  fromName: string;
  subject: string;
  bodyText: string;
  headers?: Record<string, string>;
}

export interface SendResult {
  messageId: string;
  providerMessageId: string;
  status: 'QUEUED' | 'SENT' | 'FAILED';
  dispatchedAt: Date;
}

export interface DomainStatus {
  domain: string;
  spfValid: boolean;
  dkimValid: boolean;
  dmarcValid: boolean;
  isVerified: boolean;
}

export interface EmailEventPayload {
  eventType: 'DELIVERED' | 'BOUNCED' | 'OPENED' | 'CLICKED' | 'REPLIED' | 'OPT_OUT';
  messageId: string;
  recipientEmail: string;
  timestamp: Date;
  rawEvent?: unknown;
}

/**
 * Email Service Provider Abstraction Contract
 * Decouples system from specific email vendors (Resend, SendGrid, SMTP, etc.)
 */
export interface EmailService {
  sendEmail(message: EmailMessagePayload): Promise<SendResult>;
  verifySenderDomain(domain: string): Promise<DomainStatus>;
  parseWebhookEvent(rawPayload: unknown): EmailEventPayload;
}
