import {
  voiceAIRegistry,
} from '../../integrations/voice-ai/index.js';
import type { BaseVoiceAIAdapter } from '../../integrations/voice-ai/voice-ai.adapter.js';
import type {
  VoiceAIProviderId,
  ProviderIntegrationCard,
  ProviderConnectionState,
  ProviderVerificationState,
  VoiceAIModel,
  VoiceAIVoice,
  VoiceAIAssistantConfig,
  VoiceAIAssistantSyncResult,
  VoiceAIDispatchPayload,
  VoiceAICallDispatchResult,
  CallTurnInput,
  CallRecordingMetadata,
} from './voice.types.js';
import { maskApiKey, maskSecret } from '../../security/credential-vault.js';

export class VoiceAIService {
  private registry = voiceAIRegistry;

  /**
   * Retrieves an adapter instance for the specified voice AI provider.
   */
  getAdapter(providerId: VoiceAIProviderId): BaseVoiceAIAdapter {
    const adapter = this.registry.getAdapter(providerId);
    if (!adapter) {
      throw new Error(`Voice AI Provider adapter '${providerId}' not found in registry`);
    }
    return adapter;
  }

  /**
   * Tests connection to a specific voice AI provider.
   */
  async testConnection(
    providerId: VoiceAIProviderId,
    credentials?: Record<string, unknown>
  ): Promise<{
    connected: boolean;
    status: ProviderConnectionState;
    message: string;
  }> {
    const adapter = this.getAdapter(providerId);
    return adapter.testConnection(credentials);
  }

  /**
   * Lists available models for a voice AI provider.
   */
  async listModels(providerId: VoiceAIProviderId): Promise<VoiceAIModel[]> {
    const adapter = this.getAdapter(providerId);
    return adapter.listModels();
  }

  /**
   * Lists available voices for a voice AI provider.
   */
  async listVoices(providerId: VoiceAIProviderId): Promise<VoiceAIVoice[]> {
    const adapter = this.getAdapter(providerId);
    return adapter.listVoices();
  }

  /**
   * Synchronizes assistant/agent configuration with the provider.
   */
  async syncAssistant(
    config: VoiceAIAssistantConfig
  ): Promise<VoiceAIAssistantSyncResult> {
    const adapter = this.getAdapter(config.provider);
    return adapter.syncAssistant(config);
  }

  /**
   * Dispatches a call through the provider.
   */
  async dispatchCall(
    providerId: VoiceAIProviderId,
    payload: VoiceAIDispatchPayload
  ): Promise<VoiceAICallDispatchResult> {
    const adapter = this.getAdapter(providerId);
    return adapter.dispatchCall(payload);
  }

  /**
   * Fetches transcript turns from the provider.
   */
  async fetchTranscript(
    providerId: VoiceAIProviderId,
    callId: string
  ): Promise<CallTurnInput[]> {
    const adapter = this.getAdapter(providerId);
    return adapter.fetchTranscript(callId);
  }

  /**
   * Fetches recording metadata from the provider.
   */
  async fetchRecordingMetadata(
    providerId: VoiceAIProviderId,
    callId: string
  ): Promise<CallRecordingMetadata> {
    const adapter = this.getAdapter(providerId);
    return adapter.fetchRecordingMetadata(callId);
  }

  /**
   * Builds an integration card for a Voice AI provider.
   * Guarantees all sensitive keys are masked before client exposure.
   */
  async getProviderCard(providerId: VoiceAIProviderId): Promise<ProviderIntegrationCard> {
    const adapter = this.getAdapter(providerId);
    const configured = adapter.isConfigured();
    const health = await adapter.healthCheck();

    let connectionState: ProviderConnectionState = 'NOT_CONFIGURED';
    let verificationState: ProviderVerificationState = 'UNVERIFIED';

    if (configured) {
      connectionState = health.status === 'AVAILABLE' ? 'CONNECTED' : 'DEGRADED';
      verificationState = 'VERIFIED';
    } else if (process.env.NODE_ENV !== 'production') {
      verificationState = 'TEST_MODE';
    }

    const maskedCredentials: Record<string, string> = {};
    if (providerId === 'retell') {
      const key = process.env.RETELL_API_KEY;
      if (key) {
        maskedCredentials.apiKeyMasked = maskApiKey(key);
      }
    } else if (providerId === 'vapi') {
      const key = process.env.VAPI_API_KEY;
      if (key) {
        maskedCredentials.apiKeyMasked = maskApiKey(key);
      }
      const org = process.env.VAPI_ORG_ID;
      if (org) {
        maskedCredentials.orgIdMasked = maskSecret(org);
      }
    }

    return {
      providerId,
      name: adapter.providerName,
      category: 'VOICE_AI',
      connectionState,
      verificationState,
      capabilities: adapter.getVoiceAICapabilities(),
      maskedCredentials,
      lastHealthCheck: new Date().toISOString(),
      statusMessage: health.message,
    };
  }

  /**
   * Lists all Voice AI provider integration cards.
   */
  async listProviderCards(): Promise<ProviderIntegrationCard[]> {
    const providers: VoiceAIProviderId[] = ['retell', 'vapi'];
    return Promise.all(providers.map((p) => this.getProviderCard(p)));
  }

  /**
   * Updates credentials for a Voice AI provider.
   */
  async updateCredentials(
    providerId: VoiceAIProviderId,
    credentials: { apiKey?: string; webhookSecret?: string; orgId?: string }
  ): Promise<ProviderIntegrationCard> {
    const adapter = this.getAdapter(providerId);
    if (providerId === 'retell') {
      if (credentials.apiKey) process.env.RETELL_API_KEY = credentials.apiKey;
      if (credentials.webhookSecret) process.env.RETELL_WEBHOOK_SECRET = credentials.webhookSecret;
      (adapter as any).apiKey = credentials.apiKey || (adapter as any).apiKey;
      (adapter as any).webhookSecret = credentials.webhookSecret || (adapter as any).webhookSecret;
    } else if (providerId === 'vapi') {
      if (credentials.apiKey) process.env.VAPI_API_KEY = credentials.apiKey;
      if (credentials.orgId) process.env.VAPI_ORG_ID = credentials.orgId;
      if (credentials.webhookSecret) process.env.VAPI_SERVER_SECRET = credentials.webhookSecret;
      (adapter as any).apiKey = credentials.apiKey || (adapter as any).apiKey;
      (adapter as any).orgId = credentials.orgId || (adapter as any).orgId;
      (adapter as any).serverSecret = credentials.webhookSecret || (adapter as any).serverSecret;
    }
    return this.getProviderCard(providerId);
  }
}

export const voiceAIService = new VoiceAIService();
