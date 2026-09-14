import type { BaseProviderAdapter } from '../core/provider.types.js';
import type { CallOutcomeType } from '@prisma/client';

export interface GroundedLeadData {
  leadId: string;
  businessName: string;
  domain?: string | null;
  phone?: string | null;
  address?: string | null;
  contactName?: string | null;
  contactTitle?: string | null;
  auditGaps: string[];
  campaignNiche: string;
  campaignOffer: string;
  qualificationScore?: number;
  qualificationRationale?: string;
}

export interface GroundedVoiceContext {
  leadId: string;
  businessName: string;
  contactName: string;
  verifiedFacts: Record<string, string>;
  observedWebsiteGaps: string[];
  campaignOffer: string;
  callObjective: string;
  approvedTalkingPoints: string[];
  prohibitedClaims: string[];
  unknownFields: string[];
  complianceDisclaimer: string;
}

export interface VoiceTurn {
  turnIndex: number;
  speaker: 'agent' | 'lead' | 'system';
  text: string;
  confidence?: number;
  timestampMs?: number;
}

export interface VoiceResponse {
  audioBase64?: string;
  textResponse: string;
  shouldEndCall: boolean;
  toolCalls?: VoiceToolCall[];
}

export interface VoiceToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface VoiceSession {
  sessionId: string;
  callId: string;
  provider: string;
  context: GroundedVoiceContext;
  turns: VoiceTurn[];
  status: 'INITIALIZING' | 'ACTIVE' | 'ENDED' | 'FAILED';
  startedAt: Date;
}

export interface CallSummaryResult {
  summary: string;
  keyPoints: string[];
  objectionsRaised: string[];
  followUpRequested?: string;
  sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
}

export interface CallOutcomeAnalysis {
  outcome: CallOutcomeType;
  interestLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  objections: string[];
  requestedFollowUp?: string;
  nextAction?: string;
  sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  optOutDetected: boolean;
  summary: string;
  derivedFromActual: boolean;
}

/**
 * Voice AI Provider Abstraction Interface
 */
export interface VoiceAIProvider extends BaseProviderAdapter {
  readonly providerName: string;
  readonly category: 'AI_LLM';

  generateGroundedContext(
    leadData: GroundedLeadData,
    agentConfig: {
      callObjective: string;
      approvedTalkingPoints: string[];
      prohibitedClaims: string[];
    }
  ): GroundedVoiceContext;

  createVoiceSession(
    callId: string,
    context: GroundedVoiceContext
  ): Promise<VoiceSession>;

  handleTurn(
    session: VoiceSession,
    turn: VoiceTurn
  ): Promise<VoiceResponse>;

  summarizeCall(
    turns: VoiceTurn[],
    callDurationSeconds?: number
  ): Promise<CallSummaryResult>;

  classifyOutcome(
    turns: VoiceTurn[],
    metadata?: Record<string, unknown>
  ): Promise<CallOutcomeAnalysis>;
}
