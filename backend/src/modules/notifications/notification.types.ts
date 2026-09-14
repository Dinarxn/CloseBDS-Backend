import type { Notification, NotificationType } from '@prisma/client';

export type { Notification, NotificationType };

export interface NotificationItem {
  id: string;
  workspaceId: string;
  userId: string;
  title: string;
  message: string;
  type: NotificationType;
  isRead: boolean;
  createdAt: Date;
}

export type NotificationEventType =
  | 'LEAD_QUALIFIED'
  | 'RESEARCH_COMPLETED'
  | 'OUTREACH_DRAFT_GENERATED'
  | 'OUTREACH_APPROVAL_REQUIRED'
  | 'OUTREACH_REJECTED'
  | 'TASK_DUE'
  | 'TASK_COMPLETED'
  | 'CRM_STAGE_CHANGED'
  | 'SYSTEM_SECURITY';
