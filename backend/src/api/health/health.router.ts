import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { databaseClient } from '../../database/client.js';

export interface HealthResponse {
  status: 'ok';
}

export interface ReadinessResponse {
  status: 'ready' | 'unready';
  database: 'connected' | 'disconnected' | 'error';
  timestamp: string;
}

/**
 * Health & Readiness router.
 * - /health: Application liveness probe (never leaks internal details)
 * - /health/ready: Application dependency readiness probe (checks DB readiness without leaking secrets)
 */
export const healthRouter: FastifyPluginAsync = async (fastify: FastifyInstance): Promise<void> => {
  // 1. Liveness Probe
  fastify.get<{ Reply: HealthResponse }>(
    '/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['ok'] },
            },
            required: ['status'],
          },
        },
      },
    },
    async (_request, reply) => {
      return reply.status(200).send({ status: 'ok' });
    }
  );

  // 2. Readiness Probe
  fastify.get<{ Reply: ReadinessResponse }>(
    '/health/ready',
    async (_request, reply) => {
      const dbCheck = await databaseClient.healthCheck();

      const responsePayload: ReadinessResponse = {
        status: dbCheck.ready ? 'ready' : 'unready',
        database: dbCheck.status,
        timestamp: new Date().toISOString(),
      };

      if (!dbCheck.ready) {
        return reply.status(503).send(responsePayload);
      }

      return reply.status(200).send(responsePayload);
    }
  );
};
