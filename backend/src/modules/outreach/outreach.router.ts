import type { FastifyPluginAsync } from 'fastify';
import { outreachService } from './outreach.service.js';
import {
  createOutreachDraftSchema,
  updateOutreachDraftSchema,
  listOutreachQuerySchema,
} from './outreach.schema.js';
import {
  requireAuthenticatedUser,
  requireWorkspaceContext,
} from '../../core/permissions/auth-guards.js';

export const outreachRouter: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.addHook('preHandler', requireAuthenticatedUser);
  fastify.addHook('preHandler', requireWorkspaceContext);

  // 1. POST /api/v1/outreach - Create draft
  fastify.post('/', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;
    const body = createOutreachDraftSchema.parse(request.body);

    const draft = await outreachService.createDraft(workspaceId, userId, body);
    return reply.status(201).send({
      success: true,
      draft,
    });
  });

  // 2. GET /api/v1/outreach - List drafts
  fastify.get('/', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const query = listOutreachQuerySchema.parse(request.query);

    const result = await outreachService.listDrafts(workspaceId, query);
    return reply.status(200).send({
      success: true,
      ...result,
    });
  });

  // 3. GET /api/v1/outreach/:id - Get single draft
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const draft = await outreachService.getDraft(request.params.id, workspaceId);

    return reply.status(200).send({
      success: true,
      draft,
    });
  });

  // 4. PATCH /api/v1/outreach/:id - Update draft content (resets approval)
  fastify.patch<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;
    const body = updateOutreachDraftSchema.parse(request.body);

    const draft = await outreachService.updateDraft(request.params.id, workspaceId, userId, body);
    return reply.status(200).send({
      success: true,
      draft,
    });
  });

  // 5. POST /api/v1/outreach/:id/approve - Explicit Human Approval
  fastify.post<{ Params: { id: string } }>('/:id/approve', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId || 'system';

    const draft = await outreachService.approveDraft(request.params.id, workspaceId, userId);
    return reply.status(200).send({
      success: true,
      message: 'Outreach draft successfully approved by user',
      draft,
    });
  });

  // 6. POST /api/v1/outreach/:id/reject - Human Rejection
  fastify.post<{ Params: { id: string } }>('/:id/reject', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId || 'system';

    const draft = await outreachService.rejectDraft(request.params.id, workspaceId, userId);
    return reply.status(200).send({
      success: true,
      message: 'Outreach draft rejected',
      draft,
    });
  });

  // 7. POST /api/v1/outreach/:id/cancel - Human Cancellation
  fastify.post<{ Params: { id: string } }>('/:id/cancel', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId || 'system';

    const draft = await outreachService.cancelDraft(request.params.id, workspaceId, userId);
    return reply.status(200).send({
      success: true,
      message: 'Outreach draft cancelled',
      draft,
    });
  });

  // 8. POST /api/v1/outreach/:id/safety-check - Authoritative Safety Evaluation
  fastify.post<{ Params: { id: string } }>('/:id/safety-check', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;

    const decision = await outreachService.checkSafety(request.params.id, workspaceId, userId);
    return reply.status(200).send({
      success: true,
      decision,
    });
  });

  // 9. POST /api/v1/outreach/:id/dispatch - Server-Authoritative Outbound Email Dispatch
  fastify.post<{ Params: { id: string } }>('/:id/dispatch', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;

    const dispatched = await outreachService.dispatchDraft(request.params.id, workspaceId, userId);
    return reply.status(200).send({
      success: true,
      message: 'Outreach email successfully dispatched to provider',
      draft: dispatched,
    });
  });

  // 10. POST /api/v1/outreach/whatsapp/dispatch - Server-Authoritative Outbound WhatsApp Dispatch
  fastify.post<{
    Body: {
      leadId: string;
      contactId: string;
      messageText?: string;
      templateName?: string;
      isApproved?: boolean;
    };
  }>('/whatsapp/dispatch', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;
    const body = request.body;

    const result = await outreachService.dispatchWhatsAppMessage(workspaceId, userId, body);
    return reply.status(200).send({
      message: 'WhatsApp message successfully dispatched to Meta API',
      ...result,
    });
  });
};
