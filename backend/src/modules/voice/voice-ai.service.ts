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
import {
  maskApiKey,
  maskSecret,
  encryptCredential,
  decryptCredential,
} from '../../security/credential-vault.js';
import { workspaceProviderCredentialRepository } from '../../database/repository.js';

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
  async getProviderCard(providerId: VoiceAIProviderId, workspaceId?: string): Promise<ProviderIntegrationCard> {
    const adapter = this.getAdapter(providerId);

    // If workspaceId is provided, check for workspace-persisted credentials in database
    let dbKey: string | undefined;
    let dbOrg: string | undefined;
    if (workspaceId) {
      try {
        const dbCred = await workspaceProviderCredentialRepository.findByProvider(workspaceId, providerId.toUpperCase());
        if (dbCred && dbCred.encryptedPayload) {
          const payload = dbCred.encryptedPayload as any;
          if (payload.apiKey) {
            dbKey = decryptCredential(payload.apiKey);
            (adapter as any).apiKey = dbKey;
          }
          if (payload.webhookSecret) {
            (adapter as any).webhookSecret = decryptCredential(payload.webhookSecret);
          }
          if (payload.orgId) {
            dbOrg = payload.orgId;
            (adapter as any).orgId = payload.orgId;
          }
        }
      } catch {
        // Fallback
      }
    }

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

    // SECURITY: Masked credentials are sourced exclusively from workspace vault.
    // process.env is NOT used as a fallback — each workspace must supply its own credentials.
    const maskedCredentials: Record<string, string> = {};
    if (dbKey) {
      maskedCredentials.apiKeyMasked = maskApiKey(dbKey);
    }
    if (dbOrg) {
      maskedCredentials.orgIdMasked = maskSecret(dbOrg);
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
  async listProviderCards(workspaceId?: string): Promise<ProviderIntegrationCard[]> {
    const providers: VoiceAIProviderId[] = ['retell', 'vapi'];
    return Promise.all(providers.map((p) => this.getProviderCard(p, workspaceId)));
  }

  /**
   * Updates credentials for a Voice AI provider.
   * SECURITY: Credentials are persisted to the workspace-scoped AES-256-GCM vault
   * and set on the adapter instance for the current request only.
   * process.env is NEVER mutated — workspace isolation requires per-request credential loading.
   */
  async updateCredentials(
    providerId: VoiceAIProviderId,
    credentials: { apiKey?: string; webhookSecret?: string; orgId?: string },
    workspaceId?: string
  ): Promise<ProviderIntegrationCard> {
    if (!workspaceId) {
      throw new Error('workspaceId is required for credential updates — global credentials are not supported');
    }

    // Persist encrypted credentials to workspace-scoped vault (primary storage)
    const encryptedPayload: Record<string, any> = {};
    const maskedDisplay: Record<string, any> = {};
    if (credentials.apiKey) {
      encryptedPayload.apiKey = encryptCredential(credentials.apiKey);
      maskedDisplay.apiKeyMasked = maskApiKey(credentials.apiKey);
    }
    if (credentials.webhookSecret) {
      encryptedPayload.webhookSecret = encryptCredential(credentials.webhookSecret);
    }
    if (credentials.orgId) {
      encryptedPayload.orgId = credentials.orgId;
      maskedDisplay.orgIdMasked = maskSecret(credentials.orgId);
    }
    await workspaceProviderCredentialRepository.upsert(workspaceId, providerId.toUpperCase(), {
      encryptedPayload,
      maskedDisplay,
      connectionStatus: 'CONNECTED',
    });

    return this.getProviderCard(providerId, workspaceId);
  }
}

export const voiceAIService = new VoiceAIService();
