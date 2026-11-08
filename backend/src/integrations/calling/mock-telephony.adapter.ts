import crypto from 'node:crypto';
import { BaseTelephonyAdapter } from './calling.adapter.js';
import type {
  OutboundCallPayload,
  CallInitiatePayload,
  ProviderCallResult,
  ProviderCallStatusResult,
} from './index.js';
import {
  type ProviderCapability,
  type ProviderHealthResult,
} from '../core/provider.types.js';
import type {
  TelephonyProviderId,
  TelephonyPhoneNumber,
  PhoneNumberCapabilities,
  NormalizedTelephonyEvent,
  NormalizedCallStatus,
} from '../../modules/voice/voice.types.js';
import { MOCK_TELEPHONY_NUMBERS } from './mock-fixtures.js';

export interface MockTelephonyOptions {
  simulatedFailure?: boolean;
  webhookSecret?: string;
  numbers?: TelephonyPhoneNumber[];
}

/**
 * Mock Telephony Adapter for offline development integrity mode.
 * Provides realistic carrier behaviors without live Twilio API calls.
 */
export class MockTelephonyAdapter extends BaseTelephonyAdapter {
  public readonly providerId: TelephonyProviderId = 'mock-telephony';
  public readonly providerName = 'Mock Carrier Telephony';

  private numbers: TelephonyPhoneNumber[];
  private simulatedFailure: boolean;
  private webhookSecret: string;
  private activeCalls = new Map<string, { status: NormalizedCallStatus; startedAt: Date; duration?: number }>();

  constructor(options?: MockTelephonyOptions) {
    super();
    this.numbers = options?.numbers ? [...options.numbers] : [...MOCK_TELEPHONY_NUMBERS];
    this.simulatedFailure = Boolean(options?.simulatedFailure);
    this.webhookSecret = options?.webhookSecret || 'mock_twilio_webhook_signing_secret_test';
  }

  isConfigured(): boolean {
    return true; // Fully available for offline development and testing
  }

  getCapabilities(): ProviderCapability {
    return {
      name: this.providerName,
      category: this.category,
      supportedFeatures: [
        'Deterministic Offline Carrier Telephony',
        'Simulated E.164 Number Validation',
        'HMAC-SHA1 Webhook Signature Validation',
        'Lifecycle State Transition Simulation',
      ],
      requiresApiKey: false,
      isDispatchProvider: true,
    };
  }

  async healthCheck(): Promise<ProviderHealthResult> {
    if (this.simulatedFailure) {
      return {
        providerName: this.providerName,
        category: this.category,
        status: 'DEGRADED',
        isConfigured: true,
        message: 'Mock telephony carrier reporting simulated upstream outage',
      };
    }

    return {
      providerName: this.providerName,
      category: this.category,
      status: 'AVAILABLE',
      isConfigured: true,
      message: 'Mock telephony carrier operational in offline integrity mode',
    };
  }

  override async listPhoneNumbers(): Promise<TelephonyPhoneNumber[]> {
    return this.numbers;
  }

  override async importPhoneNumber(phoneNumber: string): Promise<TelephonyPhoneNumber> {
    const caps = await this.validateCapabilities(phoneNumber);
    const newNumber: TelephonyPhoneNumber = {
      id: `mock_phone_${Date.now()}`,
      workspaceId: 'ws_test_mock',
      phoneNumber,
      friendlyName: `Mock Carrier Line (${phoneNumber})`,
      provider: this.providerId,
      capabilities: caps,
      status: 'ACTIVE',
      assignedAgentId: null,
      assignedAgentName: null,
      inboundWebhookUrl: 'https://api.closevds.com/api/v1/voice/webhooks/mock/inbound',
      outboundCallerIdEnabled: true,
      purchasedWithoutAutoBuy: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.numbers.push(newNumber);
    return newNumber;
  }

  override async validateCapabilities(phoneNumber: string): Promise<PhoneNumberCapabilities> {
    const isTollFree = /^(\+1)?(800|888|877|866|855|844|833)/.test(phoneNumber.trim());
    return {
      voice: true,
      sms: !isTollFree,
      mms: isTollFree,
      e164: phoneNumber.trim().startsWith('+'),
      tollFree: isTollFree,
    };
  }

  async initiateCall(
    payload: OutboundCallPayload | CallInitiatePayload
  ): Promise<ProviderCallResult> {
    if (this.simulatedFailure) {
      throw new Error('Simulated upstream carrier dispatch failure');
    }

    const providerCallId = `mock_carrier_call_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const startedAt = new Date();
    this.activeCalls.set(providerCallId, { status: 'initiated', startedAt });

    const recipient = 'recipientPhone' in payload ? payload.recipientPhone : payload.phoneNumber;

    return {
      providerCallId,
      status: 'INITIATING',
      startedAt,
      metadata: {
        provider: this.providerId,
        carrier: 'Mock PSTN Simulated Trunk',
        recipient,
        simulated: true,
      },
    };
  }

  async terminateCall(providerCallId: string): Promise<boolean> {
    const call = this.activeCalls.get(providerCallId);
    if (call) {
      call.status = 'completed';
      call.duration = Math.floor((Date.now() - call.startedAt.getTime()) / 1000);
      return true;
    }
    return false;
  }

  async getCallStatus(providerCallId: string): Promise<ProviderCallStatusResult> {
    const call = this.activeCalls.get(providerCallId);
    if (!call) {
      return {
        providerCallId,
        status: 'FAILED',
        rawStatus: 'not_found',
      };
    }

    return {
      providerCallId,
      status: call.status === 'completed' ? 'COMPLETED' : 'IN_PROGRESS',
      startedAt: call.startedAt,
      durationSeconds: call.duration || Math.floor((Date.now() - call.startedAt.getTime()) / 1000),
      rawStatus: call.status,
    };
  }

  verifyWebhookSignature(
    rawPayload: string | Buffer,
    signatureHeader?: string,
    secret?: string,
    url = 'https://api.closevds.com/api/v1/voice/webhooks/twilio'
  ): boolean {
    if (!signatureHeader) return false;
    const signingKey = secret || this.webhookSecret;

    try {
      const payloadString = Buffer.isBuffer(rawPayload) ? rawPayload.toString('utf8') : String(rawPayload);
      const params = new URLSearchParams(payloadString);
      const sortedKeys = Array.from(params.keys()).sort();

      let base = url;
      for (const k of sortedKeys) {
        base += k + params.get(k);
      }

      const expected = crypto.createHmac('sha1', signingKey).update(base).digest('base64');
      const expectedBuffer = Buffer.from(expected);
      const signatureBuffer = Buffer.from(signatureHeader);

      if (expectedBuffer.length !== signatureBuffer.length) return false;
      return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
    } catch {
      return false;
    }
  }

  parseCallStatusEvent(rawPayload: unknown): NormalizedTelephonyEvent {
    const payload =
      typeof rawPayload === 'object' && rawPayload !== null
        ? (rawPayload as Record<string, unknown>)
        : {};

    const callSid = String(payload.CallSid || payload.callId || `mock_sid_${Date.now()}`);
    const statusRaw = String(payload.CallStatus || payload.status || 'completed').toLowerCase();

    let normalizedStatus: NormalizedCallStatus = 'completed';
    if (statusRaw.includes('ring')) normalizedStatus = 'ringing';
    else if (statusRaw.includes('progress') || statusRaw.includes('answered')) normalizedStatus = 'in-progress';
    else if (statusRaw.includes('busy')) normalizedStatus = 'busy';
    else if (statusRaw.includes('no-answer')) normalizedStatus = 'no-answer';
    else if (statusRaw.includes('failed')) normalizedStatus = 'failed';
    else if (statusRaw.includes('cancel')) normalizedStatus = 'canceled';

    return {
      eventId: `mock_evt_${Date.now()}`,
      provider: this.providerId,
      providerCallId: callSid,
      eventType: `CALL_${normalizedStatus.toUpperCase()}`,
      normalizedStatus,
      durationSeconds: Number(payload.CallDuration || payload.duration) || 0,
      occurredAt: new Date(),
      rawPayload: payload,
    };
  }
}
