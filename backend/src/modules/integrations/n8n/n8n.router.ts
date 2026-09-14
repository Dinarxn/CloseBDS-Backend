import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { n8nService } from './n8n.service.js';
import {
  CreateN8nIntegrationSchema,
  N8nPrepareCallSchema,
  N8nRequestCallSchema,
  N8nTriggerAiParamsSchema,
  N8nPrepareOutreachSchema,
  N8nCreateFollowUpTaskSchema,
} from './n8n.schema.js';
import { requireN8nAuth } from './n8n.guard.js';
import {
  requireAuthenticatedUser,
  requireWorkspaceContext,
  requireRole,
} from '../../../core/permissions/auth-guards.js';
import { voiceService } from '../../voice/voice.service.js';
import { leadService } from '../../leads/lead.service.js';
import { leadAiService } from '../../leads/lead-ai.service.js';
import { outreachService } from '../../outreach/outreach.service.js';
import { followUpService } from '../../follow-ups/follow-up.service.js';
import {
  campaignRepository,
  suppressionRepository,
  auditRepository,
} from '../../../database/repository.js';
import { databaseClient } from '../../../database/client.js';
import { NotFoundError, BadRequestError } from '../../../core/errors/api-error.js';

export const n8nRouter: FastifyPluginAsync = async (fastify) => {
  // ==========================================
  // 1. Integration Credential Management (UI/User Session)
  // ==========================================

  fastify.post(
    '/keys',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext, requireRole(['OWNER', 'ADMIN'])],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const parsed = CreateN8nIntegrationSchema.parse(request.body);
      const result = await n8nService.createIntegration(
        workspaceId,
        parsed.name,
        parsed.scopes,
        parsed.webhookUrl
      );
      return reply.status(201).send({
        success: true,
        data: result,
        message: 'n8n integration key generated. Save this secret now; it will not be shown again.',
      });
    }
  );

  fastify.get(
    '/keys',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const list = await n8nService.listIntegrations(workspaceId);
      return reply.status(200).send({
        success: true,
        data: list,
      });
    }
  );

  fastify.delete(
    '/keys/:id',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext, requireRole(['OWNER', 'ADMIN'])],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const { id } = request.params as { id: string };
      const revoked = await n8nService.revokeIntegration(id, workspaceId);
      return reply.status(200).send({
        success: true,
        data: { revoked },
        message: 'n8n integration key revoked',
      });
    }
  );

  fastify.get(
    '/deliveries',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const deliveries = await n8nService.listDeliveries(workspaceId);
      return reply.status(200).send({
        success: true,
        data: deliveries,
      });
    }
  );

  // ==========================================
  // 2. n8n Autonomous Workflow Execution Endpoints
  // Authenticated strictly via X-N8N-API-Key with scoped authorization
  // ==========================================

  // --- Voice Calling Endpoints ---

  // List voice campaigns for n8n orchestrator
  fastify.get(
    '/campaigns',
    {
      preHandler: [requireN8nAuth('voice:read')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const campaigns = await campaignRepository.findMany(workspaceId);
      return reply.status(200).send({
        success: true,
        data: campaigns,
      });
    }
  );

  // Pre-flight call preparation and safety validation
  fastify.post(
    '/calls/prepare',
    {
      preHandler: [requireN8nAuth('voice:prepare')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const parsed = N8nPrepareCallSchema.parse(request.body);
      const result = await voiceService.prepareCall(workspaceId, parsed);
      return reply.status(200).send({
        success: true,
        data: result,
        message: 'Pre-flight safety evaluation completed',
      });
    }
  );

  // Queue call for human approval (CRITICAL SAFETY GATE: ZERO-BYPASS)
  // n8n CANNOT auto-approve calls; humanApprovalRequired is hard-locked to true
  fastify.post(
    '/calls/request',
    {
      preHandler: [requireN8nAuth('voice:request')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const parsed = N8nRequestCallSchema.parse(request.body);

      // Force humanApprovalRequired = true strictly to prevent autonomous unauthorized dialling
      const call = await voiceService.createCall(
        workspaceId,
        {
          campaignId: parsed.campaignId,
          leadId: parsed.leadId,
          contactId: parsed.contactId,
          agentConfigId: parsed.agentConfigId,
          humanApprovalRequired: true,
          idempotencyKey: parsed.idempotencyKey,
        },
        'n8n_automation'
      );

      return reply.status(201).send({
        success: true,
        data: call,
        message: 'Call requested by n8n workflow and queued for human reviewer approval',
      });
    }
  );

  // List calls for n8n orchestrator
  fastify.get(
    '/calls',
    {
      preHandler: [requireN8nAuth('voice:read')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const calls = await voiceService.listCalls(workspaceId, {});
      return reply.status(200).send({
        success: true,
        ...calls,
      });
    }
  );

  // Get call status, transcripts, and AI outcome
  fastify.get(
    '/calls/:id',
    {
      preHandler: [requireN8nAuth('voice:read')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const { id } = request.params as { id: string };
      const call = await voiceService.getCall(id, workspaceId);
      return reply.status(200).send({
        success: true,
        data: call,
      });
    }
  );

  // --- Lead & Lead AI Trigger Endpoints ---

  // List leads for n8n
  fastify.get(
    '/leads',
    {
      preHandler: [requireN8nAuth('leads:read')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const query = (request.query as Record<string, unknown>) || {};
      const result = await leadService.listLeads(workspaceId, query as any);
      return reply.status(200).send({
        success: true,
        ...result,
      });
    }
  );

  // Get single lead details
  fastify.get(
    '/leads/:id',
    {
      preHandler: [requireN8nAuth('leads:read')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const { id } = request.params as { id: string };
      const lead = await leadService.getLead(id, workspaceId);
      return reply.status(200).send({
        success: true,
        data: lead,
      });
    }
  );

  // Trigger LangGraph AI Workflow for a Lead
  // STRICT SAFETY INVARIANT: AI execution only analyzes & generates draft. ZERO outbound communication.
  fastify.post(
    '/leads/:id/trigger-ai',
    {
      preHandler: [requireN8nAuth('leads:trigger-ai')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const { id: leadId } = N8nTriggerAiParamsSchema.parse(request.params);

      // Verify lead belongs to the integration's authenticated workspace
      await leadService.getLead(leadId, workspaceId);

      // Execute AI workflow through service layer (wraps LangGraph)
      const result = await leadAiService.executeLeadAiWorkflow(leadId, workspaceId, 'n8n_integration');

      // Audit the trigger
      await auditRepository.create({
        workspaceId,
        userId: 'n8n_integration',
        eventType: 'n8n_action:ai_triggered',
        entityType: 'Lead',
        entityId: leadId,
        metadata: {
          integrationId: request.n8nIntegration?.id,
          status: result.status,
          currentStep: result.currentStep,
        },
      }).catch(() => {});

      return reply.status(200).send({
        success: true,
        data: result,
        message: 'Lead AI workflow executed successfully',
      });
    }
  );

  // --- Outreach Preparation Endpoints ---

  // List outreach drafts for n8n
  fastify.get(
    '/outreach',
    {
      preHandler: [requireN8nAuth('outreach:read')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const drafts = await outreachService.listDrafts(workspaceId, { page: 1, limit: 50 });
      return reply.status(200).send({
        success: true,
        ...drafts,
      });
    }
  );

  // Get specific outreach draft
  fastify.get(
    '/outreach/:id',
    {
      preHandler: [requireN8nAuth('outreach:read')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const { id } = request.params as { id: string };
      const draft = await outreachService.getDraft(id, workspaceId);
      return reply.status(200).send({
        success: true,
        data: draft,
      });
    }
  );

  // Prepare an outreach draft from n8n (CREATES UNAPPROVED DRAFT ONLY - ZERO OUTBOUND DISPATCH)
  fastify.post(
    '/outreach/prepare',
    {
      preHandler: [requireN8nAuth('outreach:prepare')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const parsed = N8nPrepareOutreachSchema.parse(request.body);

      // Verify contact belongs to workspace
      const prisma = databaseClient.getPrismaClient();
      const contact = await prisma.contact.findFirst({
        where: { id: parsed.contactId, lead: { workspaceId } },
        include: { lead: true },
      });

      if (!contact) {
        throw new NotFoundError('Contact not found or access denied for this workspace');
      }

      if (contact.lead?.status === 'OPT_OUT' || contact.lead?.status === 'DISQUALIFIED') {
        throw new BadRequestError(`Lead is not eligible for outreach (status: ${contact.lead?.status})`, undefined, 'LEAD_NOT_ELIGIBLE');
      }

      // Pre-flight suppression check
      if (parsed.channel === 'EMAIL' && contact.email) {
        const isSuppressed = await suppressionRepository.isSuppressed(
          workspaceId,
          contact.email,
          contact.lead?.domain || undefined
        );
        if (isSuppressed) {
          throw new BadRequestError('Recipient email or domain is suppressed', undefined, 'RECIPIENT_SUPPRESSED');
        }
      } else if (parsed.channel === 'WHATSAPP' && contact.phone) {
        const isPhoneSuppressed = await suppressionRepository.isPhoneSuppressed(workspaceId, contact.phone);
        if (isPhoneSuppressed) {
          throw new BadRequestError('Recipient phone is suppressed', undefined, 'RECIPIENT_SUPPRESSED');
        }
      }

      const campaignId = parsed.campaignId || contact.lead?.campaignId;
      if (!campaignId) {
        throw new BadRequestError('Campaign ID is required to prepare outreach draft');
      }

      // Create draft in DRAFT status with isApproved = false
      const draft = await outreachService.createDraft(workspaceId, 'n8n_integration', {
        campaignId,
        contactId: parsed.contactId,
        channel: parsed.channel,
        subject: parsed.subject || 'Follow-up Regarding Services',
        bodyText: parsed.bodyText,
      });

      // Audit log
      await auditRepository.create({
        workspaceId,
        userId: 'n8n_integration',
        eventType: 'n8n_action:draft_prepared',
        entityType: 'EmailMessage',
        entityId: draft.id,
        metadata: {
          integrationId: request.n8nIntegration?.id,
          channel: parsed.channel,
          contactId: parsed.contactId,
          leadId: contact.leadId,
        },
      }).catch(() => {});

      // Dispatch outbound event
      await n8nService.dispatchOutboundWebhook(workspaceId, 'outreach.draft_created', {
        draftId: draft.id,
        leadId: contact.leadId,
        channel: parsed.channel,
      }).catch(() => {});

      return reply.status(201).send({
        success: true,
        data: draft,
        message: 'Outreach draft prepared and queued for human reviewer approval',
      });
    }
  );

  // --- Follow-Up Task Creation Endpoint ---

  fastify.post(
    '/follow-ups/tasks',
    {
      preHandler: [requireN8nAuth('follow_ups:write')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const parsed = N8nCreateFollowUpTaskSchema.parse(request.body);

      // Verify lead belongs to workspace
      await leadService.getLead(parsed.leadId, workspaceId);

      const task = await followUpService.createTask(workspaceId, 'n8n_integration', {
        leadId: parsed.leadId,
        title: parsed.title,
        description: parsed.description,
        dueDate: parsed.dueDate ? new Date(parsed.dueDate) : undefined,
      });

      await auditRepository.create({
        workspaceId,
        userId: 'n8n_integration',
        eventType: 'n8n_action:follow_up_created',
        entityType: 'Task',
        entityId: task.id,
        metadata: {
          integrationId: request.n8nIntegration?.id,
          leadId: parsed.leadId,
          title: parsed.title,
        },
      }).catch(() => {});

      return reply.status(201).send({
        success: true,
        data: task,
        message: 'Follow-up task created',
      });
    }
  );
};
