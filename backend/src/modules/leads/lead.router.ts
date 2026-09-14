import type { FastifyPluginAsync } from 'fastify';
import { leadService } from './lead.service.js';
import { leadAiService } from './lead-ai.service.js';
import {
  createLeadSchema,
  updateLeadSchema,
  createContactSchema,
  updateContactSchema,
  leadQuerySchema,
  leadAiParamsSchema,
  leadApprovalBodySchema,
} from './lead.schema.js';
import {
  requireAuthenticatedUser,
  requireWorkspaceContext,
} from '../../core/permissions/auth-guards.js';

export const leadRouter: FastifyPluginAsync = async (fastify): Promise<void> => {
  // Enforce authentication & workspace resolution on all lead endpoints
  fastify.addHook('preHandler', requireAuthenticatedUser);
  fastify.addHook('preHandler', requireWorkspaceContext);

  // 1. GET /api/v1/leads
  fastify.get('/', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const query = leadQuerySchema.parse(request.query);
    const result = await leadService.listLeads(workspaceId, query);

    return reply.status(200).send({
      success: true,
      ...result,
    });
  });

  // 2. GET /api/v1/leads/:id
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const lead = await leadService.getLead(request.params.id, workspaceId);

    return reply.status(200).send({
      success: true,
      lead,
    });
  });

  // 3. POST /api/v1/leads
  fastify.post('/', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;
    const body = createLeadSchema.parse(request.body);
    const lead = await leadService.createLead(workspaceId, userId, body);

    return reply.status(201).send({
      success: true,
      lead,
    });
  });

  // 4. PATCH /api/v1/leads/:id
  fastify.patch<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;
    const body = updateLeadSchema.parse(request.body);
    const lead = await leadService.updateLead(request.params.id, workspaceId, userId, body);

    return reply.status(200).send({
      success: true,
      lead,
    });
  });

  // 5. DELETE /api/v1/leads/:id
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;
    await leadService.deleteLead(request.params.id, workspaceId, userId);

    return reply.status(200).send({
      success: true,
      message: 'Lead deleted successfully',
    });
  });

  // 6. POST /api/v1/leads/:id/ai - Run protected AI workflow for a specific lead
  fastify.post<{ Params: { id: string } }>('/:id/ai', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;
    const { id: leadId } = leadAiParamsSchema.parse(request.params);

    const result = await leadAiService.executeLeadAiWorkflow(leadId, workspaceId, userId);

    return reply.status(200).send({
      success: true,
      data: result,
    });
  });

  // 7. POST /api/v1/leads/:id/approve - Server-Authoritative Human Approval for Lead
  fastify.post<{ Params: { id: string } }>('/:id/approve', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId || 'operator';
    const { id: leadId } = leadAiParamsSchema.parse(request.params);
    const body = leadApprovalBodySchema.parse(request.body || {});

    const result = await leadAiService.approveLeadAi(leadId, workspaceId, userId, body.reason);

    return reply.status(200).send({
      success: true,
      data: result,
      message: 'Lead approved by operator',
    });
  });

  // 8. POST /api/v1/leads/:id/reject - Server-Authoritative Human Rejection for Lead
  fastify.post<{ Params: { id: string } }>('/:id/reject', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId || 'operator';
    const { id: leadId } = leadAiParamsSchema.parse(request.params);
    const body = leadApprovalBodySchema.parse(request.body || {});

    const result = await leadAiService.rejectLeadAi(leadId, workspaceId, userId, body.reason);

    return reply.status(200).send({
      success: true,
      data: result,
      message: 'Lead rejected by operator',
    });
  });

  // --- Contact Endpoints ---

  // 6. GET /api/v1/leads/:leadId/contacts
  fastify.get<{ Params: { leadId: string } }>('/:leadId/contacts', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const contacts = await leadService.listContacts(request.params.leadId, workspaceId);

    return reply.status(200).send({
      success: true,
      contacts,
    });
  });

  // 7. POST /api/v1/leads/:leadId/contacts
  fastify.post<{ Params: { leadId: string } }>('/:leadId/contacts', async (request, reply) => {
    const workspaceId = request.workspaceContext!.workspaceId;
    const userId = request.workspaceContext!.userId;
    const body = createContactSchema.parse(request.body);
    const contact = await leadService.createContact(request.params.leadId, workspaceId, userId, body);

    return reply.status(201).send({
      success: true,
      contact,
    });
  });

  // 8. PATCH /api/v1/leads/:leadId/contacts/:contactId
  fastify.patch<{ Params: { leadId: string; contactId: string } }>(
    '/:leadId/contacts/:contactId',
    async (request, reply) => {
      const workspaceId = request.workspaceContext!.workspaceId;
      const userId = request.workspaceContext!.userId;
      const body = updateContactSchema.parse(request.body);
      const contact = await leadService.updateContact(
        request.params.contactId,
        request.params.leadId,
        workspaceId,
        userId,
        body
      );

      return reply.status(200).send({
        success: true,
        contact,
      });
    }
  );

  // 9. DELETE /api/v1/leads/:leadId/contacts/:contactId
  fastify.delete<{ Params: { leadId: string; contactId: string } }>(
    '/:leadId/contacts/:contactId',
    async (request, reply) => {
      const workspaceId = request.workspaceContext!.workspaceId;
      const userId = request.workspaceContext!.userId;
      await leadService.deleteContact(
        request.params.contactId,
        request.params.leadId,
        workspaceId,
        userId
      );

      return reply.status(200).send({
        success: true,
        message: 'Contact deleted successfully',
      });
    }
  );
};
