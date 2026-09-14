# closeVDS System Architecture Specification

## 1. High-Level Architecture Topology

closeVDS follows a modular, server-authoritative architecture designed for reliability, scalability, security, and provider portability.

```text
┌─────────────────────────────────────────────────────────┐
│                     PRESENTATION LAYER                  │
│            Next.js / TypeScript / Tailwind CSS          │
│               (No secrets, Client State Only)           │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼ (HTTPS REST API / JSON)
┌─────────────────────────────────────────────────────────┐
│                     BACKEND API LAYER                   │
│               Node.js / Fastify / TypeScript            │
│         (Auth, Rate Limiting, Business Logic, Zod)      │
└──────┬──────────────────────┬────────────────────┬──────┘
       │                      │                    │
       ▼                      ▼                    ▼
┌──────────────┐      ┌──────────────┐     ┌──────────────┐
│ DATABASE     │      │ AI SERVICE   │     │ AUTOMATION   │
│ PostgreSQL   │      │ ABSTRACTION  │     │ n8n (Trigger)│
└──────────────┘      └──────┬───────┘     └──────────────┘
                             │
       ┌─────────────────────┼─────────────────────┐
       ▼                     ▼                     ▼
┌──────────────┐      ┌──────────────┐     ┌──────────────┐
│ LEAD SOURCE  │      │ EMAIL        │     │ OTHER        │
│ PROVIDERS    │      │ PROVIDERS    │     │ EXTERNAL APIS│
└──────────────┘      └──────────────┘     └──────────────┘
```

## 2. Core Architectural Rules

1. **Backend Authority**: The Node.js / Fastify backend API is the single authoritative source of truth for business logic, authentication, authorization, rate limiting, and state transitions.
2. **Secret Key Isolation**: Secret API keys (AI providers, email senders, lead sources, database credentials) live strictly in server environment variables and are **NEVER** exposed to the frontend browser bundle.
3. **Role of n8n**: n8n Community Edition is strictly an automation and scheduled cron trigger layer. n8n must **NEVER** act as the primary database source of truth, business logic authority, or direct writer to core entities without API authorization.
4. **Provider Abstraction**: All external vendor interactions (OpenAI/Anthropic/DeepSeek for AI, Resend/SendGrid/SMTP for Email, Google Maps/Apify for Leads) are wrapped in internal service interfaces so providers can be swapped seamlessly without refactoring core logic.

---

## 3. Conceptual Database Architecture & Entity Relationships

The database layer consists of **17 conceptual entities**. Database migrations are **not** created during Phase 0; this conceptual model establishes domain ownership and relationships for future implementation.

```mermaid
erDiagram
    Workspace ||--|{ User : "has members"
    Workspace ||--|{ Campaign : "owns"
    Workspace ||--|{ Suppression : "maintains"
    Workspace ||--|{ AuditLog : "records"
    
    Campaign ||--|{ Lead : "discovers"
    Campaign ||--|o EmailCampaign : "configures"
    
    Lead ||--|{ Contact : "contains (1:N)"
    Lead ||--o LeadSource : "sourced from"
    Lead ||--o WebsiteAudit : "audited by"
    Lead ||--o AIAnalysis : "analyzed by"
    Lead ||--o LeadScore : "scored by"
    Lead ||--|{ CRMActivity : "tracks"
    Lead ||--|{ Task : "has"
    
    Contact ||--|{ EmailMessage : "receives"
    EmailMessage ||--|{ EmailEvent : "triggers"
    
    User ||--|{ Task : "assigned to"
    User ||--|{ Notification : "notified by"
```

### Entity List & Ownership Breakdown (17 Entities)

1. **`User`**: System user account (belongs to a Workspace).
2. **`Workspace`**: Multi-tenant isolation boundary owning all campaigns, leads, and workspace configurations.
3. **`Campaign`**: Targeting configuration (niche, location, criteria, offer) belonging to a Workspace.
4. **`Lead`**: The target **business or organization entity** (e.g. "Smile Dental Care London").
5. **`Contact`**: An **individual person or decision-maker** associated with a Lead (e.g. "Dr. John Smith, Owner"). *Distinction: A Lead is the business entity; a Contact is an individual person at that business. A Lead may have 1 or more Contacts.*
6. **`LeadSource`**: Source tracking metadata (origin provider, API response reference, query parameters).
7. **`WebsiteAudit`**: Technical, UX, mobile, and CTA audit observations for a Lead's website domain.
8. **`AIAnalysis`**: Qualitative AI analysis, opportunity synthesis, and reasoning rationale.
9. **`LeadScore`**: Quantitative scoring metrics (Relevance 0-100, Opportunity 0-100, Total Lead Score).
10. **`EmailCampaign`**: Outreach configuration attached to a Campaign (sending schedules, daily caps).
11. **`EmailMessage`**: An individual draft, queued, or sent cold email addressed to a specific Contact.
12. **`EmailEvent`**: Dispatched delivery events (sent, delivered, bounce, open, reply, opt-out webhook).
13. **`CRMActivity`**: Timeline log of sales interactions, manual notes, stage transitions, and phone logs.
14. **`Task`**: Actionable to-do item for a Lead assigned to a User (e.g. "Follow up via phone").
15. **`Suppression`**: Opt-out, unsubscribed, or hard-bounced email address / domain suppression rule.
16. **`AuditLog`**: Security and operational audit log capturing user actions, API invocations, and config edits.
17. **`Notification`**: In-app alert notification dispatched to a User (e.g. "Positive reply received").

---

## 4. Conceptual API Endpoint Structure

The backend API exposes RESTful endpoints grouped into 10 explicit functional domains under `/api/v1/`:

1. **`/api/v1/auth`**: User login, session management, token refresh, workspace context switching.
2. **`/api/v1/campaigns`**: Campaign creation, configuration, pause/resume, list, and status endpoints.
3. **`/api/v1/leads`**: Lead listing, filtering, detail retrieval, manual lead entry, deduplication check.
4. **`/api/v1/qualification`**: Qualification rules configuration, re-qualification execution, scoring overrides.
5. **`/api/v1/audits`**: Website audit status, manual re-audit triggers, technical gap breakdown.
6. **`/api/v1/outreach`**: Outreach sequence configuration, daily limit controls, queue status, kill switch.
7. **`/api/v1/email`**: Message draft generation, manual review/edit, email send execution, webhook ingestion.
8. **`/api/v1/crm`**: CRM pipeline views, lead stage transitions, activity timeline, note management.
9. **`/api/v1/analytics`**: Dashboard metrics, conversion pipeline aggregates, CSV export reports.
10. **`/api/v1/settings`**: API key configuration (server-side), suppression list management, workspace settings.
