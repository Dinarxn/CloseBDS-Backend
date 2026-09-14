import type { AIService } from '../../integrations/ai/index.js';
import {
  LeadRepository,
  LeadScoreRepository,
  AIAnalysisRepository,
  AuditRepository,
  leadRepository as defaultLeadRepo,
  leadScoreRepository as defaultScoreRepo,
  aiAnalysisRepository as defaultAnalysisRepo,
  auditRepository as defaultSecurityAuditRepo,
} from '../../database/repository.js';
import { NotFoundError } from '../../core/errors/api-error.js';
import type { QualifyLeadInput } from './qualification.schema.js';
import type { LeadScore, AIAnalysis, WebsiteAudit } from '@prisma/client';

export interface QualificationResponse {
  status: 'completed' | 'unavailable';
  message: string;
  leadScore?: LeadScore;
  aiAnalysis?: AIAnalysis;
  websiteAudit?: WebsiteAudit | null;
}

export class QualificationDomainService {
  constructor(
    private aiService?: AIService,
    private leadRepo: LeadRepository = defaultLeadRepo,
    private leadScoreRepo: LeadScoreRepository = defaultScoreRepo,
    private aiAnalysisRepo: AIAnalysisRepository = defaultAnalysisRepo,
    private auditLogger: AuditRepository = defaultSecurityAuditRepo
  ) {}

  /**
   * Retrieves existing qualification score and AI analysis for a lead.
   */
  async getQualification(leadId: string, workspaceId: string): Promise<QualificationResponse> {
    const lead = await this.leadRepo.findById(leadId, workspaceId);
    if (!lead) {
      throw new NotFoundError('Lead not found or access denied for this workspace');
    }

    const [leadScore, aiAnalysis] = await Promise.all([
      this.leadScoreRepo.findByLeadId(leadId, workspaceId),
      this.aiAnalysisRepo.findByLeadId(leadId, workspaceId),
    ]);

    return {
      status: 'completed',
      message: 'Qualification data retrieved',
      leadScore: leadScore || undefined,
      aiAnalysis: aiAnalysis || undefined,
      websiteAudit: lead.websiteAudit,
    };
  }

  /**
   * Qualifies a lead using anti-hallucination factual grounding or AI provider.
   */
  async qualifyLead(
    leadId: string,
    workspaceId: string,
    userId: string | undefined,
    input: QualifyLeadInput
  ): Promise<QualificationResponse> {
    // 1. Verify lead exists
    const lead = await this.leadRepo.findById(leadId, workspaceId);
    if (!lead) {
      throw new NotFoundError('Lead not found or access denied for this workspace');
    }

    let relevanceScore: number;
    let opportunityScore: number;
    let totalScore: number;
    let rationale: string;
    let summary: string;
    let opportunityPoints: string[];
    let riskFactors: string[];

    if (input.manualScoreOverride) {
      const override = input.manualScoreOverride;
      relevanceScore = Math.min(100, Math.max(0, Math.round(override.relevanceScore)));
      opportunityScore = Math.min(100, Math.max(0, Math.round(override.opportunityScore)));
      totalScore = Math.round((relevanceScore + opportunityScore) / 2);
      rationale = override.rationale;
      summary = override.summary;
      opportunityPoints = override.opportunityPoints;
      riskFactors = override.riskFactors;
    } else if (this.aiService) {
      const aiResult = await this.aiService.qualifyLead({
        leadId,
        businessName: lead.businessName,
        niche: 'Target Industry',
        location: lead.address || 'Target Market',
        websiteUrl: lead.domain || undefined,
        websiteObservations: lead.websiteAudit?.auditGaps || [],
        campaignCriteria: input.criteria,
      });

      relevanceScore = Math.min(100, Math.max(0, Math.round(aiResult.relevanceScore)));
      opportunityScore = Math.min(100, Math.max(0, Math.round(aiResult.opportunityScore)));
      totalScore = Math.min(100, Math.max(0, Math.round(aiResult.totalScore)));
      rationale = aiResult.reasoningRationale;
      summary = `AI Qualification Analysis for ${lead.businessName}. Outcome: ${
        aiResult.isQualified ? 'Qualified' : 'Disqualified'
      }`;
      opportunityPoints = lead.websiteAudit?.auditGaps || ['Identified optimization opportunity'];
      riskFactors = aiResult.isQualified ? [] : ['Low relevance against targeting criteria'];
    } else {
      // Safe explicit unconfigured response
      return {
        status: 'unavailable',
        message: 'Live AI qualification provider is not configured in this environment',
      };
    }

    // 2. Persist LeadScore and AIAnalysis
    const [savedScore, savedAnalysis] = await Promise.all([
      this.leadScoreRepo.upsert(leadId, workspaceId, {
        relevanceScore,
        opportunityScore,
        totalScore,
        rationale,
      }),
      this.aiAnalysisRepo.upsert(leadId, workspaceId, {
        summary,
        opportunityPoints,
        riskFactors,
      }),
    ]);

    // 3. Update Lead Status
    const isQualified = totalScore >= 60;
    await this.leadRepo.update(leadId, workspaceId, {
      status: isQualified ? 'QUALIFIED' : 'DISQUALIFIED',
    });

    // 4. Audit Log & n8n event dispatch
    try {
      await this.auditLogger.create({
        workspaceId,
        userId,
        eventType: 'lead_qualification:completed',
        entityType: 'Lead',
        entityId: leadId,
        metadata: {
          totalScore,
          relevanceScore,
          opportunityScore,
          isQualified,
        },
      });

      if (isQualified) {
        const { n8nService } = await import('../integrations/n8n/n8n.service.js');
        n8nService.dispatchOutboundWebhook(workspaceId, 'lead.qualified', {
          leadId,
          totalScore,
          isQualified,
        }).catch(() => {});
      }
    } catch {
      // Non-blocking audit failure
    }

    return {
      status: 'completed',
      message: `Lead qualification complete (Score: ${totalScore}/100)`,
      leadScore: savedScore,
      aiAnalysis: savedAnalysis,
      websiteAudit: lead.websiteAudit,
    };
  }
}

export const qualificationDomainService = new QualificationDomainService();
