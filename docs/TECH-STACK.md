# closeVDS Technical Stack Specification

## 1. Stack Overview & Strategy

The closeVDS technology stack is selected to provide maximum developer velocity, strict type safety, modular maintainability, and $0 initial infrastructure cost during development and low-volume MVP validation.

```text
┌─────────────────────────────────────────────────────────┐
│ FRONTEND: Next.js + TypeScript + Tailwind CSS           │
├─────────────────────────────────────────────────────────┤
│ BACKEND: Node.js + Fastify + TypeScript + Zod           │
├─────────────────────────────────────────────────────────┤
│ DATABASE: PostgreSQL (Portable ORM / SQL Driver)        │
├─────────────────────────────────────────────────────────┤
│ AUTOMATION: n8n Community Edition / Webhook Triggers    │
├─────────────────────────────────────────────────────────┤
│ ABSTRACTION LAYERS: AI, Email, Lead Sourcing            │
└─────────────────────────────────────────────────────────┘
```

## 2. Layer Specifications & Justification

### A. Frontend Layer
- **Framework**: Next.js (App Router, React)
- **Language**: TypeScript (Strict mode enabled)
- **Styling**: Vanilla CSS / Tailwind CSS (Monochrome token configuration)
- **State Management**: React Hooks / Server Actions / TanStack Query
- **Role**: Render responsive dashboard UI, display CRM pipeline, handle user interactions. **No backend secrets or provider keys are accessible to the frontend.**

### B. Backend API Layer
- **Runtime**: Node.js (LTS version)
- **Framework**: Fastify (High performance, low overhead, native TypeScript support)
- **Language**: TypeScript (Strict type safety across API contracts)
- **Schema Validation**: Zod (Runtime input validation for all API routes and webhooks)
- **Role**: Primary authority for business logic, database operations, security, rate limiting, provider API execution, and audit logging.

### C. Database Layer
- **Engine**: PostgreSQL
- **Data Access**: Portable SQL Query Builder / ORM (e.g. Kysely or Prisma)
- **Role**: Persistence of workspaces, campaigns, leads, contacts, scores, audits, outreach logs, and suppressions.
- **Portability**: Database access is fully decoupled from cloud host specifics.

### D. Automation Layer
- **Engine**: n8n (Community Edition / Self-hosted or Cloud runner)
- **Role**: Triggering scheduled batch jobs (e.g. daily lead discovery cron, follow-up delay checkers) and webhook routing.
- **Boundary Constraint**: n8n calls backend API REST endpoints with authentication tokens. n8n does **not** directly execute SQL queries against the primary database.

---

## 3. Provider Abstraction Contracts

To prevent vendor lock-in and enable seamless swapping between free/low-cost development providers and commercial enterprise providers, all external services are wrapped in TypeScript interface abstractions.

### A. AI Service Provider Contract (`AIService`)
```typescript
export interface AIService {
  qualifyLead(input: QualificationInput): Promise<QualificationResult>;
  analyzeWebsite(input: WebsiteInput): Promise<AuditResult>;
  personalizeOutreach(input: PersonalizationInput): Promise<EmailCopyResult>;
  classifyReply(input: ReplyInput): Promise<ReplyClassificationResult>;
}
```

### B. Email Service Provider Contract (`EmailService`)
```typescript
export interface EmailService {
  sendEmail(message: EmailMessagePayload): Promise<SendResult>;
  verifySenderDomain(domain: string): Promise<DomainStatus>;
  parseWebhookEvent(rawPayload: unknown): EmailEventPayload;
}
```

### C. Lead Discovery Provider Contract (`LeadDiscoveryService`)
```typescript
export interface LeadDiscoveryService {
  discoverCandidates(query: LeadDiscoveryQuery): Promise<RawLeadCandidate[]>;
  normalizeCandidate(raw: RawLeadCandidate): NormalizedLeadCandidate;
}
```

---

## 4. Environment Variables & Secret Isolation

All application credentials and secret API keys must be declared in `.env.example` and loaded strictly on the server side:

```text
# SERVER-SIDE ONLY (NEVER EXPOSE TO FRONTEND)
PORT=4000
DATABASE_URL=postgresql://user:password@localhost:5432/closevds
JWT_SECRET=server_super_secret_key
AI_PROVIDER_API_KEY=sk-server-only-ai-key
EMAIL_PROVIDER_API_KEY=re_server_only_email_key
LEAD_PROVIDER_API_KEY=server_only_lead_key
SUPPRESSION_ENCRYPTION_KEY=server_only_encryption_key
```
