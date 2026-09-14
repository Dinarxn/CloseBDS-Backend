import crypto from 'node:crypto';
import type {
  VoiceProviderAdapter,
  OutboundCallPayload,
  CallInitiatePayload,
  ProviderCallResult,
  ProviderCallStatusResult,
  NormalizedCallEvent,
} from './index.js';
import {
  type ProviderCapability,
  type ProviderHealthResult,
  ProviderError,
} from '../core/provider.types.js';
import type { CallEventType, CallStatus } from '@prisma/client';

export interface TwilioConfigOptions {
  accountSid?: string;
  authToken?: string;
  phoneNumber?: string;
}

export class TwilioVoiceAdapter implements VoiceProviderAdapter {
  public readonly providerName = 'Twilio';
  public readonly category = 'CALLING' as const;

  private accountSid?: string;
  private authToken?: string;
  private phoneNumber?: string;

  constructor(options?: TwilioConfigOptions) {
    this.accountSid = options?.accountSid || process.env.TWILIO_ACCOUNT_SID;
    this.authToken = options?.authToken || process.env.TWILIO_AUTH_TOKEN;
    this.phoneNumber = options?.phoneNumber || process.env.TWILIO_PHONE_NUMBER;
  }

  isConfigured(): boolean {
    return Boolean(
      this.accountSid &&
      this.accountSid.trim().length > 0 &&
      this.authToken &&
      this.authToken.trim().length > 0 &&
      this.phoneNumber &&
      this.phoneNumber.trim().length > 0 &&
      !this.accountSid.includes('placeholder')
    );
  }

  getCapabilities(): ProviderCapability {
    return {
      name: this.providerName,
      category: this.category,
      supportedFeatures: [
        'Outbound PSTN Telephony',
        'Status Callbacks',
        'WebSocket Media Streams',
        'Call Recording (Consent-Gated)',
        'E.164 Caller ID Enforcement',
      ],
      requiresApiKey: true,
      isDispatchProvider: true,
    };
  }

  async healthCheck(): Promise<ProviderHealthResult> {
    if (!this.isConfigured()) {
      return {
        providerName: this.providerName,
        category: this.category,
        status: 'UNCONFIGURED',
        isConfigured: false,
        message: 'Twilio telephony credentials (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER) are not configured',
      };
    }

    return {
      providerName: this.providerName,
      category: this.category,
      status: 'AVAILABLE',
      isConfigured: true,
      message: 'Twilio telephony provider is configured and available for outbound voice dispatch',
    };
  }

  async initiateCall(
    payload: OutboundCallPayload | CallInitiatePayload
  ): Promise<ProviderCallResult> {
    if (!this.isConfigured()) {
      throw new ProviderError(
        this.providerName,
        'CONFIGURATION_ERROR',
        'Twilio credentials not configured. Outbound telephony dispatch is unavailable.',
        false
      );
    }

    const recipient = 'recipientPhone' in payload ? payload.recipientPhone : payload.phoneNumber;
    if (!recipient || !recipient.startsWith('+')) {
      throw new ProviderError(
        this.providerName,
        'CONFIGURATION_ERROR',
        'Recipient phone number must be normalized in valid E.164 format prior to provider dispatch',
        false
      );
    }

    // Provider boundary execution
    try {
      const authHeader = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Calls.json`;

      const params = new URLSearchParams();
      params.append('To', recipient);
      params.append('From', this.phoneNumber!);

      if ('callbackUrl' in payload && payload.callbackUrl) {
        params.append('StatusCallback', payload.callbackUrl);
        params.append('StatusCallbackEvent', 'initiated');
        params.append('StatusCallbackEvent', 'ringing');
        params.append('StatusCallbackEvent', 'answered');
        params.append('StatusCallbackEvent', 'completed');
      }

      if ('streamUrl' in payload && payload.streamUrl) {
        // TwiML containing <Stream> for real-time WebSocket conversational AI
        const twiml = `<Response><Connect><Stream url="${payload.streamUrl}" /></Connect></Response>`;
        params.append('Twiml', twiml);
      } else {
        const twiml = '<Response><Say>Connecting to closeVDS voice agent.</Say></Response>';
        params.append('Twiml', twiml);
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Twilio API HTTP ${res.status}: ${errorText}`);
      }

      const data = (await res.json()) as { sid: string; status: string };

      return {
        providerCallId: data.sid,
        status: 'INITIATING',
        startedAt: new Date(),
        metadata: { twilioStatus: data.status },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown telephony provider dispatch failure';
      throw new ProviderError(
        this.providerName,
        'PROVIDER_UNAVAILABLE',
        `Twilio call initiation failed: ${msg}`,
        true
      );
    }
  }

  async terminateCall(providerCallId: string): Promise<boolean> {
    if (!this.isConfigured()) {
      throw new ProviderError(
        this.providerName,
        'CONFIGURATION_ERROR',
        'Twilio credentials not configured',
        false
      );
    }

    try {
      const authHeader = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Calls/${providerCallId}.json`;

      const params = new URLSearchParams();
      params.append('Status', 'completed');

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
        signal: AbortSignal.timeout(10000),
      });

      return res.ok;
    } catch {
      return false;
    }
  }

  async getCallStatus(providerCallId: string): Promise<ProviderCallStatusResult> {
    if (!this.isConfigured()) {
      throw new ProviderError(
        this.providerName,
        'CONFIGURATION_ERROR',
        'Twilio credentials not configured',
        false
      );
    }

    try {
      const authHeader = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Calls/${providerCallId}.json`;

      const res = await fetch(url, {
        headers: { Authorization: `Basic ${authHeader}` },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = (await res.json()) as {
        sid: string;
        status: string;
        duration?: string;
        start_time?: string;
        end_time?: string;
      };

      const normalizedStatus = this.mapTwilioStatus(data.status);

      return {
        providerCallId: data.sid,
        status: normalizedStatus,
        durationSeconds: data.duration ? parseInt(data.duration, 10) : undefined,
        startedAt: data.start_time ? new Date(data.start_time) : undefined,
        endedAt: data.end_time ? new Date(data.end_time) : undefined,
        rawStatus: data.status,
      };
    } catch (err: unknown) {
      throw new ProviderError(
        this.providerName,
        'PROVIDER_UNAVAILABLE',
        `Failed to retrieve Twilio call status: ${err instanceof Error ? err.message : 'Unknown error'}`,
        true
      );
    }
  }

  /**
   * Timing-safe verification of Twilio webhook signature (X-Twilio-Signature).
   */
  verifyWebhookSignature(
    rawPayload: string | Buffer,
    signatureHeader?: string,
    secret?: string,
    url = 'https://api.closevds.local/api/v1/voice/webhooks/twilio'
  ): boolean {
    const authToken = secret || this.authToken;
    if (!authToken || authToken.trim().length === 0) {
      // If no token is configured in environment, fail safely
      return false;
    }

    if (!signatureHeader || signatureHeader.trim().length === 0) {
      return false;
    }

    try {
      const payloadString = Buffer.isBuffer(rawPayload)
        ? rawPayload.toString('utf-8')
        : typeof rawPayload === 'string'
        ? rawPayload
        : JSON.stringify(rawPayload);

      // Build data to sign: URL followed by sorted key-value pairs
      let dataToSign = url;
      try {
        const parsedParams = new URLSearchParams(payloadString);
        const sortedKeys = Array.from(parsedParams.keys()).sort();
        for (const key of sortedKeys) {
          dataToSign += key + parsedParams.get(key);
        }
      } catch {
        dataToSign += payloadString;
      }

      const hmac = crypto.createHmac('sha1', authToken);
      const computedSignature = hmac.update(Buffer.from(dataToSign, 'utf-8')).digest('base64');

      const computedBuffer = Buffer.from(computedSignature);
      const receivedBuffer = Buffer.from(signatureHeader.trim());

      if (computedBuffer.length !== receivedBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(computedBuffer, receivedBuffer);
    } catch {
      return false;
    }
  }

  /**
   * Normalizes raw Twilio webhook payload into closeVDS standard CallEvent format.
   */
  normalizeEvent(rawPayload: unknown): NormalizedCallEvent {
    const payload = (
      typeof rawPayload === 'object' && rawPayload !== null
        ? rawPayload
        : typeof rawPayload === 'string'
        ? Object.fromEntries(new URLSearchParams(rawPayload))
        : {}
    ) as Record<string, string>;

    const providerCallId = payload.CallSid || payload.call_sid || `tw_${Date.now()}`;
    const rawStatus = (payload.CallStatus || payload.call_status || '').toLowerCase();
    const status = this.mapTwilioStatus(rawStatus);
    const eventType = this.mapStatusToEventType(status);
    const durationSeconds = payload.CallDuration || payload.duration
      ? parseInt(payload.CallDuration || payload.duration, 10)
      : undefined;

    return {
      eventId: payload.SequenceNumber ? `${providerCallId}_${payload.SequenceNumber}` : `tw_evt_${Date.now()}`,
      provider: this.providerName,
      providerCallId,
      eventType,
      status,
      durationSeconds,
      occurredAt: new Date(),
      metadata: payload,
    };
  }

  private mapTwilioStatus(twilioStatus: string): CallStatus {
    switch (twilioStatus.toLowerCase()) {
      case 'queued':
        return 'QUEUED';
      case 'initiated':
        return 'INITIATING';
      case 'ringing':
        return 'RINGING';
      case 'in-progress':
      case 'in_progress':
      case 'answered':
        return 'IN_PROGRESS';
      case 'completed':
        return 'COMPLETED';
      case 'busy':
        return 'BUSY';
      case 'no-answer':
      case 'no_answer':
        return 'NO_ANSWER';
      case 'canceled':
      case 'cancelled':
        return 'CANCELLED';
      case 'failed':
        return 'FAILED';
      default:
        return 'IN_PROGRESS';
    }
  }

  private mapStatusToEventType(status: CallStatus): CallEventType {
    switch (status) {
      case 'QUEUED':
        return 'CALL_CREATED';
      case 'INITIATING':
        return 'CALL_INITIATED';
      case 'RINGING':
        return 'CALL_RINGING';
      case 'IN_PROGRESS':
        return 'CALL_STARTED';
      case 'COMPLETED':
        return 'CALL_COMPLETED';
      case 'BUSY':
        return 'CALL_BUSY';
      case 'NO_ANSWER':
        return 'CALL_NO_ANSWER';
      case 'CANCELLED':
        return 'CALL_CANCELLED';
      case 'FAILED':
        return 'CALL_FAILED';
      default:
        return 'CALL_STARTED';
    }
  }
}
