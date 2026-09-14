import type { FastifyPluginAsync } from 'fastify';
import { followUpService } from './follow-up.service.js';
import {
  createTaskSchema,
  updateTaskSchema,
  listTasksQuerySchema,
} from './follow-up.schema.js';
import {
  requireAuthenticatedUser,
  requireWorkspaceContext,
} from '../../core/permissions/auth-guards.js';

export const followUpRouter: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.addHook('preHandler', requireAuthenticatedUser);
  fastify.addHook('preHandler', requireWorkspaceContext);

  // 1. POST /api/v1/follow-ups - Create task
  fastify.post('/', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;
    const body = createTaskSchema.parse(request.body);

    const task = await followUpService.createTask(workspaceId, userId, body);
    return reply.status(201).send({
      success: true,
      task,
    });
  });

  // 2. GET /api/v1/follow-ups - List tasks
  fastify.get('/', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const query = listTasksQuerySchema.parse(request.query);

    const result = await followUpService.listTasks(workspaceId, query);
    return reply.status(200).send({
      success: true,
      ...result,
    });
  });

  // 3. GET /api/v1/follow-ups/:id - Get single task
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const task = await followUpService.getTask(request.params.id, workspaceId);

    return reply.status(200).send({
      success: true,
      task,
    });
  });

  // 4. PATCH /api/v1/follow-ups/:id - Update task
  fastify.patch<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;
    const body = updateTaskSchema.parse(request.body);

    const task = await followUpService.updateTask(request.params.id, workspaceId, userId, body);
    return reply.status(200).send({
      success: true,
      task,
    });
  });

  // 5. DELETE /api/v1/follow-ups/:id - Delete task
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;

    await followUpService.deleteTask(request.params.id, workspaceId, userId);
    return reply.status(200).send({
      success: true,
      message: 'Follow-up task deleted successfully',
    });
  });
};
