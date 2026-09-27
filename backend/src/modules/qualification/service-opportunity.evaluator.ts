import type {
  ServiceOpportunityInput,
  ServiceRecommendation,
} from './service-opportunity.types.js';

// Specific patterns indicating concrete manual/repetitive operational workflows
const CONCRETE_AUTOMATION_PATTERNS: RegExp[] = [
  /manual\s+appointment\s+follow[- ]?up/i,
  /manual\s+customer\s+inquiry\s+handling/i,
  /repetitive\s+lead\s+handling/i,
  /manual\s+booking\s+workflow/i,
  /repetitive\s+data\s+entry/i,
  /manual\s+follow[- ]?up\s+process/i,
  /clearly\s+documented\s+repetitive\s+operational\s+task/i,
  /manual\s+patient\s+intake/i,
  /spreadsheet[- ]based\s+tracking/i,
  /paper[- ]based\s+booking/i,
  /repetitive\s+confirmation\s+calls/i,
  /manual\s+quote\s+generation/i,
  /repetitive\s+scheduling\s+bottleneck/i,
  /manual\s+dispatch\s+workflow/i,
];

// Specific patterns indicating concrete customer acquisition / lead generation deficits
const CONCRETE_ACQUISITION_PATTERNS: RegExp[] = [
  /customer\s+acquisition\s+problem/i,
  /lead\s+generation\s+problem/i,
  /low\s+customer\s+inquiry\s+volume/i,
  /struggling\s+to\s+acquire\s+new\s+(clients|patients|customers)/i,
  /no\s+consistent\s+lead\s+generation\s+channel/i,
  /high\s+customer\s+churn\s+with\s+low\s+inbound\s+pipeline/i,
  /missing\s+customer\s+acquisition\s+system/i,
  /lack\s+of\s+predictable\s+(patient|client|customer)\s+acquisition/i,
  /empty\s+appointment\s+calendar/i,
  /no\s+active\s+customer\s+acquisition/i,
  /inbound\s+lead\s+flow\s+stagnant/i,
];

// Generic / vague phrases that must NOT trigger a positive recommendation
const GENERIC_EXCLUSION_PATTERNS: RegExp[] = [
  /^business exists$/i,
  /^growing company$/i,
  /^potential for technology$/i,
  /^could be improved$/i,
  /^good business$/i,
  /^high rating$/i,
  /^standard local business$/i,
  /^general business$/i,
  /^active business$/i,
  /^technology opportunity$/i,
  /^possible automation$/i,
];

/**
 * Checks whether the candidate has a verified, legitimate business domain.
 */
function hasVerifiedWebsite(input: ServiceOpportunityInput): boolean {
  if (input.hasWebsite === false) {
    return false;
  }

  const domain = input.domain?.trim().toLowerCase();
  if (!domain || domain.length === 0) {
    return false;
  }

  // Known placeholders indicating absence of real website
  const invalidPlaceholders = [
    'unknown-domain.com',
    'none',
    'null',
    'n/a',
    'no-website',
    'no-website.com',
    'undefined',
    'false',
  ];

  if (invalidPlaceholders.includes(domain)) {
    return false;
  }

  return true;
}

/**
 * Collects all observational strings from input sources.
 */
function collectObservations(input: ServiceOpportunityInput): string[] {
  const items: string[] = [];

  if (input.workflowEvidence) {
    items.push(...input.workflowEvidence);
  }
  if (input.acquisitionEvidence) {
    items.push(...input.acquisitionEvidence);
  }
  if (input.observations) {
    items.push(...input.observations);
  }
  if (input.websiteAudit?.auditGaps) {
    items.push(...input.websiteAudit.auditGaps);
  }
  if (input.aiAnalysis?.opportunityPoints) {
    items.push(...input.aiAnalysis.opportunityPoints);
  }
  if (input.aiAnalysis?.summary) {
    items.push(input.aiAnalysis.summary);
  }
  if (input.leadScore?.rationale) {
    items.push(input.leadScore.rationale);
  }

  return items.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Filters out generic or weak text that does not constitute concrete evidence.
 */
function isGenericOrWeak(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 5) return true;

  for (const pattern of GENERIC_EXCLUSION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }

  return false;
}

/**
 * Pure deterministic evaluator for closeVDS Lead Service Opportunities.
 * Enforces Rules 1 through 5 with zero external dependencies and zero side effects.
 */
export function evaluateServiceOpportunity(input: ServiceOpportunityInput): ServiceRecommendation {
  const verifiedWebsite = hasVerifiedWebsite(input);

  // --------------------------------------------------------------------------
  // RULE 1 — NO WEBSITE
  // --------------------------------------------------------------------------
  if (!verifiedWebsite) {
    return {
      hasOpportunity: true,
      serviceOpportunity: 'YES',
      recommendedService: 'Website Design / Development',
      reason: 'No business website found.',
      evidence: 'No business website found.',
    };
  }

  const allObservations = collectObservations(input);

  // --------------------------------------------------------------------------
  // RULE 2 — CONCRETE AUTOMATION OPPORTUNITY
  // --------------------------------------------------------------------------
  for (const obs of allObservations) {
    if (isGenericOrWeak(obs)) {
      continue;
    }

    for (const pattern of CONCRETE_AUTOMATION_PATTERNS) {
      if (pattern.test(obs)) {
        return {
          hasOpportunity: true,
          serviceOpportunity: 'YES',
          recommendedService: 'AI Automation',
          reason: `Concrete operational workflow bottleneck identified: ${obs}`,
          evidence: obs,
        };
      }
    }
  }

  // --------------------------------------------------------------------------
  // RULE 3 — CUSTOMER ACQUISITION OPPORTUNITY
  // --------------------------------------------------------------------------
  for (const obs of allObservations) {
    if (isGenericOrWeak(obs)) {
      continue;
    }

    for (const pattern of CONCRETE_ACQUISITION_PATTERNS) {
      if (pattern.test(obs)) {
        return {
          hasOpportunity: true,
          serviceOpportunity: 'YES',
          recommendedService: 'Customer Acquisition System',
          reason: `Concrete customer acquisition deficit identified: ${obs}`,
          evidence: obs,
        };
      }
    }
  }

  // --------------------------------------------------------------------------
  // RULE 5 — FUNCTIONING WEBSITE / NO OTHER OPPORTUNITY
  // --------------------------------------------------------------------------
  if (verifiedWebsite && allObservations.length > 0) {
    return {
      hasOpportunity: false,
      serviceOpportunity: 'NONE',
      recommendedService: 'NONE',
      reason: 'Functioning website present and no concrete operational bottlenecks or acquisition deficits detected.',
      evidence: 'Website verified active; no operational or acquisition bottleneck evidence identified.',
    };
  }

  // --------------------------------------------------------------------------
  // RULE 4 — INSUFFICIENT EVIDENCE
  // --------------------------------------------------------------------------
  return {
    hasOpportunity: false,
    serviceOpportunity: 'NONE',
    recommendedService: 'NONE',
    reason: 'Not enough evidence for a specific service opportunity.',
    evidence: 'Insufficient evidence.',
  };
}
