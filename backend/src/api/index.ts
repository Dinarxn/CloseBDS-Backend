import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { healthRouter } from './health/health.router.js';
import { v1Router } from './v1/router.js';

/**
 * Top-level API router registering global health and versioned routes.
 */
export const apiRouter: FastifyPluginAsync = async (fastify: FastifyInstance): Promise<void> => {
  // Global infrastructure health route: /health
  await fastify.register(healthRouter);

  // Version 1 API routes: /api/v1/*
  await fastify.register(v1Router, { prefix: '/api/v1' });

  // Direct Voice AI webhooks ingress aliases: /api/voice/webhooks/*
  fastify.post('/api/voice/webhooks/retell', async (request, reply) => {
    const { voiceWebhookService } = await import('../modules/voice/voice-webhook.service.js');
    const signature = (request.headers['x-retell-signature'] as string) || undefined;
    const result = await voiceWebhookService.handleRetellWebhook(
      request.body,
      signature,
      process.env.RETELL_WEBHOOK_SECRET || process.env.RETELL_API_KEY
    );
    return reply.status(200).send({
      success: true,
      data: result,
      message: 'Retell webhook processed',
    });
  });

  fastify.post('/api/voice/webhooks/vapi', async (request, reply) => {
    const { voiceWebhookService } = await import('../modules/voice/voice-webhook.service.js');
    const secretHeader =
      (request.headers['x-vapi-secret'] as string) ||
      (request.headers['x-vapi-signature'] as string) ||
      undefined;
    const result = await voiceWebhookService.handleVapiWebhook(
      request.body,
      secretHeader,
      process.env.VAPI_SERVER_SECRET || process.env.VAPI_WEBHOOK_SECRET
    );
    return reply.status(200).send({
      success: true,
      data: result,
      message: 'Vapi webhook processed',
    });
  });
};
