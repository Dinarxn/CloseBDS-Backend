import {
  OutreachRepository,
  SuppressionRepository,
  AuditRepository,
  outreachRepository as defaultOutreachRepo,
  suppressionRepository as defaultSuppressionRepo,
  auditRepository as defaultAuditRepo,
  leadRepository,
  crmActivityRepository,
  type OutreachWithRelations,
  type PaginationResult,
} from '../../database/repository.js';
import { NotFoundError, BadRequestError, ForbiddenError } from '../../core/errors/api-error.js';
import { assertKillSwitchNotActive } from '../../core/security/security.js';
import { providerRegistry } from '../../integrations/core/provider.registry.js';
import { StandardEmailAdapter } from '../../integrations/email/email.adapter.js';
import { StandardWhatsAppAdapter } from '../../integrations/whatsapp/whatsapp.adapter.js';
import type {
  CreateOutreachDraftInput,
  UpdateOutreachDraftInput,
  ListOutreachQueryParams,
} from './outreach.schema.js';
import type { OutreachItem, SafetyCheckDecision } from './outreach.types.js';

export class OutreachService {
  constructor(
    private outreachRepo: OutreachRepository = defaultOutreachRepo,
    private suppressionRepo: SuppressionRepository = defaultSuppressionRepo,
    private auditLogger: AuditRepository = defaultAuditRepo
  ) {}

  private mapToOutreachItem(entity: OutreachWithRelations): OutreachItem {
    return {
      id: entity.id,
      workspaceId: entity.emailCampaign.campaign.workspaceId,
      campaignId: entity.emailCampaign.campaignId,
      campaignName: entity.emailCampaign.campaign.name,
      leadId: entity.contact.leadId,
      leadBusinessName: entity.contact.lead.businessName,
      contactId: entity.contactId,
      contactName: entity.contact.fullName,
      recipientEmail: entity.contact.email,
      channel: 'EMAIL',
      subject: entity.subject,
      bodyText: entity.bodyText,
      status: entity.status,
      humanApprovalRequired: entity.humanApprovalRequired,
      isApproved: entity.isApproved,
      approvedByUserId: entity.approvedByUserId,
      approvedAt: entity.approvedAt,
      sentAt: entity.sentAt,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  /**
   * Creates an outreach draft locked in DRAFT status requiring human approval.
   */
  async createDraft(
    workspaceId: string,
    userId: string | undefined,
    input: CreateOutreachDraftInput
  ): Promise<OutreachItem> {
    const message = await this.outreachRepo.create(workspaceId, {
      campaignId: input.campaignId,
      contactId: input.contactId,
      subject: input.subject,
      bodyText: input.bodyText,
    });

    const item = this.mapToOutreachItem(message);

    try {
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'outreach:created',
        entityType: 'EmailMessage',
        entityId: item.id,
        metadata: {
          campaignId: item.campaignId,
          leadId: item.leadId,
          contactId: item.contactId,
          recipientEmail: item.recipientEmail,
          status: item.status,
        },
      });
    } catch {
      // Non-blocking audit failure
    }

    return item;
  }

  /**
   * Lists paginated outreach drafts with workspace isolation and filters.
   */
  async listDrafts(
    workspaceId: string,
    query: ListOutreachQueryParams
  ): Promise<PaginationResult<OutreachItem>> {
    const result = await this.outreachRepo.findManyPaginated(workspaceId, {
      campaignId: query.campaignId,
      leadId: query.leadId,
      contactId: query.contactId,
      status: query.status,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });

    return {
      data: result.data.map((m) => this.mapToOutreachItem(m)),
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    };
  }

  /**
   * Retrieves a single outreach draft by ID with workspace verification.
   */
  async getDraft(id: string, workspaceId: string): Promise<OutreachItem> {
    const message = await this.outreachRepo.findById(id, workspaceId);
    if (!message) {
      throw new NotFoundError('Outreach item not found or access denied for this workspace');
    }
    return this.mapToOutreachItem(message);
  }

  /**
   * Updates outreach content. If content is edited, invalidates any existing approval and resets status to DRAFT.
   */
  async updateDraft(
    id: string,
    workspaceId: string,
    userId: string | undefined,
    input: UpdateOutreachDraftInput
  ): Promise<OutreachItem> {
    const message = await this.outreachRepo.update(id, workspaceId, {
      subject: input.subject,
      bodyText: input.bodyText,
    });

    const item = this.mapToOutreachItem(message);

    try {
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'outreach:updated',
        entityType: 'EmailMessage',
        entityId: item.id,
        metadata: {
          isApproved: item.isApproved,
          status: item.status,
          approvalReset: true,
        },
      });
    } catch {
      // Non-blocking audit failure
    }

    return item;
  }

  /**
   * Explicit server-authoritative human approval.
   */
  async approveDraft(
    id: string,
    workspaceId: string,
    userId: string
  ): Promise<OutreachItem> {
    const message = await this.outreachRepo.approve(id, workspaceId, userId);
    const item = this.mapToOutreachItem(message);

    try {
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'outreach:approved',
        entityType: 'EmailMessage',
        entityId: item.id,
        metadata: {
          approvedByUserId: userId,
          approvedAt: item.approvedAt,
          status: item.status,
        },
      });

      const { n8nService } = await import('../integrations/n8n/n8n.service.js');
      n8nService.dispatchOutboundWebhook(workspaceId, 'approval.granted', {
        entityType: 'EmailMessage',
        entityId: item.id,
        approvedBy: userId,
      }).catch(() => {});
    } catch {
      // Non-blocking audit failure
    }

    return item;
  }

  /**
   * Explicit human rejection.
   */
  async rejectDraft(
    id: string,
    workspaceId: string,
    userId: string
  ): Promise<OutreachItem> {
    const message = await this.outreachRepo.reject(id, workspaceId, userId);
    const item = this.mapToOutreachItem(message);

    try {
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'outreach:rejected',
        entityType: 'EmailMessage',
        entityId: item.id,
        metadata: {
          status: item.status,
        },
      });

      const { n8nService } = await import('../integrations/n8n/n8n.service.js');
      n8nService.dispatchOutboundWebhook(workspaceId, 'approval.rejected', {
        entityType: 'EmailMessage',
        entityId: item.id,
        rejectedBy: userId,
      }).catch(() => {});
    } catch {
      // Non-blocking audit failure
    }

    return item;
  }

  /**
   * Explicit human cancellation.
   */
  async cancelDraft(
    id: string,
    workspaceId: string,
    userId: string
  ): Promise<OutreachItem> {
    const message = await this.outreachRepo.cancel(id, workspaceId, userId);
    const item = this.mapToOutreachItem(message);

    try {
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'outreach:cancelled',
        entityType: 'EmailMessage',
        entityId: item.id,
        metadata: {
          status: item.status,
        },
      });
    } catch {
      // Non-blocking audit failure
    }

    return item;
  }

  /**
   * Authoritative multi-point Safety Check.
   * Evaluates:
   * 1. Human Approval status (isApproved === true and status === 'APPROVED')
   * 2. Email / Domain Suppression status
   * 3. Valid Lead & Contact Recipient presence
   * 4. Outbound Content validity
   * 5. Daily Cap / Velocity boundary
   */
  async checkSafety(
    id: string,
    workspaceId: string,
    userId?: string
  ): Promise<SafetyCheckDecision> {
    const message = await this.outreachRepo.findById(id, workspaceId);
    if (!message) {
      throw new NotFoundError('Outreach item not found or access denied for this workspace');
    }

    const reasons: string[] = [];
    let isApproved = message.isApproved && message.status === 'APPROVED';
    if (!isApproved) {
      reasons.push('Outreach draft has not received explicit human approval');
    }

    const recipientEmail = message.contact.email;
    const recipientDomain = message.contact.lead.domain || undefined;
    const isSuppressed = await this.suppressionRepo.isSuppressed(
      workspaceId,
      recipientEmail,
      recipientDomain
    );
    if (isSuppressed) {
      reasons.push(`Recipient email [${recipientEmail}] or domain is currently on the workspace suppression list`);
    }

    const hasValidRecipient = Boolean(recipientEmail && recipientEmail.includes('@'));
    if (!hasValidRecipient) {
      reasons.push('Recipient contact email is missing or malformed');
    }

    const hasValidContent = Boolean(message.subject?.trim() && message.bodyText?.trim());
    if (!hasValidContent) {
      reasons.push('Outreach subject or body text is empty');
    }

    const dailyCap = message.emailCampaign.campaign.dailyCap || 50;
    const sentToday = await this.outreachRepo.countSentToday(
      workspaceId,
      message.emailCampaign.campaignId
    );
    const withinDailyCap = sentToday < dailyCap;
    if (!withinDailyCap) {
      reasons.push(`Campaign daily cap reached (${sentToday}/${dailyCap})`);
    }

    const allowed =
      isApproved &&
      !isSuppressed &&
      hasValidRecipient &&
      hasValidContent &&
      withinDailyCap;

    const decision: SafetyCheckDecision = {
      allowed,
      reasons,
      checkedAt: new Date(),
      outreachId: id,
      workspaceId,
      isApproved,
      isSuppressed,
      withinDailyCap,
      hasValidRecipient,
      hasValidContent,
    };

    try {
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: allowed ? 'outreach:safety_checked' : 'outreach:blocked',
        entityType: 'EmailMessage',
        entityId: id,
        metadata: {
          allowed,
          reasons,
          isApproved,
          isSuppressed,
          withinDailyCap,
        },
      });
    } catch {
      // Non-blocking audit failure
    }

    return decision;
  }

  /**
   * Outbound Email Dispatch: strictly executes the mandatory 9-step safety chain:
   * 1. Tenant Authentication & Workspace Resolution (server-authoritative)
   * 2. Lead Ownership Boundary
   * 3. Explicit Human Approval Verification (immediate)
   * 4. Immediate DNC & Email/Domain Suppression Check
   * 5. Lead Opt-Out / Qualification Check
   * 6. Kill Switch Enforcement
   * 7. Idempotency & Duplicate Prevention
   * 8. Pre-Dispatch Audit Logging
   * 9. External Provider Boundary Execution (Resend)
   */
  async dispatchDraft(
    id: string,
    workspaceId: string,
    userId?: string
  ): Promise<OutreachItem> {
    // 1 & 2. Retrieve draft with full relations and verify workspace tenant isolation
    const message = await this.outreachRepo.findById(id, workspaceId);
    if (!message) {
      throw new NotFoundError('Outreach draft not found or access denied for this workspace');
    }

    // 2.5 Idempotency Gate: if already dispatched and SENT, return existing item gracefully
    if ((message.status as string) === 'SENT') {
      return this.mapToOutreachItem(message);
    }

    // 3. Human Approval Gate: must be explicitly approved immediately prior to dispatch
    if (!message.isApproved || message.status !== 'APPROVED') {
      throw new ForbiddenError(
        `Outreach draft requires explicit human approval before provider dispatch. Status: ${message.status}`
      );
    }

    // 4. Suppression / DNC Gate: immediate re-check against suppression table
    const recipientEmail = message.contact.email;
    const recipientDomain = message.contact.lead.domain || undefined;
    const isSuppressed = await this.suppressionRepo.isSuppressed(
      workspaceId,
      recipientEmail,
      recipientDomain
    );
    if (isSuppressed) {
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'outreach:blocked',
        entityType: 'EmailMessage',
        entityId: id,
        metadata: {
          reason: 'Recipient email or domain is on workspace suppression list',
          recipientEmail,
        },
      }).catch(() => {});
      throw new ForbiddenError(
        `Recipient email [${recipientEmail}] or domain is currently on the workspace suppression list`
      );
    }

    // 5. Lead Status Qualification Gate: must not be OPT_OUT or DISQUALIFIED
    if (
      message.contact.lead.status === 'OPT_OUT' ||
      message.contact.lead.status === 'DISQUALIFIED'
    ) {
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'outreach:blocked',
        entityType: 'EmailMessage',
        entityId: id,
        metadata: {
          reason: `Lead status '${message.contact.lead.status}' is not eligible for outreach`,
        },
      }).catch(() => {});
      throw new ForbiddenError(
        `Lead status '${message.contact.lead.status}' is not eligible for outbound communication`
      );
    }

    // 6. Global Kill Switch Gate
    const isKillSwitchActive =
      process.env.KILL_SWITCH_ACTIVE === 'true' || process.env.KILL_SWITCH_ACTIVE === '1';
    if (isKillSwitchActive) {
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'outreach:blocked',
        entityType: 'EmailMessage',
        entityId: id,
        metadata: { reason: 'Global Outreach Kill Switch is active' },
      }).catch(() => {});
      assertKillSwitchNotActive(true);
    }

    // 7. Provider Configuration Check
    const emailAdapter =
      providerRegistry.getAdapter<StandardEmailAdapter>('Resend') ||
      new StandardEmailAdapter({ dispatchEnabled: true });

    if (!emailAdapter.isConfigured()) {
      throw new BadRequestError('Email provider API key is not configured');
    }

    // Pre-dispatch audit logging
    await this.auditLogger.create({
      workspaceId,
      userId,
      eventType: 'outreach:dispatch_attempt',
      entityType: 'EmailMessage',
      entityId: id,
      metadata: {
        campaignId: message.emailCampaign.campaignId,
        recipientEmail,
        subject: message.subject,
      },
    }).catch(() => {});

    // 9. Provider Dispatch Boundary
    try {
      const sendResult = await emailAdapter.sendEmail({
        messageId: message.id,
        workspaceId,
        campaignId: message.emailCampaign.campaignId,
        toEmail: recipientEmail,
        toName: message.contact.fullName,
        fromEmail: message.emailCampaign.fromEmail,
        fromName: message.emailCampaign.fromName,
        subject: message.subject,
        bodyText: message.bodyText,
      });

      // Update state in database
      const updated = await this.outreachRepo.markSent(id, workspaceId, sendResult.providerMessageId);

      // Post-dispatch audit log
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'outreach:dispatched',
        entityType: 'EmailMessage',
        entityId: id,
        metadata: {
          providerMessageId: sendResult.providerMessageId,
          status: 'SENT',
          recipientEmail,
        },
      }).catch(() => {});

      // Outbound n8n notification
      try {
        const { n8nService } = await import('../integrations/n8n/n8n.service.js');
        n8nService.dispatchOutboundWebhook(workspaceId, 'outreach.sent', {
          draftId: id,
          leadId: message.contact.lead.id,
          providerMessageId: sendResult.providerMessageId,
        }).catch(() => {});
      } catch {
        // Non-blocking
      }

      return this.mapToOutreachItem(updated);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Outbound email dispatch failed';

      await this.outreachRepo.markFailed(id, workspaceId, errorMsg).catch(() => {});

      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'outreach:dispatch_failed',
        entityType: 'EmailMessage',
        entityId: id,
        metadata: {
          error: errorMsg,
          recipientEmail,
        },
      }).catch(() => {});

      // Outbound n8n notification
      try {
        const { n8nService } = await import('../integrations/n8n/n8n.service.js');
        n8nService.dispatchOutboundWebhook(workspaceId, 'outreach.failed', {
          draftId: id,
          leadId: message.contact.lead.id,
          error: errorMsg,
        }).catch(() => {});
      } catch {
        // Non-blocking
      }

      throw err;
    }
  }

  /**
   * Outbound WhatsApp Dispatch: strictly executes the safety chain for WhatsApp.
   */
  async dispatchWhatsAppMessage(
    workspaceId: string,
    userId: string | undefined,
    input: {
      leadId: string;
      contactId: string;
      messageText?: string;
      templateName?: string;
      isApproved?: boolean;
    }
  ): Promise<{ success: boolean; providerMessageId: string; status: string }> {
    // 1. Tenancy verification
    const lead = await leadRepository.findById(input.leadId, workspaceId);
    if (!lead) {
      throw new NotFoundError('Lead not found in this workspace');
    }

    const contact = await leadRepository.findContactById(input.contactId, input.leadId, workspaceId);
    if (!contact) {
      throw new NotFoundError('Contact not found or does not belong to specified Lead');
    }

    // 2. Explicit Human Approval Verification
    if (!input.isApproved) {
      throw new ForbiddenError('WhatsApp outbound message requires explicit human approval before dispatch');
    }

    // 3. Lead Qualification / Opt-Out check
    if (lead.status === 'OPT_OUT' || lead.status === 'DISQUALIFIED') {
      throw new ForbiddenError(`Lead status '${lead.status}' is not eligible for outbound WhatsApp communication`);
    }

    // 4. Phone presence & E.164 normalization
    const rawPhone = contact.phone || lead.phone;
    if (!rawPhone) {
      throw new BadRequestError('Recipient phone number is required for WhatsApp messaging');
    }

    let normalizedPhone = rawPhone.trim();
    if (!normalizedPhone.startsWith('+')) {
      normalizedPhone = '+' + normalizedPhone.replace(/\D/g, '');
    }

    // 5. Immediate Phone Suppression Check
    const isSuppressed = await this.suppressionRepo.isPhoneSuppressed(workspaceId, normalizedPhone);
    if (isSuppressed) {
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'outreach:whatsapp_blocked',
        entityType: 'Lead',
        entityId: input.leadId,
        metadata: { reason: 'Phone number is on workspace suppression list', phone: normalizedPhone },
      }).catch(() => {});
      throw new ForbiddenError(`Phone number ${normalizedPhone} is suppressed in this workspace`);
    }

    // 6. Kill Switch Check
    const isKillSwitchActive =
      process.env.KILL_SWITCH_ACTIVE === 'true' || process.env.KILL_SWITCH_ACTIVE === '1';
    if (isKillSwitchActive) {
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'outreach:whatsapp_blocked',
        entityType: 'Lead',
        entityId: input.leadId,
        metadata: { reason: 'Global Kill Switch is active' },
      }).catch(() => {});
      assertKillSwitchNotActive(true);
    }

    // 7. WhatsApp Provider Configured Check
    const whatsappAdapter =
      providerRegistry.getAdapter<StandardWhatsAppAdapter>('Meta WhatsApp Cloud API') ||
      new StandardWhatsAppAdapter({ dispatchEnabled: true });

    if (!whatsappAdapter.isConfigured()) {
      throw new BadRequestError('WhatsApp provider credentials are not configured');
    }

    // 8. Pre-dispatch Audit Log
    await this.auditLogger.create({
      workspaceId,
      userId,
      eventType: 'outreach:whatsapp_attempt',
      entityType: 'Lead',
      entityId: input.leadId,
      metadata: { phone: normalizedPhone, contactId: input.contactId },
    }).catch(() => {});

    // 9. Provider Dispatch Boundary
    try {
      const result = await whatsappAdapter.sendMessage({
        recipientPhoneNumber: normalizedPhone,
        messageText: input.messageText,
        templateName: input.templateName,
      });

      // 10. Record CRM Activity with provider message ID
      await crmActivityRepository.create(workspaceId, {
        leadId: input.leadId,
        userId,
        type: 'NOTE',
        description: `Outbound WhatsApp message sent to ${normalizedPhone}. Provider ID: ${result.providerMessageId}`,
        metadata: {
          channel: 'WHATSAPP',
          providerMessageId: result.providerMessageId,
          recipientPhone: normalizedPhone,
        },
      });

      // 11. Post-dispatch Audit Log
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'outreach:whatsapp_sent',
        entityType: 'Lead',
        entityId: input.leadId,
        metadata: { providerMessageId: result.providerMessageId, status: result.status },
      }).catch(() => {});

      return {
        success: true,
        providerMessageId: result.providerMessageId || 'wamid_sent',
        status: result.status,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'WhatsApp dispatch failed';
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'outreach:whatsapp_failed',
        entityType: 'Lead',
        entityId: input.leadId,
        metadata: { error: msg },
      }).catch(() => {});
      throw err;
    }
  }
}

export const outreachService = new OutreachService();
