import crypto from 'node:crypto';
import { n8nIntegrationRepository } from '../../../database/repository.js';
import type { N8nKeyCreationResult, N8nIntegrationRecord } from './n8n.types.js';
import { BadRequestError } from '../../../core/errors/api-error.js';

export class N8nService {
  /**
   * Generates a new n8n API key for a workspace.
   * Plaintext key is returned strictly once and never stored.
   */
  async createIntegration(
    workspaceId: string,
    name: string,
    scopes: string[],
    webhookUrl?: string
  ): Promise<N8nKeyCreationResult> {
    if (!name || name.trim().length === 0) {
      throw new BadRequestError('Integration name is required');
    }

    // Generate random 32-byte secret
    const rawSecret = crypto.randomBytes(32).toString('hex');
    const apiKey = `n8n_live_${rawSecret}`;
    const keyPrefix = apiKey.substring(0, 14); // e.g. "n8n_live_a1b2c"
    const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    const integration = await n8nIntegrationRepository.createIntegration({
      workspaceId,
      name,
      apiKeyHash,
      keyPrefix,
      scopes,
      webhookUrl,
    });

    const record: N8nIntegrationRecord = {
      id: integration.id,
      workspaceId: integration.workspaceId,
      name: integration.name,
      keyPrefix: integration.keyPrefix,
      scopes: integration.scopes,
      webhookUrl: integration.webhookUrl,
      isActive: integration.isActive,
      lastUsedAt: integration.lastUsedAt,
      createdAt: integration.createdAt,
    };

    return {
      integration: record,
      apiKey,
    };
  }

  async listIntegrations(workspaceId: string): Promise<N8nIntegrationRecord[]> {
    const list = await n8nIntegrationRepository.findMany(workspaceId);
    return list.map((item) => ({
      id: item.id,
      workspaceId: item.workspaceId,
      name: item.name,
      keyPrefix: item.keyPrefix,
      scopes: item.scopes,
      webhookUrl: item.webhookUrl,
      isActive: item.isActive,
      lastUsedAt: item.lastUsedAt,
      createdAt: item.createdAt,
    }));
  }

  async revokeIntegration(id: string, workspaceId: string): Promise<boolean> {
    return n8nIntegrationRepository.revoke(id, workspaceId);
  }

  async listDeliveries(workspaceId: string) {
    return n8nIntegrationRepository.findDeliveries(workspaceId);
  }

  /**
   * Outbound signed event dispatcher to registered n8n webhooks.
   * Uses HMAC-SHA256 signature verification in X-CloseVDS-Signature.
   */
  async dispatchOutboundWebhook(
    workspaceId: string,
    eventType: string,
    data: Record<string, unknown>
  ): Promise<void> {
    const integrations = await n8nIntegrationRepository.findMany(workspaceId);
    const targets = integrations.filter((i) => i.isActive && i.webhookUrl);

    if (targets.length === 0) {
      return;
    }

    const secret = process.env.N8N_WEBHOOK_SECRET || process.env.JWT_SECRET || 'closevds_webhook_secret_key';

    for (const target of targets) {
      const eventId = `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const payload = {
        eventId,
        eventType,
        timestamp: new Date().toISOString(),
        workspaceId,
        data,
      };

      const payloadString = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', secret).update(payloadString).digest('hex');

      try {
        const res = await fetch(target.webhookUrl!, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CloseVDS-Signature': `sha256=${signature}`,
            'X-CloseVDS-Event': eventType,
          },
          body: payloadString,
          signal: AbortSignal.timeout(10000),
        });

        await n8nIntegrationRepository.createDelivery({
          workspaceId,
          integrationId: target.id,
          eventId,
          eventType,
          payload,
          statusCode: res.status,
          status: res.ok ? 'DELIVERED' : 'FAILED',
          deliveredAt: res.ok ? new Date() : undefined,
        });
      } catch (err: unknown) {
        await n8nIntegrationRepository.createDelivery({
          workspaceId,
          integrationId: target.id,
          eventId,
          eventType,
          payload,
          status: 'FAILED',
          lastError: err instanceof Error ? err.message : 'Network failure',
        });
      }
    }
  }
}

export const n8nService = new N8nService();
