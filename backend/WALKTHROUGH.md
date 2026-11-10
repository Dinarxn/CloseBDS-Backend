# CloseVDS — Complete System & Architecture Walkthrough

**Repository**: `Dinarxn/CloseBDS-Backend` (`C:\Users\Admin\Desktop\CloseBDS OS\CloseBDS Backend`)  
**Frontend Reference**: `Dinarxn/CloseVDS-` (`closebds-premium-monochrome-redesign` at `C:\Users\Admin\Desktop\CloseBDS OS\CloseBDS Frontend`)  
**Technology Stack**: Fastify 5, Prisma 6, PostgreSQL, TypeScript, Next.js 15, React 19, Tailwind CSS v4  
**Date**: November 2026  
**Document Nature**: Read-only Master Walkthrough & System Guide (Zero application code modified)

---

## 1. Executive Summary & Mission Overview

CloseVDS is an enterprise AI-powered Client Acquisition Operating System designed specifically for dental clinic marketing and outreach automation. It orchestrates multichannel prospecting, CRM pipeline advancement, and natural conversational voice agents.

The application is structured into two decoupled repositories:
1. **Frontend (`Dinarxn/CloseVDS-`)**: Modern Next.js 15 App Router, React 19, Tailwind CSS v4 interface providing visual dashboards, pipeline boards, lead discovery tables, an 11-step voice agent studio, and operational control centers.
2. **Backend (`Dinarxn/CloseBDS-Backend`)**: High-throughput Fastify 5 API server, Prisma 6 ORM, PostgreSQL database, 18-gate server-side calling safety engine, AES-256-GCM cryptographic credential vault, and multi-provider voice abstraction layer.

---

## 2. Complete System Topology

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 CLOSEVDS SYSTEM TOPOLOGY                               │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│   NEXT.JS 15 FRONTEND (Dinarxn/CloseVDS-)                                              │
│   React 19 • Tailwind CSS v4 • SWR Client • Bearer JWT / HttpOnly Cookie               │
│                                       │                                                │
│                                       ▼ HTTPS / Standard RFC-7807 Errors               │
│   FASTIFY 5 BACKEND (Dinarxn/CloseBDS-Backend)                                         │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │  Core Security: Helmet (CSP/HSTS) • Strict CORS • Rate Limiting • Anti-SSRF    │   │
│   │  Auth Middleware: requireAuthenticatedUser • requireWorkspaceContext (RBAC)    │   │
│   └───────────────────────────────────────┬────────────────────────────────────────┘   │
│                                           │                                            │
│            ┌──────────────────────────────┼──────────────────────────────┐             │
│            ▼                              ▼                              ▼             │
│   CORE APPLICATION APIS         CALLING SAFETY ENGINE          MULTI-PROVIDER AI       │
│   - Dashboard & Analytics       - 18 Fail-Closed Gates         - Twilio PSTN Engine    │
│   - Leads & Deduplication       - Human Operator Approval      - Retell AI Engine      │
│   - OSM / Geoapify Discovery    - DNC / Phone Suppression      - Vapi Voice Engine     │
│   - Campaigns & CRM Pipeline    - Recipient Calling Windows    - AES-256-GCM Vault     │
│   - Outreach & Follow-Ups       - Daily Limits & Cooldowns     - Masked Credentials    │
│   - Settings & Notifications    - Emergency Kill Switch        - Webhook Signature Sec │
│            │                              │                              │             │
│            └──────────────────────────────┼──────────────────────────────┘             │
│                                           │                                            │
│                                           ▼                                            │
│   DATABASE LAYER (Prisma 6)                                                            │
│   - Production Mode: PostgreSQL (Supabase Transaction Pooler, Port 6543)               │
│   - Direct DDL Mode: PostgreSQL Direct Connection (Port 5432, Migrations)              │
│   - Test / Offline Mode: Dual-Mode In-Memory Client with Full Delegate Parity          │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Master Audit Inventory & Reference Files

All master audit documents are located in the repository root for independent technical inspection:

| Report File | Size | Focus Area |
|---|:---:|---|
| [`BACKEND_MASTER_AUDIT.md`](file:///c:/Users/Admin/Desktop/CloseBDS%20OS/CloseBDS%20Backend/BACKEND_MASTER_AUDIT.md) | 11.9 KB | Executive scorecard, code quality metrics, Fastify architecture, 100% test pass confirmation. |
| [`FRONTEND_BACKEND_INTEGRATION_MATRIX.md`](file:///c:/Users/Admin/Desktop/CloseBDS%20OS/CloseBDS%20Backend/FRONTEND_BACKEND_INTEGRATION_MATRIX.md) | 51.5 KB | **120 API interactions** across 18 functional domains classified with 7-tier status tags. |
| [`DATABASE_ARCHITECTURE_AUDIT.md`](file:///c:/Users/Admin/Desktop/CloseBDS%20OS/CloseBDS%20Backend/DATABASE_ARCHITECTURE_AUDIT.md) | 14.9 KB | 30 Prisma models, 13 enums, referential integrity cascades, and migration history analysis. |
| [`AUTH_SECURITY_AUDIT.md`](file:///c:/Users/Admin/Desktop/CloseBDS%20OS/CloseBDS%20Backend/AUTH_SECURITY_AUDIT.md) | 10.8 KB | JWT issuance, RBAC boundaries, AES-256-GCM vault, webhook replay cache, password reset security. |
| [`LEADS_CAMPAIGNS_AUDIT.md`](file:///c:/Users/Admin/Desktop/CloseBDS%20OS/CloseBDS%20Backend/LEADS_CAMPAIGNS_AUDIT.md) | 14.2 KB | Lead qualification scoring, 3-tier compound deduplication, OSM/Geoapify discovery, campaigns. |
| [`CRM_OUTREACH_ANALYTICS_AUDIT.md`](file:///c:/Users/Admin/Desktop/CloseBDS%20OS/CloseBDS%20Backend/CRM_OUTREACH_ANALYTICS_AUDIT.md) | 10.7 KB | 16-stage pipeline, server-side human approval gate (`isApproved === true`), real DB analytics. |
| [`AI_CALLING_INTEGRATION_AUDIT.md`](file:///c:/Users/Admin/Desktop/CloseBDS%20OS/CloseBDS%20Backend/AI_CALLING_INTEGRATION_AUDIT.md) | 14.8 KB | Twilio/Retell/Vapi provider separation, 18 safety gates, 11-step studio configuration. |
| [`BACKEND_IMPLEMENTATION_BACKLOG.md`](file:///c:/Users/Admin/Desktop/CloseBDS%20OS/CloseBDS%20Backend/BACKEND_IMPLEMENTATION_BACKLOG.md) | 41.6 KB | Complete 25-task backlog (P0 to P5) with all 9 mandatory specification fields per item. |
| [`BACKEND_INTEGRATION_READINESS_REPORT.md`](file:///c:/Users/Admin/Desktop/CloseBDS%20OS/CloseBDS%20Backend/BACKEND_INTEGRATION_READINESS_REPORT.md) | 61.8 KB | Final integration readiness audit certifying `READY FOR STAGING & PHASE 8 E2E INTEGRATION`. |

---

## 4. Core Domain Architecture & Feature Breakdown

### 4.1 Authentication & Workspace Multi-Tenancy
- **Dual-Layer Session Tokens**: Supports HttpOnly cookie authentication (`SameSite=Lax`, secure) alongside standard `Authorization: Bearer <JWT>` headers.
- **Tenant Isolation**: Every database repository enforces `workspaceId` as a strict query filter predicate. Users cannot read, mutate, or delete records belonging to another workspace.
- **RBAC Role Matrix**:
  - `OWNER`: Full billing, member invitation, credential configuration, and policy authority.
  - `ADMIN`: Lead management, campaign execution, and studio agent configuration.
  - `MEMBER`: Read-only analytics, lead inspection, and draft preparation.
- **OWASP Password Reset Flow**:
  - 256-bit cryptographic entropy token (`crypto.randomBytes(32)`).
  - SHA-256 token hashing prior to database storage (plain tokens are never stored).
  - 1-hour expiration TTL and single-use `usedAt` timestamp invalidation.
  - Account enumeration defense: Ambiguous 200 OK message returned regardless of email existence.
  - Dedicated IP rate limiting (maximum 5 requests per 15-minute window).

### 4.2 Lead Management, Deduplication & Discovery
- **Compound Deduplication**: Unique constraint index on `[workspaceId, businessName, domain, phone, address]` prevents duplicate leads across CSV imports or manual creations.
- **Enrichment Graph**: A `Lead` is related to `Contact`, `WebsiteAudit`, `AIAnalysis`, `LeadScore`, and `CRMActivity`.
- **Discovery Adapters**: Integrated bounded search using OpenStreetMap (Overpass API) and Geoapify adapters with geographic radius bounding.

### 4.3 Multichannel Campaigns & CRM Pipeline
- **Campaign State Machine**: Supports atomic transitions across `DRAFT`, `ACTIVE`, `PAUSED`, `COMPLETED`, `ARCHIVED` with dynamic lead aggregation counters (`_count.leads`).
- **CRM Pipeline**:
  - Standardized stages: `LEAD`, `CONTACTED`, `QUALIFIED`, `PROPOSAL`, `NEGOTIATION`, `CLOSED_WON`, `CLOSED_LOST`.
  - Automated activity history logged on every stage change.
  - Dynamic deal size estimation calculated from dental practice metrics.

### 4.4 Cold Outreach & Human Approval Gate
- **Strict Human Operator Sign-Off**: Outbound message queues require explicit human supervisor approval (`isApproved === true`). Calls or emails cannot be dispatched programmatically until sign-off is logged.
- **DNC / Suppression List**: Every dispatch target is checked against workspace suppression lists. Matching numbers or emails are immediately blocked (`BLOCKED_DNC`).

---

## 5. AI Calling & Multi-Provider Architecture

The voice calling backend is built on a **strictly decoupled provider abstraction model**:

```
                              ┌───────────────────────────┐
                              │    VOICE CALL DISPATCH    │
                              └─────────────┬─────────────┘
                                            │
                                            ▼
                              ┌───────────────────────────┐
                              │  18-GATE SAFETY ENGINE    │
                              │  (Fail-Closed Validation) │
                              └─────────────┬─────────────┘
                                            │
                        ┌───────────────────┴───────────────────┐
                        ▼                                       ▼
            ┌───────────────────────┐               ┌───────────────────────┐
            │   TELEPHONY / PSTN    │               │       VOICE AI        │
            │        Twilio         │               │    Retell AI / Vapi   │
            └───────────┬───────────┘               └───────────┬───────────┘
                        │                                       │
                        ▼                                       ▼
            - E.164 Number Carrier                  - Conversational LLM
            - PSTN Audio Trunking                   - ElevenLabs / Deepgram
            - Recording Webhooks                    - Real-time Transcription
```

### 5.1 Provider Architecture Rules
1. **Twilio**: Dedicated PSTN telephony provider responsible for carrier phone number routing, SIP trunking, and call connectivity.
2. **Retell AI & Vapi**: Independent Voice AI providers responsible for real-time speech-to-speech conversational synthesis.
3. **Provider Selection**: Each Voice Agent configures exactly one Voice AI provider (`retell` or `vapi`).
4. **No Automatic Failover**: No cross-provider failover is permitted (prevents unexpected billing surprises or divergent conversational personas).
5. **No Automatic Purchases**: Carrier phone numbers cannot be purchased automatically by scripts; workspace owners must manually confirm number provisioning.

### 5.2 The 18-Gate Server-Side Calling Safety Engine
Calling safety is evaluated server-side before any outbound connection is opened:
1. `Gate 1`: Lead Existence & Tenant Isolation
2. `Gate 2`: Strict E.164 Phone Normalization (`/^\+[1-9]\d{1,14}$/`)
3. `Gate 3`: Campaign Active & Verified Status
4. `Gate 4`: Mandatory Human Operator Approval (`isApproved === true`)
5. `Gate 5`: Approval Tamper Invalidation (parameter changes reset approval)
6. `Gate 6`: Do Not Call (DNC) Workspace Suppression List Check
7. `Gate 7`: Recipient Local Timezone Calling Window (09:00 - 18:00 local time)
8. `Gate 8`: Workspace Daily Call Quota Enforcement
9. `Gate 9`: Retry Cooldown Delay (minimum configured duration between attempts)
10. `Gate 10`: Duplicate In-Flight Call Lock & Idempotency Key
11. `Gate 11`: Global Emergency Kill Switch Status
12. `Gate 12`: Workspace-Level Emergency Kill Switch Status
13. `Gate 13`: Target Phone Eligibility Check
14. `Gate 14`: Anti-Hallucination Prompt Boundary Check
15. `Gate 15`: Telephony Carrier Phone Number Capability Verification
16. `Gate 16`: Voice AI Provider Credential Presence & Connectivity
17. `Gate 17`: Voice Agent Studio Pre-Activation Gate (tested status)
18. `Gate 18`: Audit Log Dispatch Event Recorded

---

## 6. Cryptography & Webhook Defense

### 6.1 AES-256-GCM Credential Vault
- **Encryption Algorithm**: Authenticated `aes-256-gcm` using `node:crypto`.
- **Key Derivation**: Master encryption key combined with per-credential unique cryptographic salt.
- **Payload Structure**: `{ ciphertext, iv, authTag, salt }`.
- **Masking Protection**: Raw API keys, account SIDs, and auth tokens are never returned in HTTP responses (`AC****...` masking enforced).

### 6.2 Webhook Signature Verification & Replay Protection
- **Twilio**: HMAC-SHA1 signature verification using timing-safe comparison (`crypto.timingSafeEqual`).
- **Retell & Vapi**: HMAC-SHA256 signature verification over raw request buffers.
- **Replay Protection**:
  - Maximum allowable timestamp drift: **±300 seconds** (5 minutes).
  - In-memory sliding-window nonce / event ID cache deduplicates incoming events and prevents replay attacks.

---

## 7. Database & Migration Status

### 7.1 Schema Composition (Prisma 6)
- **30 Total Models**:
  - *Core Identity*: `User`, `Workspace`, `Session`, `PasswordResetToken`
  - *Leads & Contacts*: `Lead`, `Contact`, `WebsiteAudit`, `AIAnalysis`, `LeadScore`
  - *Outreach & Campaigns*: `Campaign`, `OutreachMessage`, `EmailMessage`, `Suppression`
  - *CRM & Pipeline*: `Deal`, `CRMStage`, `CRMActivity`
  - *Voice & Telephony*: `VoiceAgentConfig`, `Call`, `CallEvent`, `WorkspaceCallingPolicy`, `WorkspaceProviderCredential`, `TelephonyPhoneNumber`
  - *Automation & Logs*: `N8nIntegration`, `N8nWebhookDelivery`, `AuditLog`, `Notification`
- **13 Enums**: Validated and type-safe.

### 7.2 Migrations Status
- **Baseline**: 2 applied migrations in remote database.
- **Pending Migrations (Additive & Non-Destructive)**:
  1. `20261020194000_add_cancelled_to_email_message_status`: Adds `'CANCELLED'` to enum.
  2. `20261108200000_schema_expansion`: Creates `workspace_provider_credentials`, `telephony_phone_numbers`, `password_reset_tokens`, and adds optional non-breaking columns to `voice_agent_configs` and `calls`.
- **Zero Destructive Changes**: No `DROP TABLE`, no `DROP COLUMN`, and no type truncations.

---

## 8. Prioritized Implementation Backlog (The 25 Tasks)

The prioritized roadmap for Phase R2 implementation is organized into 5 sequential workstreams:

```mermaid
flowchart LR
    W1["Workstream 1: P0<br>Security, DB Hydration & Persistence"] --> W2["Workstream 2: P1<br>Safety Gates & Contract Alignment"]
    W2 --> W3["Workstream 3: P2<br>Audit Logs, Appointments & RBAC"]
    W3 --> W4["Workstream 4: P3<br>Hardening & Performance"]
    W4 --> W5["Workstream 5: P4-P5<br>Optimization & Staging Verification"]
```

### P0 Tasks (Immediate Priority):
- `P0-1`: Eliminate runtime `process.env` mutations; load credentials per-workspace from encrypted vault.
- `P0-2`: Hydrate carrier phone numbers from PostgreSQL `TelephonyPhoneNumber` on container restart.
- `P0-3`: Migrate in-memory `SettingsRepository` to persistent PostgreSQL model.

### P1 Tasks (Safety & Parity):
- `P1-1`: Enforce strict fail-closed evaluation on Calling Safety Gates 14 & 16.
- `P1-2`: Persist webhook recording URLs to `Call` table for audio playback.
- `P1-3`: Implement dual-aliasing on high-impact routes (`.items` + `.data`, `{ data: { discovered } }`).
- `P1-4`: Persist workspace notification preferences and team members.
- `P1-5`: Align password reset responses with frontend expectations.

### P2 Tasks (Governance & Expansions):
- `P2-1`: Implement `GET /api/v1/settings/audit-logs` endpoint with pagination and filtering.
- `P2-2`: Enforce strict RBAC route guards on workspace invitations.
- `P2-3`: Expand `Lead` model with dental clinic fields (`chairCount`, `practiceType`).
- `P2-4`: Create `Appointment` schema and routes for booked consultations.
- `P2-5`: Unify deduplication engine across manual and batch CSV imports.

### P3–P5 Tasks:
- PostgreSQL pooler connection string tuning, anti-SSRF protections, discovery query caching, campaign rollup analytics, and staging E2E integration test execution.

---

## 9. Local Development & Operational Guide

### 9.1 Environment Configuration

#### Backend (`backend/.env`):
```env
NODE_ENV=development
PORT=3001
HOST=0.0.0.0
API_PREFIX=/api/v1
CORS_ORIGIN=http://localhost:3000

# Security Secrets
ENCRYPTION_MASTER_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
JWT_SECRET=super_secure_jwt_secret_min_32_characters_long
COOKIE_SECRET=super_secure_cookie_secret_min_32_chars

# Database (Supabase PostgreSQL)
DATABASE_URL=postgresql://postgres.xxx:[PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres.xxx:[PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
```

#### Frontend (`C:\Users\Admin\Desktop\CloseBDS OS\CloseBDS Frontend\.env.local`):
```env
NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1
NEXT_PUBLIC_APP_NAME="CloseVDS"
```

### 9.2 Running Verification Commands

All commands are executed inside the `backend/` directory:

```bash
# 1. Validate Prisma schema consistency
npx prisma validate

# 2. Run TypeScript strict typecheck (0 errors)
npm run typecheck

# 3. Execute all 33 test suites (100% pass rate)
npm test

# 4. Run server in development mode
npm run dev
```

---

## 10. Summary & Next Steps

This walkthrough provides the complete technical architecture and operational context for the CloseVDS Backend without modifying application source code.

**Current Project State**:
- **Phase R1 (Read-Only Audit & Deliverables)**: **100% Complete & Verified**.
- **Phase R2 (Implementation)**: Paused awaiting explicit user approval.
- **Git Branch**: `closevds-backend-completion` (Clean, zero unapproved commits, zero frontend modifications).

To begin Phase R2 implementation, approve **Workstream 1 (P0: Security, Persistence & Multi-Tenancy)**.
