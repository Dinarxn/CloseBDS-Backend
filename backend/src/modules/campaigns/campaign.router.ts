import type { FastifyPluginAsync } from 'fastify';
import { campaignService } from './campaign.service.js';
import {
  createCampaignSchema,
  updateCampaignSchema,
  campaignQuerySchema,
} from './campaign.schema.js';
import {
  requireAuthenticatedUser,
  requireWorkspaceContext,
} from '../../core/permissions/auth-guards.js';

export const campaignRouter: FastifyPluginAsync = async (fastify): Promise<void> => {
  // Enforce authentication & workspace resolution on all campaign endpoints
  fastify.addHook('preHandler', requireAuthenticatedUser);
  fastify.addHook('preHandler', requireWorkspaceContext);

  // 1. GET /api/v1/campaigns
  fastify.get('/', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const query = campaignQuerySchema.parse(request.query);
    const result = await campaignService.listCampaigns(workspaceId, query);

    return reply.status(200).send({
      success: true,
      ...result,
    });
  });

  // 2. GET /api/v1/campaigns/:id
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const campaign = await campaignService.getCampaign(request.params.id, workspaceId);

    return reply.status(200).send({
      success: true,
      campaign,
    });
  });

  // 3. POST /api/v1/campaigns
  fastify.post('/', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;
    const body = createCampaignSchema.parse(request.body);
    const campaign = await campaignService.createCampaign(workspaceId, userId, body);

    return reply.status(201).send({
      success: true,
      campaign,
    });
  });

  // 4. PATCH /api/v1/campaigns/:id
  fastify.patch<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;
    const body = updateCampaignSchema.parse(request.body);
    const campaign = await campaignService.updateCampaign(
      request.params.id,
      workspaceId,
      userId,
      body
    );

    return reply.status(200).send({
      success: true,
      campaign,
    });
  });

  // 5. DELETE /api/v1/campaigns/:id
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;
    await campaignService.deleteCampaign(request.params.id, workspaceId, userId);

    return reply.status(200).send({
      success: true,
      message: 'Campaign deleted successfully',
    });
  });
};
