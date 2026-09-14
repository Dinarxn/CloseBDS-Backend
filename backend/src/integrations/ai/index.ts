/**
 * AI Provider Types & Contract matching Phase 0 TECH-STACK.md & AI-ARCHITECTURE.md
 */

export interface QualificationInput {
  leadId: string;
  businessName: string;
  niche: string;
  location: string;
  websiteUrl?: string;
  websiteObservations?: string[];
  campaignCriteria: string[];
}

export interface QualificationResult {
  relevanceScore: number; // 0-100
  opportunityScore: number; // 0-100
  totalScore: number; // 0-100
  isQualified: boolean;
  reasoningRationale: string;
}

export interface WebsiteInput {
  domain: string;
  htmlSummary?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditResult {
  mobileOptimized: boolean;
  bookingCtaVisible: boolean;
  identifiedGaps: string[];
  summary: string;
}

export interface PersonalizationInput {
  leadId: string;
  businessName: string;
  contactName?: string;
  auditGaps: string[];
  targetOffer: string;
}

export interface EmailCopyResult {
  subjectLine: string;
  openingHook: string;
  bodyText: string;
  factReferences: string[];
}

export type ReplyCategory =
  | 'INTERESTED'
  | 'QUESTION'
  | 'OBJECTION'
  | 'NOT_INTERESTED'
  | 'OPT_OUT'
  | 'UNCLEAR';

export interface ReplyInput {
  inboundMessageText: string;
  previousOutreachContext?: string;
}

export interface ReplyClassificationResult {
  category: ReplyCategory;
  confidence: number;
  extractedReason?: string;
}

/**
 * AI Service Provider Abstraction Contract
 * Decouples system from specific AI models (Gemini, Groq, OpenRouter, etc.)
 */
export interface AIService {
  qualifyLead(input: QualificationInput): Promise<QualificationResult>;
  analyzeWebsite(input: WebsiteInput): Promise<AuditResult>;
  personalizeOutreach(input: PersonalizationInput): Promise<EmailCopyResult>;
  classifyReply(input: ReplyInput): Promise<ReplyClassificationResult>;
}
