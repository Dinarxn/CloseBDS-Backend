import crypto from 'node:crypto';
import { BaseVoiceAIAdapter } from './voice-ai.adapter.js';
import type {
  GroundedLeadData,
  GroundedVoiceContext,
  VoiceTurn,
  VoiceSession,
  VoiceResponse,
  CallSummaryResult,
  CallOutcomeAnalysis,
} from './index.js';
import {
  type ProviderCapability,
  type ProviderHealthResult,
} from '../core/provider.types.js';
import type {
  VoiceAIProviderId,
  VoiceAIModel,
  VoiceAIVoice,
  VoiceAIAssistantConfig,
  VoiceAIAssistantSyncResult,
  VoiceAIDispatchPayload,
  VoiceAICallDispatchResult,
  NormalizedVoiceAIEvent,
  CallTurnInput,
  CallRecordingMetadata,
} from '../../modules/voice/voice.types.js';
import {
  MOCK_RETELL_MODELS,
  MOCK_VAPI_MODELS,
  MOCK_VOICES,
  MOCK_CALL_TRANSCRIPTS,
  MOCK_RECORDING,
} from './mock-fixtures.js';

export interface MockVoiceAIOptions {
  providerId?: VoiceAIProviderId;
  simulatedFailure?: boolean;
  webhookSecret?: string;
}

/**
 * Mock Voice AI Adapter for offline development integrity mode.
 * Simulates Retell AI and Vapi assistant synchronization, model discovery, voice discovery,
 * and call dispatch without live API calls.
 */
export class MockVoiceAIAdapter extends BaseVoiceAIAdapter {
  public readonly providerId: VoiceAIProviderId;
  public readonly providerName: string;

  private simulatedFailure: boolean;
  private webhookSecret: string;
  private assistants = new Map<string, VoiceAIAssistantConfig>();

  constructor(options?: MockVoiceAIOptions) {
    super();
    this.providerId = options?.providerId || 'mock-voice-ai';
    this.providerName =
      this.providerId === 'retell'
        ? 'Mock Retell AI Engine'
        : this.providerId === 'vapi'
        ? 'Mock Vapi Voice Platform'
        : 'Mock Voice AI Intelligence';
    this.simulatedFailure = Boolean(options?.simulatedFailure);
    this.webhookSecret = options?.webhookSecret || 'mock_voice_ai_webhook_signing_secret';
  }

  isConfigured(): boolean {
    return true; // Available for offline testing and development
  }

  getCapabilities(): ProviderCapability {
    return {
      name: this.providerName,
      category: this.category,
      supportedFeatures: [
        'Deterministic Voice AI Assistant Simulation',
        'Model & Voice Catalog Discovery',
        'Anti-Hallucination Grounded Prompt Generation',
        'HMAC Webhook Verification',
        'Transcript & Recording Metadata Synthesis',
      ],
      requiresApiKey: false,
      isDispatchProvider: false,
    };
  }

  async healthCheck(): Promise<ProviderHealthResult> {
    if (this.simulatedFailure) {
      return {
        providerName: this.providerName,
        category: this.category,
        status: 'DEGRADED',
        isConfigured: true,
        message: 'Mock Voice AI reporting simulated upstream latency/error',
      };
    }

    return {
      providerName: this.providerName,
      category: this.category,
      status: 'AVAILABLE',
      isConfigured: true,
      message: 'Mock Voice AI engine operational in offline integrity mode',
    };
  }

  override async listModels(): Promise<VoiceAIModel[]> {
    if (this.providerId === 'retell') {
      return MOCK_RETELL_MODELS;
    }
    if (this.providerId === 'vapi') {
      return MOCK_VAPI_MODELS;
    }
    return [...MOCK_RETELL_MODELS, ...MOCK_VAPI_MODELS];
  }

  override async listVoices(): Promise<VoiceAIVoice[]> {
    return MOCK_VOICES;
  }

  override async syncAssistant(config: VoiceAIAssistantConfig): Promise<VoiceAIAssistantSyncResult> {
    if (this.simulatedFailure) {
      throw new Error('Simulated upstream assistant sync failure');
    }

    const assistantId = config.assistantId || `mock_asst_${this.providerId}_${Date.now()}`;
    this.assistants.set(assistantId, config);

    return {
      assistantId,
      provider: this.providerId,
      syncedAt: new Date(),
      version: '1.0.0',
      status: 'SYNCED',
    };
  }

  override async dispatchCall(_payload: VoiceAIDispatchPayload): Promise<VoiceAICallDispatchResult> {
    if (this.simulatedFailure) {
      throw new Error('Simulated Voice AI dispatch error');
    }

    return {
      providerCallId: `mock_vai_call_${this.providerId}_${Date.now()}`,
      provider: this.providerId,
      status: 'initiated',
      startedAt: new Date(),
    };
  }

  override verifyWebhookSignature(
    rawPayload: string | Buffer,
    signatureHeader?: string,
    secret?: string
  ): boolean {
    if (!signatureHeader) return false;
    const signingKey = secret || this.webhookSecret;

    try {
      const payloadString = Buffer.isBuffer(rawPayload) ? rawPayload.toString('utf8') : String(rawPayload);
      const expected = crypto.createHmac('sha256', signingKey).update(payloadString).digest('hex');
      const expectedBuffer = Buffer.from(expected);
      const signatureBuffer = Buffer.from(signatureHeader);

      if (expectedBuffer.length !== signatureBuffer.length) return false;
      return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
    } catch {
      return false;
    }
  }

  override parseWebhookEvent(rawPayload: unknown): NormalizedVoiceAIEvent {
    const payload =
      typeof rawPayload === 'object' && rawPayload !== null
        ? (rawPayload as Record<string, unknown>)
        : {};

    const callId = String(payload.call_id || payload.callId || `mock_call_${Date.now()}`);

    return {
      eventId: `mock_vai_evt_${Date.now()}`,
      provider: this.providerId,
      providerCallId: callId,
      eventType: 'call_analyzed',
      normalizedStatus: 'completed',
      transcriptTurns: MOCK_CALL_TRANSCRIPTS,
      recordingUrl: MOCK_RECORDING.recordingUrl,
      durationSeconds: 105,
      occurredAt: new Date(),
    };
  }

  override async fetchTranscript(_callId: string): Promise<CallTurnInput[]> {
    return MOCK_CALL_TRANSCRIPTS;
  }

  override async fetchRecordingMetadata(callId: string): Promise<CallRecordingMetadata> {
    return {
      ...MOCK_RECORDING,
      callId,
    };
  }

  generateGroundedContext(
    leadData: GroundedLeadData,
    agentConfig: {
      callObjective: string;
      approvedTalkingPoints: string[];
      prohibitedClaims: string[];
    }
  ): GroundedVoiceContext {
    const verifiedFacts: Record<string, string> = {
      leadId: leadData.leadId,
      businessName: leadData.businessName.trim(),
    };

    if (leadData.domain) verifiedFacts.websiteUrl = leadData.domain.trim();
    if (leadData.phone) verifiedFacts.phoneNumber = leadData.phone.trim();
    if (leadData.address) verifiedFacts.location = leadData.address.trim();
    if (leadData.contactName) verifiedFacts.contactPerson = leadData.contactName.trim();
    if (leadData.contactTitle) verifiedFacts.contactRole = leadData.contactTitle.trim();

    return {
      leadId: leadData.leadId,
      businessName: leadData.businessName,
      contactName: leadData.contactName || 'Decision Maker',
      verifiedFacts,
      observedWebsiteGaps: leadData.auditGaps || [],
      campaignOffer: leadData.campaignOffer || 'Diagnostic Review',
      callObjective: agentConfig.callObjective,
      approvedTalkingPoints: agentConfig.approvedTalkingPoints,
      prohibitedClaims: agentConfig.prohibitedClaims,
      unknownFields: ['pricing_quotes', 'competitor_comparisons'],
      complianceDisclaimer: 'This call is an AI-assisted outreach conversation conducted on behalf of closeVDS.',
    };
  }

  async createVoiceSession(
    callId: string,
    context: GroundedVoiceContext
  ): Promise<VoiceSession> {
    return {
      sessionId: `mock_vses_${Date.now()}`,
      callId,
      provider: this.providerName,
      context,
      turns: [],
      status: 'ACTIVE',
      startedAt: new Date(),
    };
  }

  async handleTurn(
    _session: VoiceSession,
    turn: VoiceTurn
  ): Promise<VoiceResponse> {
    const text = turn.text.toLowerCase();
    const isOptOut = text.includes('stop') || text.includes('unsubscribe') || text.includes('do not call');

    if (isOptOut) {
      return {
        textResponse: 'Understood. I will immediately remove your number from our contact list. Have a great day.',
        shouldEndCall: true,
      };
    }

    return {
      textResponse: 'Thank you for your time. Would tomorrow at 2 PM work for a quick review?',
      shouldEndCall: false,
    };
  }

  async summarizeCall(
    turns: VoiceTurn[],
    callDurationSeconds = 105
  ): Promise<CallSummaryResult> {
    return {
      summary: `Mock call completed with duration ${callDurationSeconds}s across ${turns.length} conversational turns.`,
      keyPoints: ['Observed 4.2-second mobile load time', 'Appointment scheduled for tomorrow at 2 PM'],
      objectionsRaised: [],
      followUpRequested: 'Tomorrow at 2 PM',
      sentiment: 'POSITIVE',
    };
  }

  async classifyOutcome(
    _turns: VoiceTurn[],
    _metadata?: Record<string, unknown>
  ): Promise<CallOutcomeAnalysis> {
    return {
      outcome: 'MEETING_REQUESTED',
      interestLevel: 'HIGH',
      objections: [],
      requestedFollowUp: 'Tomorrow at 2 PM',
      nextAction: 'Send calendar invite',
      sentiment: 'POSITIVE',
      optOutDetected: false,
      summary: 'Prospect confirmed diagnostic appointment for tomorrow at 2 PM.',
      derivedFromActual: true,
    };
  }
}
