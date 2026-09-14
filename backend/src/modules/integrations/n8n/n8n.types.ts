export type N8nScope =
  | 'voice:read'
  | 'voice:prepare'
  | 'voice:request'
  | 'leads:read'
  | 'leads:trigger-ai'
  | 'outreach:read'
  | 'outreach:prepare'
  | 'follow_ups:write'
  | 'crm:write';

export const ALL_N8N_SCOPES: readonly N8nScope[] = [
  'voice:read',
  'voice:prepare',
  'voice:request',
  'leads:read',
  'leads:trigger-ai',
  'outreach:read',
  'outreach:prepare',
  'follow_ups:write',
  'crm:write',
];

export interface N8nIntegrationRecord {
  id: string;
  workspaceId: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  webhookUrl?: string | null;
  isActive: boolean;
  lastUsedAt?: Date | null;
  createdAt: Date;
}

export interface N8nKeyCreationResult {
  integration: N8nIntegrationRecord;
  apiKey: string; // Plaintext returned strictly once
}

export interface N8nOutboundEventPayload {
  eventId: string;
  eventType: string;
  timestamp: string;
  workspaceId: string;
  data: Record<string, unknown>;
}
