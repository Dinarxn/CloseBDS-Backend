import type { FastifyPluginAsync } from 'fastify';
import { settingsService } from './settings.service.js';
import {
  updateWorkspaceSettingsSchema,
  updateUserPreferencesSchema,
  createSuppressionSchema,
  listSuppressionsQuerySchema,
} from './settings.schema.js';
import {
  requireAuthenticatedUser,
  requireWorkspaceContext,
} from '../../core/permissions/auth-guards.js';

export const settingsRouter: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.addHook('preHandler', requireAuthenticatedUser);
  fastify.addHook('preHandler', requireWorkspaceContext);

  // 1. GET /api/v1/settings/workspace - Workspace settings
  fastify.get('/workspace', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const settings = await settingsService.getWorkspaceSettings(workspaceId);

    return reply.status(200).send({
      success: true,
      settings,
    });
  });

  // 2. PATCH /api/v1/settings/workspace - Update workspace settings
  fastify.patch('/workspace', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;
    const body = updateWorkspaceSettingsSchema.parse(request.body);

    const settings = await settingsService.updateWorkspaceSettings(
      workspaceId,
      userId,
      body
    );

    return reply.status(200).send({
      success: true,
      settings,
    });
  });

  // 3. GET /api/v1/settings/preferences - User preferences
  fastify.get('/preferences', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId || request.authenticatedUser!.userId;

    const preferences = await settingsService.getUserPreferences(userId, workspaceId);

    return reply.status(200).send({
      success: true,
      preferences,
    });
  });

  // 4. PATCH /api/v1/settings/preferences - Update user preferences
  fastify.patch('/preferences', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId || request.authenticatedUser!.userId;
    const body = updateUserPreferencesSchema.parse(request.body);

    const preferences = await settingsService.updateUserPreferences(userId, workspaceId, body);

    return reply.status(200).send({
      success: true,
      preferences,
    });
  });

  // 5. GET /api/v1/settings/providers - Provider configuration statuses (Safe: NO SECRETS LEAKED)
  fastify.get('/providers', async (_request, reply) => {
    const providers = await settingsService.getProviderStatus();

    return reply.status(200).send({
      success: true,
      providers,
    });
  });

  // 6. GET /api/v1/settings/suppressions - List suppressions with pagination
  fastify.get('/suppressions', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const query = listSuppressionsQuerySchema.parse(request.query);

    const result = await settingsService.listSuppressions(workspaceId, query);

    return reply.status(200).send({
      success: true,
      ...result,
    });
  });

  // 7. POST /api/v1/settings/suppressions - Add suppression
  fastify.post('/suppressions', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;
    const body = createSuppressionSchema.parse(request.body);

    const suppression = await settingsService.addSuppression(workspaceId, userId, body);

    return reply.status(201).send({
      success: true,
      suppression,
    });
  });

  // 8. DELETE /api/v1/settings/suppressions/:id - Delete suppression
  fastify.delete<{ Params: { id: string } }>('/suppressions/:id', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;

    await settingsService.removeSuppression(request.params.id, workspaceId, userId);

    return reply.status(200).send({
      success: true,
      message: 'Suppression record removed successfully',
    });
  });
};
