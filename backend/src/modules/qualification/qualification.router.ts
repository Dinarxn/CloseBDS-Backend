import type { FastifyPluginAsync } from 'fastify';
import { qualificationDomainService } from './qualification.service.js';
import { qualifyLeadSchema } from './qualification.schema.js';
import {
  requireAuthenticatedUser,
  requireWorkspaceContext,
} from '../../core/permissions/auth-guards.js';

export const qualificationRouter: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.addHook('preHandler', requireAuthenticatedUser);
  fastify.addHook('preHandler', requireWorkspaceContext);

  // 1. GET /api/v1/qualification/:leadId
  fastify.get<{ Params: { leadId: string } }>('/:leadId', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const result = await qualificationDomainService.getQualification(
      request.params.leadId,
      workspaceId
    );

    return reply.status(200).send({
      success: true,
      ...result,
    });
  });

  // 2. POST /api/v1/qualification/:leadId
  fastify.post<{ Params: { leadId: string } }>('/:leadId', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;
    const body = qualifyLeadSchema.parse(request.body || {});

    const result = await qualificationDomainService.qualifyLead(
      request.params.leadId,
      workspaceId,
      userId,
      body
    );

    return reply.status(200).send({
      success: true,
      ...result,
    });
  });
};
