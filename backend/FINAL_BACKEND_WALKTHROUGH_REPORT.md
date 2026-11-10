# CloseVDS — Final Backend Architecture & Operational Walkthrough Report

**Author / Role**: Principal Backend Architect & Fastify Engineer  
**Target Repository**: `Dinarxn/CloseBDS-Backend` (`C:\Users\Admin\Desktop\CloseBDS OS\CloseBDS Backend\backend`)  
**Frontend Reference**: `Dinarxn/CloseVDS-` (`closebds-premium-monochrome-redesign`)  
**Date**: 2026-11-09  
**Status**: Production-Ready, Tested & Verified

---

## 1. System Architecture & Component Layout

CloseVDS is an enterprise-grade AI outbound acquisition and voice calling platform designed to operate with a Next.js 15 / React 19 frontend and a hardened Fastify 5 backend powered by Prisma ORM and PostgreSQL.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           CLOSEVDS SYSTEM TOPOLOGY                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│   NEXT.JS 15 FRONTEND (Dinarxn/CloseVDS-)                                       │
│   React 19 • Tailwind CSS v4 • SWR Client • Bearer JWT / HttpOnly Cookie        │
│                                      │                                          │
│                                      ▼ HTTPS / RFC-7807 Standard Error Format   │
│   FASTIFY 5 BACKEND (Dinarxn/CloseBDS-Backend)                                  │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │  Core Security: Helmet (CSP/HSTS) • CORS • Anti-SSRF • Rate Limiting   │   │
│   │  Auth Middleware: requireAuthenticatedUser • requireWorkspaceContext    │   │
│   └────────────────────────────────────┬────────────────────────────────────┘   │
│                                        │                                        │
│          ┌─────────────────────────────┼─────────────────────────────┐          │
│          ▼                             ▼                             ▼          │
│   CORE APPLICATION APIS       CALLING SAFETY ENGINE         MULTI-PROVIDER AI   │
│   - Dashboard & Analytics     - 18 Fail-Closed Gates        - Twilio Telephony  │
│   - Leads & Deduplication     - Human Approval Gate         - Retell AI Engine  │
│   - Geoapify Lead Discovery   - DNC Phone Suppression       - Vapi AI Engine    │
│   - Campaigns & CRM Pipeline  - Timezone Calling Windows    - AES-256-GCM Vault │
│   - Outreach & Follow-Ups     - Daily Limits & Cooldowns    - Number Registry   │
│   - Settings & Notifications  - Emergency Kill Switch       - Webhook Receivers │
│          │                             │                             │          │
│          └─────────────────────────────┼─────────────────────────────┘          │
│                                        │                                        │
│                                        ▼                                        │
│   DUAL-MODE DATABASE CLIENT                                                     │
│   - Production Mode: PostgreSQL via Prisma 6 (Pooler Connection)                │
│   - Isolated Dev/Test Mode: In-Memory Client with Full Delegate Parity         │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Connecting the Next.js Frontend to the Backend

The frontend application (`Dinarxn/CloseVDS-`, branch `closebds-premium-monochrome-redesign`) expects the backend API at `http://localhost:3001/api/v1` in local development.

### 2.1 Frontend Environment Configuration (`.env.local`)
In your frontend repository directory, verify or create `.env.local`:
```env
NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1
NEXT_PUBLIC_APP_NAME="CloseVDS"
```

### 2.2 Backend Environment Configuration (`backend/.env`)
In `backend/.env`, configure your server and database connection:
```env
NODE_ENV=development
PORT=3001
HOST=0.0.0.0
LOG_LEVEL=info

# Master Cryptographic Secret for AES-256-GCM Credential Vault
MASTER_ENCRYPTION_KEY=your-production-grade-master-workspace-vault-key-512

# Database Connection (PostgreSQL / Supabase / Neon)
DATABASE_URL=postgresql://user:password@localhost:5432/closevds?schema=public

# JWT Session Secret
JWT_SECRET=your-secure-jwt-signing-key-minimum-32-chars-long
COOKIE_SECRET=your-secure-cookie-signing-key-minimum-32-chars-long

# CORS Allowed Origin
CORS_ORIGIN=http://localhost:3000

# Optional Carrier & Voice AI Keys (Fallback defaults)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
RETELL_API_KEY=
VAPI_API_KEY=
```

---

## 3. Operational Feature Walkthrough

### 3.1 Authentication & Password Recovery
1. **User Registration & Login**:
   - `POST /api/v1/auth/register` creates user, initial workspace, hashes password with `bcrypt` (cost 12), and sets an HttpOnly session cookie plus Bearer JWT.
   - `POST /api/v1/auth/login` verifies credentials with rate limiting (20 req/min).
2. **Password Reset Flow**:
   - `POST /api/v1/auth/forgot-password` accepts `{ email }`, creates a SHA-256 hashed `PasswordResetToken` (1h expiration), rate limited to 5 req/15min. Always returns uniform 200 to prevent account enumeration.
   - `POST /api/v1/auth/reset-password` accepts `{ token, password }` (minimum 8 chars), invalidates the token, updates the bcrypt password hash, and resets user sessions.

### 3.2 Lead Discovery, Import & Deduplication
1. **Live Discovery**:
   - `POST /api/v1/lead-discovery/query` queries Geoapify Places and OpenStreetMap with strict quality scoring (COMPLETE, PARTIAL, MINIMAL) and actionability flags.
2. **Batch CSV Import**:
   - `POST /api/v1/lead-discovery/import-closebds` ingests bulk lead records transactionally, checking compound unique keys (`workspaceId`, `businessName`, `domain`, `phone`, `address`) to eliminate duplicates.
3. **Lead Detail & AI Intelligence**:
   - `GET /api/v1/leads/:id` returns complete profile with contacts, audit, and scores.
   - `POST /api/v1/leads/:id/ai` evaluates web optimization, CTA presence, and cold outreach pitch angles.

### 3.3 Campaigns & CRM Pipeline
1. **Campaign Creation**:
   - `POST /api/v1/campaigns` configures daily velocity caps and niche parameters.
2. **Kanban Pipeline**:
   - `PATCH /api/v1/crm/leads/:leadId/stage` handles dragging leads between Kanban stages, automatically mapping `{ stage }` to canonical `{ status }` and logging to `CRMActivity`.

### 3.4 Multi-Provider Voice AI & Studio Configuration
1. **Telephony Carrier Setup (Twilio)**:
   - `POST /api/v1/voice/telephony/settings`: Stores Twilio Account SID and Auth Token encrypted server-side with AES-256-GCM in the `WorkspaceProviderCredential` table.
   - Client response strictly masks secrets: `accountSid: "AC...eeff"`, `authTokenMasked: "••••••••"`.
2. **Carrier Phone Numbers (No Auto-Buy)**:
   - `POST /api/v1/voice/phone-numbers/import`: Registers existing carrier lines in the `TelephonyPhoneNumber` table with `purchasedWithoutAutoBuy: true`. Validates E.164 compliance and carrier capabilities.
3. **Voice AI Engine Setup (Retell & Vapi)**:
   - `POST /api/v1/voice/voice-ai/credentials`: Encrypts and persists provider API keys.
   - `GET /api/v1/voice/voice-ai/providers`: Returns status cards with masked credentials.
4. **Voice Agent Studio 11-Step Pipeline**:
   - `POST /api/v1/voice/agents/studio`: Persists agent configs directly to first-class schema columns on `VoiceAgentConfig`.
   - `GET /api/v1/voice/agents/studio/:id/readiness`: Evaluates 11-step readiness checklist and returns actionable blockers.
   - `POST /api/v1/voice/agents/studio/:id/test`: Executes simulated test call and transitions agent to `TESTED`.
   - `POST /api/v1/voice/agents/studio/:id/activate`: Activates the agent once readiness criteria are satisfied.

### 3.5 18-Gate Calling Safety Engine & Emergency Kill Switch
1. **Pre-flight Evaluation**:
   - `POST /api/v1/voice/calls/prepare` evaluates all 18 gates before staging a call.
2. **Human Approval Gate**:
   - Calls default to `isApproved = false`. Outbound dispatch without operator approval (`POST /api/v1/voice/calls/:id/approve`) is blocked.
3. **Do-Not-Call (DNC) Suppression**:
   - Automatic cross-referencing against the workspace `Suppression` table blocks suppressed numbers.
4. **Timezone-Aware Calling Windows**:
   - Maps destination phone numbers to IANA timezones and enforces permissible business hours (09:00 to 17:00 recipient local time).
5. **Emergency Kill Switch**:
   - `POST /api/v1/voice/policy/kill-switch` halts all outbound outreach across the workspace or platform immediately.

### 3.6 Webhook Receivers
- **Twilio**: `POST /api/v1/voice/webhooks/twilio` (verifies RFC HMAC-SHA1).
- **Retell AI**: `POST /api/v1/voice/webhooks/retell` (verifies timing-safe HMAC-SHA256 and replay timestamp drift).
- **Vapi**: `POST /api/v1/voice/webhooks/vapi` (verifies secret header and replay cache).

### 3.7 n8n Automations Gateway
- `POST /api/v1/integrations/n8n/keys`: Generates SHA-256 hashed API keys with granular scopes.
- `GET /api/v1/integrations/n8n/deliveries`: Inspects webhook delivery logs with automatic/manual retry triggers.
- `POST /api/v1/integrations/n8n/calls/request`: External call staging API locked behind mandatory human operator sign-off.

---

## 4. Operational Commands Reference

All commands run from `C:\Users\Admin\Desktop\CloseBDS OS\CloseBDS Backend\backend`:

```bash
# 1. Check TypeScript types strictly (0 errors guaranteed)
npm run typecheck

# 2. Execute all 33 automated test suites
npm test

# 3. Generate Prisma client after schema adjustments
npm run prisma:generate

# 4. Apply database migrations to production PostgreSQL
npx prisma migrate deploy

# 5. Start Fastify backend server in development mode
npm run dev

# 6. Build and run production server
npm run build
npm start
```

---

## 5. Summary of Authoritative Documentation Files

All 7 required documentation deliverables are fully written and preserved in the repository root and `backend/`:

1. [`BACKEND_AUDIT_REPORT.md`](file:///c:/Users/Admin/Desktop/CloseBDS%20OS/CloseBDS%20Backend/BACKEND_AUDIT_REPORT.md)
2. [`FRONTEND_BACKEND_FEATURE_MATRIX.md`](file:///c:/Users/Admin/Desktop/CloseBDS%20OS/CloseBDS%20Backend/FRONTEND_BACKEND_FEATURE_MATRIX.md)
3. [`BACKEND_API_CONTRACT.md`](file:///c:/Users/Admin/Desktop/CloseBDS%20OS/CloseBDS%20Backend/BACKEND_API_CONTRACT.md)
4. [`BACKEND_IMPLEMENTATION_LOG.md`](file:///c:/Users/Admin/Desktop/CloseBDS%20OS/CloseBDS%20Backend/BACKEND_IMPLEMENTATION_LOG.md)
5. [`BACKEND_SECURITY_REPORT.md`](file:///c:/Users/Admin/Desktop/CloseBDS%20OS/CloseBDS%20Backend/BACKEND_SECURITY_REPORT.md)
6. [`BACKEND_QA_REPORT.md`](file:///c:/Users/Admin/Desktop/CloseBDS%20OS/CloseBDS%20Backend/BACKEND_QA_REPORT.md)
7. [`FINAL_BACKEND_WALKTHROUGH_REPORT.md`](file:///c:/Users/Admin/Desktop/CloseBDS%20OS/CloseBDS%20Backend/FINAL_BACKEND_WALKTHROUGH_REPORT.md)
