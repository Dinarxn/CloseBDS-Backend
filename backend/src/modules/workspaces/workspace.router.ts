import type { FastifyPluginAsync } from 'fastify';
import { workspaceService } from './workspace.service.js';
import {
  requireAuthenticatedUser,
  requireWorkspaceContext,
} from '../../core/permissions/auth-guards.js';

export const workspaceRouter: FastifyPluginAsync = async (fastify): Promise<void> => {
  // Enforce authentication & workspace resolution on all workspace routes
  fastify.addHook('preHandler', requireAuthenticatedUser);
  fastify.addHook('preHandler', requireWorkspaceContext);

  // 1. GET /api/v1/workspaces/current
  fastify.get('/current', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const workspace = await workspaceService.getCurrentWorkspace(workspaceId);

    return reply.status(200).send({
      success: true,
      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      },
    });
  });

  // 2. GET /api/v1/workspaces/current/members
  fastify.get('/current/members', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const members = await workspaceService.getWorkspaceMembers(workspaceId);

    return reply.status(200).send({
      success: true,
      members,
    });
  });
};
