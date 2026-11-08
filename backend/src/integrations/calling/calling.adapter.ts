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
import type {
  TelephonyProvider,
  TelephonyProviderId,
  ProviderCapabilities,
  ProviderConnectionState,
  TelephonyPhoneNumber,
  PhoneNumberCapabilities,
  InboundRoutingConfig,
  OutboundRoutingConfig,
  NormalizedTelephonyEvent,
} from '../../modules/voice/voice.types.js';

/**
 * Base Abstract Telephony Adapter uniting CloseVDS VoiceProviderAdapter and TelephonyProvider contracts.
 */
export abstract class BaseTelephonyAdapter implements VoiceProviderAdapter, TelephonyProvider {
  public abstract readonly providerId: TelephonyProviderId;
  public abstract readonly providerName: string;
  public readonly category = 'CALLING' as const;

  abstract isConfigured(): boolean;
  abstract getCapabilities(): ProviderCapability;

  /**
   * Granular multi-provider telephony capabilities.
   */
  getProviderCapabilities(): ProviderCapabilities {
    return {
      supportsInbound: true,
      supportsOutbound: true,
      supportsCustomVoices: false,
      supportsTransfer: true,
      supportsRecording: true,
      supportsTranscripts: false,
      supportsRealtimeTranscription: false,
      supportedCodecs: ['PCMU', 'PCMA', 'opus', 'g711'],
    };
  }

  abstract healthCheck(): Promise<ProviderHealthResult>;

  async testConnection(_credentials?: Record<string, unknown>): Promise<{
    connected: boolean;
    status: ProviderConnectionState;
    message: string;
    accountDetails?: Record<string, unknown>;
  }> {
    const configured = this.isConfigured();
    return {
      connected: configured,
      status: configured ? 'CONNECTED' : 'NOT_CONFIGURED',
      message: configured
        ? `${this.providerName} connection verified successfully.`
        : `${this.providerName} credentials not configured.`,
    };
  }

  async listPhoneNumbers(): Promise<TelephonyPhoneNumber[]> {
    return [];
  }

  async importPhoneNumber(phoneNumber: string): Promise<TelephonyPhoneNumber> {
    const caps = await this.validateCapabilities(phoneNumber);
    return {
      id: `imported_${Date.now()}`,
      workspaceId: 'workspace_default',
      phoneNumber,
      friendlyName: `Imported Line (${phoneNumber})`,
      provider: this.providerId,
      capabilities: caps,
      status: 'ACTIVE',
      assignedAgentId: null,
      assignedAgentName: null,
      inboundWebhookUrl: null,
      outboundCallerIdEnabled: true,
      purchasedWithoutAutoBuy: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async validateCapabilities(phoneNumber: string): Promise<PhoneNumberCapabilities> {
    const isTollFree = /^(\+1)?(800|888|877|866|855|844|833)/.test(phoneNumber.trim());
    return {
      voice: true,
      sms: !isTollFree,
      mms: false,
      e164: phoneNumber.trim().startsWith('+'),
      tollFree: isTollFree,
    };
  }

  async configureInboundRouting(_config: InboundRoutingConfig): Promise<boolean> {
    return true;
  }

  async configureOutboundRouting(_config: OutboundRoutingConfig): Promise<boolean> {
    return true;
  }

  abstract verifyWebhookSignature(
    rawPayload: string | Buffer,
    signatureHeader?: string,
    secret?: string,
    url?: string
  ): boolean;

  abstract parseCallStatusEvent(rawPayload: unknown): NormalizedTelephonyEvent;

  abstract initiateCall(
    payload: OutboundCallPayload | CallInitiatePayload
  ): Promise<ProviderCallResult | CallResult>;

  abstract terminateCall(providerCallId: string): Promise<boolean>;

  abstract getCallStatus(providerCallId: string): Promise<ProviderCallStatusResult>;

  normalizeEvent(rawPayload: unknown): NormalizedCallEvent {
    const telephonyEvt = this.parseCallStatusEvent(rawPayload);
    return {
      eventId: telephonyEvt.eventId,
      provider: this.providerName,
      providerCallId: telephonyEvt.providerCallId,
      eventType: telephonyEvt.eventType as any,
      status: telephonyEvt.normalizedStatus === 'completed' ? 'COMPLETED' : 'FAILED',
      durationSeconds: telephonyEvt.durationSeconds,
      occurredAt: telephonyEvt.occurredAt,
      metadata: telephonyEvt.rawPayload,
    };
  }
}

/**
 * Standard unconfigured fallback calling adapter.
 */
export class StandardCallingAdapter extends BaseTelephonyAdapter {
  public readonly providerId: TelephonyProviderId = 'mock-telephony';
  public readonly providerName: string;

  constructor(providerName = 'Retell AI / Bland AI') {
    super();
    this.providerName = providerName;
  }

  isConfigured(): boolean {
    return false;
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
    _secret?: string,
    _url?: string
  ): boolean {
    return false;
  }

  parseCallStatusEvent(rawPayload: unknown): NormalizedTelephonyEvent {
    const payload =
      typeof rawPayload === 'object' && rawPayload !== null
        ? (rawPayload as Record<string, unknown>)
        : {};

    return {
      eventId: `call_evt_${Date.now()}`,
      provider: this.providerId,
      providerCallId: String(payload.callId || `call_${Date.now()}`),
      eventType: 'CALL_COMPLETED',
      normalizedStatus: 'completed',
      durationSeconds: Number(payload.duration) || 0,
      occurredAt: new Date(),
      rawPayload: payload,
    };
  }
}
