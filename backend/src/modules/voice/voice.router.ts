import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { voiceService } from './voice.service.js';
import {
  CreateVoiceCampaignSchema,
  UpdateCallingPolicySchema,
  CreateVoiceAgentConfigSchema,
  PrepareCallSchema,
  CreateCallSchema,
  RejectCallSchema,
  CancelCallSchema,
  DispatchCallSchema,
  RecordCallTurnSchema,
  ListCallsQuerySchema,
} from './voice.schema.js';
import {
  requireAuthenticatedUser,
  requireWorkspaceContext,
  requireRole,
} from '../../core/permissions/auth-guards.js';
import { UnauthorizedError } from '../../core/errors/api-error.js';

export const voiceRouter: FastifyPluginAsync = async (fastify) => {
  // 0. Workspace Calling Policy Management
  fastify.get(
    '/policy',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const policy = await voiceService.getCallingPolicy(workspaceId);
      return reply.status(200).send({
        success: true,
        data: policy,
      });
    }
  );

  fastify.put(
    '/policy',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext, requireRole(['OWNER', 'ADMIN'])],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId, userId } = request.workspaceContext!;
      const parsed = UpdateCallingPolicySchema.parse(request.body);
      const policy = await voiceService.updateCallingPolicy(workspaceId, parsed, userId || 'system');
      return reply.status(200).send({
        success: true,
        data: policy,
        message: 'Workspace calling policy updated successfully',
      });
    }
  );
  // 1. Voice Campaign Configuration
  fastify.post(
    '/campaigns/:campaignId',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext, requireRole(['OWNER', 'ADMIN'])],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId, userId } = request.workspaceContext!;
      const { campaignId } = request.params as { campaignId: string };
      const parsed = CreateVoiceCampaignSchema.parse(request.body);
      const voiceCampaign = await voiceService.upsertVoiceCampaign(
        campaignId,
        workspaceId,
        parsed,
        userId || 'system'
      );
      return reply.status(200).send({
        success: true,
        data: voiceCampaign,
        message: 'Voice campaign configuration saved',
      });
    }
  );

  fastify.get(
    '/campaigns/:campaignId',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const { campaignId } = request.params as { campaignId: string };
      const voiceCampaign = await voiceService.getVoiceCampaign(campaignId, workspaceId);
      return reply.status(200).send({
        success: true,
        data: voiceCampaign,
      });
    }
  );

  // 2. Voice Agent Configs
  fastify.post(
    '/agent-configs',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext, requireRole(['OWNER', 'ADMIN'])],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId, userId } = request.workspaceContext!;
      const parsed = CreateVoiceAgentConfigSchema.parse(request.body);
      const config = await voiceService.createAgentConfig(
        workspaceId,
        {
          workspaceId,
          ...parsed,
        },
        userId || 'system'
      );
      return reply.status(201).send({
        success: true,
        data: config,
        message: 'Voice agent configuration created',
      });
    }
  );

  fastify.get(
    '/agent-configs',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const configs = await voiceService.getAgentConfigs(workspaceId);
      return reply.status(200).send({
        success: true,
        data: configs,
      });
    }
  );

  fastify.get(
    '/agent-configs/:id',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const { id } = request.params as { id: string };
      const config = await voiceService.getAgentConfigById(id, workspaceId);
      return reply.status(200).send({
        success: true,
        data: config,
      });
    }
  );

  fastify.put(
    '/agent-configs/:id',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext, requireRole(['OWNER', 'ADMIN'])],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId, userId } = request.workspaceContext!;
      const { id } = request.params as { id: string };
      const parsed = CreateVoiceAgentConfigSchema.partial().parse(request.body);
      const config = await voiceService.updateAgentConfig(
        id,
        workspaceId,
        parsed,
        userId || 'system'
      );
      return reply.status(200).send({
        success: true,
        data: config,
        message: 'Voice agent configuration updated',
      });
    }
  );

  // 3. Call Preparation (Dry-run safety & context)
  fastify.post(
    '/calls/prepare',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const parsed = PrepareCallSchema.parse(request.body);
      const result = await voiceService.prepareCall(workspaceId, parsed);
      return reply.status(200).send({
        success: true,
        data: result,
        message: 'Call pre-flight evaluation complete',
      });
    }
  );

  // 4. Create Call
  fastify.post(
    '/calls',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext, requireRole(['OWNER', 'ADMIN', 'MEMBER'])],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId, userId } = request.workspaceContext!;
      const parsed = CreateCallSchema.parse(request.body);
      const call = await voiceService.createCall(workspaceId, parsed, userId);
      return reply.status(201).send({
        success: true,
        data: call,
        message: 'Voice call queued for human approval',
      });
    }
  );

  // 5. List Calls (Paginated)
  fastify.get(
    '/calls',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const query = ListCallsQuerySchema.parse(request.query);
      const calls = await voiceService.listCalls(workspaceId, query);
      return reply.status(200).send({
        success: true,
        ...calls,
      });
    }
  );

  // 6. Get Single Call
  fastify.get(
    '/calls/:id',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext],
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

  // 7. Human Approval Actions (Server-Authoritative)
  fastify.post(
    '/calls/:id/approve',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext, requireRole(['OWNER', 'ADMIN', 'MEMBER'])],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId, userId } = request.workspaceContext!;
      if (!userId) {
        throw new UnauthorizedError('Human user session required for call approval');
      }
      const { id } = request.params as { id: string };
      const call = await voiceService.approveCall(id, workspaceId, userId);
      return reply.status(200).send({
        success: true,
        data: call,
        message: 'Call approved by human reviewer',
      });
    }
  );

  fastify.post(
    '/calls/:id/reject',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext, requireRole(['OWNER', 'ADMIN', 'MEMBER'])],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId, userId } = request.workspaceContext!;
      const { id } = request.params as { id: string };
      const parsed = RejectCallSchema.safeParse(request.body);
      const reason = parsed.success ? parsed.data.reason : undefined;
      const call = await voiceService.rejectCall(id, workspaceId, userId || 'system', reason);
      return reply.status(200).send({
        success: true,
        data: call,
        message: 'Call rejected',
      });
    }
  );

  fastify.post(
    '/calls/:id/cancel',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext, requireRole(['OWNER', 'ADMIN', 'MEMBER'])],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId, userId } = request.workspaceContext!;
      const { id } = request.params as { id: string };
      const parsed = CancelCallSchema.safeParse(request.body);
      const reason = parsed.success ? parsed.data.reason : undefined;
      const call = await voiceService.cancelCall(id, workspaceId, userId || 'system', reason);
      return reply.status(200).send({
        success: true,
        data: call,
        message: 'Call cancelled',
      });
    }
  );

  // 7b. Pre-Dispatch Safety Check Evaluation
  fastify.post(
    '/calls/:id/safety-check',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const { id } = request.params as { id: string };
      const safetyResult = await voiceService.evaluateCallSafety(id, workspaceId);
      return reply.status(200).send({
        success: true,
        data: safetyResult,
        message: 'Call safety evaluation complete',
      });
    }
  );

  // 8. Outbound Dispatch
  fastify.post(
    '/calls/:id/dispatch',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext, requireRole(['OWNER', 'ADMIN', 'MEMBER'])],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const { id } = request.params as { id: string };
      const parsed = DispatchCallSchema.safeParse(request.body);
      const streamUrl = parsed.success ? parsed.data.streamUrl : undefined;
      const result = await voiceService.dispatchCall(id, workspaceId, { streamUrl });
      return reply.status(200).send({
        success: true,
        data: result,
        message: 'Call dispatched to telephony provider',
      });
    }
  );

  // 9. Transcripts & Turns
  fastify.post(
    '/calls/:id/turns',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const { id } = request.params as { id: string };
      const parsed = RecordCallTurnSchema.parse(request.body);
      const turn = await voiceService.recordCallTurn(id, workspaceId, parsed);
      return reply.status(201).send({
        success: true,
        data: turn,
        message: 'Turn recorded',
      });
    }
  );

  // 10. Call Completion & AI Sync
  fastify.post(
    '/calls/:id/complete',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const { id } = request.params as { id: string };
      const outcome = await voiceService.processCallCompletion(id, workspaceId);
      return reply.status(200).send({
        success: true,
        data: outcome,
        message: 'Call outcome analyzed and CRM activity recorded',
      });
    }
  );

  // 11. Provider Webhook (Twilio Status Callback)
  fastify.post(
    '/webhooks/twilio',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const signature = (request.headers['x-twilio-signature'] as string) || undefined;
      const host = request.headers.host || 'api.closevds.local';
      const url = `https://${host}${request.url}`;

      const result = await voiceService.handleProviderWebhook(
        'twilio',
        request.body,
        signature,
        process.env.TWILIO_AUTH_TOKEN,
        url
      );

      return reply.status(200).send({
        success: true,
        data: { received: true, ...result },
        message: 'Twilio webhook processed',
      });
    }
  );
};
