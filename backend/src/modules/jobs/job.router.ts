import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { jobService } from './job.service.js';
import { createJobSchema, listJobsQuerySchema } from './job.schema.js';
import {
  requireAuthenticatedUser,
  requireWorkspaceContext,
} from '../../core/permissions/auth-guards.js';

export const jobRouter: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.addHook('preHandler', requireAuthenticatedUser);
  fastify.addHook('preHandler', requireWorkspaceContext);

  // 1. POST /api/v1/jobs - Enqueue background job
  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId || request.authenticatedUser!.userId;
    const body = createJobSchema.parse(request.body);

    const job = await jobService.enqueueJob(workspaceId, userId, body);

    return reply.status(201).send({
      success: true,
      job,
    });
  });

  // 2. GET /api/v1/jobs - List workspace background jobs
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const query = listJobsQuerySchema.parse(request.query);

    const result = await jobService.listJobs(workspaceId, query);

    return reply.status(200).send({
      success: true,
      ...result,
    });
  });

  // 3. GET /api/v1/jobs/:id - Get single job details
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const job = await jobService.getJob(request.params.id, workspaceId);

    return reply.status(200).send({
      success: true,
      job,
    });
  });

  // 4. POST /api/v1/jobs/:id/cancel - Cancel pending job
  fastify.post<{ Params: { id: string } }>('/:id/cancel', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId || request.authenticatedUser!.userId;

    const job = await jobService.cancelJob(request.params.id, workspaceId, userId);

    return reply.status(200).send({
      success: true,
      job,
    });
  });

  // 5. POST /api/v1/jobs/:id/retry - Retry failed job
  fastify.post<{ Params: { id: string } }>('/:id/retry', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId || request.authenticatedUser!.userId;

    const job = await jobService.retryJob(request.params.id, workspaceId, userId);

    return reply.status(200).send({
      success: true,
      job,
    });
  });

  // 6. POST /api/v1/jobs/:id/execute - Trigger safe internal execution
  fastify.post<{ Params: { id: string } }>('/:id/execute', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const job = await jobService.executeJob(request.params.id, workspaceId);

    return reply.status(200).send({
      success: true,
      job,
    });
  });
};
