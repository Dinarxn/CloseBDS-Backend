import type {
  BaseProviderAdapter,
  ProviderCategory,
  ProviderCapability,
  ProviderHealthResult,
} from './provider.types.js';
import { StandardAIAdapter } from '../ai/ai.adapter.js';
import { StandardEmailAdapter } from '../email/email.adapter.js';
import { StandardDiscoveryAdapter } from '../lead-discovery/discovery.adapter.js';
import { GeoapifyDiscoveryAdapter } from '../lead-discovery/geoapify.adapter.js';
import { StandardWhatsAppAdapter } from '../whatsapp/whatsapp.adapter.js';
import { StandardCallingAdapter } from '../calling/calling.adapter.js';
import { TwilioVoiceAdapter } from '../calling/twilio.adapter.js';

export class ProviderRegistry {
  private adapters: Map<string, BaseProviderAdapter> = new Map();

  constructor() {
    // Register default production adapters
    this.register(new StandardAIAdapter({ providerName: 'OpenAI' }));
    this.register(new StandardAIAdapter({ providerName: 'Anthropic Claude' }));
    this.register(new StandardAIAdapter({ providerName: 'DeepSeek' }));
    this.register(new StandardEmailAdapter({ providerName: 'Resend', dispatchEnabled: false }));
    this.register(new StandardEmailAdapter({ providerName: 'SendGrid', dispatchEnabled: false }));
    this.register(new StandardDiscoveryAdapter({ providerName: 'OpenStreetMap' }));
    this.register(new StandardDiscoveryAdapter({ providerName: 'SerpAPI' }));
    this.register(new StandardDiscoveryAdapter({ providerName: 'Apify Web Scraper' }));
    this.register(new GeoapifyDiscoveryAdapter());
    this.register(new StandardWhatsAppAdapter('Meta WhatsApp Cloud API'));
    this.register(new StandardCallingAdapter('Retell AI / Bland AI'));
    this.register(new TwilioVoiceAdapter());
  }

  register(adapter: BaseProviderAdapter): void {
    this.adapters.set(adapter.providerName, adapter);
  }

  getAdapter<T extends BaseProviderAdapter>(name: string): T | undefined {
    return this.adapters.get(name) as T | undefined;
  }

  getByCategory(category: ProviderCategory): BaseProviderAdapter[] {
    return Array.from(this.adapters.values()).filter((a) => a.category === category);
  }

  getAllCapabilities(): ProviderCapability[] {
    return Array.from(this.adapters.values()).map((a) => a.getCapabilities());
  }

  async checkAllHealth(): Promise<ProviderHealthResult[]> {
    const results: ProviderHealthResult[] = [];
    for (const adapter of this.adapters.values()) {
      try {
        const health = await adapter.healthCheck();
        results.push(health);
      } catch (err: unknown) {
        results.push({
          providerName: adapter.providerName,
          category: adapter.category,
          status: 'DEGRADED',
          isConfigured: adapter.isConfigured(),
          message: err instanceof Error ? err.message : 'Health check failed',
        });
      }
    }
    return results;
  }
}

export const providerRegistry = new ProviderRegistry();
