import type { BaseProviderAdapter } from '../core/provider.types.js';
import type { CallEventType, CallStatus } from '@prisma/client';

export interface OutboundCallPayload {
  callId: string;
  leadId: string;
  contactId: string;
  recipientPhone: string;
  agentScriptId?: string;
  maxDurationSeconds?: number;
  callbackUrl?: string;
  streamUrl?: string;
  recordingConsent?: boolean;
}

// Backward-compatible alias for existing tests
export type CallInitiatePayload = {
  leadId: string;
  contactId: string;
  phoneNumber: string;
  agentScriptId?: string;
  maxDurationSeconds?: number;
};

export interface ProviderCallResult {
  providerCallId: string;
  status: CallStatus;
  startedAt: Date;
  metadata?: Record<string, unknown>;
}

// Backward-compatible alias
export type CallResult = {
  callSessionId: string;
  status: 'INITIATED' | 'COMPLETED' | 'BUSY' | 'FAILED';
  durationSeconds: number;
  transcriptSummary?: string;
};

export interface ProviderCallStatusResult {
  providerCallId: string;
  status: CallStatus;
  durationSeconds?: number;
  startedAt?: Date;
  endedAt?: Date;
  rawStatus?: string;
}

export interface NormalizedCallEvent {
  eventId: string;
  provider: string;
  providerCallId: string;
  eventType: CallEventType;
  status: CallStatus;
  durationSeconds?: number;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
}

/**
 * AI Voice Calling Service Abstraction Contract
 */
export interface CallingService {
  initiateCall(payload: OutboundCallPayload | CallInitiatePayload): Promise<ProviderCallResult | CallResult>;
}

/**
 * Full Provider-Agnostic Voice Telephony Adapter Contract
 */
export interface VoiceProviderAdapter extends BaseProviderAdapter, CallingService {
  readonly providerName: string;
  readonly category: 'CALLING';

  initiateCall(payload: OutboundCallPayload | CallInitiatePayload): Promise<ProviderCallResult | CallResult>;
  terminateCall(providerCallId: string): Promise<boolean>;
  getCallStatus(providerCallId: string): Promise<ProviderCallStatusResult>;
  verifyWebhookSignature(
    rawPayload: string | Buffer,
    signatureHeader?: string,
    secret?: string,
    url?: string
  ): boolean;
  normalizeEvent(rawPayload: unknown): NormalizedCallEvent;
}
