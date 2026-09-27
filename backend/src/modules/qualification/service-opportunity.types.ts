/**
 * Service Opportunity & Service Recommendation Domain Types
 * Matching closeVDS Phase 1 Business Behavior Requirements
 */

export type ServiceOpportunityType = 'YES' | 'NONE';

export type RecommendedService =
  | 'Website Design / Development'
  | 'AI Automation'
  | 'Customer Acquisition System'
  | 'NONE';

export interface ServiceRecommendation {
  hasOpportunity: boolean;
  serviceOpportunity: ServiceOpportunityType;
  recommendedService: RecommendedService;
  reason: string;
  evidence: string;
}

export interface ServiceOpportunityInput {
  domain?: string | null;
  hasWebsite?: boolean;
  websiteAudit?: {
    mobileOptimized?: boolean;
    bookingCtaVisible?: boolean;
    auditGaps?: string[];
    rawAuditData?: Record<string, unknown> | null;
  } | null;
  aiAnalysis?: {
    summary?: string;
    opportunityPoints?: string[];
    riskFactors?: string[];
  } | null;
  leadScore?: {
    rationale?: string;
  } | null;
  observations?: string[];
  workflowEvidence?: string[];
  acquisitionEvidence?: string[];
}
