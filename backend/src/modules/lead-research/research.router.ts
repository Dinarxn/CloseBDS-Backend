import type { FastifyPluginAsync } from 'fastify';
import { researchDomainService } from './research.service.js';
import { triggerResearchSchema } from './research.schema.js';
import {
  requireAuthenticatedUser,
  requireWorkspaceContext,
} from '../../core/permissions/auth-guards.js';

export const researchRouter: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.addHook('preHandler', requireAuthenticatedUser);
  fastify.addHook('preHandler', requireWorkspaceContext);

  // 1. GET /api/v1/lead-research/:leadId
  fastify.get<{ Params: { leadId: string } }>('/:leadId', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const audit = await researchDomainService.getAudit(request.params.leadId, workspaceId);

    return reply.status(200).send({
      success: true,
      audit,
    });
  });

  // 2. POST /api/v1/lead-research/:leadId
  fastify.post<{ Params: { leadId: string } }>('/:leadId', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;
    const body = triggerResearchSchema.parse(request.body || {});

    const result = await researchDomainService.executeResearch(
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
