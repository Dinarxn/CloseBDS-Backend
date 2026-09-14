import { z } from 'zod';
import type { LeadAgentState } from '../state/lead-agent.state.js';
import { testGeminiConnection } from '../../integrations/ai/gemini.client.js';
import { databaseClient } from '../../database/client.js';

export const LeadContextSchema = z.object({
  leadId: z.string().min(1),
  workspaceId: z.string().min(1),
  businessName: z.string().min(1),
  domain: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  status: z.string().min(1),
  contactName: z.string().nullable().optional(),
  contactTitle: z.string().nullable().optional(),
});

export type LeadContext = z.infer<typeof LeadContextSchema>;

export const AiResultSchema = z.object({
  summary: z.string().min(1),
  intent: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export type AiResult = z.infer<typeof AiResultSchema>;

export const QualificationSchema = z.object({
  qualified: z.boolean(),
  reason: z.string().min(1),
  score: z.number().min(0).max(100),
});

export type Qualification = z.infer<typeof QualificationSchema>;

/**
 * Step 10: Deterministic node that loads read-only lead context from backend database.
 * Enforces server-authoritative workspace isolation.
 * Performs zero database mutations.
 */
export async function loadLeadContext(state: LeadAgentState): Promise<Partial<LeadAgentState>> {
  try {
    const leadId = state.leadId?.trim();
    const workspaceId = state.workspaceId?.trim();

    if (!leadId) {
      return {
        status: 'failed',
        currentStep: 'lead_context_failed',
        error: 'Cannot load lead context: leadId is missing',
      };
    }

    if (!workspaceId) {
      return {
        status: 'failed',
        currentStep: 'lead_context_failed',
        error: 'Cannot load lead context: workspaceId is missing',
      };
    }

    const prisma = databaseClient.getPrismaClient();

    // Read lead and associated contacts (read-only query)
    const rawLead = await prisma.lead.findFirst({
      where: { id: leadId },
      include: { contacts: true },
    });

    if (!rawLead) {
      return {
        status: 'failed',
        currentStep: 'lead_context_failed',
        error: `Cannot load lead context: Lead '${leadId}' not found`,
      };
    }

    // Enforce multi-tenant workspace ownership
    if (rawLead.workspaceId !== workspaceId) {
      return {
        status: 'failed',
        currentStep: 'lead_context_failed',
        error: `Cannot load lead context: Workspace mismatch - lead does not belong to authorized workspace '${workspaceId}'`,
      };
    }

    // Extract primary contact details if available
    const contacts = (rawLead as any).contacts || [];
    const primaryContact = contacts.find((c: any) => c.isPrimary) || contacts[0];

    const leadContext: LeadContext = LeadContextSchema.parse({
      leadId: rawLead.id,
      workspaceId: rawLead.workspaceId,
      businessName: rawLead.businessName,
      domain: rawLead.domain ?? null,
      phone: rawLead.phone ?? null,
      address: rawLead.address ?? null,
      status: rawLead.status,
      contactName: primaryContact?.fullName ?? null,
      contactTitle: primaryContact?.title ?? null,
    });

    return {
      status: 'completed',
      currentStep: 'lead_context_loaded',
      leadContext,
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      status: 'failed',
      currentStep: 'lead_context_failed',
      error: `Failed to load lead context: ${errorMessage}`,
    };
  }
}

/**
 * Step 11: AI Research node that queries Gemini to analyze the normalized lead context.
 * Performs analysis ONLY — no outreach, no calls, no emails, no CRM modifications.
 */
export async function runGeminiAgent(state: LeadAgentState): Promise<Partial<LeadAgentState>> {
  // Short-circuit if prior step failed
  if (state.status === 'failed') {
    return {
      status: 'failed',
      currentStep: state.currentStep,
      error: state.error,
    };
  }

  if (!state.leadContext) {
    return {
      status: 'failed',
      currentStep: 'gemini_agent_failed',
      error: 'Cannot run Gemini agent: leadContext is missing',
    };
  }

  try {
    const lead = state.leadContext;
    const prompt = `You are a B2B lead research analyst.
Analyze the following lead context for research insights and opportunity evaluation.
Analyze ONLY the supplied information. Do NOT invent or fabricate facts.

Lead Context:
- Business Name: ${lead.businessName}
- Domain / Website: ${lead.domain || 'Not provided'}
- Phone: ${lead.phone || 'Not provided'}
- Address: ${lead.address || 'Not provided'}
- Current Status: ${lead.status}
- Contact Person: ${lead.contactName || 'Not provided'} (${lead.contactTitle || 'Title not provided'})

Instructions:
- Provide a concise research summary of the lead based strictly on the provided context.
- Assess business intent / opportunity fit (e.g. "high_fit", "medium_fit", "unclear", "low_fit").
- Provide a confidence score between 0.00 and 1.00 indicating confidence in this lead's suitability and information completeness.
- Do NOT contact the lead, send messages, make calls, generate outreach, or modify CRM.
- Return valid JSON only matching the schema below. No Markdown code fences, no surrounding commentary.

Required JSON Structure:
{
  "summary": "concise research summary",
  "intent": "assessed business fit",
  "confidence": 0.85
}`;

    const response = await testGeminiConnection(prompt);

    // Strip markdown code fences if model enclosed JSON
    const cleanJson = response.text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsedJson = JSON.parse(cleanJson);
    const validatedResult = AiResultSchema.parse(parsedJson);

    return {
      status: 'completed',
      currentStep: 'gemini_agent_completed',
      message: validatedResult.summary,
      aiResult: validatedResult,
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown Gemini structured output error';
    return {
      status: 'failed',
      currentStep: 'gemini_agent_failed',
      error: `Structured AI validation failed: ${errorMessage}`,
    };
  }
}

/**
 * Deterministic qualification node that evaluates the existing state.aiResult confidence.
 * Threshold: confidence >= 0.70 -> qualified = true, score = Math.round(confidence * 100).
 * Does not make any external, database, or LLM calls.
 */
export async function qualifyLead(state: LeadAgentState): Promise<Partial<LeadAgentState>> {
  if (state.status === 'failed') {
    return {
      status: 'failed',
      currentStep: state.currentStep,
      error: state.error,
    };
  }

  if (!state.aiResult) {
    return {
      status: 'failed',
      currentStep: 'qualification_failed',
      error: 'Cannot qualify lead: aiResult is missing',
    };
  }

  const confidence = state.aiResult.confidence;
  const score = Math.round(confidence * 100);
  const qualified = confidence >= 0.70;
  const reason = qualified
    ? 'AI confidence meets the qualification threshold.'
    : 'AI confidence is below the qualification threshold.';

  const qualificationData: Qualification = QualificationSchema.parse({
    qualified,
    reason,
    score,
  });

  return {
    status: 'completed',
    currentStep: 'qualification_completed',
    qualification: qualificationData,
  };
}

/**
 * Deterministic guard node that verifies internal consistency of aiResult and qualification.
 * Reuses existing Zod schemas and performs cross-field consistency validation.
 * Does not make any LLM, database, or network calls.
 */
export async function validateAIDecision(state: LeadAgentState): Promise<Partial<LeadAgentState>> {
  if (state.status === 'failed') {
    return {
      status: 'failed',
      currentStep: state.currentStep,
      error: state.error,
    };
  }

  if (!state.aiResult) {
    return {
      status: 'failed',
      currentStep: 'ai_decision_validation_failed',
      error: 'Cannot validate AI decision: aiResult is missing',
    };
  }

  if (!state.qualification) {
    return {
      status: 'failed',
      currentStep: 'ai_decision_validation_failed',
      error: 'Cannot validate AI decision: qualification is missing',
    };
  }

  // Validate structural integrity using existing schemas
  try {
    AiResultSchema.parse(state.aiResult);
    QualificationSchema.parse(state.qualification);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      status: 'failed',
      currentStep: 'ai_decision_validation_failed',
      error: `AI decision validation failed schema check: ${errorMsg}`,
    };
  }

  // Cross-field consistency checks
  const expectedScore = Math.round(state.aiResult.confidence * 100);
  if (state.qualification.score !== expectedScore) {
    return {
      status: 'failed',
      currentStep: 'ai_decision_validation_failed',
      error: `AI decision validation failed: qualification score (${state.qualification.score}) is inconsistent with confidence score (${expectedScore})`,
    };
  }

  const expectedQualified = state.aiResult.confidence >= 0.70;
  if (state.qualification.qualified !== expectedQualified) {
    return {
      status: 'failed',
      currentStep: 'ai_decision_validation_failed',
      error: `AI decision validation failed: qualification status (${state.qualification.qualified}) is inconsistent with confidence threshold (${expectedQualified})`,
    };
  }

  return {
    status: 'completed',
    currentStep: 'ai_decision_validated',
  };
}

export const PersonalizedMessageSchema = z.object({
  subject: z.string().optional(),
  body: z.string().min(1),
});

export type PersonalizedMessage = z.infer<typeof PersonalizedMessageSchema>;

export const QualityCheckSchema = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(100),
  issues: z.array(z.string()),
});

export type QualityCheck = z.infer<typeof QualityCheckSchema>;

/**
 * Step 12: Generates a grounded, personalized B2B outreach draft based strictly on leadContext.
 * Conditioned on qualification.qualified === true; skipped safely if unqualified.
 * Produces a DRAFT ONLY — zero outbound messaging or external actions.
 */
export async function generatePersonalizedMessage(state: LeadAgentState): Promise<Partial<LeadAgentState>> {
  if (state.status === 'failed') {
    return {
      status: 'failed',
      currentStep: state.currentStep,
      error: state.error,
    };
  }

  if (!state.qualification) {
    return {
      status: 'failed',
      currentStep: 'message_generation_failed',
      error: 'Cannot generate personalized message: qualification is missing',
    };
  }

  // Safe skip if lead is not qualified
  if (state.qualification.qualified !== true) {
    return {
      currentStep: 'message_generation_skipped',
      message: 'Message generation skipped: lead is not qualified',
    };
  }

  if (!state.leadContext) {
    return {
      status: 'failed',
      currentStep: 'message_generation_failed',
      error: 'Cannot generate personalized message: leadContext is missing',
    };
  }

  try {
    const lead = state.leadContext;
    const prompt = `You are a professional B2B outreach copywriter.
Generate a concise, personalized outreach draft based strictly on the provided lead context and AI research insights.
This message is strictly an internal draft.

Lead Context:
- Business Name: ${lead.businessName}
- Domain: ${lead.domain || 'Not provided'}
- Phone: ${lead.phone || 'Not provided'}
- Address: ${lead.address || 'Not provided'}
- Contact Person: ${lead.contactName || 'Not provided'} (${lead.contactTitle || 'Title not provided'})
- Status: ${lead.status}
- Research Summary: ${state.aiResult?.summary || 'Not provided'}
- Assessed Fit: ${state.aiResult?.intent || 'Not provided'}

Strict Writing Guidelines:
- Ground the message ONLY in the supplied lead context.
- Do NOT invent facts, pain points, metrics, customer results, or technologies.
- Do NOT claim prior contact, previous conversations, or that someone requested outreach.
- Do NOT claim extensive research was done beyond what is given.
- If a detail is missing, write a natural generic professional sentence instead.
- Include a simple, polite call-to-action (e.g. asking for a brief intro call or conversation).
- Keep it concise (under 120 words).
- Return valid JSON only with structure below. No Markdown code fences, no surrounding commentary.

Required JSON Structure:
{
  "subject": "quick concise subject line (optional)",
  "body": "Hi [Name or Team], I noticed..."
}`;

    const response = await testGeminiConnection(prompt);

    const cleanJson = response.text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsedJson = JSON.parse(cleanJson);
    const validatedMessage = PersonalizedMessageSchema.parse(parsedJson);

    return {
      currentStep: 'message_generated',
      personalizedMessage: validatedMessage,
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown message generation error';
    return {
      status: 'failed',
      currentStep: 'message_generation_failed',
      error: `Personalized message generation failed: ${errorMessage}`,
    };
  }
}

/**
 * Step 13: Deterministic & AI Quality Control node that audits the generated outreach draft.
 * Verifies grounding, truthfulness, tone, CTA, and security (no credential/secret leaks).
 * Does NOT auto-rewrite or retry on failure.
 */
export async function qualityCheckMessage(state: LeadAgentState): Promise<Partial<LeadAgentState>> {
  if (state.status === 'failed') {
    return {
      status: 'failed',
      currentStep: state.currentStep,
      error: state.error,
    };
  }

  // Safe skip if message generation was skipped (e.g. unqualified lead)
  if (state.currentStep === 'message_generation_skipped' || state.qualification?.qualified === false) {
    return {
      currentStep: 'quality_check_skipped',
    };
  }

  if (!state.personalizedMessage) {
    return {
      status: 'failed',
      currentStep: 'quality_check_failed',
      error: 'Cannot perform quality check: personalizedMessage is missing',
    };
  }

  // Deterministic checks
  const body = state.personalizedMessage.body?.trim();
  if (!body) {
    return {
      status: 'failed',
      currentStep: 'quality_check_failed',
      error: 'Cannot perform quality check: message body is empty',
    };
  }

  // Security pattern check for leaked secrets
  const sensitivePatterns = [
    /api[_-]?key/i,
    /bearer\s+[a-z0-9_\-\.]+/i,
    /sk-[a-z0-9]{20,}/i,
    /AIza[0-9A-Za-z-_]{35}/i,
  ];
  for (const pattern of sensitivePatterns) {
    if (pattern.test(body)) {
      const securityIssue: QualityCheck = {
        passed: false,
        score: 0,
        issues: ['Security violation: Message contains potential sensitive credential or API key'],
      };
      return {
        status: 'failed',
        currentStep: 'quality_check_failed',
        qualityCheck: securityIssue,
        error: 'AI quality check failed: security credential detected in draft',
      };
    }
  }

  try {
    const lead = state.leadContext;
    const prompt = `You are a strict quality control auditor for B2B outreach communications.
Audit the following outreach message draft against the supplied verified lead context.

Verified Lead Context:
- Business Name: ${lead?.businessName || 'Unknown'}
- Contact Person: ${lead?.contactName || 'Not provided'}
- Contact Title: ${lead?.contactTitle || 'Not provided'}
- Domain / Website: ${lead?.domain || 'Not provided'}
- Address / Location: ${lead?.address || 'Not provided'}
- Phone: ${lead?.phone || 'Not provided'}
- Status: ${lead?.status || 'Unknown'}

Outreach Draft:
${state.personalizedMessage.body}

Audit Criteria:
1. Grounding: Is the message grounded in the provided lead context? Verify that any mentioned business name, person name, title, or location matches the verified lead context above. Does it avoid fabricated claims or unverified metrics?
2. Truthfulness: Does it avoid pretending prior contact, previous conversations, or referrals that never happened?
3. Professionalism & Clarity: Is the tone professional, polite, and free of inappropriate content?
4. Call to Action: Does it contain a simple, reasonable call to action?
5. Conciseness: Is it reasonably concise and suitable for B2B outreach?

Scoring:
- Assign a score between 0 and 100.
- If score >= 70 and no major truthfulness/fabrication violations, passed = true.
- If score < 70 or violations exist, passed = false.
- List any specific issues found in the "issues" array (empty array if none).
- Return valid JSON only matching the schema below. No Markdown code fences, no commentary.

Required JSON Structure:
{
  "passed": true,
  "score": 90,
  "issues": []
}`;

    const response = await testGeminiConnection(prompt);

    const cleanJson = response.text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsedJson = JSON.parse(cleanJson);
    const qcResult = QualityCheckSchema.parse(parsedJson);

    if (!qcResult.passed) {
      return {
        status: 'failed',
        currentStep: 'quality_check_failed',
        qualityCheck: qcResult,
        error: `AI quality check failed: ${qcResult.issues.join('; ')}`,
      };
    }

    return {
      status: 'completed',
      currentStep: 'quality_check_passed',
      qualityCheck: qcResult,
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown quality check error';
    return {
      status: 'failed',
      currentStep: 'quality_check_failed',
      error: `AI quality check validation failed: ${errorMessage}`,
    };
  }
}

export const HumanApprovalSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']),
  approvedBy: z.string().optional(),
  approvedAt: z.string().optional(),
  reason: z.string().optional(),
});

export type HumanApproval = z.infer<typeof HumanApprovalSchema>;

/**
 * Step 14: Human Approval / Permission Gate.
 * Inspects human approval state for outreach drafts.
 * AI cannot authorize its own communication.
 * QC_PASSED != HUMAN_APPROVED.
 * QUALIFIED != HUMAN_APPROVED.
 * Performs ZERO LLM calls, ZERO database mutations, and ZERO outbound actions.
 */
export async function humanApprovalGate(state: LeadAgentState): Promise<Partial<LeadAgentState>> {
  // Critical Safety Rule 1: Failed QC or workflow failure cannot be bypassed by approval!
  if (state.status === 'failed' || (state.qualityCheck && state.qualityCheck.passed === false)) {
    return {
      status: 'failed',
      currentStep: 'human_approval_blocked_by_qc',
      error: state.error || 'Human approval blocked: quality check failed or workflow is in failed status',
    };
  }

  // Critical Rule 2: Unqualified lead skips approval (does not invent approval requirement for non-drafted lead)
  if (state.qualification && state.qualification.qualified === false) {
    return {
      currentStep: 'human_approval_skipped',
    };
  }

  // If no draft message exists, skip approval
  if (!state.personalizedMessage) {
    return {
      currentStep: 'human_approval_skipped',
    };
  }

  const approval = state.approval;

  // Case: Explicit human approval granted
  if (approval?.status === 'approved') {
    return {
      status: 'completed',
      currentStep: 'human_approval_granted',
      approval: {
        status: 'approved',
        approvedBy: approval.approvedBy,
        approvedAt: approval.approvedAt || new Date().toISOString(),
        reason: approval.reason,
      },
    };
  }

  // Case: Explicit human rejection
  if (approval?.status === 'rejected') {
    return {
      status: 'rejected',
      currentStep: 'human_approval_rejected',
      approval: {
        status: 'rejected',
        reason: approval.reason,
        approvedBy: approval.approvedBy,
        approvedAt: approval.approvedAt,
      },
    };
  }

  // Safe Default: Pending approval or missing approval
  // approval.status === 'pending' or missing means NO permission to send
  return {
    status: 'awaiting_approval',
    currentStep: 'human_approval_pending',
    approval: approval || { status: 'pending' },
  };
}

