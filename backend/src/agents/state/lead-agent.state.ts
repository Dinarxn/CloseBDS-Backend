import { Annotation } from '@langchain/langgraph';

export interface LeadContext {
  leadId: string;
  workspaceId: string;
  businessName: string;
  domain?: string | null;
  phone?: string | null;
  address?: string | null;
  status: string;
  contactName?: string | null;
  contactTitle?: string | null;
}

export interface AiResult {
  summary: string;
  intent: string;
  confidence: number;
}

export interface Qualification {
  qualified: boolean;
  reason: string;
  score: number;
}

export interface PersonalizedMessage {
  subject?: string;
  body: string;
}

export interface QualityCheck {
  passed: boolean;
  score: number;
  issues: string[];
}

export interface HumanApproval {
  status: 'pending' | 'approved' | 'rejected';
  approvedBy?: string;
  approvedAt?: string;
  reason?: string;
}

export const LeadAgentAnnotation = Annotation.Root({
  message: Annotation<string>,
  status: Annotation<string>,
  leadId: Annotation<string | undefined>,
  workspaceId: Annotation<string | undefined>,
  currentStep: Annotation<string>,
  error: Annotation<string | undefined>,
  leadContext: Annotation<LeadContext | undefined>,
  aiResult: Annotation<AiResult | undefined>,
  qualification: Annotation<Qualification | undefined>,
  personalizedMessage: Annotation<PersonalizedMessage | undefined>,
  qualityCheck: Annotation<QualityCheck | undefined>,
  approval: Annotation<HumanApproval | undefined>,
});

export type LeadAgentState = typeof LeadAgentAnnotation.State;
