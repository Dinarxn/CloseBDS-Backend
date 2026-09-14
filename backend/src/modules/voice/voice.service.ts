import {
  voiceRepository,
  campaignRepository,
  leadRepository,
  suppressionRepository,
  auditRepository,
  crmActivityRepository,
  notificationRepository,
  type CreateVoiceCampaignInput,
  type CreateVoiceAgentConfigInput,
  type ListCallsFilter,
  type CallWithRelations,
} from '../../database/repository.js';
import { databaseClient } from '../../database/client.js';
import { BadRequestError, NotFoundError, ForbiddenError, KillSwitchActiveError } from '../../core/errors/api-error.js';
import { normalizePhoneNumber, voiceSafetyEvaluator } from './voice.safety.js';
import { assertValidCallTransition, isTerminalCallStatus } from './voice.lifecycle.js';
import { StandardVoiceAIAdapter } from '../../integrations/voice-ai/voice-ai.adapter.js';
import { TwilioVoiceAdapter } from '../../integrations/calling/twilio.adapter.js';
import { providerRegistry } from '../../integrations/core/provider.registry.js';
import type { VoiceProviderAdapter } from '../../integrations/calling/index.js';
import { followUpService } from '../follow-ups/follow-up.service.js';
import { callingPolicyService } from './calling-policy.service.js';
import type {
  Call,
  VoiceCampaign,
  VoiceAgentConfig,
  WorkspaceCallingPolicy,
  CallOutcome,
  CallTranscript,
  CallEvent,
  Campaign,
} from '@prisma/client';
import type {
  CallPreparationResult,
  CallDispatchResult,
  CallTurnInput,
  VoiceSafetyCheckResult,
} from './voice.types.js';

export class VoiceService {
  private voiceAI = new StandardVoiceAIAdapter();
  private twilioAdapter = new TwilioVoiceAdapter();

  // --- Calling Policy ---
  async getCallingPolicy(workspaceId: string): Promise<WorkspaceCallingPolicy> {
    return callingPolicyService.getOrCreatePolicy(workspaceId);
  }

  async updateCallingPolicy(
    workspaceId: string,
    input: Partial<WorkspaceCallingPolicy>,
    userId?: string
  ): Promise<WorkspaceCallingPolicy> {
    const policy = await callingPolicyService.updatePolicy(workspaceId, input);
    if (userId) {
      await auditRepository.create({
        workspaceId,
        userId,
        eventType: 'CALLING_POLICY_UPDATED',
        entityType: 'WorkspaceCallingPolicy',
        entityId: policy.id,
        metadata: { updatedFields: Object.keys(input) },
      });
    }
    return policy;
  }

  // --- Legacy Voice Campaigns (backward compatibility) ---
  async upsertVoiceCampaign(
    campaignId: string,
    workspaceId: string,
    input: CreateVoiceCampaignInput,
    userId: string
  ): Promise<VoiceCampaign> {
    const campaign = await campaignRepository.findById(campaignId, workspaceId);
    if (!campaign) {
      throw new NotFoundError('Campaign not found or access denied for this workspace');
    }

    const voiceCampaign = await voiceRepository.upsertVoiceCampaign(campaignId, workspaceId, input);

    await auditRepository.create({
      workspaceId,
      userId,
      eventType: 'VOICE_CAMPAIGN_UPDATED',
      entityType: 'VoiceCampaign',
      entityId: voiceCampaign.id,
      metadata: { campaignId, input: input as unknown as Record<string, unknown> },
    });

    return voiceCampaign;
  }

  async getVoiceCampaign(
    campaignId: string,
    workspaceId: string
  ): Promise<(VoiceCampaign & { agentConfig: VoiceAgentConfig | null }) | null> {
    return voiceRepository.findVoiceCampaignByCampaignId(campaignId, workspaceId);
  }

  // --- Voice Agent Configs (Autonomous & Campaign-Independent) ---
  async createAgentConfig(
    workspaceId: string,
    input: CreateVoiceAgentConfigInput,
    userId: string
  ): Promise<VoiceAgentConfig> {
    const config = await voiceRepository.createAgentConfig(workspaceId, input);

    await auditRepository.create({
      workspaceId,
      userId,
      eventType: 'VOICE_AGENT_CONFIG_CREATED',
      entityType: 'VoiceAgentConfig',
      entityId: config.id,
      metadata: { name: config.name },
    });

    return config;
  }

  async getAgentConfigs(workspaceId: string): Promise<VoiceAgentConfig[]> {
    return voiceRepository.findAgentConfigs(workspaceId);
  }

  async getAgentConfigById(id: string, workspaceId: string): Promise<VoiceAgentConfig | null> {
    return voiceRepository.findAgentConfigById(id, workspaceId);
  }

  async updateAgentConfig(
    id: string,
    workspaceId: string,
    input: Partial<CreateVoiceAgentConfigInput>,
    userId: string
  ): Promise<VoiceAgentConfig> {
    const config = await voiceRepository.updateAgentConfig(id, workspaceId, input);

    await auditRepository.create({
      workspaceId,
      userId,
      eventType: 'VOICE_AGENT_CONFIG_UPDATED',
      entityType: 'VoiceAgentConfig',
      entityId: config.id,
      metadata: { updatedFields: Object.keys(input) },
    });

    return config;
  }

  // --- Call Preparation (Pre-Flight Safety & Context: STRICT DRY-RUN) ---
  async prepareCall(
    workspaceId: string,
    input: {
      campaignId?: string | null;
      leadId: string;
      contactId: string;
      agentConfigId?: string | null;
      idempotencyKey?: string;
    }
  ): Promise<CallPreparationResult> {
    const callingPolicy = await callingPolicyService.getOrCreatePolicy(workspaceId);

    let campaign: Campaign | null = null;
    let voiceCampaign: (VoiceCampaign & { agentConfig: VoiceAgentConfig | null }) | null = null;

    if (input.campaignId) {
      campaign = await campaignRepository.findById(input.campaignId, workspaceId);
      if (campaign) {
        voiceCampaign = await voiceRepository.findVoiceCampaignByCampaignId(input.campaignId, workspaceId);
      }
    }

    const lead = await leadRepository.findById(input.leadId, workspaceId);
    if (!lead) {
      throw new NotFoundError('Lead not found in this workspace');
    }

    const prisma = databaseClient.getPrismaClient();
    const contact = await prisma.contact.findFirst({
      where: { id: input.contactId, leadId: lead.id },
    });
    if (!contact) {
      throw new NotFoundError('Contact not found or does not belong to specified Lead');
    }

    const rawPhone = contact.phone || lead.phone;
    if (!rawPhone) {
      throw new BadRequestError('Neither contact nor lead has a phone number available for voice calling');
    }

    const normalizedPhone = normalizePhoneNumber(rawPhone);

    // Resolve VoiceAgentConfig: passed ID > voiceCampaign ID > first workspace agent config
    let agentConfig: VoiceAgentConfig | null = null;
    if (input.agentConfigId) {
      agentConfig = await voiceRepository.findAgentConfigById(input.agentConfigId, workspaceId);
    } else if (voiceCampaign?.agentConfigId) {
      agentConfig = await voiceRepository.findAgentConfigById(voiceCampaign.agentConfigId, workspaceId);
    } else {
      const allConfigs = await voiceRepository.findAgentConfigs(workspaceId);
      agentConfig = allConfigs[0] || null;
    }

    // Safety Gate Evaluation (18 Gates)
    const safetyCheck = await voiceSafetyEvaluator.evaluate({
      workspaceId,
      campaignId: campaign?.id,
      leadId: lead.id,
      contactId: contact.id,
      recipientPhone: rawPhone,
      normalizedPhone,
      callingPolicy,
      voiceCampaign,
      campaign,
      lead,
      contact,
      agentConfig,
    });

    // Grounded Context Generation (Anti-Hallucination)
    const grounded = this.voiceAI.generateGroundedContext(
      {
        leadId: lead.id,
        businessName: lead.businessName,
        domain: lead.domain,
        phone: normalizedPhone,
        address: lead.address,
        contactName: contact.fullName || `${(contact as any).firstName || ''} ${(contact as any).lastName || ''}`.trim() || undefined,
        contactTitle: contact.title,
        auditGaps: lead.websiteAudit?.auditGaps || [],
        campaignNiche: campaign?.niche || 'B2B Client Acquisition',
        campaignOffer: campaign?.targetOffer || 'Productivity & Growth Solutions',
      },
      {
        callObjective: agentConfig?.callObjective || 'Initial outreach, discovery, and qualification',
        approvedTalkingPoints: agentConfig?.approvedTalkingPoints || [],
        prohibitedClaims: agentConfig?.prohibitedClaims || [],
      }
    );

    return {
      callId: `prep_${Date.now()}`,
      status: safetyCheck.passed ? 'APPROVAL_REQUIRED' : 'BLOCKED',
      safetyCheck,
      normalizedPhone,
      groundedContext: grounded as unknown as Record<string, unknown>,
      requiresApproval: true,
    };
  }

  // --- Call Creation (Campaign-Independent) ---
  async createCall(
    workspaceId: string,
    input: {
      campaignId?: string | null;
      leadId: string;
      contactId: string;
      agentConfigId?: string | null;
      humanApprovalRequired?: boolean;
      idempotencyKey?: string;
    },
    userId?: string
  ): Promise<Call> {
    // Idempotency Check
    if (input.idempotencyKey) {
      const existing = await voiceRepository.findCallByIdempotencyKey(workspaceId, input.idempotencyKey);
      if (existing) {
        return existing;
      }
    }

    const callingPolicy = await callingPolicyService.getOrCreatePolicy(workspaceId);

    let campaign: Campaign | null = null;
    let voiceCampaign: VoiceCampaign | null = null;
    if (input.campaignId) {
      campaign = await campaignRepository.findById(input.campaignId, workspaceId);
      if (campaign) {
        voiceCampaign = await voiceRepository.findVoiceCampaignByCampaignId(input.campaignId, workspaceId);
      }
    }

    const lead = await leadRepository.findById(input.leadId, workspaceId);
    if (!lead) {
      throw new NotFoundError('Lead not found in this workspace');
    }

    const prisma = databaseClient.getPrismaClient();
    const contact = await prisma.contact.findFirst({
      where: { id: input.contactId, leadId: lead.id },
    });
    if (!contact) {
      throw new NotFoundError('Contact not found for this Lead');
    }

    const rawPhone = contact.phone || lead.phone;
    if (!rawPhone) {
      throw new BadRequestError('Recipient phone number is required');
    }

    const normalizedPhone = normalizePhoneNumber(rawPhone);

    const call = await voiceRepository.createCall(workspaceId, {
      workspaceId,
      campaignId: campaign?.id ?? null,
      voiceCampaignId: voiceCampaign?.id ?? null,
      leadId: input.leadId,
      contactId: input.contactId,
      agentConfigId: input.agentConfigId || voiceCampaign?.agentConfigId || null,
      recipientPhone: rawPhone,
      normalizedPhone,
      idempotencyKey: input.idempotencyKey,
      humanApprovalRequired: input.humanApprovalRequired ?? callingPolicy.humanApprovalRequired ?? true,
      status: 'APPROVAL_REQUIRED',
    });

    await voiceRepository.createEvent(call.id, 'CALL_CREATED', {
      recipientPhone: rawPhone,
      normalizedPhone,
      humanApprovalRequired: call.humanApprovalRequired,
    });

    if (userId) {
      await auditRepository.create({
        workspaceId,
        userId,
        eventType: 'CALL_CREATED',
        entityType: 'Call',
        entityId: call.id,
        metadata: { campaignId: input.campaignId ?? null, leadId: input.leadId },
      });
    }

    return call;
  }

  async getCall(id: string, workspaceId: string): Promise<CallWithRelations> {
    const call = await voiceRepository.findCallById(id, workspaceId);
    if (!call) {
      throw new NotFoundError('Call not found or access denied for this workspace');
    }
    return call;
  }

  // --- Call Safety Evaluation (Server-Authoritative) ---
  async evaluateCallSafety(id: string, workspaceId: string): Promise<VoiceSafetyCheckResult> {
    const call = await this.getCall(id, workspaceId);
    const callingPolicy = await callingPolicyService.getOrCreatePolicy(workspaceId);

    return voiceSafetyEvaluator.evaluate({
      workspaceId,
      campaignId: call.campaignId,
      leadId: call.leadId,
      contactId: call.contactId,
      recipientPhone: call.recipientPhone,
      normalizedPhone: call.normalizedPhone,
      callingPolicy,
      voiceCampaign: call.voiceCampaign,
      campaign: call.campaign,
      lead: call.lead,
      contact: call.contact,
      agentConfig: call.agentConfig,
      currentCall: call,
    });
  }

  async listCalls(workspaceId: string, filter: ListCallsFilter) {
    return voiceRepository.findManyCallsPaginated(workspaceId, filter);
  }

  // --- Human Approval Lifecycle ---
  async approveCall(id: string, workspaceId: string, userId: string): Promise<Call> {
    const call = await this.getCall(id, workspaceId);
    assertValidCallTransition(call.status, 'APPROVED');

    const updated = await voiceRepository.approveCall(id, workspaceId, userId);

    await voiceRepository.createEvent(id, 'CALL_STARTED', {
      approvedByUserId: userId,
      approvedAt: new Date(),
    });

    await auditRepository.create({
      workspaceId,
      userId,
      eventType: 'CALL_APPROVED',
      entityType: 'Call',
      entityId: id,
      metadata: { previousStatus: call.status, newStatus: 'APPROVED' },
    });

    return updated;
  }

  async rejectCall(id: string, workspaceId: string, userId: string, reason?: string): Promise<Call> {
    const call = await this.getCall(id, workspaceId);
    assertValidCallTransition(call.status, 'BLOCKED');

    const updated = await voiceRepository.rejectCall(id, workspaceId, userId);

    await voiceRepository.createEvent(id, 'CALL_FAILED', {
      rejectedByUserId: userId,
      reason: reason || 'Rejected by human reviewer',
    });

    await auditRepository.create({
      workspaceId,
      userId,
      eventType: 'CALL_REJECTED',
      entityType: 'Call',
      entityId: id,
      metadata: { reason },
    });

    return updated;
  }

  async cancelCall(id: string, workspaceId: string, userId: string, reason?: string): Promise<Call> {
    const call = await this.getCall(id, workspaceId);
    assertValidCallTransition(call.status, 'CANCELLED');

    const updated = await voiceRepository.cancelCall(id, workspaceId, userId);

    await voiceRepository.createEvent(id, 'CALL_CANCELLED', {
      cancelledByUserId: userId,
      reason,
    });

    await auditRepository.create({
      workspaceId,
      userId,
      eventType: 'CALL_CANCELLED',
      entityType: 'Call',
      entityId: id,
      metadata: { reason },
    });

    return updated;
  }

  /**
   * Invalidates existing human approval whenever call context, phone, or script is edited.
   */
  async invalidateCallApproval(
    id: string,
    workspaceId: string,
    userId?: string,
    reason?: string
  ): Promise<Call> {
    const call = await this.getCall(id, workspaceId);
    const updated = await voiceRepository.updateCall(id, workspaceId, {
      isApproved: false,
      approvedByUserId: null,
      approvedAt: null,
      status: 'APPROVAL_REQUIRED',
      blockedReason: reason || 'Call parameters modified; approval invalidated',
    });

    await voiceRepository.createEvent(id, 'CALL_FAILED', {
      reason: reason || 'Approval invalidated due to context modification',
    });

    if (userId) {
      await auditRepository.create({
        workspaceId,
        userId,
        eventType: 'CALL_APPROVAL_INVALIDATED',
        entityType: 'Call',
        entityId: id,
        metadata: { reason, previousStatus: call.status },
      });
    }

    return updated;
  }

  // --- Outbound Call Dispatch ---
  async dispatchCall(
    id: string,
    workspaceId: string,
    options?: { streamUrl?: string }
  ): Promise<CallDispatchResult> {
    const call = await this.getCall(id, workspaceId);
    const callingPolicy = await callingPolicyService.getOrCreatePolicy(workspaceId);

    // Enforce Approval Gate
    if (call.humanApprovalRequired && !call.isApproved) {
      throw new ForbiddenError(
        'Call requires explicit human approval before provider dispatch. Call status is: ' + call.status
      );
    }

    // Enforce Global Kill Switch immediately prior to dispatch
    const isKillSwitchActive =
      process.env.KILL_SWITCH_ACTIVE === 'true' || process.env.KILL_SWITCH_ACTIVE === '1';
    if (isKillSwitchActive) {
      await auditRepository.create({
        workspaceId,
        userId: call.approvedByUserId || undefined,
        eventType: 'CALL_BLOCKED',
        entityType: 'Call',
        entityId: id,
        metadata: { reason: 'Global Kill Switch is active' },
      }).catch(() => {});
      throw new KillSwitchActiveError('Global Outreach Kill Switch is active. Telephony dispatch blocked.');
    }

    assertValidCallTransition(call.status, 'INITIATING');

    // Run Pre-Dispatch Safety Check (All 18 Gates)
    const safetyCheck = await voiceSafetyEvaluator.evaluate({
      workspaceId,
      campaignId: call.campaignId,
      leadId: call.leadId,
      contactId: call.contactId,
      recipientPhone: call.recipientPhone,
      normalizedPhone: call.normalizedPhone,
      callingPolicy,
      voiceCampaign: call.voiceCampaign,
      campaign: call.campaign,
      lead: call.lead,
      contact: call.contact,
      agentConfig: call.agentConfig,
      currentCall: call,
    });

    if (!safetyCheck.passed) {
      await voiceRepository.updateCallStatus(id, workspaceId, 'BLOCKED', {
        blockedReason: safetyCheck.blockedReason,
      });

      await voiceRepository.createEvent(id, 'CALL_FAILED', {
        blockedReason: safetyCheck.blockedReason,
      });

      await auditRepository.create({
        workspaceId,
        userId: call.approvedByUserId || undefined,
        eventType: 'CALL_BLOCKED',
        entityType: 'Call',
        entityId: id,
        metadata: { blockedReason: safetyCheck.blockedReason },
      }).catch(() => {});

      return {
        callId: id,
        status: 'BLOCKED',
        blockedReason: safetyCheck.blockedReason,
      };
    }

    // Provider Dispatch Boundary
    const telephonyAdapter =
      providerRegistry.getAdapter<VoiceProviderAdapter>('Twilio') || this.twilioAdapter;

    if (!telephonyAdapter.isConfigured()) {
      throw new BadRequestError(
        'Outbound telephony provider is not configured. Outbound voice calling is disabled for safety.'
      );
    }

    const attemptNumber = (call.attempts?.length || 0) + 1;
    const attempt = await voiceRepository.createAttempt(call.id, {
      attemptNumber,
      status: 'INITIATING',
    });

    try {
      const recordingConsent = call.voiceCampaign?.recordingConsent ?? callingPolicy.recordingConsent;
      const providerResult = await telephonyAdapter.initiateCall({
        callId: call.id,
        leadId: call.leadId,
        contactId: call.contactId,
        recipientPhone: call.normalizedPhone,
        streamUrl: options?.streamUrl,
        recordingConsent,
      });

      const providerCallId =
        'providerCallId' in providerResult ? providerResult.providerCallId : providerResult.callSessionId;

      await voiceRepository.updateCallStatus(id, workspaceId, 'INITIATING', {
        providerCallId,
        initiatedAt: new Date(),
      });

      await voiceRepository.updateAttempt(attempt.id, {
        providerCallId,
        status: 'INITIATING',
      });

      await voiceRepository.createEvent(id, 'CALL_INITIATED', {
        providerCallId,
        attemptNumber,
      });

      await auditRepository.create({
        workspaceId,
        userId: call.approvedByUserId || undefined,
        eventType: 'CALL_DISPATCHED',
        entityType: 'Call',
        entityId: id,
        metadata: {
          providerCallId,
          attemptNumber,
          recipientPhone: call.normalizedPhone,
        },
      }).catch(() => {});

      return {
        callId: id,
        status: 'INITIATING',
        providerCallId,
        startedAt: new Date(),
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Telephony dispatch failed';

      await voiceRepository.updateCallStatus(id, workspaceId, 'FAILED', {
        blockedReason: errorMsg,
      });

      await voiceRepository.updateAttempt(attempt.id, {
        status: 'FAILED',
        failureReason: errorMsg,
        endedAt: new Date(),
      });

      await voiceRepository.createEvent(id, 'CALL_FAILED', {
        attemptNumber,
        error: errorMsg,
      });

      await auditRepository.create({
        workspaceId,
        userId: call.approvedByUserId || undefined,
        eventType: 'CALL_DISPATCH_FAILED',
        entityType: 'Call',
        entityId: id,
        metadata: { error: errorMsg, attemptNumber },
      }).catch(() => {});

      // Outbound n8n notification
      try {
        const { n8nService } = await import('../integrations/n8n/n8n.service.js');
        n8nService.dispatchOutboundWebhook(workspaceId, 'call.failed', {
          callId: id,
          leadId: call.leadId,
          error: errorMsg,
        }).catch(() => {});
      } catch {
        // Non-blocking
      }

      throw err;
    }
  }

  // --- Provider Webhook Integration (Status Callbacks) ---
  async handleProviderWebhook(
    provider: string,
    rawPayload: unknown,
    signatureHeader?: string,
    secret?: string,
    url?: string
  ): Promise<{ processed: boolean; event: CallEvent | null }> {
    const telephonyAdapter =
      providerRegistry.getAdapter<VoiceProviderAdapter>(provider === 'twilio' ? 'Twilio' : provider) ||
      this.twilioAdapter;

    // Webhook Signature Verification
    const rawString = typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload);
    const isValid = telephonyAdapter.verifyWebhookSignature(rawString, signatureHeader, secret, url);

    if (!isValid && process.env.NODE_ENV === 'production') {
      throw new ForbiddenError('Invalid provider webhook signature');
    }

    const normalized = telephonyAdapter.normalizeEvent(rawPayload);
    const prisma = databaseClient.getPrismaClient();

    const call = await prisma.call.findFirst({
      where: { providerCallId: normalized.providerCallId },
    });

    if (!call) {
      return { processed: false, event: null };
    }

    // Check valid state machine transition
    if (call.status !== normalized.status && !isTerminalCallStatus(call.status)) {
      assertValidCallTransition(call.status, normalized.status);

      await voiceRepository.updateCallStatus(call.id, call.workspaceId, normalized.status, {
        durationSeconds: normalized.durationSeconds ?? call.durationSeconds,
        completedAt: isTerminalCallStatus(normalized.status) ? new Date() : undefined,
      });
    }

    const event = await voiceRepository.createEvent(call.id, normalized.eventType, normalized.metadata);

    await auditRepository.create({
      workspaceId: call.workspaceId,
      eventType: `webhook:${provider}:${normalized.status.toLowerCase()}`,
      entityType: 'Call',
      entityId: call.id,
      metadata: {
        providerCallId: normalized.providerCallId,
        eventType: normalized.eventType,
        status: normalized.status,
      },
    }).catch(() => {});

    // If call reached terminal state, trigger post-call processing
    if (isTerminalCallStatus(normalized.status)) {
      await this.processCallCompletion(call.id, call.workspaceId);
    }

    return { processed: true, event };
  }

  // --- Transcripts & Real-Time Turns ---
  async recordCallTurn(
    callId: string,
    workspaceId: string,
    turnInput: CallTurnInput
  ): Promise<CallTranscript> {
    const call = await this.getCall(callId, workspaceId);

    const transcript = await voiceRepository.createTranscriptTurn(call.id, {
      turnIndex: turnInput.turnIndex,
      speaker: turnInput.speaker,
      text: turnInput.text,
      confidence: turnInput.confidence,
      timestampMs: turnInput.timestampMs,
    });

    return transcript;
  }

  // --- Post-Call Intelligence & CRM Sync ---
  async processCallCompletion(callId: string, workspaceId: string): Promise<CallOutcome> {
    const call = await this.getCall(callId, workspaceId);

    const turns: CallTurnInput[] = (call.transcripts || []).map((t) => ({
      turnIndex: t.turnIndex,
      speaker: (t.speaker as 'agent' | 'lead' | 'system') || 'agent',
      text: t.text,
      confidence: t.confidence ?? undefined,
      timestampMs: t.timestampMs ?? undefined,
    }));

    // Voice AI Analysis
    const outcomeAnalysis = await this.voiceAI.classifyOutcome(turns, {
      rawStatus: call.status,
      durationSeconds: call.durationSeconds,
    });

    // Upsert CallOutcome
    const callOutcome = await voiceRepository.upsertOutcome(call.id, {
      outcome: outcomeAnalysis.outcome,
      interestLevel: outcomeAnalysis.interestLevel,
      objections: outcomeAnalysis.objections,
      requestedFollowUp: outcomeAnalysis.requestedFollowUp,
      nextAction: outcomeAnalysis.nextAction,
      sentiment: outcomeAnalysis.sentiment,
      optOutDetected: outcomeAnalysis.optOutDetected,
      summary: outcomeAnalysis.summary,
      derivedFromActual: outcomeAnalysis.derivedFromActual,
    });

    // 1. CRM Activity Log (CALL_LOG)
    await crmActivityRepository.create(workspaceId, {
      leadId: call.leadId,
      userId: call.approvedByUserId || undefined,
      type: 'CALL_LOG',
      description: `Voice Outreach: ${outcomeAnalysis.outcome} - ${outcomeAnalysis.summary}`,
      metadata: {
        callId: call.id,
        outcome: outcomeAnalysis.outcome,
        durationSeconds: call.durationSeconds,
        interestLevel: outcomeAnalysis.interestLevel,
        sentiment: outcomeAnalysis.sentiment,
      },
    });

    // 2. Follow-Up Task Creation (No external dispatch)
    if (
      outcomeAnalysis.outcome === 'CALLBACK_REQUESTED' ||
      outcomeAnalysis.outcome === 'MEETING_REQUESTED'
    ) {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + (outcomeAnalysis.outcome === 'MEETING_REQUESTED' ? 1 : 2));

      await followUpService.createTask(workspaceId, call.approvedByUserId || undefined, {
        leadId: call.leadId,
        title:
          outcomeAnalysis.outcome === 'MEETING_REQUESTED'
            ? `Follow up on requested demo/meeting with ${call.contact.fullName}`
            : `Call back prospect ${call.contact.fullName} at ${call.normalizedPhone}`,
        description: `Voice call outcome: ${outcomeAnalysis.summary}. Objections: ${outcomeAnalysis.objections.join(', ') || 'None'}.`,
        dueDate,
      });
    }

    // 3. Automated Opt-Out Suppression Enforcement
    if (outcomeAnalysis.optOutDetected || outcomeAnalysis.outcome === 'OPTED_OUT' || outcomeAnalysis.outcome === 'DO_NOT_CALL') {
      await suppressionRepository.create({
        workspaceId,
        type: 'PHONE',
        value: call.normalizedPhone,
        reason: 'OPT_OUT',
      });

      // Advance Lead CRM Stage to OPT_OUT
      const prisma = databaseClient.getPrismaClient();
      await prisma.lead.update({
        where: { id: call.leadId },
        data: { status: 'OPT_OUT' },
      });

      await voiceRepository.updateCallStatus(call.id, workspaceId, 'OPTED_OUT');
    }

    // 4. In-App Notification
    if (call.approvedByUserId) {
      await notificationRepository.create({
        workspaceId,
        userId: call.approvedByUserId,
        title: `Voice Call Completed: ${call.lead.businessName}`,
        message: `Outcome: ${outcomeAnalysis.outcome}. Sentiment: ${outcomeAnalysis.sentiment}.`,
        type: outcomeAnalysis.outcome === 'MEETING_REQUESTED' ? 'SUCCESS' : 'INFO',
      });
    }

    // 5. Outbound n8n notification
    try {
      const { n8nService } = await import('../integrations/n8n/n8n.service.js');
      n8nService.dispatchOutboundWebhook(workspaceId, 'call.completed', {
        callId: call.id,
        leadId: call.leadId,
        outcome: outcomeAnalysis.outcome,
        durationSeconds: call.durationSeconds,
        sentiment: outcomeAnalysis.sentiment,
      }).catch(() => {});
    } catch {
      // Non-blocking
    }

    return callOutcome;
  }
}

export const voiceService = new VoiceService();
