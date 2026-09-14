import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { operationsService } from './operations.service.js';
import {
  ListOperationsTasksQuerySchema,
  TaskActionBodySchema,
  PrioritizeQueueItemBodySchema,
} from './operations.schema.js';
import {
  requireAuthenticatedUser,
  requireWorkspaceContext,
} from '../../core/permissions/auth-guards.js';

export const operationsRouter: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAuthenticatedUser);
  fastify.addHook('preHandler', requireWorkspaceContext);

  // 1. GET /api/v1/operations/summary - Real-time acquisition pipeline metrics
  fastify.get('/summary', async (request: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId } = request.workspaceContext!;
    const summary = await operationsService.getSummary(workspaceId);
    return reply.status(200).send({
      success: true,
      data: summary,
    });
  });

  // 1b. GET /api/v1/operations - General operator tasks
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId } = request.workspaceContext!;
    const query = ListOperationsTasksQuerySchema.parse(request.query);
    const tasks = await operationsService.getTasks(workspaceId, query);
    return reply.status(200).send({
      success: true,
      data: tasks,
    });
  });

  // 1c. GET /api/v1/operations/approvals - Critical pending approvals
  fastify.get('/approvals', async (request: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId } = request.workspaceContext!;
    const tasks = await operationsService.getTasks(workspaceId, { category: 'approvals' });
    return reply.status(200).send({
      success: true,
      data: tasks,
    });
  });

  // 1d. GET /api/v1/operations/call-ready - Queue and call-ready tasks
  fastify.get('/call-ready', async (request: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId } = request.workspaceContext!;
    const tasks = await operationsService.getTasks(workspaceId, { category: 'calling' });
    return reply.status(200).send({
      success: true,
      data: tasks,
    });
  });

  // 1e. GET /api/v1/operations/research - Research tasks
  fastify.get('/research', async (request: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId } = request.workspaceContext!;
    const tasks = await operationsService.getTasks(workspaceId, { category: 'research' });
    return reply.status(200).send({
      success: true,
      data: tasks,
    });
  });

  // 1f. GET /api/v1/operations/qualification - Qualification tasks
  fastify.get('/qualification', async (request: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId } = request.workspaceContext!;
    const tasks = await operationsService.getTasks(workspaceId, { category: 'qualification' });
    return reply.status(200).send({
      success: true,
      data: tasks,
    });
  });

  // 1g. GET /api/v1/operations/follow-ups - Due follow-up tasks
  fastify.get('/follow-ups', async (request: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId } = request.workspaceContext!;
    const tasks = await operationsService.getTasks(workspaceId, { category: 'followup' });
    return reply.status(200).send({
      success: true,
      data: tasks,
    });
  });

  // 1h. GET /api/v1/operations/system-health - Authentic telemetry & config status
  fastify.get('/system-health', async (request: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId } = request.workspaceContext!;
    const summary = await operationsService.getSummary(workspaceId);
    return reply.status(200).send({
      success: true,
      data: summary.systemHealth,
    });
  });

  // 2. GET /api/v1/operations/tasks - Authoritative operational tasks
  fastify.get('/tasks', async (request: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId } = request.workspaceContext!;
    const query = ListOperationsTasksQuerySchema.parse(request.query);
    const tasks = await operationsService.getTasks(workspaceId, query);
    return reply.status(200).send({
      success: true,
      data: tasks,
    });
  });

  // 3. POST /api/v1/operations/tasks/:taskId/execute - Execute operational task
  fastify.post(
    '/tasks/:taskId/execute',
    async (
      request: FastifyRequest<{ Params: { taskId: string } }>,
      reply: FastifyReply
    ) => {
      const { workspaceId, userId } = request.workspaceContext!;
      const { taskId } = request.params;
      const result = await operationsService.executeTask(workspaceId, taskId, userId || 'operator');
      return reply.status(200).send({
        success: true,
        data: result,
        message: 'Operational task executed successfully',
      });
    }
  );

  // 4. POST /api/v1/operations/tasks/:taskId/approve - Authorize pending task
  fastify.post(
    '/tasks/:taskId/approve',
    async (
      request: FastifyRequest<{ Params: { taskId: string } }>,
      reply: FastifyReply
    ) => {
      const { workspaceId, userId } = request.workspaceContext!;
      const { taskId } = request.params;
      const result = await operationsService.approveTask(workspaceId, taskId, userId || 'operator');
      return reply.status(200).send({
        success: true,
        data: result,
        message: 'Task authorized successfully',
      });
    }
  );

  // 5. POST /api/v1/operations/tasks/:taskId/reject - Reject pending task
  fastify.post(
    '/tasks/:taskId/reject',
    async (
      request: FastifyRequest<{ Params: { taskId: string } }>,
      reply: FastifyReply
    ) => {
      const { workspaceId, userId } = request.workspaceContext!;
      const { taskId } = request.params;
      const body = TaskActionBodySchema.parse(request.body || {});
      const result = await operationsService.rejectTask(
        workspaceId,
        taskId,
        userId || 'operator',
        body.reason
      );
      return reply.status(200).send({
        success: true,
        data: result,
        message: 'Task rejected',
      });
    }
  );

  // 6. GET /api/v1/operations/queue - Outbound calling queue
  fastify.get('/queue', async (request: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId } = request.workspaceContext!;
    const queue = await operationsService.getQueue(workspaceId);
    return reply.status(200).send({
      success: true,
      data: queue,
    });
  });

  // 7. POST /api/v1/operations/queue/:itemId/prioritize - Reorder call queue priority
  fastify.post(
    '/queue/:itemId/prioritize',
    async (
      request: FastifyRequest<{ Params: { itemId: string } }>,
      reply: FastifyReply
    ) => {
      const { workspaceId } = request.workspaceContext!;
      const { itemId } = request.params;
      const body = PrioritizeQueueItemBodySchema.parse(request.body || {});
      const result = await operationsService.prioritizeQueueItem(
        workspaceId,
        itemId,
        body.priority
      );
      return reply.status(200).send({
        success: true,
        data: result,
        message: 'Queue item prioritized',
      });
    }
  );

  // 8. POST /api/v1/operations/queue/:itemId/cancel - Cancel queued call
  fastify.post(
    '/queue/:itemId/cancel',
    async (
      request: FastifyRequest<{ Params: { itemId: string } }>,
      reply: FastifyReply
    ) => {
      const { workspaceId, userId } = request.workspaceContext!;
      const { itemId } = request.params;
      const body = TaskActionBodySchema.parse(request.body || {});
      const result = await operationsService.cancelQueueItem(
        workspaceId,
        itemId,
        userId || 'operator',
        body.reason
      );
      return reply.status(200).send({
        success: true,
        data: result,
        message: 'Call cancelled from queue',
      });
    }
  );
};
