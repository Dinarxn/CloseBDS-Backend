import {
  TaskRepository,
  CRMActivityRepository,
  AuditRepository,
  taskRepository as defaultTaskRepo,
  crmActivityRepository as defaultCRMRepo,
  auditRepository as defaultAuditRepo,
  type TaskWithRelations,
  type PaginationResult,
} from '../../database/repository.js';
import { databaseClient, type DatabaseClient } from '../../database/client.js';
import { NotFoundError, BadRequestError } from '../../core/errors/api-error.js';
import type {
  CreateTaskBody,
  UpdateTaskBody,
  ListTasksQueryParams,
} from './follow-up.schema.js';
import type { FollowUpTaskItem } from './follow-up.types.js';
import type { TaskStatus } from '@prisma/client';

/**
 * Authoritative Task Lifecycle State Transition Matrix.
 */
export const ALLOWED_TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  PENDING: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  IN_PROGRESS: ['PENDING', 'COMPLETED', 'CANCELLED'],
  COMPLETED: ['PENDING', 'IN_PROGRESS'], // Re-opening
  CANCELLED: ['PENDING', 'IN_PROGRESS'], // Re-opening
};

export class FollowUpService {
  constructor(
    private taskRepo: TaskRepository = defaultTaskRepo,
    private crmRepo: CRMActivityRepository = defaultCRMRepo,
    private auditLogger: AuditRepository = defaultAuditRepo,
    private db: DatabaseClient = databaseClient
  ) {}

  private mapToFollowUpItem(entity: TaskWithRelations): FollowUpTaskItem {
    return {
      id: entity.id,
      leadId: entity.leadId,
      leadBusinessName: entity.lead.businessName,
      assignedToUserId: entity.assignedToUserId,
      assignedUserName: entity.assignee?.name || null,
      title: entity.title,
      description: entity.description,
      dueDate: entity.dueDate,
      status: entity.status,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  /**
   * Creates an internal actionable follow-up task.
   * Hardcoded safety guarantee: Creating a task never triggers external messaging or dispatch.
   */
  async createTask(
    workspaceId: string,
    userId: string | undefined,
    body: CreateTaskBody
  ): Promise<FollowUpTaskItem> {
    const task = await this.taskRepo.create(workspaceId, {
      leadId: body.leadId,
      assignedToUserId: body.assignedToUserId,
      title: body.title,
      description: body.description,
      dueDate: body.dueDate,
      status: body.status,
    });

    const item = this.mapToFollowUpItem(task);

    try {
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'task:created',
        entityType: 'Task',
        entityId: item.id,
        metadata: {
          leadId: item.leadId,
          title: item.title,
          status: item.status,
        },
      });
    } catch {
      // Non-blocking audit failure
    }

    // Outbound n8n webhook notification
    try {
      const { n8nService } = await import('../integrations/n8n/n8n.service.js');
      n8nService.dispatchOutboundWebhook(workspaceId, 'follow_up.created', {
        taskId: item.id,
        leadId: item.leadId,
        title: item.title,
        status: item.status,
      }).catch(() => {});
    } catch {
      // Non-blocking
    }

    return item;
  }

  /**
   * Lists paginated follow-up tasks with workspace isolation and filters.
   */
  async listTasks(
    workspaceId: string,
    query: ListTasksQueryParams
  ): Promise<PaginationResult<FollowUpTaskItem>> {
    const result = await this.taskRepo.findManyPaginated(workspaceId, {
      leadId: query.leadId,
      assignedToUserId: query.assignedToUserId,
      status: query.status,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });

    return {
      data: result.data.map((t) => this.mapToFollowUpItem(t)),
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    };
  }

  /**
   * Retrieves a single follow-up task by ID.
   */
  async getTask(id: string, workspaceId: string): Promise<FollowUpTaskItem> {
    const task = await this.taskRepo.findById(id, workspaceId);
    if (!task) {
      throw new NotFoundError('Task not found or access denied for this workspace');
    }
    return this.mapToFollowUpItem(task);
  }

  /**
   * Updates task details or marks it COMPLETED/CANCELLED.
   * Enforces lifecycle transition rules and records CRM completion events atomically.
   */
  async updateTask(
    id: string,
    workspaceId: string,
    userId: string | undefined,
    body: UpdateTaskBody
  ): Promise<FollowUpTaskItem> {
    const existing = await this.taskRepo.findById(id, workspaceId);
    if (!existing) {
      throw new NotFoundError('Task not found or access denied for this workspace');
    }

    // 1. Lifecycle transition validation
    if (body.status && body.status !== existing.status) {
      const allowedNext = ALLOWED_TASK_TRANSITIONS[existing.status] || [];
      if (!allowedNext.includes(body.status)) {
        throw new BadRequestError(
          `Invalid task status transition from ${existing.status} to ${body.status}. Allowed transitions: ${allowedNext.join(', ')}`
        );
      }
    }

    const updatedTask = await this.db.transaction(async () => {
      // a. Update task in database
      const task = await this.taskRepo.update(id, workspaceId, {
        title: body.title,
        description: body.description === null ? undefined : body.description,
        dueDate: body.dueDate === null ? undefined : body.dueDate,
        status: body.status,
        assignedToUserId: body.assignedToUserId === null ? undefined : body.assignedToUserId,
      });

      // b. If marked COMPLETED, log internal CRM activity on lead timeline
      if (body.status === 'COMPLETED' && existing.status !== 'COMPLETED') {
        try {
          await this.crmRepo.create(workspaceId, {
            leadId: existing.leadId,
            userId,
            type: 'NOTE',
            description: `Task completed: "${task.title}"`,
            metadata: {
              taskId: task.id,
              status: 'COMPLETED',
            },
          });
        } catch {
          // CRM note fallback
        }
      }

      // c. Append immutable audit log
      try {
        await this.auditLogger.create({
          workspaceId,
          userId,
          eventType: task.status === 'COMPLETED' ? 'task:completed' : 'task:updated',
          entityType: 'Task',
          entityId: task.id,
          metadata: {
            title: task.title,
            previousStatus: existing.status,
            newStatus: task.status,
          },
        });
      } catch {
        // Non-blocking audit failure
      }

      return task;
    });

    return this.mapToFollowUpItem(updatedTask);
  }

  /**
   * Deletes a follow-up task.
   */
  async deleteTask(
    id: string,
    workspaceId: string,
    userId: string | undefined
  ): Promise<boolean> {
    await this.taskRepo.delete(id, workspaceId);

    try {
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'task:deleted',
        entityType: 'Task',
        entityId: id,
        metadata: {
          taskId: id,
        },
      });
    } catch {
      // Non-blocking audit failure
    }

    return true;
  }
}

export const followUpService = new FollowUpService();
