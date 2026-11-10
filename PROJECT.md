# PROJECT: CloseBDS Backend (CloseVDS Acquisition OS)

## 1. Project Overview & Mission

CloseBDS Backend is the enterprise-grade API, real-time telephony, and AI pipeline server powering the **CloseVDS** client application (Next.js 15 App Router). It orchestrates end-to-end B2B client acquisition: from local market lead discovery (Geoapify/OSM) and automated technical website audits to fact-grounded qualification, multi-channel cold outreach (Resend email, Meta WhatsApp), and voice AI phone calls (Twilio telephony + Retell AI / Vapi conversational voice agents).

### Core Invariants
- **Multi-Tenant Isolation**: Strict tenant scoping across all HTTP handlers, pre-handler authorization hooks, and database repository queries via `workspaceId`.
- **Zero-Bypass Human Approval**: Outbound voice calls and cold outreach messages are strictly blocked until a human operator signs off (`isApproved === true`).
- **Fail-Closed Calling Safety**: 18 server-side safety gates block call dispatch on any unverified condition (DNC suppression, local timezone business hours 09:00 - 17:00, daily limits, cooldowns, emergency kill switch).
- **Financial Protection**: Zero real outbound calls and zero phone number purchases during testing or development; genuine mock adapters simulate provider protocols safely.
- **Credential Protection**: Server-side AES-256-GCM encryption at rest; field-level masking in API responses; cryptographic HMAC webhook verification and replay protection.

---

## 2. Technology Stack

- **Server Engine**: Fastify v5.2.1
- **Language & Runtime**: TypeScript v5.7.3, Node.js (v20+ / v25), native ESM (`NodeNext`)
- **Database & ORM**: PostgreSQL, Prisma ORM v6.4.1 (with in-memory fallback for offline dev/test)
- **Validation & Environment**: Zod v3.24.2, Dotenv v16.4.7
- **Security & Cryptography**: `@fastify/helmet` v13, `@fastify/cors` v10, `@fastify/rate-limit` v10, `@fastify/cookie` v11, `bcryptjs` v2.4.3, `jsonwebtoken` v9.0.2, Node `crypto` (AES-256-GCM authenticated cipher, scrypt KDF, HMAC-SHA256)
- **AI & Workflow Orchestration**: `@google/generative-ai` v0.24.1, `@langchain/core` v1.2.9, `@langchain/langgraph` v1.4.14
- **Telephony & Voice AI Adapters**: Twilio PSTN REST API, Retell AI, Vapi Voice AI, Meta WhatsApp Business Cloud API, Resend Email API, Geoapify Places API, Nominatim OSM

---

## 3. Repository & Workspace Layout

```
CloseBDS Backend/
├── BACKEND_AUDIT_REPORT.md             # Authoritative Phase 1 audit report
├── FRONTEND_BACKEND_FEATURE_MATRIX.md   # Feature-by-feature parity matrix & gap analysis
├── PROJECT.md                           # Master project reference and architectural guidelines
├── backend/                             # Core Fastify backend implementation
│   ├── BACKEND_AUDIT_REPORT.md         # Synchronized local copy of audit report
│   ├── FRONTEND_BACKEND_FEATURE_MATRIX.md # Synchronized local copy of feature matrix
│   ├── PROJECT.md                      # Synchronized local copy of project documentation
│   ├── package.json                    # Scripts and dependencies
│   ├── tsconfig.json                   # Strict TypeScript compiler options
│   ├── prisma/
│   │   ├── schema.prisma               # 27 Prisma models, 15 enums
│   │   └── migrations/                 # 3 sequential PostgreSQL migrations
│   ├── src/
│   │   ├── config/                     # Environment configuration and Zod schemas
│   │   ├── core/                       # Errors, security, auth guards, permissions
│   │   ├── database/                   # PrismaClient dual-mode, repositories (17 repos), in-memory fallback
│   │   ├── integrations/               # Telephony, Voice AI, Resend, WhatsApp, Geoapify adapters
│   │   ├── modules/                    # Domain modules (auth, leads, voice, crm, outreach, etc.)
│   │   ├── security/                   # AES-256-GCM vault, masking, replay protection
│   │   └── server/                     # Fastify application factory, plugins, bootstrap
│   └── tests/                          # 50 TypeScript test suites (32 chained suites)
└── .agents/teamwork/                   # Orchestrator and agent metadata logs (NO source code here)
```

---

## 4. Architectural Principles & Coding Standards

1. **Domain-Driven Modular Structure**:
   - Every business capability lives in `src/modules/<domain>/` with its router, service, schemas, and types.
   - Cross-domain persistence is encapsulated in `src/database/repository.ts`.
2. **Strict Multi-Tenancy**:
   - Never query models without `workspaceId` in the `where` filter.
   - Always verify `request.workspaceContext.workspaceId` matches the targeted resource.
3. **Fail-Closed Safety Engine**:
   - Every outbound communication action must be gated by the safety engine (`voice.safety.ts`).
   - If any verification check, credential query, or timezone lookup fails, the action evaluates to `passed: false` and blocks execution.
4. **Zero Secret Disclosure**:
   - Plaintext credentials must never be returned in API responses.
   - Use `maskProviderCredentials()` from `src/security/credential-vault.ts` before serialization.
5. **No Direct Environment Mutation**:
   - Never mutate `process.env` at runtime. All workspace provider credentials must be persisted in PostgreSQL.
6. **First-Class Schema Entities**:
   - Relational data and configuration fields must have dedicated Prisma columns. Never pack configuration structures into unrelated JSON fields (e.g. `_studio` in `objectionHandling`).

---

## 5. Interface Contracts & Key Artifacts

- **Audit Findings**: `BACKEND_AUDIT_REPORT.md`
- **Feature Matrix & Gaps**: `FRONTEND_BACKEND_FEATURE_MATRIX.md`
- **API Contracts**: `BACKEND_API_CONTRACT.md` (Phase 2 Deliverable)
- **Frontend Reference**: `Dinarxn/CloseVDS-` (`closebds-premium-monochrome-redesign` branch)
  - Monolithic client: `CloseVDS/lib/api-client.ts`
  - Canonical types: `CloseVDS/types/*.ts`

---

## 6. Verification Commands

All commands are executed from the `backend/` directory:

```powershell
cd "C:\Users\Admin\Desktop\CloseBDS OS\CloseBDS Backend\backend"

# 1. Typecheck: Verify 0 compilation errors under strict NodeNext settings
npm run typecheck

# 2. Automated Test Suite: Execute all 32 chained test suites
npm test

# 3. Prisma Schema Validation
npx prisma validate

# 4. Dev Server Bootstrap
npm run dev

# 5. Production Build
npm run build
```

---

## 7. Phased Implementation Roadmap

- **Phase 1: Complete Backend Audit & Gap Analysis** — **COMPLETE**
  - Synthesized exhaustive explorer reports into `BACKEND_AUDIT_REPORT.md`, `FRONTEND_BACKEND_FEATURE_MATRIX.md`, and `PROJECT.md`.
  - Verified 100% test pass rate (32/32 suites) and 0 TypeScript errors.
- **Phase 2: API Contract Design**
  - Author `BACKEND_API_CONTRACT.md` defining all request/response schemas, validation rules, pagination, and error payloads for all 76+ endpoints.
- **Phase 3: Database Schema & Authentication Architecture**
  - Non-destructive Prisma migrations for `WorkspaceProviderCredential`, `TelephonyPhoneNumber`, `PasswordResetToken`, and expanded `VoiceAgentConfig` columns.
  - Implement `/auth/forgot-password` and `/auth/reset-password`.
- **Phase 4: Core Application APIs Persistence**
  - Verify PostgreSQL persistence and eliminate mock data across Dashboard, Leads, Discovery, Campaigns, CRM, Outreach, Follow-ups, and Analytics.
- **Phase 5: Multi-Provider Voice & Telephony Abstraction**
  - Migrate Twilio, Retell, and Vapi to AES-256-GCM encrypted database storage; eliminate `process.env` mutations; migrate carrier phone lines to database.
- **Phase 6: Server-Side Calling Safety Engine Hardening**
  - Wire Gates 15 & 16 to database credentials; reinforce 18 fail-closed gates and emergency kill switch.
- **Phase 7: Automation & n8n Gateway Alignment**
  - Implement delivery retry queues and HMAC webhook signatures for n8n.
- **Phase 8: Frontend Integration & End-to-End Alignment**
  - Validate Next.js UI integration with zero frontend modifications.
- **Phase 9: Verification, Testing & Final Documentation**
  - Execute full regression test suites and produce all 7 required markdown audit reports.
