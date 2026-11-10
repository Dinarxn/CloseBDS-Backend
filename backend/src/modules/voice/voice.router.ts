import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { voiceService } from './voice.service.js';
import { callingPolicyService } from './calling-policy.service.js';
import { voiceWebhookService } from './voice-webhook.service.js';
import { voiceAIService } from './voice-ai.service.js';
import type { VoiceAIProviderId } from './voice.types.js';
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
  SaveTelephonyCredentialsSchema,
  TestConnectionSchema,
  ImportPhoneNumberSchema,
  ValidatePhoneNumberSchema,
  ConfigureRoutingSchema,
  CreateVoiceAgentStudioSchema,
  UpdateVoiceAgentStudioSchema,
  TestVoiceAgentStudioSchema,
  TransitionVoiceAgentStatusSchema,
} from './voice.schema.js';
import {
  requireAuthenticatedUser,
  requireWorkspaceContext,
  requireRole,
} from '../../core/permissions/auth-guards.js';
import { UnauthorizedError, NotFoundError, BadRequestError, ForbiddenError } from '../../core/errors/api-error.js';
import { telephonyService } from './telephony.service.js';
import { phoneNumbersService } from './phone-numbers.service.js';
import {
  voiceAgentReadinessService,
  PROVIDER_MODELS,
  PROVIDER_VOICES,
} from './voice-agent-readiness.service.js';
import type { VoiceAgentProviderType } from './voice.types.js';


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

  // 0b. Workspace Emergency Kill Switch Management
  fastify.post(
    '/policy/kill-switch',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext, requireRole(['OWNER', 'ADMIN'])],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const body = request.body as { active: boolean; reason?: string } | undefined;
      const killSwitchActive = body?.active ?? true;

      const policy = killSwitchActive
        ? await callingPolicyService.triggerEmergencyKillSwitch(workspaceId, body?.reason)
        : await callingPolicyService.resetEmergencyKillSwitch(workspaceId);

      return reply.status(200).send({
        success: true,
        data: policy,
        message: killSwitchActive
          ? 'Emergency Kill Switch ACTIVATED. All calling outreach is halted for this workspace.'
          : 'Emergency Kill Switch DEACTIVATED. Calling outreach is resumed.',
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

  // ============================================================================
  // 2.1 Voice Agent Studio 11-Step Guided Wizard & Lifecycle Engine (R4)
  // ============================================================================

  // List all Voice Agents formatted as Studio configurations
  fastify.get(
    '/agents/studio',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const agents = await voiceAgentReadinessService.listAgentsStudio(workspaceId);
      return reply.status(200).send({
        success: true,
        data: agents,
      });
    }
  );

  // Create new Voice Agent via Studio
  fastify.post(
    '/agents/studio',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext, requireRole(['OWNER', 'ADMIN'])],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId, userId } = request.workspaceContext!;
      const parsed = CreateVoiceAgentStudioSchema.parse(request.body);
      const agent = await voiceAgentReadinessService.createAgentStudio(
        workspaceId,
        parsed,
        userId || 'system'
      );
      return reply.status(201).send({
        success: true,
        data: agent,
        message: 'Voice agent created in Studio successfully',
      });
    }
  );

  // Models catalog filtered by provider
  fastify.get(
    '/agents/studio/models',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { provider?: string };
      const provider = (query.provider || 'mock') as VoiceAgentProviderType;
      const models = PROVIDER_MODELS[provider] || PROVIDER_MODELS.mock;
      return reply.status(200).send({
        success: true,
        data: models,
      });
    }
  );

  // Voices catalog filtered by provider with audio samples
  fastify.get(
    '/agents/studio/voices',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { provider?: string };
      const provider = (query.provider || 'mock') as VoiceAgentProviderType;
      const voices = PROVIDER_VOICES[provider] || PROVIDER_VOICES.mock;
      return reply.status(200).send({
        success: true,
        data: voices,
      });
    }
  );

  // Validate Provider-Agent-Number compatibility
  fastify.post(
    '/agents/studio/validate-number',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const { phoneNumberId, agentId } = request.body as {
        phoneNumberId: string;
        agentId?: string;
      };
      const result = await voiceAgentReadinessService.validateNumberCompatibility(
        workspaceId,
        phoneNumberId,
        agentId
      );
      return reply.status(200).send({
        success: true,
        data: result,
      });
    }
  );

  // Get single Studio Agent by ID
  fastify.get(
    '/agents/studio/:id',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const { id } = request.params as { id: string };
      const agent = await voiceAgentReadinessService.getAgentStudio(id, workspaceId);
      return reply.status(200).send({
        success: true,
        data: agent,
      });
    }
  );

  // Update Studio Agent configuration
  fastify.put(
    '/agents/studio/:id',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext, requireRole(['OWNER', 'ADMIN'])],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId, userId } = request.workspaceContext!;
      const { id } = request.params as { id: string };
      const parsed = UpdateVoiceAgentStudioSchema.parse(request.body);
      const updated = await voiceAgentReadinessService.updateAgentStudio(
        id,
        workspaceId,
        parsed,
        userId || 'system'
      );
      return reply.status(200).send({
        success: true,
        data: updated,
        message: 'Voice agent configuration updated in Studio',
      });
    }
  );

  // Audit Pre-Activation Readiness Report across 11 Steps
  fastify.get(
    '/agents/studio/:id/readiness',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const { id } = request.params as { id: string };
      const agent = await voiceAgentReadinessService.getAgentStudio(id, workspaceId);
      const report = await voiceAgentReadinessService.evaluateReadiness(agent, workspaceId);
      return reply.status(200).send({
        success: true,
        data: report,
      });
    }
  );

  // Execute diagnostic test call (simulated or carrier line) -> transitions to 'TESTED'
  fastify.post(
    '/agents/studio/:id/test',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext, requireRole(['OWNER', 'ADMIN', 'MEMBER'])],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const { id } = request.params as { id: string };
      const parsed = TestVoiceAgentStudioSchema.parse(request.body || {});
      const result = await voiceAgentReadinessService.simulateTestCall(
        id,
        workspaceId,
        parsed
      );
      return reply.status(200).send({
        success: true,
        data: result,
        message: 'Diagnostic test call completed. Status updated to TESTED.',
      });
    }
  );

  // State machine transition with verified readiness check gate
  fastify.post(
    '/agents/studio/:id/transition-status',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext, requireRole(['OWNER', 'ADMIN'])],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId, userId } = request.workspaceContext!;
      const { id } = request.params as { id: string };
      const { status } = TransitionVoiceAgentStatusSchema.parse(request.body);
      const result = await voiceAgentReadinessService.transitionStatus(
        id,
        workspaceId,
        status,
        userId || 'system'
      );
      return reply.status(200).send({
        success: true,
        data: result.agent,
        readinessReport: result.readinessReport,
        message: `Voice agent transitioned to status ${status}`,
      });
    }
  );

  // Pre-activation gate: activate Voice Agent (requires canActivate === true and status === TESTED)
  fastify.post(
    '/agents/studio/:id/activate',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext, requireRole(['OWNER', 'ADMIN'])],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId, userId } = request.workspaceContext!;
      const { id } = request.params as { id: string };
      const result = await voiceAgentReadinessService.transitionStatus(
        id,
        workspaceId,
        'ACTIVE',
        userId || 'system'
      );
      return reply.status(200).send({
        success: true,
        data: result.agent,
        readinessReport: result.readinessReport,
        message: 'Voice agent activated successfully after verified readiness gate check.',
      });
    }
  );

  // Pause active Voice Agent
  fastify.post(
    '/agents/studio/:id/pause',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext, requireRole(['OWNER', 'ADMIN'])],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId, userId } = request.workspaceContext!;
      const { id } = request.params as { id: string };
      const result = await voiceAgentReadinessService.transitionStatus(
        id,
        workspaceId,
        'PAUSED',
        userId || 'system'
      );
      return reply.status(200).send({
        success: true,
        data: result.agent,
        message: 'Voice agent paused successfully.',
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

  // 7c. Get Call Timeline Milestones
  fastify.get(
    '/calls/:id/timeline',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const { id } = request.params as { id: string };
      const timeline = await voiceService.getCallTimeline(id, workspaceId);
      return reply.status(200).send({
        success: true,
        data: timeline,
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

      // Check signature validation
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      if (authToken && signature) {
        const twilioAdapter = telephonyService.getAdapterForWorkspace('workspace_default');
        const rawBody = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
        const isValid = twilioAdapter.verifyWebhookSignature(rawBody, signature, authToken, url);
        if (!isValid) {
          throw new ForbiddenError('Invalid Twilio webhook HMAC-SHA1 signature');
        }
      }

      const result = await voiceService.handleProviderWebhook(
        'twilio',
        request.body,
        signature,
        authToken,
        url
      );

      return reply.status(200).send({
        success: true,
        data: { received: true, ...result },
        message: 'Twilio webhook processed',
      });
    }
  );

  // 12. Telephony Credential Management (AES-256-GCM Encrypted & Masked)
  fastify.get(
    '/telephony/settings',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const settings = await telephonyService.getSettings(workspaceId);
      return reply.status(200).send({
        success: true,
        data: settings,
      });
    }
  );

  fastify.post(
    '/telephony/settings',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext, requireRole(['OWNER', 'ADMIN'])],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const parsed = SaveTelephonyCredentialsSchema.parse(request.body);
      const masked = await telephonyService.saveCredentials(workspaceId, parsed);
      return reply.status(200).send({
        success: true,
        data: masked,
        message: 'Twilio credentials encrypted server-side and persisted successfully',
      });
    }
  );

  fastify.post(
    '/telephony/test-connection',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const parsed = TestConnectionSchema.safeParse(request.body);
      const result = await telephonyService.testConnection(
        workspaceId,
        parsed.success ? parsed.data : undefined
      );
      return reply.status(200).send({
        success: true,
        data: result,
        message: result.message,
      });
    }
  );

  // 13. Phone Numbers Management (WITHOUT auto-purchasing)
  fastify.get(
    '/phone-numbers',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const numbers = await phoneNumbersService.listPhoneNumbers(workspaceId);
      return reply.status(200).send({
        success: true,
        data: numbers,
      });
    }
  );

  fastify.post(
    '/phone-numbers/import',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext, requireRole(['OWNER', 'ADMIN'])],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const parsed = ImportPhoneNumberSchema.parse(request.body);
      const imported = await phoneNumbersService.importPhoneNumber(workspaceId, parsed);
      return reply.status(201).send({
        success: true,
        data: imported,
        message: `Phone number ${imported.phoneNumber} imported into workspace successfully`,
      });
    }
  );

  fastify.post(
    '/phone-numbers/validate',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = ValidatePhoneNumberSchema.parse(request.body);
      const capabilities = await phoneNumbersService.validateCapabilities(parsed.phoneNumber);
      return reply.status(200).send({
        success: true,
        data: capabilities,
        message: capabilities.e164 ? 'Phone number format valid' : 'Invalid E.164 phone format',
      });
    }
  );

  fastify.put(
    '/phone-numbers/:id/routing',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext, requireRole(['OWNER', 'ADMIN'])],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const { id } = request.params as { id: string };
      const parsed = ConfigureRoutingSchema.parse(request.body);
      const numberEntry = await phoneNumbersService.getPhoneNumber(workspaceId, id);
      if (!numberEntry) {
        throw new NotFoundError(`Phone number with ID ${id} not found in this workspace`);
      }
      const updated = await phoneNumbersService.configureRouting(workspaceId, id, {
        phoneNumber: numberEntry.phoneNumber,
        targetAgentId: parsed.targetAgentId ?? undefined,
        forwardToNumber: parsed.forwardToNumber ?? undefined,
        webhookUrl: parsed.webhookUrl ?? undefined,
        recordingEnabled: Boolean(parsed.recordingEnabled),
      });
      return reply.status(200).send({
        success: true,
        data: updated,
        message: 'Inbound routing and agent assignment updated',
      });
    }
  );

  fastify.delete(
    '/phone-numbers/:id',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext, requireRole(['OWNER', 'ADMIN'])],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const { id } = request.params as { id: string };
      const result = await phoneNumbersService.releasePhoneNumber(workspaceId, id);
      return reply.status(200).send({
        success: true,
        data: result,
        message: result.message,
      });
    }
  );

  // 17. Retell AI Webhook Ingress
  fastify.post(
    '/webhooks/retell',
    async (request: FastifyRequest, reply: FastifyReply) => {
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
    }
  );

  // 18. Vapi Webhook Ingress
  fastify.post(
    '/webhooks/vapi',
    async (request: FastifyRequest, reply: FastifyReply) => {
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
    }
  );

  // 19. Voice AI Providers & Models/Voices Discovery
  fastify.get(
    '/voice-ai/providers',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = request.workspaceContext!;
      const cards = await voiceAIService.listProviderCards(workspaceId);
      return reply.status(200).send({
        success: true,
        data: cards,
      });
    }
  );

  fastify.get(
    '/voice-ai/models/:provider',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { provider } = request.params as { provider: VoiceAIProviderId };
      const models = await voiceAIService.listModels(provider);
      return reply.status(200).send({
        success: true,
        data: models,
      });
    }
  );

  fastify.get(
    '/voice-ai/voices/:provider',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { provider } = request.params as { provider: VoiceAIProviderId };
      const voices = await voiceAIService.listVoices(provider);
      return reply.status(200).send({
        success: true,
        data: voices,
      });
    }
  );

  fastify.post(
    '/voice-ai/test-connection',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { providerId, credentials } = (request.body || {}) as {
        providerId: VoiceAIProviderId;
        credentials?: Record<string, unknown>;
      };
      if (!providerId) {
        throw new BadRequestError('providerId is required (retell | vapi)');
      }
      const result = await voiceAIService.testConnection(providerId, credentials);
      return reply.status(200).send({
        success: true,
        data: result,
        message: result.message,
      });
    }
  );

  fastify.post(
    '/voice-ai/credentials',
    {
      preHandler: [requireAuthenticatedUser, requireWorkspaceContext, requireRole(['OWNER', 'ADMIN'])],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { providerId, credentials } = (request.body || {}) as {
        providerId: VoiceAIProviderId;
        credentials: Record<string, string>;
      };
      if (!providerId) {
        throw new BadRequestError('providerId is required (retell | vapi)');
      }
      const { workspaceId } = request.workspaceContext!;
      const card = await voiceAIService.updateCredentials(providerId, credentials || {}, workspaceId);
      return reply.status(200).send({
        success: true,
        data: card,
        message: `${card.name} credentials updated and encrypted server-side`,
      });
    }
  );
};
