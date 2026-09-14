import {
  NotificationRepository,
  notificationRepository as defaultNotificationRepo,
  type PaginationResult,
} from '../../database/repository.js';
import { NotFoundError } from '../../core/errors/api-error.js';
import type { ListNotificationsQueryParams } from './notification.schema.js';
import type {
  NotificationItem,
  Notification,
  NotificationType,
  NotificationEventType,
} from './notification.types.js';

export class NotificationService {
  constructor(private notificationRepo: NotificationRepository = defaultNotificationRepo) {}

  private mapToItem(entity: Notification): NotificationItem {
    return {
      id: entity.id,
      workspaceId: entity.workspaceId,
      userId: entity.userId,
      title: entity.title,
      message: entity.message,
      type: entity.type,
      isRead: entity.isRead,
      createdAt: entity.createdAt,
    };
  }

  /**
   * Retrieves single notification by ID with workspace and user scoping.
   */
  async getNotification(
    id: string,
    userId: string,
    workspaceId: string
  ): Promise<NotificationItem> {
    const notification = await this.notificationRepo.findById(id, userId, workspaceId);
    if (!notification) {
      throw new NotFoundError('Notification not found or access denied');
    }
    return this.mapToItem(notification);
  }

  /**
   * Lists notifications for authenticated user with pagination and filters.
   */
  async listNotifications(
    userId: string,
    workspaceId: string,
    query: ListNotificationsQueryParams
  ): Promise<PaginationResult<NotificationItem>> {
    const result = await this.notificationRepo.findManyPaginated(userId, workspaceId, {
      isRead: query.isRead,
      type: query.type,
      page: query.page,
      limit: query.limit,
    });

    return {
      data: result.data.map((n) => this.mapToItem(n)),
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    };
  }

  /**
   * Returns count of unread notifications for authenticated user.
   */
  async getUnreadCount(userId: string, workspaceId: string): Promise<number> {
    return this.notificationRepo.countUnread(userId, workspaceId);
  }

  /**
   * Creates an in-app notification for a user.
   */
  async createNotification(
    workspaceId: string,
    userId: string,
    title: string,
    message: string,
    type?: NotificationType
  ): Promise<NotificationItem> {
    const notification = await this.notificationRepo.create({
      workspaceId,
      userId,
      title,
      message,
      type,
    });
    return this.mapToItem(notification);
  }

  /**
   * Creates event-driven internal notification.
   */
  async createEventNotification(
    workspaceId: string,
    userId: string,
    eventType: NotificationEventType,
    metadata?: { businessName?: string; title?: string; details?: string }
  ): Promise<NotificationItem> {
    let title: string;
    let message: string;
    let type: NotificationType = 'INFO';

    switch (eventType) {
      case 'LEAD_QUALIFIED':
        title = 'Lead Qualified';
        message = `Lead ${metadata?.businessName || 'Entity'} has met qualification criteria.`;
        type = 'SUCCESS';
        break;
      case 'RESEARCH_COMPLETED':
        title = 'Lead Research Completed';
        message = `Technical audit and research finalized for ${metadata?.businessName || 'lead'}.`;
        type = 'INFO';
        break;
      case 'OUTREACH_DRAFT_GENERATED':
        title = 'Outreach Draft Generated';
        message = `Personalized outreach draft ready for review for ${metadata?.businessName || 'contact'}.`;
        type = 'INFO';
        break;
      case 'OUTREACH_APPROVAL_REQUIRED':
        title = 'Human Approval Required';
        message = `Outreach message for ${metadata?.businessName || 'contact'} awaits explicit human approval.`;
        type = 'WARNING';
        break;
      case 'OUTREACH_REJECTED':
        title = 'Outreach Rejected';
        message = `Outreach message draft for ${metadata?.businessName || 'contact'} was rejected.`;
        type = 'WARNING';
        break;
      case 'TASK_DUE':
        title = 'Follow-up Task Due';
        message = `Task "${metadata?.title || 'Action item'}" is due for review.`;
        type = 'WARNING';
        break;
      case 'TASK_COMPLETED':
        title = 'Task Completed';
        message = `Task "${metadata?.title || 'Action item'}" was marked completed.`;
        type = 'SUCCESS';
        break;
      case 'CRM_STAGE_CHANGED':
        title = 'CRM Stage Changed';
        message = `Lead ${metadata?.businessName || 'entity'} stage updated: ${metadata?.details || 'stage transition'}.`;
        type = 'INFO';
        break;
      case 'SYSTEM_SECURITY':
        title = 'Security Alert';
        message = metadata?.details || 'Security event recorded.';
        type = 'ERROR';
        break;
    }

    return this.createNotification(workspaceId, userId, title, message, type);
  }

  /**
   * Marks a notification as read.
   */
  async markAsRead(id: string, userId: string, workspaceId: string): Promise<NotificationItem> {
    const updated = await this.notificationRepo.markAsRead(id, userId, workspaceId);
    return this.mapToItem(updated);
  }

  /**
   * Marks all notifications as read for current user.
   */
  async markAllAsRead(userId: string, workspaceId: string): Promise<{ count: number }> {
    const count = await this.notificationRepo.markAllAsRead(userId, workspaceId);
    return { count };
  }

  /**
   * Dismisses / deletes a notification.
   */
  async deleteNotification(id: string, userId: string, workspaceId: string): Promise<boolean> {
    return this.notificationRepo.delete(id, userId, workspaceId);
  }
}

export const notificationService = new NotificationService();
