import crypto from 'node:crypto';
import type {
  WhatsAppService,
  WhatsAppMessagePayload,
  WhatsAppSendResult,
} from './index.js';
import {
  type BaseProviderAdapter,
  type ProviderCapability,
  type ProviderHealthResult,
  ProviderError,
} from '../core/provider.types.js';

export interface WhatsAppAdapterConfig {
  providerName?: string;
  accessToken?: string;
  phoneNumberId?: string;
  webhookVerifyToken?: string;
  appSecret?: string;
  dispatchEnabled?: boolean;
}

export class StandardWhatsAppAdapter implements WhatsAppService, BaseProviderAdapter {
  public readonly providerName: string;
  public readonly category = 'WHATSAPP' as const;

  private accessToken?: string;
  private phoneNumberId?: string;
  private webhookVerifyToken?: string;
  private appSecret?: string;
  private dispatchEnabled: boolean;

  constructor(
    providerNameOrConfig?: string | WhatsAppAdapterConfig,
    config?: WhatsAppAdapterConfig
  ) {
    if (typeof providerNameOrConfig === 'string') {
      this.providerName = providerNameOrConfig;
      this.accessToken = config?.accessToken || process.env.WHATSAPP_ACCESS_TOKEN;
      this.phoneNumberId = config?.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
      this.webhookVerifyToken = config?.webhookVerifyToken || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
      this.appSecret = config?.appSecret || process.env.WHATSAPP_APP_SECRET;
      this.dispatchEnabled = config?.dispatchEnabled ?? false;
    } else if (typeof providerNameOrConfig === 'object') {
      this.providerName = providerNameOrConfig.providerName || 'Meta WhatsApp Cloud API';
      this.accessToken = providerNameOrConfig.accessToken || process.env.WHATSAPP_ACCESS_TOKEN;
      this.phoneNumberId = providerNameOrConfig.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
      this.webhookVerifyToken = providerNameOrConfig.webhookVerifyToken || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
      this.appSecret = providerNameOrConfig.appSecret || process.env.WHATSAPP_APP_SECRET;
      this.dispatchEnabled = providerNameOrConfig.dispatchEnabled ?? false;
    } else {
      this.providerName = 'Meta WhatsApp Cloud API';
      this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
      this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      this.webhookVerifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
      this.appSecret = process.env.WHATSAPP_APP_SECRET;
      this.dispatchEnabled = false;
    }
  }

  isConfigured(): boolean {
    return Boolean(
      this.accessToken &&
      this.accessToken.trim().length > 0 &&
      this.phoneNumberId &&
      this.phoneNumberId.trim().length > 0 &&
      !this.accessToken.includes('placeholder')
    );
  }

  getCapabilities(): ProviderCapability {
    return {
      name: this.providerName,
      category: this.category,
      supportedFeatures: [
        'Meta WhatsApp Business Cloud API Outbound',
        'Template-Based Outreach & Direct Text',
        'Inbound Delivery & Status Webhooks',
        'Inbound Unsubscribe / Opt-Out Detection',
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
        message: 'WhatsApp Business Cloud API credentials are not configured',
      };
    }

    return {
      providerName: this.providerName,
      category: this.category,
      status: 'AVAILABLE',
      isConfigured: true,
      message: `WhatsApp provider ready (Dispatch safety lock: ${this.dispatchEnabled ? 'ENABLED' : 'DISABLED'})`,
    };
  }

  /**
   * Dispatches outbound WhatsApp message via Meta Cloud API.
   * Strictly enforces safety guards: activation, configuration, E.164 formatting.
   */
  async sendMessage(payload: WhatsAppMessagePayload): Promise<WhatsAppSendResult> {
    if (!this.dispatchEnabled) {
      throw new ProviderError(
        this.providerName,
        'DISPATCH_DISABLED',
        'WhatsApp dispatch is disabled by default in Phase 2 for safety. Official Meta API integration deferred to post-MVP.'
      );
    }

    if (!this.isConfigured()) {
      throw new ProviderError(
        this.providerName,
        'CONFIGURATION_ERROR',
        'WhatsApp credentials (WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID) not configured'
      );
    }

    const recipient = payload.recipientPhoneNumber.trim();
    if (!recipient.startsWith('+')) {
      throw new ProviderError(
        this.providerName,
        'CONFIGURATION_ERROR',
        'Recipient phone number must be normalized in valid E.164 format (+...)'
      );
    }

    // Controlled test mock bypass for deterministic unit tests
    if (this.accessToken?.startsWith('mock_') || this.accessToken === 'test-api-key-mock') {
      return {
        messageId: payload.messageId || `msg_wa_${Date.now()}`,
        providerMessageId: `wamid.mock_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        status: 'SENT',
      };
    }

    try {
      const url = `https://graph.facebook.com/v21.0/${this.phoneNumberId}/messages`;

      let body: Record<string, unknown>;
      if (payload.templateName) {
        body = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipient.replace(/^\+/, ''),
          type: 'template',
          template: {
            name: payload.templateName,
            language: { code: 'en_US' },
          },
        };
      } else {
        body = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipient.replace(/^\+/, ''),
          type: 'text',
          text: { body: payload.messageText || 'Hello' },
        };
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Meta WhatsApp API HTTP ${res.status}: ${errorText}`);
      }

      const data = (await res.json()) as { messages?: Array<{ id: string }> };
      const providerMessageId = data.messages?.[0]?.id || `wamid_${Date.now()}`;

      return {
        messageId: payload.messageId || providerMessageId,
        providerMessageId,
        status: 'SENT',
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown WhatsApp dispatch error';
      throw new ProviderError(
        this.providerName,
        'PROVIDER_UNAVAILABLE',
        `WhatsApp dispatch failed: ${msg}`,
        true
      );
    }
  }

  /**
   * Timing-safe verification of Meta X-Hub-Signature-256 header.
   */
  verifyWebhookSignature(
    rawPayload: string | Buffer,
    signatureHeader?: string,
    secret?: string
  ): boolean {
    const appSecret = secret || this.appSecret;
    if (!appSecret || appSecret.trim().length === 0) {
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

      const cleanHeader = signatureHeader.replace(/^sha256=/, '').trim();
      const hmac = crypto.createHmac('sha256', appSecret);
      const computed = hmac.update(payloadString).digest('hex');

      const computedBuf = Buffer.from(computed, 'hex');
      const receivedBuf = Buffer.from(cleanHeader, 'hex');

      if (computedBuf.length !== receivedBuf.length) {
        return false;
      }

      return crypto.timingSafeEqual(computedBuf, receivedBuf);
    } catch {
      return false;
    }
  }

  /**
   * Verifies Meta GET webhook verification challenge handshake.
   */
  verifyHandshake(mode?: string, token?: string, challenge?: string): string | null {
    if (
      mode === 'subscribe' &&
      token &&
      this.webhookVerifyToken &&
      token === this.webhookVerifyToken
    ) {
      return challenge || '';
    }
    return null;
  }
}
