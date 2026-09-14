import type { FastifyPluginAsync } from 'fastify';
import { discoveryDomainService } from './discovery.service.js';
import {
  leadDiscoveryQuerySchema,
  closeBDSImportBodySchema,
} from './discovery.schema.js';
import {
  requireAuthenticatedUser,
  requireWorkspaceContext,
} from '../../core/permissions/auth-guards.js';

export const discoveryRouter: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.addHook('preHandler', requireAuthenticatedUser);
  fastify.addHook('preHandler', requireWorkspaceContext);

  // 1. POST /api/v1/lead-discovery/query
  fastify.post('/query', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;
    const query = leadDiscoveryQuerySchema.parse(request.body);

    const result = await discoveryDomainService.executeDiscovery(workspaceId, userId, query);

    return reply.status(200).send({
      success: true,
      ...result,
    });
  });

  // 2. POST /api/v1/lead-discovery/sync-closebds
  fastify.post('/sync-closebds', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;

    const result = await discoveryDomainService.syncCloseBDS(workspaceId, userId);

    return reply.status(200).send({
      success: true,
      ...result,
    });
  });

  // 3. POST /api/v1/lead-discovery/import-closebds - Ingest leads from closeBDS
  fastify.post('/import-closebds', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;
    const body = closeBDSImportBodySchema.parse(request.body);

    const result = await discoveryDomainService.importCloseBDSLeads(workspaceId, userId, body);

    return reply.status(200).send(result);
  });
};
