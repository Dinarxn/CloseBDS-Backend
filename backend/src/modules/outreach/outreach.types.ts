import type { EmailMessageStatus } from '@prisma/client';

export type OutreachChannel = 'EMAIL' | 'WHATSAPP' | 'CALL';

export type OutreachLifecycleStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'SENT'
  | 'FAILED';

export interface OutreachItem {
  id: string;
  workspaceId: string;
  campaignId: string;
  campaignName: string;
  leadId: string;
  leadBusinessName: string;
  contactId: string;
  contactName: string;
  recipientEmail: string;
  toEmail?: string;
  fromEmail?: string;
  fromName?: string;
  emailCampaignId?: string;
  channel: OutreachChannel;
  subject: string;
  bodyText: string;
  status: EmailMessageStatus;
  humanApprovalRequired: boolean;
  isApproved: boolean;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lead?: any;
  contact?: any;
}

export interface SafetyCheckDecision {
  allowed: boolean;
  reasons: string[];
  checkedAt: Date;
  outreachId: string;
  workspaceId: string;
  isApproved: boolean;
  isSuppressed: boolean;
  withinDailyCap: boolean;
  hasValidRecipient: boolean;
  hasValidContent: boolean;
}
