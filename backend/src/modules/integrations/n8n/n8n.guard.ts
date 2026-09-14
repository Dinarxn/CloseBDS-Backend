import crypto from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { n8nIntegrationRepository } from '../../../database/repository.js';
import { UnauthorizedError, ForbiddenError } from '../../../core/errors/api-error.js';
import type { N8nScope } from './n8n.types.js';
import type { N8nIntegration } from '@prisma/client';

declare module 'fastify' {
  interface FastifyRequest {
    n8nIntegration?: N8nIntegration;
  }
}

export function requireN8nAuth(requiredScope?: N8nScope) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    let apiKey: string | undefined;

    const customHeader = request.headers['x-n8n-api-key'];
    if (typeof customHeader === 'string' && customHeader.trim().length > 0) {
      apiKey = customHeader.trim();
    } else {
      const authHeader = request.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        apiKey = authHeader.slice(7).trim();
      }
    }

    if (!apiKey) {
      throw new UnauthorizedError('Missing n8n API key. Provide via X-N8N-API-Key or Authorization header.');
    }

    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const integration = await n8nIntegrationRepository.findByApiKeyHash(keyHash);

    if (!integration || !integration.isActive || integration.revokedAt) {
      throw new UnauthorizedError('Invalid, expired, or revoked n8n API key.');
    }

    if (requiredScope && !integration.scopes.includes(requiredScope)) {
      throw new ForbiddenError(
        `n8n integration lacks the required scope '${requiredScope}'. Granted scopes: [${integration.scopes.join(', ')}]`
      );
    }

    // Fire-and-forget last used update
    n8nIntegrationRepository.updateLastUsed(integration.id).catch(() => {});

    request.n8nIntegration = integration;
    request.workspaceContext = {
      workspaceId: integration.workspaceId,
      userId: 'n8n_integration',
      userRole: 'admin',
      requestId: request.id || `n8n_${Date.now()}`,
    };
  };
}
