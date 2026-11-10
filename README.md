# CloseVDS — AI Client Acquisition OS Backend

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)
[![Fastify](https://img.shields.io/badge/fastify-v5.0.0-black.svg)](https://fastify.dev/)
[![TypeScript](https://img.shields.io/badge/typescript-v5.7.3-blue.svg)](https://www.typescriptlang.org/)
[![Prisma ORM](https://img.shields.io/badge/prisma-v6.0.0-1B222D.svg)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/postgresql-v15%2B-336791.svg)](https://www.postgresql.org/)
[![Test Suites](https://img.shields.io/badge/tests-34%20passed%20(100%25)-success.svg)](backend/tests/)
[![Security](https://img.shields.io/badge/security-AES--256--GCM%20%7C%20Fail--Closed-red.svg)](backend/FINAL_SECURITY_AND_TENANT_ISOLATION_REPORT.md)

Production-grade, server-authoritative backend foundation for **CloseVDS** — an AI-powered Client Acquisition Operating System engineered for agencies selling websites, booking software, and growth services to dental practices and healthcare clinics.

---

## 📑 Table of Contents

- [Architectural Overview](#-architectural-overview)
- [Core Engineering Principles](#-core-engineering-principles)
- [Key Subsystems](#-key-subsystems)
- [Repository Structure](#-repository-structure)
- [Authoritative Database Schema](#-authoritative-database-schema)
- [API Route Map (/api/v1)](#-api-route-map-apiv1)
- [Safety & Human-in-the-Loop Guardrails](#-safety--human-in-the-loop-guardrails)
- [Local Setup & Verification](#-local-setup--verification)
- [Test Suites & Quality Gates](#-test-suites--quality-gates)
- [Production Readiness & Documentation Index](#-production-readiness--documentation-index)

---

## 🏛 Architectural Overview

The CloseVDS backend operates as an autonomous, high-throughput, server-authoritative API strictly decoupled from the Next.js 15 frontend application ([CloseVDS-](https://github.com/Dinarxn/CloseVDS-)).

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       CLOSEVDS FRONTEND (Next.js 15)                       │
│        React 19 • Tailwind CSS v4 • Monochrome Dark Theme • Client State    │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ HTTPS /api/v1 (JWT Cookie)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    CLOSEVDS BACKEND API (Fastify 5)                         │
│   Auth Guards • Zod Validation • Security Headers (Helmet) • Rate Limiter   │
├─────────────────────────────────────────────────────────────────────────────┤
│ Core Layer:                                                                 │
│  - Centralized Error Normalization (RFC 7807, zero secret leaks)           │
│  - Fail-Closed Workspace Context & AES-256-GCM Credential Vault             │
│  - Mandatory Human-in-the-Loop Permission Gates                             │
│  - Emergency Kill Switch Architecture (Global & Workspace Scoped)           │
├─────────────────────────────────────────────────────────────────────────────┤
│ Domain Modules:                                                             │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐ ┌───────────────┐ │
│  │ Lead Discovery │ │ AI Grounding & │ │ Voice AI &     │ │ CRM & Dental  │ │
│  │ & Geoapify Maps│ │ Personalization│ │ Telephony (Tw) │ │ Pipeline      │ │
│  └───────┬────────┘ └───────┬────────┘ └───────┬────────┘ └───────┬───────┘ │
│          │                  │                  │                  │         │
│  ┌───────┴────────┐ ┌───────┴────────┐ ┌───────┴────────┐ ┌───────┴───────┐ │
│  │ Outreach & DNC │ │ Background Jobs│ │ In-App Alerts  │ │ n8n Webhook   │ │
│  │ Velocity Safety│ │ Queue & Worker │ │ & Analytics    │ │ Ingestion Hub │ │
│  └───────┬────────┘ └───────┬────────┘ └───────┬────────┘ └───────┬───────┘ │
└──────────┼──────────────────┼──────────────────┼──────────────────┼─────────┘
           ▼                  ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      DATABASE & PERSISTENCE (Prisma 6)                      │
│             PostgreSQL 15+ • Connection Pooling • Strict Tenant Scoping     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🛡 Core Engineering Principles

1. **Zero Secret Leakage**: No production API keys, Twilio Auth Tokens, or database connection strings are ever sent to client browsers or exposed in error messages.
2. **Fail-Closed Security**: In the event of a database connectivity failure, settings degradation, or ambiguous verification state, the system automatically defaults to `killSwitchActive: true` and blocks all outbound calling and communications.
3. **Strict Multi-Tenant Isolation**: Every database interaction requires an explicit `workspaceId`. Cross-tenant queries are structurally prohibited at the repository layer.
4. **Human-in-the-Loop by Design**: AI-generated cold calls and email drafts are created locked in `DRAFT` status and cannot be dispatched without recorded human approval. Any modification to approved content immediately revokes approval.
5. **No Blind External Dispatch in Tests**: The entire test suite executes safely in local environments using zero-dispatch mock adapters, incurring zero live carrier fees or telephony costs.

---

## ⚡ Key Subsystems

### 1. Voice AI & Telephony Integration
- **Multi-Provider Architecture**: Pluggable adapters for **Twilio Voice**, **Retell AI**, and **Vapi**.
- **Carrier Line Management**: E.164 phone number formatting, SIP trunking capabilities, caller ID verification, and PostgreSQL restart hydration.
- **Outbound Safety Engine**:
  - DNC (Do Not Call) and domain suppression enforcement.
  - Recipient local timezone computation (strictly enforcing 9:00 AM – 5:00 PM local calling hours).
  - Workspace velocity caps and retry cooldown backoffs.
  - Sub-second emergency kill-switch halt across active phone lines.
- **Webhook Telephony Hub**: Cryptographic timing-safe HMAC-SHA1 signature verification for inbound carrier webhooks.

### 2. Lead Discovery & Deep Research
- **Geoapify Places & OpenStreetMap**: Targeted geographic discovery for dental practices, orthodontists, and cosmetic dental clinics.
- **4-Factor Match Key Deduplication**: Canonical normalization across `(name, phone, website, geoHash)` preventing duplicate lead ingestion.
- **Automated Website Audit**: Analyzes website mobile responsiveness, speed, SSL, online booking presence, and CTA conversion bottlenecks.

### 3. AI Qualification & Anti-Hallucination Cold Outreach
- **Fact-Grounded Synthesis**: LLM prompts partitioned strictly into verified audit facts vs. outreach hooks, preventing fabricated claims.
- **Objective Scoring Engine**: Evaluates clinic acquisition readiness from `0` to `100` with transparent scoring rationales.
- **Draft Generator**: Produces tailored cold emails and call scripts highlighting exact technical gaps discovered during audit.

### 4. Dental CRM & Follow-Up Lifecycle
- **Specialized Pipeline Stages**: `DISCOVERED` $\rightarrow$ `ENRICHED` $\rightarrow$ `AUDITED` $\rightarrow$ `QUALIFIED` $\rightarrow$ `OUTREACH_READY` $\rightarrow$ `CONTACTED` $\rightarrow$ `ENGAGED` $\rightarrow$ `MEETING_SCHEDULED` $\rightarrow$ `PROPOSAL_SENT` $\rightarrow$ `CLOSED_WON` $\rightarrow$ `CLOSED_LOST`.
- **Appointments Management**: Clinic demo bookings, calendar sync timestamps, reminder workflows, and outcome tracking.
- **Activity Timeline**: Full chronological audit trails for notes, call recordings, emails, and stage updates.

### 5. Automation & Integration Hub
- **n8n Workflow Webhooks**: HMAC-SHA256 signed communication channel for triggering complex external sales workflows.
- **Job Engine**: Asynchronous queue with multi-tenant isolation, idempotency keys, execution logs, and automated retry backoffs.

---

## 📁 Repository Structure

```text
CloseBDS-Backend/
├── .gitignore                         # Root Git ignore rules (protects credentials & scratch)
├── README.md                          # Master GitHub documentation
├── backend/                           # Node.js backend application root
│   ├── .env.example                   # Safe environment template
│   ├── package.json                   # Dependencies, scripts, and engine specifications
│   ├── tsconfig.json                  # Strict TypeScript compiler configuration
│   ├── prisma/
│   │   ├── schema.prisma              # Production Prisma schema (30+ models)
│   │   └── migrations/                # 4 deterministic migration steps
│   │       ├── 0_init/
│   │       ├── 20261108200000_schema_expansion/
│   │       ├── 20261110_add_workspace_settings/
│   │       ├── 20261110_create_appointments/
│   │       └── 20261110_expand_dental_lead_columns/
│   ├── src/
│   │   ├── api/                       # Fastify HTTP routing layer & health checks
│   │   ├── config/                    # Environment validation (Zod)
│   │   ├── core/                      # Error handler, permissions, security, logging
│   │   ├── database/                  # Prisma client, multi-tenant repository, in-memory mock
│   │   ├── integrations/              # Adapters: Twilio, Retell, Vapi, Gemini, Geoapify, Resend
│   │   ├── jobs/                      # Background task scheduler and runner
│   │   ├── modules/                   # Domain services (auth, leads, voice, crm, settings, etc.)
│   │   ├── security/                  # AES-256-GCM Credential Vault & SSRF Guards
│   │   └── server/                    # Fastify server startup & graceful shutdown
│   ├── tests/                         # 34 comprehensive integration & unit test suites
│   └── MASTER_BACKEND_EXECUTION_REPORT.md # Master engineering completion report
```

---

## 🗄 Authoritative Database Schema

The persistence layer is modeled around **30+ relational PostgreSQL tables** managed through Prisma ORM:

| Domain | Key Models | Description |
| :--- | :--- | :--- |
| **Tenancy & Auth** | `Workspace`, `User`, `WorkspaceSettings`, `PasswordResetToken` | Organization boundaries, user credentials, encrypted configs, rate limits |
| **Lead Engine** | `Lead`, `Contact`, `LeadSource`, `DentalClinicProfile` | Practice metadata, operatory count, software in use, deduplication keys |
| **Audit & Intel** | `WebsiteAudit`, `AIAnalysis`, `LeadScore` | Tech stack discovery, page speed, UX issues, 0–100 score metrics |
| **Voice & Telephony** | `TelephonyPhoneNumber`, `CallSession`, `CallEvent`, `VoiceAgent` | Caller IDs, Twilio/Retell dispatch state, timeline recordings, transcript logs |
| **Outreach** | `EmailCampaign`, `EmailMessage`, `EmailEvent`, `Suppression` | Cold outreach drafts, human approvals, velocity caps, opt-out suppressions |
| **CRM & Deals** | `CRMActivity`, `Task`, `Appointment` | Sales timeline, follow-up reminders, demo bookings, pipeline stages |
| **System & Jobs** | `AuditLog`, `Notification`, `Job`, `IntegrationEvent` | Security audit trails, in-app notifications, asynchronous workflow tasks |

---

## 🔌 API Route Map (`/api/v1`)

| Prefix | Method | Endpoint | Description |
| :--- | :---: | :--- | :--- |
| `/health` | `GET` | `/health` | Process liveness probe (`HTTP 200 { "status": "ok" }`) |
| `/health` | `GET` | `/health/ready` | Database readiness probe (`200` connected / `503` degraded) |
| `/auth` | `POST` | `/api/v1/auth/register` | Atomic workspace + user onboarding |
| `/auth` | `POST` | `/api/v1/auth/login` | Secure JWT session issuance with HttpOnly cookies |
| `/auth` | `POST` | `/api/v1/auth/forgot-password` | Time-limited password reset token issuance (rate-limited) |
| `/auth` | `POST` | `/api/v1/auth/reset-password` | Secure password update via cryptographic token |
| `/leads` | `GET` | `/api/v1/leads` | Paginated lead listing with search, stage, and score filters |
| `/leads` | `POST` | `/api/v1/leads` | Create dental lead with 4-factor match-key deduplication |
| `/lead-discovery`| `POST`| `/api/v1/lead-discovery/query`| Geographic discovery via Geoapify Maps / OSM |
| `/qualification` | `POST`| `/api/v1/qualification/:id` | AI analysis, gap identification, and 0–100 score computation |
| `/personalization`|`POST`| `/api/v1/personalization/:id`| Generate cold outreach drafts locked in `DRAFT` status |
| `/outreach` | `POST` | `/api/v1/outreach/:id/approve`| Server-authoritative explicit human approval |
| `/outreach` | `POST` | `/api/v1/outreach/:id/safety-check`| Multi-point safety validation before queuing |
| `/voice` | `POST` | `/api/v1/voice/calls` | Queue outbound call (enforces kill-switch & caller ID check) |
| `/voice` | `GET` | `/api/v1/voice/calls/:id/timeline` | Granular call lifecycle timeline progression |
| `/voice` | `POST` | `/api/v1/voice/policy/kill-switch`| Sub-second emergency kill switch activation |
| `/voice` | `GET` | `/api/v1/voice/phone-numbers` | List verified caller ID lines with carrier capabilities |
| `/crm` | `GET` | `/api/v1/crm/leads/:id` | Comprehensive CRM profile and activity history |
| `/crm` | `PATCH`| `/api/v1/crm/leads/:id/stage` | Transition pipeline stage with automatic audit logging |
| `/settings` | `GET` | `/api/v1/settings/workspace` | Workspace settings and emergency kill-switch status |
| `/settings` | `PATCH`| `/api/v1/settings/workspace` | Update daily limits, calling windows, and kill switch |
| `/settings` | `GET` | `/api/v1/settings/providers` | Safe provider connection status (zero secret exposure) |
| `/jobs` | `POST` | `/api/v1/jobs` | Enqueue background job with idempotency key |
| `/jobs` | `POST` | `/api/v1/jobs/:id/cancel` | Cancel queued background task |

---

## 🚦 Safety & Human-in-the-Loop Guardrails

```text
[ Lead Discovery ] ──> [ AI Website Audit ] ──> [ AI Draft Generated ]
                                                        │
                                                        ▼
                                             ┌──────────────────────┐
                                             │ Status: DRAFT        │
                                             │ isApproved: FALSE    │
                                             └──────────┬───────────┘
                                                        │
                                                        ▼
                                             ┌──────────────────────┐
                                             │ Human Reviewer       │
                                             │ Explicit Approval    │
                                             └──────────┬───────────┘
                                                        │
                         ┌──────────────────────────────┴──────────────────────────────┐
                         │                                                             │
                  [ REJECT / EDIT ]                                            [ APPROVE ]
                         │                                                             │
                         ▼                                                             ▼
             Reset to DRAFT state                                             Run 6-Point Safety Gate:
             Approval invalidated                                             1. Global Kill Switch Check
                                                                              2. Workspace Kill Switch Check
                                                                              3. DNC / Suppression List
                                                                              4. Recipient Local Timezone Window
                                                                              5. Daily Workspace Limit
                                                                              6. Retry Cooldown Check
                                                                                       │
                                                                                       ▼
                                                                              Ready for Dispatch Queue
```

---

## 💻 Local Setup & Verification

### Prerequisites
- **Node.js**: `v20.0.0` or higher
- **npm**: `v10.0.0` or higher
- **PostgreSQL**: `v15+` (local or hosted via Supabase/AWS RDS)

### 1. Installation
Clone the repository and enter the `backend/` workspace:
```bash
git clone https://github.com/Dinarxn/CloseBDS-Backend.git
cd CloseBDS-Backend/backend
npm install
```

### 2. Environment Configuration
Create a local `.env` file based on `.env.example`:
```bash
cp .env.example .env
```
Populate required environment keys:
```env
PORT=4000
NODE_ENV=development
DATABASE_URL="postgresql://user:password@localhost:5432/closevds?schema=public"
JWT_SECRET="your-at-least-32-characters-super-secret-jwt-key"
ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
```

### 3. Database Initialization
Generate the Prisma client and apply migrations:
```bash
npx prisma generate
npx prisma migrate dev
```

### 4. Running Verification Commands
Verify code quality and type safety:
```bash
# Typecheck with zero errors
npm run typecheck

# Validate Prisma schema
npx prisma validate

# Run entire automated test suite (34 suites)
npm test
```

### 5. Start Development Server
```bash
npm run dev
```
The Fastify server starts on `http://localhost:4000`. Liveness probe is available at `http://localhost:4000/health`.

---

## 🧪 Test Suites & Quality Gates

The backend repository includes **34 dedicated test suites** covering unit, integration, persistence, and regression specifications:

```bash
npm test
```

```text
✓ tests/health.test.ts                          (Process liveness & error format)
✓ tests/database.test.ts                        (Prisma client & readiness probe)
✓ tests/auth.test.ts                            (JWT, bcrypt, registration, session)
✓ tests/auth-password-reset.test.ts             (Password recovery tokens & rate limit)
✓ tests/leads.test.ts                           (Deduplication & contact management)
✓ tests/campaigns.test.ts                       (Targeting & workspace limits)
✓ tests/discovery-research.test.ts              (Geoapify & audit integration)
✓ tests/geoapify-normalization.test.ts          (OSM & Places normalization)
✓ tests/geoapify-place-details.test.ts          (Enrichment & fallback safety)
✓ tests/geoapify-maps-targeting.test.ts         (Bounding boxes & dental queries)
✓ tests/geoapify-actionability.test.ts          (Quality scoring & phone extraction)
✓ tests/qualification-personalization.test.ts   (AI score clamping & drafts)
✓ tests/outreach.test.ts                        (Human approval & approval invalidation)
✓ tests/safety-approval.test.ts                 (Permission gates & guardrails)
✓ tests/crm.test.ts                             (Dental pipeline & activity audit)
✓ tests/follow-ups.test.ts                      (Reminders & task execution)
✓ tests/analytics.test.ts                       (KPI dashboards & CSV export)
✓ tests/settings-notifications.test.ts          (User preferences & alert queues)
✓ tests/integrations-webhooks.test.ts           (Resend/SendGrid HMAC signatures)
✓ tests/jobs.test.ts                            (Queue workers & safe execution)
✓ tests/provider-adapters.test.ts               (Secret masking & non-dispatch locks)
✓ tests/e2e-simulation.test.ts                  (End-to-end acquisition workflow)
✓ tests/voice-safety-lifecycle.test.ts          (Emergency kill switch & timeframes)
✓ tests/voice-provider-twilio.test.ts           (Twilio Voice & HMAC-SHA1 signatures)
✓ tests/voice-grounding-ai.test.ts              (Anti-hallucination fact verification)
✓ tests/n8n-integration.test.ts                 (n8n Webhook HMAC & payload guards)
✓ tests/operations-workspace.test.ts            (Workspace isolation boundaries)
✓ tests/contract-alignment.test.ts              (Fastify route envelope compliance)
✓ tests/voice-shared-contracts.test.ts          (Frontend-backend schema contracts)
✓ tests/voice-ai-providers.test.ts              (Retell AI & Vapi decoupled adapters)
✓ tests/twilio-telephony.test.ts                (Caller ID & E.164 line validation)
✓ tests/voice-agent-studio.test.ts              (Prompt templates & LLM parameters)
✓ tests/voice-safety-operations.test.ts         (DNC, velocity caps, call windows)
✓ tests/workstream1-p0-persistence.test.ts      (AES credential vault & DB hydration)

Total: 34 test suites passed (100% pass rate)
```

---

## 📚 Production Readiness & Documentation Index

Comprehensive technical reports generated during architectural audits and hardening:

- **[Master Backend Execution Report](backend/MASTER_BACKEND_EXECUTION_REPORT.md)**: Full milestone delivery record and verification sign-off.
- **[Frontend-Backend Integration Matrix](backend/FINAL_FRONTEND_BACKEND_INTEGRATION_MATRIX.md)**: Contract alignment mapping for 100% of Next.js views.
- **[Database & Migration Runbook](backend/FINAL_DATABASE_AND_MIGRATION_REPORT.md)**: Staging deployment instructions, migration verification, and backup steps.
- **[Security & Multi-Tenant Isolation Report](backend/FINAL_SECURITY_AND_TENANT_ISOLATION_REPORT.md)**: AES-256 vault verification and cross-tenant penetration tests.
- **[AI Calling Safety Report](backend/FINAL_AI_CALLING_SAFETY_REPORT.md)**: Timezone boundaries, DNC lists, kill switches, and anti-hallucination controls.
- **[QA & Regression Testing Report](backend/FINAL_QA_AND_REGRESSION_REPORT.md)**: Full test execution logs and coverage breakdown.
- **[API Contract Specification](backend/BACKEND_API_CONTRACT.md)**: Exhaustive request and response JSON schemas for every endpoint.

---

## ⚖️ License & Proprietary Notice

Copyright © 2026 CloseVDS. All rights reserved.  
Proprietary software for authorized CloseVDS agency deployments.
