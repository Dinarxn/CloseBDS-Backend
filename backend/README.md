# closeVDS Backend Foundation & Architecture

This is the custom backend API foundation for **closeVDS — AI Client Acquisition OS**, built with **Node.js, Fastify v5, TypeScript (strict), Zod, and PostgreSQL with Prisma ORM**.

---

## 1. Architectural Overview & Boundaries

The closeVDS backend is designed as an autonomous, server-authoritative system strictly decoupled from the Next.js frontend:

```text
┌─────────────────────────────────────────────────────────┐
│                   FRONTEND (Next.js)                    │
│            (No Secrets, Client State Only)              │
└────────────────────────────┬────────────────────────────┘
                             │ HTTPS REST API (/api/v1)
                             ▼
┌─────────────────────────────────────────────────────────┐
│                  BACKEND API (Fastify)                  │
│       (Auth, Security, Zod, Rate Limiting, Audit)       │
├─────────────────────────────────────────────────────────┤
│ Core Foundations:                                       │
│  - Centralized Error Handler (No leaked secrets/traces) │
│  - Security Headers (Helmet) & CORS                     │
│  - Permission Gates (Human Approval Required)           │
│  - Workspace Isolation (Multi-tenant context)           │
│  - Structured Logging with Secret Redaction             │
└──────┬──────────────────────┬────────────────────┬──────┘
       │                      │                    │
       ▼                      ▼                    ▼
┌──────────────┐      ┌──────────────┐     ┌──────────────┐
│ DATABASE     │      │ INTEGRATIONS │     │ JOBS         │
│ Repositories │      │ (AI, Email,  │     │ Scheduler    │
│ (PostgreSQL/ │      │ Discovery)   │     │ Boundary     │
│  Prisma ORM) │      │              │     │              │
└──────────────┘      └──────────────┘     └──────────────┘
```

---

## 2. API Endpoints Overview (/api/v1)

### Infrastructure & Health
- `GET /health`: Process liveness probe (`HTTP 200 { "status": "ok" }`)
- `GET /health/ready` & `GET /api/v1/health/ready`: Database dependency readiness probe (`HTTP 200` connected, `HTTP 503` disconnected)

### Authentication & Identity (`/api/v1/auth`)
- `POST /api/v1/auth/register`: Atomic user + workspace registration
- `POST /api/v1/auth/login`: User login issuing secure HttpOnly cookie & JWT
- `POST /api/v1/auth/logout`: Session cookie revocation
- `GET  /api/v1/auth/me`: Authenticated profile & active workspace

### Workspace Management (`/api/v1/workspaces`)
- `GET /api/v1/workspaces/current`: Active workspace metadata
- `GET /api/v1/workspaces/current/members`: Workspace membership listing

### Campaign Management (`/api/v1/campaigns`)
- `GET    /api/v1/campaigns`: List campaigns with pagination, status filtering, and search
- `GET    /api/v1/campaigns/:id`: Retrieve single campaign with lead count
- `POST   /api/v1/campaigns`: Create new targeting campaign
- `PATCH  /api/v1/campaigns/:id`: Update campaign parameters and status transitions
- `DELETE /api/v1/campaigns/:id`: Delete campaign

### Lead & Contact Management (`/api/v1/leads`)
- `GET    /api/v1/leads`: List leads with pagination, campaign/status filtering, and search
- `GET    /api/v1/leads/:id`: Retrieve lead with associated contacts, audit, and scores
- `POST   /api/v1/leads`: Create lead with 4-factor match key deduplication
- `PATCH  /api/v1/leads/:id`: Update lead details and lifecycle status
- `DELETE /api/v1/leads/:id`: Delete lead
- `GET    /api/v1/leads/:leadId/contacts`: List contacts for a lead
- `POST   /api/v1/leads/:leadId/contacts`: Add contact to a lead
- `PATCH  /api/v1/leads/:leadId/contacts/:contactId`: Update contact
- `DELETE /api/v1/leads/:leadId/contacts/:contactId`: Delete contact

### Lead Discovery (`/api/v1/lead-discovery`)
- `POST   /api/v1/lead-discovery/query`: Query discovery candidates with match-key deduplication and `LeadSource` tracking

### Lead Research & Website Audit (`/api/v1/lead-research`)
- `GET    /api/v1/lead-research/:leadId`: Retrieve technical/UX website audit observations
- `POST   /api/v1/lead-research/:leadId`: Trigger website audit / record audit gaps

### AI Qualification & Scoring (`/api/v1/qualification`)
- `GET    /api/v1/qualification/:leadId`: Retrieve AI analysis and 0–100 lead score
- `POST   /api/v1/qualification/:leadId`: Trigger qualification analysis and score evaluation

### AI Personalization (`/api/v1/personalization`)
- `POST   /api/v1/personalization/:leadId`: Generate fact-grounded personalized cold outreach draft with mandatory human approval guardrails (`status: DRAFT`, `isApproved: false`)

### Outreach Workflow & Human Approval (`/api/v1/outreach`)
- `POST   /api/v1/outreach`: Create outreach draft locked in `DRAFT` status
- `GET    /api/v1/outreach`: List outreach drafts with workspace scoping, filtering, and pagination
- `GET    /api/v1/outreach/:id`: Retrieve single outreach draft
- `PATCH  /api/v1/outreach/:id`: Update draft content (editing content automatically resets approval)
- `POST   /api/v1/outreach/:id/approve`: Server-authoritative explicit human approval
- `POST   /api/v1/outreach/:id/reject`: Server-authoritative explicit human rejection
- `POST   /api/v1/outreach/:id/cancel`: Server-authoritative explicit human cancellation
- `POST   /api/v1/outreach/:id/safety-check`: Multi-point safety evaluation (human approval, email/domain suppression, daily velocity cap, recipient and content validity)

### CRM & Activity Management (`/api/v1/crm`)
- `GET    /api/v1/crm/leads/:leadId`: Retrieve complete CRM profile and timeline
- `GET    /api/v1/crm/leads/:leadId/activities`: Retrieve activities for lead
- `POST   /api/v1/crm/leads/:leadId/activities`: Record manual/system CRM activity (note, call log)
- `PATCH  /api/v1/crm/leads/:leadId/stage`: Update pipeline stage with automatic activity log & audit

### Follow-Up & Task Workflow (`/api/v1/follow-ups`)
- `POST   /api/v1/follow-ups`: Create actionable follow-up task
- `GET    /api/v1/follow-ups`: List follow-up tasks with pagination and filters
- `GET    /api/v1/follow-ups/:id`: Retrieve single follow-up task
- `PATCH  /api/v1/follow-ups/:id`: Update task details or mark complete
- `DELETE /api/v1/follow-ups/:id`: Delete follow-up task

### Analytics & Reporting Domain (`/api/v1/analytics`)
- `GET    /api/v1/analytics/overview`: Overall KPI dashboard metrics across leads, campaigns, outreach, CRM, and tasks
- `GET    /api/v1/analytics/leads`: Conversion funnel breakdown and lead score distribution summaries
- `GET    /api/v1/analytics/campaigns`: Workspace-wide campaign performance summaries
- `GET    /api/v1/analytics/campaigns/:campaignId`: Campaign-specific performance and conversion rates
- `GET    /api/v1/analytics/outreach`: Outreach volume, draft states, and human approval rate
- `GET    /api/v1/analytics/activity`: Activity volume timeline breakdown and 24h velocity
- `GET    /api/v1/analytics/export`: Export leads and metrics in CSV or JSON format with tenant scoping

### Settings & Administration (`/api/v1/settings`)
- `GET    /api/v1/settings/workspace`: Retrieve workspace settings and kill-switch status
- `PATCH  /api/v1/settings/workspace`: Update workspace settings (name, kill-switch, daily caps, thresholds)
- `GET    /api/v1/settings/preferences`: Retrieve user preferences within workspace
- `PATCH  /api/v1/settings/preferences`: Update user notification and theme preferences
- `GET    /api/v1/settings/providers`: Safe provider configuration status inspection (zero secrets leaked)
- `GET    /api/v1/settings/suppressions`: List workspace suppression rules with pagination
- `POST   /api/v1/settings/suppressions`: Add email or domain suppression entry
- `DELETE /api/v1/settings/suppressions/:id`: Remove suppression record

### In-App Notifications (`/api/v1/notifications`)
- `GET    /api/v1/notifications`: List current user's in-app notifications (paginated)
- `GET    /api/v1/notifications/unread-count`: Retrieve unread notification badge counter
- `GET    /api/v1/notifications/:id`: Retrieve single notification
- `POST   /api/v1/notifications`: Create internal notification
- `PATCH  /api/v1/notifications/:id/read` & `POST /api/v1/notifications/:id/read`: Mark single notification as read
- `POST   /api/v1/notifications/mark-all-read` & `POST /api/v1/notifications/read-all`: Mark all notifications as read
- `DELETE /api/v1/notifications/:id`: Dismiss/delete notification

### System Events & Integrations (`/api/v1/integrations`)
- `POST   /api/v1/integrations/webhooks/:provider`: Ingest external provider webhook events (Resend, SendGrid, Generic) with HMAC signature validation & idempotency
- `GET    /api/v1/integrations/events`: List processed integration events for the active workspace

### Background Jobs & Workflow Engine (`/api/v1/jobs`)
- `POST   /api/v1/jobs`: Enqueue background workflow job with payload validation & idempotency
- `GET    /api/v1/jobs`: List background jobs with status/type filtering and pagination
- `GET    /api/v1/jobs/:id`: Retrieve single job status and result/error logs
- `POST   /api/v1/jobs/:id/cancel`: Cancel pending/queued job
- `POST   /api/v1/jobs/:id/retry`: Retry failed job
- `POST   /api/v1/jobs/:id/execute`: Execute safe internal job handler (zero external dispatch guarantee)

---

## 3. Database Architecture & 17 Authoritative Phase 0 Entities

The persistence layer uses **PostgreSQL** with **Prisma ORM**, strictly modeling the **17 authoritative conceptual entities** defined in Phase 0 `SYSTEM-ARCHITECTURE.md`:

1. **`User`**: System user account (belongs to a Workspace).
2. **`Workspace`**: Multi-tenant isolation boundary.
3. **`Campaign`**: Targeting configuration belonging to a Workspace.
4. **`Lead`**: Target business or organization entity.
5. **`Contact`**: Individual person or decision-maker at a Lead (1:N with Lead).
6. **`LeadSource`**: Source tracking metadata (provider, external ID, query payload).
7. **`WebsiteAudit`**: Technical, UX, mobile, and CTA audit observations.
8. **`AIAnalysis`**: Qualitative AI analysis, opportunity points, risk factors.
9. **`LeadScore`**: Quantitative scoring metrics (0-100) and reasoning rationale.
10. **`EmailCampaign`**: Outreach sending configuration attached to a Campaign.
11. **`EmailMessage`**: An individual draft, queued, or sent cold email to a Contact.
12. **`EmailEvent`**: Dispatched delivery webhook event (delivered, bounce, reply, opt-out).
13. **`CRMActivity`**: Sales interaction timeline log, notes, stage transitions.
14. **`Task`**: Actionable to-do item for a Lead assigned to a User.
15. **`Suppression`**: Opt-out, unsubscribed, or bounced email/domain suppression rule.
16. **`AuditLog`**: Security and operational audit log capturing user actions & config changes.
17. **`Notification`**: In-app alert notification dispatched to a User.

---

## 4. Security & Multi-Tenant Foundations

1. **Zero Frontend Secrets**: All credentials (`DATABASE_URL`, provider tokens) reside exclusively in backend environment variables.
2. **Server-Authoritative Workspace Isolation**: Every repository method requires and filters on `workspaceId`, preventing cross-tenant data leaks.
3. **Liveness vs. Readiness Probes**:
   - `GET /health` $\rightarrow$ `HTTP 200 { "status": "ok" }` (process liveness probe)
   - `GET /health/ready` $\rightarrow$ Reports dependency readiness (`connected` vs `disconnected`) without exposing database connection strings, passwords, or hostnames.
4. **Mandatory Human-Approval Gates**:
   - Outreach and follow-up drafts generated by AI can never be dispatched without recorded human approval (`assertHumanApprovalGranted`).
   - Editing an approved draft resets its status to `DRAFT` and invalidates any prior approval.
   - Creating or completing follow-up tasks does not trigger external dispatch or bypass approval.
5. **Global Outreach Kill Switch**: Instant backend freeze for all dispatch queues (`assertKillSwitchNotActive`).
6. **Enumeration & Leak Prevention**: Passwords hashed with `bcrypt` (12 rounds). Password hashes never returned in API payloads or logs.

---

## 5. Development & Verification Commands

From the `backend/` directory:

```bash
# Install dependencies
npm install

# Generate Prisma Client
npx prisma generate

# Run TypeScript type check
npm run typecheck

# Run test suite (13 suites / 179 tests)
npm test

# Build production bundle
npm run build

# Start development server with auto-reload
npm run dev

# Start production server
npm run start
```
