export type ProviderCategory =
  | 'AI_LLM'
  | 'EMAIL_DISPATCH'
  | 'LEAD_DISCOVERY'
  | 'WEBSITE_RESEARCH'
  | 'WHATSAPP'
  | 'CALLING';

export type ProviderStatus =
  | 'AVAILABLE'
  | 'UNCONFIGURED'
  | 'DEGRADED'
  | 'RATE_LIMITED'
  | 'DISABLED';

export interface ProviderCapability {
  name: string;
  category: ProviderCategory;
  supportedFeatures: string[];
  requiresApiKey: boolean;
  isDispatchProvider: boolean;
}

export interface ProviderHealthResult {
  providerName: string;
  category: ProviderCategory;
  status: ProviderStatus;
  isConfigured: boolean;
  latencyMs?: number;
  message: string;
}

export type ProviderErrorCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'TIMEOUT'
  | 'CONFIGURATION_ERROR'
  | 'RATE_LIMITED'
  | 'DISPATCH_DISABLED'
  | 'PARSING_ERROR'
  | 'UNKNOWN_ERROR';

export class ProviderError extends Error {
  public readonly isRetryable: boolean;
  public readonly code: ProviderErrorCode;
  public readonly providerName: string;

  constructor(
    providerName: string,
    code: ProviderErrorCode,
    message: string,
    isRetryable = false
  ) {
    super(`[${providerName}] ${code}: ${message}`);
    this.name = 'ProviderError';
    this.providerName = providerName;
    this.code = code;
    this.isRetryable = isRetryable;
  }
}

export interface BaseProviderAdapter {
  readonly providerName: string;
  readonly category: ProviderCategory;
  isConfigured(): boolean;
  getCapabilities(): ProviderCapability;
  healthCheck(): Promise<ProviderHealthResult>;
}
