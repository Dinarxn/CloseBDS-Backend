import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { notificationService } from './notification.service.js';
import {
  listNotificationsQuerySchema,
  createNotificationSchema,
} from './notification.schema.js';
import {
  requireAuthenticatedUser,
  requireWorkspaceContext,
} from '../../core/permissions/auth-guards.js';

export const notificationRouter: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.addHook('preHandler', requireAuthenticatedUser);
  fastify.addHook('preHandler', requireWorkspaceContext);

  // 1. GET /api/v1/notifications - List user's notifications
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId || request.authenticatedUser!.userId;
    const query = listNotificationsQuerySchema.parse(request.query);

    const result = await notificationService.listNotifications(userId, workspaceId, query);

    return reply.status(200).send({
      success: true,
      ...result,
    });
  });

  // 2. GET /api/v1/notifications/unread-count - Unread badge count
  fastify.get('/unread-count', async (request: FastifyRequest, reply: FastifyReply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId || request.authenticatedUser!.userId;

    const unreadCount = await notificationService.getUnreadCount(userId, workspaceId);

    return reply.status(200).send({
      success: true,
      unreadCount,
    });
  });

  // 3. GET /api/v1/notifications/:id - Get single notification
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId || request.authenticatedUser!.userId;

    const notification = await notificationService.getNotification(
      request.params.id,
      userId,
      workspaceId
    );

    return reply.status(200).send({
      success: true,
      notification,
    });
  });

  // 4. POST /api/v1/notifications - Create internal notification
  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const currentUserId = request.workspaceContext!.userId || request.authenticatedUser!.userId;
    const body = createNotificationSchema.parse(request.body);

    const targetUserId = body.targetUserId || currentUserId;
    const notification = await notificationService.createNotification(
      workspaceId,
      targetUserId,
      body.title,
      body.message,
      body.type
    );

    return reply.status(201).send({
      success: true,
      notification,
    });
  });

  // 5. PATCH & POST /api/v1/notifications/:id/read - Mark single notification as read
  fastify.patch<{ Params: { id: string } }>('/:id/read', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId || request.authenticatedUser!.userId;

    const notification = await notificationService.markAsRead(
      request.params.id,
      userId,
      workspaceId
    );

    return reply.status(200).send({
      success: true,
      notification,
    });
  });

  fastify.post<{ Params: { id: string } }>('/:id/read', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId || request.authenticatedUser!.userId;

    const notification = await notificationService.markAsRead(
      request.params.id,
      userId,
      workspaceId
    );

    return reply.status(200).send({
      success: true,
      notification,
    });
  });

  // 6. POST /api/v1/notifications/mark-all-read & /api/v1/notifications/read-all - Mark all as read
  fastify.post('/mark-all-read', async (request: FastifyRequest, reply: FastifyReply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId || request.authenticatedUser!.userId;

    const result = await notificationService.markAllAsRead(userId, workspaceId);

    return reply.status(200).send({
      success: true,
      ...result,
    });
  });

  fastify.post('/read-all', async (request: FastifyRequest, reply: FastifyReply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId || request.authenticatedUser!.userId;

    const result = await notificationService.markAllAsRead(userId, workspaceId);

    return reply.status(200).send({
      success: true,
      ...result,
    });
  });

  // 7. DELETE /api/v1/notifications/:id - Delete notification
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId || request.authenticatedUser!.userId;

    await notificationService.deleteNotification(request.params.id, userId, workspaceId);

    return reply.status(200).send({
      success: true,
      message: 'Notification deleted successfully',
    });
  });
};
