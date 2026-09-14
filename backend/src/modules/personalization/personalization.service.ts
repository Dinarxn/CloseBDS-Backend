import type { AIService, EmailCopyResult } from '../../integrations/ai/index.js';
import {
  LeadRepository,
  AuditRepository,
  leadRepository as defaultLeadRepo,
  auditRepository as defaultSecurityAuditRepo,
} from '../../database/repository.js';
import { NotFoundError } from '../../core/errors/api-error.js';
import type { GeneratePersonalizationInput } from './personalization.schema.js';

export interface OutreachDraft {
  id: string;
  leadId: string;
  contactId?: string;
  recipientEmail?: string;
  subject: string;
  bodyText: string;
  openingHook?: string;
  factReferences: string[];
  status: 'DRAFT';
  humanApprovalRequired: true;
  isApproved: false;
  createdAt: Date;
}

export interface PersonalizationResponse {
  status: 'completed' | 'unavailable';
  message: string;
  draft?: OutreachDraft;
}

export class PersonalizationDomainService {
  constructor(
    private aiService?: AIService,
    private leadRepo: LeadRepository = defaultLeadRepo,
    private auditLogger: AuditRepository = defaultSecurityAuditRepo
  ) {}

  /**
   * Generates a personalized cold outreach draft strictly tied to verified lead data.
   * Enforces human approval boundary: status is always 'DRAFT', isApproved is false.
   */
  async generateOutreachDraft(
    leadId: string,
    workspaceId: string,
    userId: string | undefined,
    input: GeneratePersonalizationInput
  ): Promise<PersonalizationResponse> {
    // 1. Fetch lead with contacts and audit
    const lead = await this.leadRepo.findById(leadId, workspaceId);
    if (!lead) {
      throw new NotFoundError('Lead not found or access denied for this workspace');
    }

    // Determine target contact
    const contact = input.contactId
      ? lead.contacts.find((c) => c.id === input.contactId)
      : lead.contacts.find((c) => c.isPrimary) || lead.contacts[0];

    const contactName = contact?.fullName;
    const recipientEmail = contact?.email;
    const auditGaps = lead.websiteAudit?.auditGaps || [];
    const offer = input.targetOffer || 'Complimentary Technical Booking Audit';

    let copyResult: EmailCopyResult;

    if (input.manualCopyOverride) {
      copyResult = input.manualCopyOverride;
    } else if (this.aiService) {
      copyResult = await this.aiService.personalizeOutreach({
        leadId,
        businessName: lead.businessName,
        contactName,
        auditGaps,
        targetOffer: offer,
      });
    } else {
      // Safe explicit unconfigured response
      return {
        status: 'unavailable',
        message: 'Live AI personalization provider is not configured in this environment',
      };
    }

    // Create draft representation with mandatory human approval guardrails
    const draft: OutreachDraft = {
      id: `draft_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      leadId,
      contactId: contact?.id,
      recipientEmail,
      subject: copyResult.subjectLine,
      bodyText: copyResult.bodyText,
      openingHook: copyResult.openingHook,
      factReferences: copyResult.factReferences,
      status: 'DRAFT',
      humanApprovalRequired: true,
      isApproved: false,
      createdAt: new Date(),
    };

    // Record AuditLog
    try {
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'outreach_draft:generated',
        entityType: 'Lead',
        entityId: leadId,
        metadata: {
          draftId: draft.id,
          recipientEmail: draft.recipientEmail,
          humanApprovalRequired: true,
          status: 'DRAFT',
        },
      });
    } catch {
      // Non-blocking audit failure
    }

    return {
      status: 'completed',
      message: 'Personalized outreach draft prepared. Explicit human approval is required prior to dispatch.',
      draft,
    };
  }
}

export const personalizationDomainService = new PersonalizationDomainService();
