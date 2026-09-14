import type {
  VoiceProviderAdapter,
  OutboundCallPayload,
  CallInitiatePayload,
  ProviderCallResult,
  CallResult,
  ProviderCallStatusResult,
  NormalizedCallEvent,
} from './index.js';
import {
  type ProviderCapability,
  type ProviderHealthResult,
  ProviderError,
} from '../core/provider.types.js';

export class StandardCallingAdapter implements VoiceProviderAdapter {
  public readonly providerName: string;
  public readonly category = 'CALLING' as const;

  constructor(providerName = 'Retell AI / Bland AI') {
    this.providerName = providerName;
  }

  isConfigured(): boolean {
    return false; // Reserved for post-MVP AI calling agents
  }

  getCapabilities(): ProviderCapability {
    return {
      name: this.providerName,
      category: this.category,
      supportedFeatures: [
        'Interactive Voice Qualification (Post-MVP)',
        'Live Call Transcript & Recording Sync (Post-MVP)',
      ],
      requiresApiKey: true,
      isDispatchProvider: true,
    };
  }

  async healthCheck(): Promise<ProviderHealthResult> {
    return {
      providerName: this.providerName,
      category: this.category,
      status: 'DISABLED',
      isConfigured: false,
      message: 'AI Voice Calling integration is deferred to post-MVP per Phase 0 specifications',
    };
  }

  async initiateCall(
    _payload: OutboundCallPayload | CallInitiatePayload
  ): Promise<ProviderCallResult | CallResult> {
    throw new ProviderError(
      this.providerName,
      'DISPATCH_DISABLED',
      'AI Cold calling is disabled by default in Phase 2 for safety. Voice agent integration deferred to post-MVP.'
    );
  }

  async terminateCall(_providerCallId: string): Promise<boolean> {
    throw new ProviderError(
      this.providerName,
      'DISPATCH_DISABLED',
      'Calling provider not configured'
    );
  }

  async getCallStatus(_providerCallId: string): Promise<ProviderCallStatusResult> {
    throw new ProviderError(
      this.providerName,
      'DISPATCH_DISABLED',
      'Calling provider not configured'
    );
  }

  verifyWebhookSignature(
    _rawPayload: string | Buffer,
    _signatureHeader?: string,
    _secret?: string
  ): boolean {
    return false;
  }

  normalizeEvent(rawPayload: unknown): NormalizedCallEvent {
    const payload = (typeof rawPayload === 'object' && rawPayload !== null ? rawPayload : {}) as Record<string, unknown>;
    return {
      eventId: `call_evt_${Date.now()}`,
      provider: this.providerName,
      providerCallId: String(payload.callId || `call_${Date.now()}`),
      eventType: 'CALL_COMPLETED',
      status: 'COMPLETED',
      occurredAt: new Date(),
      metadata: payload,
    };
  }
}
