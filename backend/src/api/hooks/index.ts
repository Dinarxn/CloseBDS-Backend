import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { WorkspaceContext } from '../../core/workspace/workspace-context.js';
import { databaseClient } from '../../database/client.js';

declare module 'fastify' {
  interface FastifyRequest {
    workspaceContext?: WorkspaceContext;
  }
}

/**
 * Register core application lifecycle hooks.
 */
export async function registerAppHooks(fastify: FastifyInstance): Promise<void> {
  // Pre-handler hook to extract request context and workspace ID headers safely
  fastify.addHook('preHandler', async (request: FastifyRequest, _reply: FastifyReply) => {
    const workspaceIdHeader = request.headers['x-workspace-id'];
    const workspaceId = typeof workspaceIdHeader === 'string' ? workspaceIdHeader : undefined;

    if (workspaceId) {
      request.workspaceContext = {
        workspaceId,
        requestId: request.id,
      };
    }
  });

  // On-response hook for response time tracking header
  fastify.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply, payload) => {
    reply.header('X-Request-Id', request.id);
    return payload;
  });

  // Gracefully disconnect database client on server shutdown
  fastify.addHook('onClose', async () => {
    try {
      await databaseClient.disconnect();
    } catch {
      // Safe non-blocking cleanup
    }
  });
}

