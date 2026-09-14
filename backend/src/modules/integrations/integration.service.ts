import {
  AuditRepository,
  SuppressionRepository,
  CRMActivityRepository,
  auditRepository as defaultAuditRepo,
  suppressionRepository as defaultSuppressionRepo,
  crmActivityRepository as defaultCRMRepo,
  type PaginationResult,
} from '../../database/repository.js';
import { databaseClient, type DatabaseClient } from '../../database/client.js';
import { WebhookSignatureValidator } from './signature.validator.js';
import { UnauthorizedError } from '../../core/errors/api-error.js';
import type {
  WebhookProvider,
  NormalizedEventType,
  NormalizedWebhookEvent,
  WebhookProcessingResult,
  StoredIntegrationEvent,
} from './integration.types.js';
import type { WebhookPayload, ListIntegrationEventsQuery } from './integration.schema.js';

export class IntegrationService {
  // In-memory idempotency tracker to prevent duplicate event processing
  private processedEventsStore: Map<string, StoredIntegrationEvent> = new Map();

  constructor(
    private auditRepo: AuditRepository = defaultAuditRepo,
    private suppressionRepo: SuppressionRepository = defaultSuppressionRepo,
    private crmRepo: CRMActivityRepository = defaultCRMRepo,
    private db: DatabaseClient = databaseClient
  ) {}

  private get prisma() {
    return this.db.getPrismaClient();
  }

  /**
   * Normalizes raw webhook payloads from various email/event providers into closeVDS standard event format.
   */
  normalizeEvent(provider: WebhookProvider, payload: WebhookPayload): NormalizedWebhookEvent {
    let eventId = payload.id || `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    let eventType: NormalizedEventType = 'DELIVERED';
    let recipientEmail = payload.email || payload.recipient || '';
    let messageId = payload.message_id;
    let occurredAt = new Date();

    if (provider === 'resend') {
      // Resend webhook format: { type: 'email.delivered' | 'email.bounced' | 'email.complained', data: { to: [...], email_id: '...' } }
      const resendType = (payload.type || '').toLowerCase();
      if (resendType.includes('bounc')) eventType = 'BOUNCED';
      else if (resendType.includes('open')) eventType = 'OPENED';
      else if (resendType.includes('click')) eventType = 'CLICKED';
      else if (resendType.includes('complain') || resendType.includes('opt_out')) eventType = 'OPT_OUT';
      else if (resendType.includes('reply') || resendType.includes('replied')) eventType = 'REPLIED';
      else eventType = 'DELIVERED';

      const data = (payload.data as Record<string, unknown>) || {};
      if (data.to && Array.isArray(data.to) && data.to.length > 0) {
        recipientEmail = String(data.to[0]);
      }
      if (data.email_id) {
        messageId = String(data.email_id);
      }
      if (payload.created_at) {
        occurredAt = new Date(payload.created_at);
      }
    } else if (provider === 'sendgrid') {
      // SendGrid webhook format: [{ event: 'delivered' | 'bounce' | 'open' | 'click' | 'unsubscribe', email: '...', sg_message_id: '...' }]
      const sgEvent = (payload.event || '').toLowerCase();
      if (sgEvent.includes('bounce') || sgEvent.includes('dropped')) eventType = 'BOUNCED';
      else if (sgEvent.includes('open')) eventType = 'OPENED';
      else if (sgEvent.includes('click')) eventType = 'CLICKED';
      else if (sgEvent.includes('unsubscribe') || sgEvent.includes('spamreport')) eventType = 'OPT_OUT';
      else if (sgEvent.includes('reply')) eventType = 'REPLIED';
      else eventType = 'DELIVERED';

      if (payload.email) recipientEmail = payload.email;
      if (payload.message_id || payload['sg_message_id']) {
        messageId = String(payload.message_id || payload['sg_message_id']);
      }
      if (payload.timestamp) {
        const ts = Number(payload.timestamp);
        occurredAt = new Date(ts > 1e11 ? ts : ts * 1000);
      }
    } else if (provider === 'whatsapp') {
      // Meta WhatsApp webhook structure
      let waPhone = '';
      let waText = '';
      let waStatus = '';
      let waId = '';

      const entry = (payload as Record<string, unknown>).entry as unknown[];
      if (Array.isArray(entry) && entry[0] && typeof entry[0] === 'object') {
        const changes = (entry[0] as { changes?: Array<{ value?: Record<string, unknown> }> }).changes;
        const val = changes?.[0]?.value;
        if (val) {
          const messages = val.messages as Array<{ from?: string; id?: string; text?: { body?: string } }>;
          const statuses = val.statuses as Array<{ recipient_id?: string; id?: string; status?: string }>;
          if (Array.isArray(messages) && messages[0]) {
            const msg = messages[0];
            waPhone = msg.from ? (msg.from.startsWith('+') ? msg.from : `+${msg.from}`) : '';
            waId = msg.id || '';
            if (msg.text?.body) waText = String(msg.text.body);
          } else if (Array.isArray(statuses) && statuses[0]) {
            const st = statuses[0];
            waPhone = st.recipient_id ? (st.recipient_id.startsWith('+') ? st.recipient_id : `+${st.recipient_id}`) : '';
            waId = st.id || '';
            waStatus = st.status || '';
          }
        }
      } else {
        // Flat payload fallback (useful for tests and direct webhook simulations)
        const rawPhone = String(payload.phone || (payload as Record<string, unknown>).from || '');
        waPhone = rawPhone ? (rawPhone.startsWith('+') ? rawPhone : `+${rawPhone}`) : '';
        waText = String((payload as Record<string, unknown>).text || (payload as Record<string, unknown>).body || '');
        waStatus = String((payload as Record<string, unknown>).status || '');
        waId = String(payload.id || payload.message_id || '');
      }

      if (waId) {
        eventId = waId;
        messageId = waId;
      }

      // Check for strict unsubscribe / opt-out keywords (STOP, UNSUBSCRIBE, CANCEL, QUIT, END, OPTOUT)
      const cleanWaText = waText.trim().toUpperCase();
      const optOutKeywords = ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'QUIT', 'END', 'OPTOUT'];

      if (optOutKeywords.includes(cleanWaText)) {
        eventType = 'OPT_OUT';
      } else if (waText.length > 0) {
        eventType = 'REPLIED';
      } else if (waStatus === 'delivered' || waStatus === 'sent') {
        eventType = 'DELIVERED';
      } else if (waStatus === 'read') {
        eventType = 'OPENED';
      } else if (waStatus === 'failed') {
        eventType = 'BOUNCED';
      }

      return {
        eventId,
        provider,
        eventType,
        recipientEmail: '',
        recipientPhone: waPhone,
        messageId,
        occurredAt,
        metadata: { ...payload, text: waText, phone: waPhone, status: waStatus },
      };
    } else {
      // Generic format
      const genType = (payload.type || payload.event || '').toUpperCase();
      if (['DELIVERED', 'BOUNCED', 'OPENED', 'CLICKED', 'REPLIED', 'OPT_OUT'].includes(genType)) {
        eventType = genType as NormalizedEventType;
      }
      if (payload.email) recipientEmail = payload.email;
      if (payload.message_id) messageId = payload.message_id;
    }

    return {
      eventId,
      provider,
      eventType,
      recipientEmail: recipientEmail.toLowerCase().trim(),
      messageId,
      occurredAt,
      metadata: payload,
    };
  }

  /**
   * Processes an incoming webhook event idempotently with signature verification and safe side-effects.
   */
  async processWebhook(
    provider: WebhookProvider,
    rawPayload: unknown,
    signatureHeader?: string,
    secret?: string
  ): Promise<WebhookProcessingResult> {
    // 1. Signature verification
    const isValid = WebhookSignatureValidator.verifySignature(
      provider,
      typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload),
      signatureHeader,
      secret
    );

    if (!isValid) {
      throw new UnauthorizedError('Invalid or forged webhook signature');
    }

    const payloadObj = (typeof rawPayload === 'object' && rawPayload !== null
      ? rawPayload
      : JSON.parse(String(rawPayload))) as WebhookPayload;

    // 2. Event normalization
    const normalized = this.normalizeEvent(provider, payloadObj);

    // 3. Idempotency check
    if (this.processedEventsStore.has(normalized.eventId)) {
      return {
        success: true,
        action: 'IGNORED_DUPLICATE',
        eventId: normalized.eventId,
        normalizedType: normalized.eventType,
        duplicate: true,
        message: 'Event was already processed idempotently',
      };
    }

    // 4. Match recipient contact & lead to identify tenant workspace
    let matchedWorkspaceId: string | undefined;
    let matchedLeadId: string | undefined;

    if (normalized.recipientEmail) {
      const contact = await this.prisma.contact.findFirst({
        where: { email: normalized.recipientEmail },
        include: { lead: { select: { id: true, workspaceId: true, status: true } } },
      });

      if (contact?.lead) {
        matchedWorkspaceId = contact.lead.workspaceId;
        matchedLeadId = contact.lead.id;
      }
    }

    // Phone-based matching for WhatsApp events
    if (!matchedWorkspaceId && normalized.recipientPhone) {
      let cleanPhone = normalized.recipientPhone.trim();
      if (!cleanPhone.startsWith('+')) cleanPhone = '+' + cleanPhone.replace(/\D/g, '');
      const rawDigits = cleanPhone.replace(/\D/g, '');

      const contact = await this.prisma.contact.findFirst({
        where: {
          OR: [
            { phone: cleanPhone },
            { phone: { contains: rawDigits.slice(-10) } },
          ],
        },
        include: { lead: { select: { id: true, workspaceId: true, status: true } } },
      });

      if (contact?.lead) {
        matchedWorkspaceId = contact.lead.workspaceId;
        matchedLeadId = contact.lead.id;
      } else {
        const lead = await this.prisma.lead.findFirst({
          where: {
            OR: [
              { phone: cleanPhone },
              { phone: { contains: rawDigits.slice(-10) } },
            ],
          },
          select: { id: true, workspaceId: true, status: true },
        });
        if (lead) {
          matchedWorkspaceId = lead.workspaceId;
          matchedLeadId = lead.id;
        }
      }
    }

    // 5. Execute safe side-effects based on event type
    let resultAction: WebhookProcessingResult['action'] = 'EVENT_RECORDED';

    if (matchedWorkspaceId && normalized.recipientEmail) {
      if (normalized.eventType === 'OPT_OUT') {
        // Automatically add suppression rule
        await this.suppressionRepo.create({
          workspaceId: matchedWorkspaceId,
          type: 'EMAIL',
          value: normalized.recipientEmail,
          reason: 'OPT_OUT',
        });

        // Update lead status to OPT_OUT if matched
        if (matchedLeadId) {
          await this.prisma.lead.update({
            where: { id: matchedLeadId },
            data: { status: 'OPT_OUT' },
          });

          await this.crmRepo.create(matchedWorkspaceId, {
            leadId: matchedLeadId,
            type: 'STAGE_CHANGE',
            description: 'Lead opted out via email webhook event',
          });
        }
        resultAction = 'SUPPRESSION_ADDED';
        try {
          const { n8nService } = await import('./n8n/n8n.service.js');
          n8nService.dispatchOutboundWebhook(matchedWorkspaceId, 'suppression.created', {
            type: 'EMAIL',
            value: normalized.recipientEmail,
            reason: 'OPT_OUT',
          }).catch(() => {});
        } catch {}
      } else if (normalized.eventType === 'BOUNCED') {
        // Automatically add hard-bounce suppression
        await this.suppressionRepo.create({
          workspaceId: matchedWorkspaceId,
          type: 'EMAIL',
          value: normalized.recipientEmail,
          reason: 'HARD_BOUNCE',
        });
        resultAction = 'SUPPRESSION_ADDED';
      } else if (normalized.eventType === 'REPLIED') {
        // Transition lead to REPLIED and write CRM timeline note
        if (matchedLeadId) {
          await this.prisma.lead.update({
            where: { id: matchedLeadId },
            data: { status: 'REPLIED' },
          });

          await this.crmRepo.create(matchedWorkspaceId, {
            leadId: matchedLeadId,
            type: 'EMAIL_REPLIED',
            description: `Inbound email response received from ${normalized.recipientEmail}`,
          });
        }
        resultAction = 'CRM_STAGE_UPDATED';
      }
    } else if (matchedWorkspaceId && normalized.recipientPhone) {
      let cleanPhone = normalized.recipientPhone.trim();
      if (!cleanPhone.startsWith('+')) cleanPhone = '+' + cleanPhone.replace(/\D/g, '');

      if (normalized.eventType === 'OPT_OUT') {
        // Automatically add PHONE suppression rule
        await this.suppressionRepo.create({
          workspaceId: matchedWorkspaceId,
          type: 'PHONE',
          value: cleanPhone,
          reason: 'OPT_OUT',
        });

        if (matchedLeadId) {
          await this.prisma.lead.update({
            where: { id: matchedLeadId },
            data: { status: 'OPT_OUT' },
          });

          await this.crmRepo.create(matchedWorkspaceId, {
            leadId: matchedLeadId,
            type: 'STAGE_CHANGE',
            description: `Lead opted out via WhatsApp inbound ${normalized.metadata?.text || 'STOP'}`,
          });
        }
        resultAction = 'SUPPRESSION_ADDED';
        try {
          const { n8nService } = await import('./n8n/n8n.service.js');
          n8nService.dispatchOutboundWebhook(matchedWorkspaceId, 'suppression.created', {
            type: 'PHONE',
            value: cleanPhone,
            reason: 'OPT_OUT',
          }).catch(() => {});
        } catch {}
      } else if (normalized.eventType === 'REPLIED') {
        if (matchedLeadId) {
          await this.prisma.lead.update({
            where: { id: matchedLeadId },
            data: { status: 'REPLIED' },
          });

          await this.crmRepo.create(matchedWorkspaceId, {
            leadId: matchedLeadId,
            type: 'NOTE',
            description: `Inbound WhatsApp response received from ${cleanPhone}`,
          });
        }
        resultAction = 'CRM_STAGE_UPDATED';
      }
    }

    // 6. Record EmailEvent if matching emailMessageId exists
    if (normalized.messageId) {
      try {
        await this.prisma.emailEvent.create({
          data: {
            emailMessageId: normalized.messageId,
            eventType: normalized.eventType,
            eventPayload: normalized.metadata ? (normalized.metadata as any) : undefined,
            occurredAt: normalized.occurredAt,
          },
        });
      } catch {
        // If messageId is not a valid DB UUID, continue gracefully
      }
    }

    // 7. Store processed event in idempotency memory store
    const storedEvent: StoredIntegrationEvent = {
      id: `integ_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      workspaceId: matchedWorkspaceId,
      provider,
      eventId: normalized.eventId,
      eventType: normalized.eventType,
      recipientEmail: normalized.recipientEmail,
      recipientPhone: normalized.recipientPhone,
      status: 'PROCESSED',
      occurredAt: normalized.occurredAt,
      createdAt: new Date(),
    };
    this.processedEventsStore.set(normalized.eventId, storedEvent);

    // 8. Immutable Audit Log
    if (matchedWorkspaceId) {
      try {
        await this.auditRepo.create({
          workspaceId: matchedWorkspaceId,
          eventType: `webhook:${provider}:${normalized.eventType.toLowerCase()}`,
          entityType: 'IntegrationEvent',
          entityId: normalized.eventId,
          metadata: {
            provider,
            eventType: normalized.eventType,
            recipientEmail: normalized.recipientEmail,
            recipientPhone: normalized.recipientPhone,
            action: resultAction,
          },
        });
      } catch {
        // Non-blocking audit
      }
    }

    return {
      success: true,
      action: resultAction,
      eventId: normalized.eventId,
      normalizedType: normalized.eventType,
      duplicate: false,
    };
  }

  /**
   * Lists processed integration events with workspace tenant scoping and pagination.
   */
  async listIntegrationEvents(
    workspaceId: string,
    query: ListIntegrationEventsQuery
  ): Promise<PaginationResult<StoredIntegrationEvent>> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const allEvents = Array.from(this.processedEventsStore.values()).filter((e) => {
      const matchWs = !e.workspaceId || e.workspaceId === workspaceId;
      const matchProv = !query.provider || e.provider === query.provider;
      const matchType = !query.eventType || e.eventType === query.eventType;
      const matchSearch =
        !query.search ||
        Boolean(e.recipientEmail?.toLowerCase().includes(query.search.toLowerCase().trim())) ||
        Boolean(e.recipientPhone?.includes(query.search.trim()));
      return matchWs && matchProv && matchType && matchSearch;
    });

    const total = allEvents.length;
    const data = allEvents.slice(skip, skip + limit);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }
}

export const integrationService = new IntegrationService();
