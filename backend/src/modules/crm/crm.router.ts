import type { FastifyPluginAsync } from 'fastify';
import { crmService } from './crm.service.js';
import { recordCRMActivitySchema, updateLeadStageSchema } from './crm.schema.js';
import {
  requireAuthenticatedUser,
  requireWorkspaceContext,
} from '../../core/permissions/auth-guards.js';

export const crmRouter: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.addHook('preHandler', requireAuthenticatedUser);
  fastify.addHook('preHandler', requireWorkspaceContext);

  // 1. GET /api/v1/crm/leads/:leadId - Complete CRM profile
  fastify.get<{ Params: { leadId: string } }>('/leads/:leadId', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const profile = await crmService.getLeadCRMProfile(request.params.leadId, workspaceId);

    return reply.status(200).send({
      success: true,
      ...profile,
    });
  });

  // 2. GET /api/v1/crm/leads/:leadId/activities - Activities timeline
  fastify.get<{ Params: { leadId: string } }>('/leads/:leadId/activities', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const activities = await crmService.getLeadActivities(request.params.leadId, workspaceId);

    return reply.status(200).send({
      success: true,
      activities,
    });
  });

  // 3. POST /api/v1/crm/leads/:leadId/activities - Record new activity
  fastify.post<{ Params: { leadId: string } }>('/leads/:leadId/activities', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;
    const body = recordCRMActivitySchema.parse(request.body);

    const activity = await crmService.recordActivity(
      request.params.leadId,
      workspaceId,
      userId,
      body
    );

    return reply.status(201).send({
      success: true,
      activity,
    });
  });

  // 4. PATCH /api/v1/crm/leads/:leadId/stage - Update stage
  fastify.patch<{ Params: { leadId: string } }>('/leads/:leadId/stage', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;
    const body = updateLeadStageSchema.parse(request.body);

    const result = await crmService.updateLeadStage(
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
