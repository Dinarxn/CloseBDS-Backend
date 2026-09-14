import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { integrationService } from './integration.service.js';
import {
  webhookParamsSchema,
  listIntegrationEventsQuerySchema,
} from './integration.schema.js';
import {
  requireAuthenticatedUser,
  requireWorkspaceContext,
} from '../../core/permissions/auth-guards.js';
import type { WebhookProvider } from './integration.types.js';

export const integrationRouter: FastifyPluginAsync = async (fastify): Promise<void> => {
  // 0. Public Webhook Verification Handshake (Meta WhatsApp GET verification): GET /api/v1/integrations/webhooks/:provider
  fastify.get<{
    Params: { provider: string };
    Querystring: { 'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string };
  }>('/webhooks/:provider', async (request, reply) => {
    const { provider } = request.params;
    if (provider === 'whatsapp') {
      const mode = request.query['hub.mode'];
      const token = request.query['hub.verify_token'];
      const challenge = request.query['hub.challenge'];

      const expectedToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
      if (mode === 'subscribe' && token && expectedToken && token === expectedToken) {
        return reply.status(200).send(challenge);
      }
      return reply.status(403).send({ error: 'Webhook verification token mismatch' });
    }
    return reply.status(200).send({ status: 'ok', provider });
  });

  // 1. Public Webhook Ingestion: POST /api/v1/integrations/webhooks/:provider
  fastify.post<{ Params: { provider: string } }>(
    '/webhooks/:provider',
    async (request: FastifyRequest<{ Params: { provider: string } }>, reply: FastifyReply) => {
      const params = webhookParamsSchema.parse(request.params);
      const provider = params.provider as WebhookProvider;

      // Extract provider signature from headers (supports Resend Svix, SendGrid, Meta X-Hub-Signature-256)
      const signatureHeader =
        (request.headers['x-hub-signature-256'] as string) ||
        (request.headers['svix-signature'] as string) ||
        (request.headers['x-resend-signature'] as string) ||
        (request.headers['x-twilio-email-event-webhook-signature'] as string) ||
        (request.headers['x-webhook-signature'] as string) ||
        undefined;

      const secret =
        (provider === 'whatsapp' ? process.env.WHATSAPP_APP_SECRET : undefined) ||
        process.env[`${provider.toUpperCase()}_WEBHOOK_SECRET`] ||
        process.env.WEBHOOK_SIGNING_SECRET ||
        undefined;

      const result = await integrationService.processWebhook(
        provider,
        request.body,
        signatureHeader,
        secret
      );

      return reply.status(200).send(result);
    }
  );

  // 2. Authenticated Integration Events: GET /api/v1/integrations/events
  fastify.register(async (protectedRoutes) => {
    protectedRoutes.addHook('preHandler', requireAuthenticatedUser);
    protectedRoutes.addHook('preHandler', requireWorkspaceContext);

    protectedRoutes.get('/events', async (request: FastifyRequest, reply: FastifyReply) => {
      const workspaceId = request.workspaceContext!.workspaceId;
      const query = listIntegrationEventsQuerySchema.parse(request.query);

      const result = await integrationService.listIntegrationEvents(workspaceId, query);

      return reply.status(200).send({
        success: true,
        ...result,
      });
    });
  });
};
