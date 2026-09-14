import type { AIService } from '../../integrations/ai/index.js';
import {
  LeadRepository,
  WebsiteAuditRepository,
  AuditRepository,
  leadRepository as defaultLeadRepo,
  websiteAuditRepository as defaultAuditRepo,
  auditRepository as defaultSecurityAuditRepo,
} from '../../database/repository.js';
import { NotFoundError, ValidationError } from '../../core/errors/api-error.js';
import { validateUrlForAudit } from '../../security/ssrf.guard.js';
import type { TriggerResearchInput, SaveAuditObservationInput } from './research.schema.js';
import type { WebsiteAudit } from '@prisma/client';

export interface ResearchExecutionResult {
  status: 'completed' | 'unavailable';
  message: string;
  audit?: WebsiteAudit;
}

export class ResearchDomainService {
  constructor(
    private aiService?: AIService,
    private leadRepo: LeadRepository = defaultLeadRepo,
    private websiteAuditRepo: WebsiteAuditRepository = defaultAuditRepo,
    private auditLogger: AuditRepository = defaultSecurityAuditRepo
  ) {}

  /**
   * Retrieves existing website audit for a lead.
   */
  async getAudit(leadId: string, workspaceId: string): Promise<WebsiteAudit> {
    const audit = await this.websiteAuditRepo.findByLeadId(leadId, workspaceId);
    if (!audit) {
      throw new NotFoundError('Website audit not found for this lead');
    }
    return audit;
  }

  /**
   * Executes research on a lead's website or records direct audit observations.
   */
  async executeResearch(
    leadId: string,
    workspaceId: string,
    userId: string | undefined,
    input: TriggerResearchInput
  ): Promise<ResearchExecutionResult> {
    // 1. Verify lead exists in active workspace
    const lead = await this.leadRepo.findById(leadId, workspaceId);
    if (!lead) {
      throw new NotFoundError('Lead not found or access denied for this workspace');
    }

    const targetDomain = input.domain || lead.domain || 'unknown-domain.com';

    // 2. Anti-SSRF validation on target domain
    const ssrfCheck = validateUrlForAudit(targetDomain);
    if (!ssrfCheck.safe && targetDomain !== 'unknown-domain.com') {
      throw new ValidationError(ssrfCheck.error || 'Target domain violates security network policy');
    }

    let auditData: SaveAuditObservationInput;

    if (input.manualObservations) {
      auditData = input.manualObservations;
    } else if (this.aiService) {
      const aiResult = await this.aiService.analyzeWebsite({
        domain: targetDomain,
        htmlSummary: input.htmlSnippet,
      });

      auditData = {
        domain: targetDomain,
        mobileOptimized: aiResult.mobileOptimized,
        bookingCtaVisible: aiResult.bookingCtaVisible,
        auditGaps: aiResult.identifiedGaps,
        rawAuditData: { summary: aiResult.summary },
      };
    } else {
      // Safe explicit unconfigured response when no live analyzer or observations are provided
      return {
        status: 'unavailable',
        message: 'Live website research provider is not configured in this environment',
      };
    }

    // 3. Persist WebsiteAudit
    const audit = await this.websiteAuditRepo.upsert(leadId, workspaceId, {
      domain: auditData.domain,
      mobileOptimized: auditData.mobileOptimized,
      bookingCtaVisible: auditData.bookingCtaVisible,
      auditGaps: auditData.auditGaps,
      rawAuditData: auditData.rawAuditData,
    });

    // 4. Record AuditLog
    try {
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'lead_research:completed',
        entityType: 'Lead',
        entityId: leadId,
        metadata: {
          domain: audit.domain,
          mobileOptimized: audit.mobileOptimized,
          bookingCtaVisible: audit.bookingCtaVisible,
          gapsCount: audit.auditGaps.length,
        },
      });
    } catch {
      // Non-blocking audit failure
    }

    return {
      status: 'completed',
      message: 'Website research audit completed and persisted',
      audit,
    };
  }
}

export const researchDomainService = new ResearchDomainService();
