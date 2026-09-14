import type { FastifyPluginAsync } from 'fastify';
import { personalizationDomainService } from './personalization.service.js';
import { generatePersonalizationSchema } from './personalization.schema.js';
import {
  requireAuthenticatedUser,
  requireWorkspaceContext,
} from '../../core/permissions/auth-guards.js';

export const personalizationRouter: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.addHook('preHandler', requireAuthenticatedUser);
  fastify.addHook('preHandler', requireWorkspaceContext);

  // POST /api/v1/personalization/:leadId
  fastify.post<{ Params: { leadId: string } }>('/:leadId', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;
    const body = generatePersonalizationSchema.parse(request.body || {});

    const result = await personalizationDomainService.generateOutreachDraft(
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
