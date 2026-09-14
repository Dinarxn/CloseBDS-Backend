# closeVDS AI Architecture Specification

## 1. AI Responsibilities & Scope

AI in closeVDS is designed as an intelligent reasoning and generation layer that enhances human sales operations while operating within strict factuality, security, and cost boundaries.

```text
┌──────────────────────────────────────────────────────────┐
│                   AI SERVICE LAYER                       │
├──────────────────────────────────────────────────────────┤
│ 1. Lead Qualification & Scoring                          │
│ 2. Website Opportunity Analysis                          │
│ 3. Fact-Grounded Outreach Personalization                │
│ 4. Inbound Reply Classification                          │
└──────────────────────────────────────────────────────────┘
```

---

## 2. Core AI Responsibilities

### A. Lead Qualification & Opportunity Scoring
- Evaluate discovered business candidates against campaign qualification criteria.
- Calculate quantified scores (Relevance 0-100, Opportunity 0-100) and synthesize clear reasoning rationale.

### B. Website Opportunity Analysis
- Analyze observed website metadata and DOM structure to identify tangible business deficits (e.g. missing mobile optimization, absent booking links, poor CTA placement).

### C. Outreach Personalization
- Generate concise, non-templated cold email subject lines, opening hooks, and business observations based exclusively on verified lead facts.

### D. Inbound Reply Classification
- Classify incoming lead email responses into 6 discrete categories: `INTERESTED`, `QUESTION`, `OBJECTION`, `NOT_INTERESTED`, `OPT_OUT`, `UNCLEAR`.

---

## 3. Strict Anti-Hallucination Rules

1. **Fact Grounding Only**: Prompts must restrict models to referencing explicitly provided lead facts and audit observations.
2. **No Invented Reviews or Awards**: The AI must **NEVER** fabricate false customer reviews, non-existent awards, or fake testimonials.
3. **No Fabricated Services or Prices**: The AI must **NEVER** invent pricing details or service capabilities not defined in the user's campaign configuration.
4. **No False Audit Claims**: The AI must **NEVER** claim a technical audit or analysis was conducted if the website was unreachable or un-audited.
5. **Null Distinction**: Missing information must be treated as `unknown` rather than filled with hallucinated defaults.

---

## 4. Provider Abstraction Contract & Cost Control

### Provider Isolation Contract
AI interactions are isolated behind a TypeScript service contract (`AIService`), allowing model providers (OpenAI, Anthropic, DeepSeek, or local open-weight models) to be swapped via configuration:

```typescript
export interface AIService {
  qualifyLead(input: QualificationInput): Promise<QualificationResult>;
  analyzeWebsite(input: WebsiteInput): Promise<AuditResult>;
  personalizeOutreach(input: PersonalizationInput): Promise<EmailCopyResult>;
  classifyReply(input: ReplyInput): Promise<ReplyClassificationResult>;
}
```

### Cost Control & Token Optimization
- **Model Routing**: Use lightweight, cost-effective models (e.g., GPT-4o-mini / Claude 3 Haiku / DeepSeek-V3) for simple reply classification and initial scoring, reserving larger models strictly for complex analysis.
- **Prompt Caching & Deduplication**: Cache audit analyses and prevent redundant LLM invocations for identical leads.
- **Structured JSON Schema Output**: All model calls enforce strict JSON Schema mode output parsing to eliminate unparseable text responses and retry overhead.
- **Human Review Triggers**: High-impact messaging generation supports human review before high-volume automated dispatch.
