# BACKEND_IMPLEMENTATION_BACKLOG: CloseBDS Backend (CloseVDS Acquisition OS)
**Prioritized Technical Backlog, Gap Remediation Specifications & Phased Implementation Roadmap**
**Governance Status**: Prepared for User & Orchestrator Approval prior to Phase R2 Execution
**Scope**: All 6 Specialized Subsystem Domains | **Priorities**: P0 (Blocker) to P5 (Polish)
**Author**: Worker Deliverables Author (Master Audit Synthesis)
**Date**: 2026-11-09

---

## 1. Executive Summary & Implementation Governance

This authoritative implementation backlog synthesizes all architectural gaps, contract discrepancies, security hardening requirements, and database expansion proposals discovered during the Phase R1 Read-Only Audit.

### Governance Guardrails for Phase R2 Execution:
1. **Frontend Immutability**: The frontend repository at `C:\Users\Admin\Desktop\CloseBDS OS\CloseBDS Frontend` remains **strictly read-only**. All contract alignments must be achieved via backend response aliasing, envelope formatting, and endpoint compatibility.
2. **Reuse Existing Foundations**: Zero unnecessary rewrites. Build directly upon existing services, repositories, schemas, and adapters.
3. **No Mock Shortcuts**: All implementations must persist to PostgreSQL via Prisma 6 and maintain genuine business state.
4. **Zero Financial Liability**: All provider adapters must maintain non-charging mock modes for automated testing; zero live phone number purchases or external paid operations.
5. **Git Safety**: No commits, branch creation, or pushes without explicit approval.

---

## 2. Master Backlog Summary by Priority

| Priority Tier | Classification | Count | Primary Focus |
|:---:|:---|:---:|:---|
| **`P0`** | **Blocker** | **3** | Multi-tenant secret isolation, container restart persistence, runtime environment protection. |
| **`P1`** | **Critical** | **5** | Safety engine fail-closed hardening, call recording ingestion, UI contract mismatches, workspace settings persistence. |
| **`P2`** | **High** | **5** | RBAC permission gates, dental clinic schema attributes, audit logs endpoint, appointment scheduling, deduplication unification. |
| **`P3`** | **Medium** | **5** | Connection pool limits, webhook tenant routing disambiguation, outbound anti-SSRF, native studio column cleanup, WhatsApp model. |
| **`P4`** | **Low** | **4** | Discovery query caching, server-side multi-field lead filtering/sorting, live HTML audit crawling, batch lead mutations. |
| **`P5`** | **Polish** | **3** | Campaign metrics pre-aggregation rollups, voice analytics provider breakdowns, multi-touch sequence step state machine. |
| **TOTAL** | **All Tiers** | **25** | **Comprehensive Full-System Engineering Roadmap** |

---

## 3. Detailed Backlog Specifications (P0 to P5)

### PRIORITY P0: BLOCKER (Security, Multi-Tenancy & Persistence)

#### Item P0-1: Eliminate Runtime `process.env` Mutation in Voice AI Service
- **Priority**: `P0 Blocker`
- **Workstream & Domain**: AI Calling & Security Subsystem
- **Exact Affected Files**:
  - `backend/src/modules/voice/voice-ai.service.ts` (lines 207-219)
  - `backend/src/integrations/voice-ai/retell.adapter.ts`
  - `backend/src/integrations/voice-ai/vapi.adapter.ts`
  - `backend/tests/voice-ai-providers.test.ts`
- **Existing Implementation Summary**:
  When `updateCredentials(workspaceId, providerId, credentials)` is called, it mutates global process variables:
  ```typescript
  if (providerId === 'retell') {
    if (credentials.apiKey) process.env.RETELL_API_KEY = credentials.apiKey;
    if (credentials.webhookSecret) process.env.RETELL_WEBHOOK_SECRET = credentials.webhookSecret;
  }
  ```
- **Required Change / Implementation Details**:
  1. Completely remove all assignments to `process.env.*`.
  2. Load decrypted credentials strictly per-workspace from `workspaceProviderCredentialRepository`.
  3. Update `RetellVoiceAIAdapter` and `VapiVoiceAIAdapter` execution methods to accept per-workspace credentials or dynamically initialize client contexts using `workspaceProviderCredentialRepository.getDecryptedCredentials(workspaceId)`.
- **Dependencies & Prerequisites**: `WorkspaceProviderCredentialRepository`, `credential-vault.ts`.
- **Test Cases & Verification Method**:
  - Test multi-tenant isolation: Configure Workspace A with Key A and Workspace B with Key B; assert Workspace B operations never use Key A.
  - Verify `npm test` passes with 0 failures.
- **Risk Level & Mitigation Strategy**: High (Multi-tenant data leakage if unaddressed).
- **Acceptance Criteria**: Zero mutations to `process.env` anywhere in `src/modules/voice/`.

---

#### Item P0-2: Hydrate Carrier Phone Numbers from PostgreSQL on Container Restart
- **Priority**: `P0 Blocker`
- **Workstream & Domain**: Telephony & Database Subsystem
- **Exact Affected Files**:
  - `backend/src/modules/voice/phone-numbers.service.ts` (lines 24, 52-71)
  - `backend/src/database/repository.ts` (`TelephonyPhoneNumberRepository`)
  - `backend/tests/twilio-telephony.test.ts`
- **Existing Implementation Summary**:
  `phoneNumbersService.listPhoneNumbers(workspaceId)` and `getPhoneNumber(workspaceId, id)` query exclusively from `private numberStore: Map<string, Map<string, TelephonyPhoneNumber>>`.
  After a container restart or deployment, `this.numberStore` is empty, making all registered carrier numbers in PostgreSQL invisible in the UI.
- **Required Change / Implementation Details**:
  Replace in-memory Map queries in `listPhoneNumbers` and `getPhoneNumber` with direct asynchronous calls to `this.telephonyRepo.listByWorkspace(workspaceId)` and `this.telephonyRepo.findById(workspaceId, id)`.
- **Dependencies & Prerequisites**: `telephonyPhoneNumberRepository`.
- **Test Cases & Verification Method**:
  - Unit test: Seed database with phone number, instantiate fresh `PhoneNumbersService` (empty Map), assert `listPhoneNumbers(workspaceId)` returns seeded database records.
- **Risk Level & Mitigation Strategy**: High (Data loss / invisibility on container restart).
- **Acceptance Criteria**: All phone number operations read from and write to PostgreSQL via Prisma.

---

#### Item P0-3: Asynchronous Workspace Telephony Credential Hydration
- **Priority**: `P0 Blocker`
- **Workstream & Domain**: Telephony & Security Subsystem
- **Exact Affected Files**:
  - `backend/src/modules/voice/telephony.service.ts` (lines 39, 300-346)
  - `backend/src/integrations/calling/twilio.adapter.ts`
  - `backend/tests/twilio-telephony.test.ts`
- **Existing Implementation Summary**:
  `telephonyService.getAdapterForWorkspace(workspaceId)` is synchronous and relies on `this.credentialVault: Map<string, StoredTelephonyCredentials>`. If the cache is cold, it falls back to process environment variables rather than querying the database.
- **Required Change / Implementation Details**:
  Refactor `getAdapterForWorkspace` to be asynchronous (`async getAdapterForWorkspace(workspaceId: string): Promise<TwilioTelephonyAdapter>`), querying `workspaceProviderCredentialRepository.findByWorkspaceAndProvider(workspaceId, 'twilio')` and decrypting credentials on cache miss.
- **Dependencies & Prerequisites**: `workspaceProviderCredentialRepository`.
- **Test Cases & Verification Method**:
  - Assert that calling `getAdapterForWorkspace` with an unprimed in-memory cache fetches and decrypts credentials from PostgreSQL.
- **Risk Level & Mitigation Strategy**: High.
- **Acceptance Criteria**: Telephony credentials reliably load from PostgreSQL regardless of cache state.

---

### PRIORITY P1: CRITICAL (Safety & Contract Parity)

#### Item P1-1: Remove Short-Circuits from Safety Gates 14 & 16
- **Priority**: `P1 Critical`
- **Workstream & Domain**: Calling Safety Engine
- **Exact Affected Files**:
  - `backend/src/modules/voice/voice.safety.ts` (lines 239-253)
  - `backend/tests/voice-safety-operations.test.ts`
- **Existing Implementation Summary**:
  ```typescript
  addGate(14, 'Anti-Hallucination Guardrails Gate', hasProhibitedClaims || true);
  addGate(16, 'Voice AI Provider Configured Gate', aiConfigured || true);
  ```
  Appending `|| true` bypasses fail-closed safety evaluation.
- **Required Change / Implementation Details**:
  1. Remove `|| true` from Gate 14: assert `Boolean(ctx.agentConfig?.prohibitedClaims && ctx.agentConfig.prohibitedClaims.length > 0)`.
  2. Remove `|| true` from Gate 16: assert active Voice AI adapter is configured and verified for the requesting workspace.
  3. Ensure Gate 15 checks workspace database credentials rather than global environment variables.
- **Dependencies & Prerequisites**: `voice.safety.ts`, `workspaceProviderCredentialRepository`.
- **Test Cases & Verification Method**:
  - Test Gate 14 failure: Agent without `prohibitedClaims` must evaluate to `passed: false` and block dispatch.
  - Test Gate 16 failure: Unconfigured provider must evaluate to `passed: false` and block dispatch.
- **Risk Level & Mitigation Strategy**: Medium.
- **Acceptance Criteria**: All 18 gates strictly enforce fail-closed evaluation.

---

#### Item P1-2: Persist Webhook Call Recording Metadata to `Call` Table
- **Priority**: `P1 Critical`
- **Workstream & Domain**: AI Calling & Webhooks
- **Exact Affected Files**:
  - `backend/src/modules/voice/voice-webhook.service.ts` (lines 236-240, 255-268)
  - `backend/src/database/repository.ts` (`VoiceRepository.updateCallStatus`)
  - `backend/tests/voice-safety-lifecycle.test.ts`
- **Existing Implementation Summary**:
  When a provider delivers `event.recordingUrl` upon call completion, `voice-webhook.service.ts` logs it to `AuditLog.metadata` but omits it from `voiceRepository.updateCallStatus()`. Consequently, `Call.recordingUrl` remains `null` in PostgreSQL, breaking the frontend recording audio player.
- **Required Change / Implementation Details**:
  Update `voiceRepository.updateCallStatus` invocation in `processNormalizedVoiceEvent` to pass:
  ```typescript
  recordingUrl: event.recordingUrl ?? call.recordingUrl,
  recordingDuration: event.durationSeconds ?? call.recordingDuration,
  recordingChannels: 1,
  ```
- **Dependencies & Prerequisites**: `voiceRepository`, `prisma/schema.prisma` (`Call` model).
- **Test Cases & Verification Method**:
  - Deliver simulated Retell/Vapi webhook with `recordingUrl: "https://recordings.provider.com/call-123.wav"`. Assert `call.recordingUrl` in PostgreSQL matches the payload.
- **Risk Level & Mitigation Strategy**: Low.
- **Acceptance Criteria**: Audio recordings immediately play in the frontend UI.

---

#### Item P1-3: Fix High-Impact Frontend Contract Mismatches
- **Priority**: `P1 Critical`
- **Workstream & Domain**: API Routing & Contract Parity
- **Exact Affected Files**:
  - `backend/src/modules/campaigns/campaign.router.ts` (line 25)
  - `backend/src/modules/leads/lead.router.ts` (line 29)
  - `backend/src/modules/lead-discovery/discovery.router.ts` (line 24)
  - `backend/tests/contract-alignment.test.ts`
- **Existing Implementation Summary**:
  - `/campaigns` returns `{ success: true, data: Campaign[] }`; UI expects `.items`.
  - `/leads` returns `{ success: true, data: Lead[] }`; UI expects `.items`.
  - `/lead-discovery/query` returns flat `{ success: true, discoveredCount }`; UI expects `{ data: { discovered } }`.
- **Required Change / Implementation Details**:
  1. In `campaign.router.ts:25`: Return `{ success: true, ...result, items: result.data }`.
  2. In `lead.router.ts:29`: Return `{ success: true, ...result, items: result.data }`.
  3. In `discovery.router.ts:24`: Return `{ success: true, ...result, data: { discovered: result.discoveredCount, candidates: result.candidates, persisted: result.persistedCount, skippedDuplicates: result.skippedDuplicateCount } }`.
- **Dependencies & Prerequisites**: None.
- **Test Cases & Verification Method**:
  - Verify that `GET /campaigns` response includes both `data` array and `items` array.
  - Verify that `POST /lead-discovery/query` response includes `data.discovered`.
- **Risk Level & Mitigation Strategy**: Low (Fully backward compatible).
- **Acceptance Criteria**: Frontend discovery modal displays non-zero candidate count; campaign dropdown in call queue populates cleanly.

---

#### Item P1-4: Implement Persistent `WorkspaceSetting` Model in PostgreSQL
- **Priority**: `P1 Critical`
- **Workstream & Domain**: Database & Workspace Settings
- **Exact Affected Files**:
  - `backend/prisma/schema.prisma` (add `model WorkspaceSetting`)
  - `backend/prisma/migrations/` (new migration `20261110_add_workspace_settings`)
  - `backend/src/database/repository.ts` (add `WorkspaceSettingRepository`)
  - `backend/src/modules/settings/settings.service.ts`
  - `backend/tests/settings-notifications.test.ts`
- **Existing Implementation Summary**:
  `SettingsService` stores workspace settings in an ephemeral in-memory `Map`. Settings changes are lost upon server restart.
- **Required Change / Implementation Details**:
  1. Add `model WorkspaceSetting` to `schema.prisma` with columns: `id`, `workspaceId @unique`, `safetyConfig Json`, `aiConfig Json`, `suppressionConfig Json`, `generalConfig Json`, `createdAt`, `updatedAt`.
  2. Generate and apply non-destructive migration.
  3. Update `SettingsService` to query and persist settings via `WorkspaceSettingRepository`.
- **Dependencies & Prerequisites**: Prisma ORM, PostgreSQL.
- **Test Cases & Verification Method**:
  - Save workspace settings, restart service, assert settings persist and are returned accurately.
- **Risk Level & Mitigation Strategy**: Medium.
- **Acceptance Criteria**: Workspace settings persist across server restarts.

---

#### Item P1-5: Connect Real Password Recovery Routes in Frontend
- **Priority**: `P1 Critical`
- **Workstream & Domain**: Authentication & Frontend Integration
- **Exact Affected Files**:
  - `CloseVDS Frontend/app/(auth)/forgot-password/page.tsx`
  - `CloseVDS Frontend/app/(auth)/reset-password/page.tsx`
  - *(Note: Frontend repo is read-only; provide integration instructions and ensure backend routes match frontend form schemas exactly)*
- **Existing Implementation Summary**:
  Frontend pages use client-side `setTimeout` simulations, while backend has verified endpoints `POST /api/v1/auth/forgot-password` and `POST /api/v1/auth/reset-password`.
- **Required Change / Implementation Details**:
  Verify backend schemas accept `{ email }` for forgot-password and `{ token, password }` for reset-password. Ensure response payload shapes match frontend expectations.
- **Dependencies & Prerequisites**: `auth.router.ts`, `PasswordResetToken` table.
- **Test Cases & Verification Method**:
  - `tests/auth-password-reset.test.ts` passing 100%.
- **Risk Level & Mitigation Strategy**: Very Low.
- **Acceptance Criteria**: Real password recovery tokens generated and consumed.

---

### PRIORITY P2: HIGH (RBAC, Domain Models & Governance)

#### Item P2-1: Enforce RBAC Guards on Mutative Endpoints
- **Priority**: `P2 High`
- **Workstream & Domain**: Authorization & Security
- **Exact Affected Files**:
  - `backend/src/modules/campaigns/campaign.router.ts` (`POST /`, `PATCH /:id`, `DELETE /:id`)
  - `backend/src/modules/outreach/outreach.router.ts` (`POST /:id/approve`, `POST /:id/dispatch`)
  - `backend/src/modules/settings/settings.router.ts` (`PATCH /workspace`, `POST /suppressions`)
  - `backend/tests/auth.test.ts`
- **Existing Implementation Summary**:
  Routes only apply `requireAuthenticatedUser` and `requireWorkspaceContext`, allowing `MEMBER` users to execute campaign mutations and outreach dispatches.
- **Required Change / Implementation Details**:
  Apply `requireRole(['OWNER', 'ADMIN'])` to all mutative campaign, outreach approval/dispatch, and settings routes.
- **Dependencies & Prerequisites**: `auth-guards.ts`.
- **Test Cases & Verification Method**:
  - Authenticate as `MEMBER` and attempt `POST /api/v1/campaigns`; assert HTTP 403 Forbidden.
  - Authenticate as `ADMIN`; assert HTTP 201 Created.
- **Risk Level & Mitigation Strategy**: Low.
- **Acceptance Criteria**: Only `OWNER` and `ADMIN` roles can mutate campaigns, approve dispatches, or modify settings.

---

#### Item P2-2: Dental Clinic Domain Attributes Schema Expansion
- **Priority**: `P2 High`
- **Workstream & Domain**: Database & Leads Subsystem
- **Exact Affected Files**:
  - `backend/prisma/schema.prisma` (`Lead` model)
  - `backend/prisma/migrations/` (new migration `20261110_expand_dental_lead_columns`)
  - `backend/src/modules/leads/lead.schema.ts`
  - `backend/src/modules/leads/lead.service.ts`
  - `backend/tests/leads.test.ts`
- **Existing Implementation Summary**:
  `Lead` model lacks dedicated dental specialization attributes. Ratings and review counts are packed inside JSON (`LeadSource.queryPayload`), violating Project Principle 6.
- **Required Change / Implementation Details**:
  Add nullable columns to `Lead`: `practiceType String?`, `chairCount Int?`, `doctorCount Int?`, `googleRating Decimal?`, `googleReviewCount Int?`.
- **Dependencies & Prerequisites**: Prisma ORM, PostgreSQL.
- **Test Cases & Verification Method**:
  - Create lead with dental clinic attributes; assert fields persist and query accurately.
- **Risk Level & Mitigation Strategy**: Low (Non-destructive column addition).
- **Acceptance Criteria**: Dental clinic attributes exist as first-class, indexable PostgreSQL columns.

---

#### Item P2-3: Expose Back-Office Audit Logs Endpoint
- **Priority**: `P2 High`
- **Workstream & Domain**: Settings & Compliance
- **Exact Affected Files**:
  - `backend/src/modules/settings/settings.router.ts`
  - `backend/src/database/repository.ts` (`AuditRepository`)
  - `backend/tests/settings-notifications.test.ts`
- **Existing Implementation Summary**:
  `AuditLog` table and `auditRepository.findManyPaginated` exist, but no route is mounted in Fastify.
- **Required Change / Implementation Details**:
  Mount `GET /api/v1/settings/audit-logs` in `settings.router.ts` with `requireRole(['OWNER', 'ADMIN'])`, supporting pagination (`page`, `limit`) and event filtering.
- **Dependencies & Prerequisites**: `auditRepository`.
- **Test Cases & Verification Method**:
  - Query `GET /api/v1/settings/audit-logs`; assert paginated array of immutable audit events returned.
- **Risk Level & Mitigation Strategy**: Very Low.
- **Acceptance Criteria**: Resolves the single `MISSING` route in the 120-endpoint matrix.

---

#### Item P2-4: Dedicated Appointment / Meeting Scheduling Model
- **Priority**: `P2 High`
- **Workstream & Domain**: CRM & Calendar Subsystem
- **Exact Affected Files**:
  - `backend/prisma/schema.prisma` (add `model Appointment`)
  - `backend/prisma/migrations/`
  - `backend/src/database/repository.ts` (`AppointmentRepository`)
  - `backend/src/modules/crm/crm.service.ts`
- **Existing Implementation Summary**:
  Booked meetings are only logged as unstructured text notes in `crm_activities`.
- **Required Change / Implementation Details**:
  Add `Appointment` model: `id`, `workspaceId`, `leadId`, `contactId?`, `scheduledStartTime`, `scheduledEndTime`, `meetingLink?`, `status`, `notes?`.
- **Dependencies & Prerequisites**: Prisma ORM, PostgreSQL.
- **Test Cases & Verification Method**:
  - Create and reschedule appointments; assert foreign key cascades to `Lead` and `Workspace`.
- **Risk Level & Mitigation Strategy**: Low.
- **Acceptance Criteria**: Calendar appointments are managed as first-class relational entities.

---

#### Item P2-5: Unify Lead Ingestion Deduplication Logic
- **Priority**: `P2 High`
- **Workstream & Domain**: Leads & Discovery Subsystem
- **Exact Affected Files**:
  - `backend/src/modules/leads/lead.service.ts`
  - `backend/src/modules/lead-discovery/discovery.service.ts`
  - `backend/src/database/repository.ts` (`LeadRepository`)
  - `backend/tests/leads.test.ts`
- **Existing Implementation Summary**:
  `createLead` relies on strict 4-factor equality, while discovery uses a 3-tier fuzzy match.
- **Required Change / Implementation Details**:
  Standardize `LeadService.createLead` and `importCloseBDSLeads` to use the 3-tier hierarchical deduplication engine (`findExistingLeadForDiscovery`).
- **Dependencies & Prerequisites**: `LeadRepository`.
- **Test Cases & Verification Method**:
  - Submit duplicate lead with phone format variation; assert duplicate is identified and updated rather than duplicated.
- **Risk Level & Mitigation Strategy**: Low.
- **Acceptance Criteria**: Zero duplicate leads created from variations in phone or domain formatting.

---

### PRIORITY P3: MEDIUM (Configuration, Routing & Hardening)

#### Item P3-1: Connection Pool Parameter Formatting in Prisma Client
- **Priority**: `P3 Medium`
- **Workstream & Domain**: Database Connection Layer
- **Exact Affected Files**:
  - `backend/src/database/client.ts`
  - `backend/src/config/env.ts`
- **Existing Implementation Summary**:
  `DATABASE_URL` is passed directly without appending pool query parameters.
- **Required Change / Implementation Details**:
  In `database/client.ts`, format connection URI to include `?connection_limit=${config.DATABASE_POOL_MAX}&pool_timeout=10` if not already present.
- **Dependencies & Prerequisites**: None.
- **Test Cases & Verification Method**:
  - Verify PostgreSQL connection pool initializes with configured maximum connections.
- **Risk Level & Mitigation Strategy**: Very Low.
- **Acceptance Criteria**: Connection pool limits enforced at the database connection layer.

---

#### Item P3-2: Disambiguate Webhook Tenant Routing by Outbound Message ID
- **Priority**: `P3 Medium`
- **Workstream & Domain**: Webhook Ingress & Multi-Tenancy
- **Exact Affected Files**:
  - `backend/src/modules/integrations/integration.service.ts` (lines 217-260)
  - `backend/src/database/repository.ts` (`OutreachRepository`)
  - `backend/tests/integrations-webhooks.test.ts`
- **Existing Implementation Summary**:
  Webhooks match contacts globally by email (`findFirst({ where: { email } })`). If identical prospect emails exist across workspaces, events are ambiguously attributed.
- **Required Change / Implementation Details**:
  Index outbound provider message IDs (`Outreach.providerMessageId`) and resolve tenant workspace by message ID before falling back to email search.
- **Dependencies & Prerequisites**: `outreachRepository`.
- **Test Cases & Verification Method**:
  - Dispatch webhook with `providerMessageId`; verify event resolves to exact originating workspace.
- **Risk Level & Mitigation Strategy**: Low.
- **Acceptance Criteria**: Zero cross-tenant webhook attribution collisions.

---

#### Item P3-3: Anti-SSRF Validation on Outbound n8n Webhook Deliveries
- **Priority**: `P3 Medium`
- **Workstream & Domain**: Integrations & Security
- **Exact Affected Files**:
  - `backend/src/modules/integrations/n8n/n8n.service.ts` (line 110)
  - `backend/src/modules/integrations/n8n/n8n.schema.ts`
  - `backend/src/security/ssrf.guard.ts`
- **Existing Implementation Summary**:
  `n8n.service.ts` dispatches webhooks to user-configured URLs without checking against loopbacks or cloud metadata endpoints.
- **Required Change / Implementation Details**:
  Validate `target.webhookUrl` with `validateUrlForAudit()` upon registration and prior to `fetch()` dispatch.
- **Dependencies & Prerequisites**: `ssrf.guard.ts`.
- **Test Cases & Verification Method**:
  - Attempt registering `http://169.254.169.254/latest/meta-data`; assert HTTP 400 Bad Request.
- **Risk Level & Mitigation Strategy**: Low.
- **Acceptance Criteria**: SSRF attacks blocked on outbound n8n webhooks.

---

#### Item P3-4: Standardize Native Voice Agent Studio Columns
- **Priority**: `P3 Medium`
- **Workstream & Domain**: Voice AI Subsystem
- **Exact Affected Files**:
  - `backend/src/modules/voice/voice-agent-readiness.service.ts` (lines 345-348)
  - `backend/tests/voice-agent-studio.test.ts`
- **Existing Implementation Summary**:
  Dual-writing studio metadata inside `objectionHandling._studio` JSON while also writing to native columns.
- **Required Change / Implementation Details**:
  Eliminate `_studio` JSON packing; read and write studio configuration purely through first-class columns.
- **Dependencies & Prerequisites**: `VoiceAgentConfig` expanded columns.
- **Test Cases & Verification Method**:
  - Verify studio wizard reads and updates first-class columns natively.
- **Risk Level & Mitigation Strategy**: Very Low.
- **Acceptance Criteria**: Clean relational persistence complying with Project Principle 6.

---

#### Item P3-5: Dedicated WhatsApp Message Model & Client Method
- **Priority**: `P3 Medium`
- **Workstream & Domain**: Cold Outreach & Messaging
- **Exact Affected Files**:
  - `backend/prisma/schema.prisma` (add `model WhatsAppMessage`)
  - `backend/src/modules/outreach/outreach.service.ts`
  - `backend/src/database/repository.ts`
- **Existing Implementation Summary**:
  WhatsApp dispatches log generic `CRMActivity` notes without dedicated message records.
- **Required Change / Implementation Details**:
  Create `WhatsAppMessage` model mirroring `EmailMessage` (`templateName`, `status`, `isApproved`, `providerMessageId`).
- **Dependencies & Prerequisites**: Prisma ORM, PostgreSQL.
- **Test Cases & Verification Method**:
  - Dispatch WhatsApp outreach; assert `WhatsAppMessage` created and tracked.
- **Risk Level & Mitigation Strategy**: Low.
- **Acceptance Criteria**: WhatsApp outreach tracked with identical rigor to email outreach.

---

### PRIORITY P4: LOW (Discovery Caching & Advanced Filtering)

#### Item P4-1: Lead Discovery Query Caching Table (`DiscoveryQuery`)
- **Priority**: `P4 Low`
- **Workstream & Domain**: Discovery Optimization & Database Subsystem
- **Exact Affected Files**:
  - `backend/prisma/schema.prisma` (add `model DiscoveryQuery`)
  - `backend/prisma/migrations/` (migration to create `discovery_queries` table)
  - `backend/src/modules/lead-discovery/discovery.service.ts` (lines 97-175)
  - `backend/src/database/repository.ts` (add `DiscoveryQueryRepository`)
  - `backend/tests/discovery-research.test.ts`
- **Existing Implementation Summary**:
  In `DiscoveryDomainService.executeDiscovery()` (`backend/src/modules/lead-discovery/discovery.service.ts`), every discovery query directly invokes `provider.discoverCandidates({ niche, location, limit, countryCode })` against external providers (Geoapify, OpenStreetMap Overpass API) in real time. There is no query caching table in PostgreSQL. When multiple users or repeated campaign workflows search the same geography and niche (e.g. "pediatric dentist" in "Austin, TX"), redundant outbound API calls consume provider rate limits, waste third-party quotas, and introduce 2-5 second network latencies.
- **Required Change / Implementation Details**:
  1. Add `model DiscoveryQuery` to `backend/prisma/schema.prisma`:
     ```prisma
     model DiscoveryQuery {
       id            String   @id @default(uuid())
       workspaceId   String
       queryHash     String   // SHA-256 hash of normalized lowercase `${niche}:${location}:${countryCode || ''}`
       provider      String   @default("geoapify")
       niche         String
       location      String
       countryCode   String?
       resultCount   Int      @default(0)
       rawResults    Json     // Cached NormalizedLeadCandidate[] array
       expiresAt     DateTime // Configurable TTL (default 7 days from creation)
       createdAt     DateTime @default(now())
       updatedAt     DateTime @updatedAt

       workspace     Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

       @@unique([workspaceId, queryHash])
       @@index([workspaceId])
       @@index([expiresAt])
       @@map("discovery_queries")
     }
     ```
  2. Implement `DiscoveryQueryRepository` in `backend/src/database/repository.ts` with `findByHash(workspaceId, queryHash)` and `upsertCache(workspaceId, data)`.
  3. In `DiscoveryDomainService.executeDiscovery()`, compute deterministic `queryHash`. Check for unexpired cached record (`expiresAt > new Date()`). If found, hydrate candidate list directly from `rawResults` and run workspace deduplication, bypassing outbound provider requests. If cache miss, fetch from provider, persist to `DiscoveryQuery`, and return.
- **Dependencies & Prerequisites**:
  Prisma ORM, PostgreSQL, Node.js `node:crypto`, `DiscoveryDomainService`.
- **Test Cases & Verification Method**:
  - Test cache miss: Execute discovery query for a new geography; assert external provider is invoked and `DiscoveryQuery` row is created.
  - Test cache hit: Execute identical query within 7 days; assert provider adapter method is not invoked and cached results are returned.
  - Test expiration: Seed cached row with `expiresAt` in the past; assert provider is invoked and cache refreshed.
  - Verification command: `npm test` executing `tests/discovery-research.test.ts`.
- **Risk Level & Mitigation Strategy**:
  Very Low. Caching is purely internal and additive. Risk of stale data is mitigated by an explicit 7-day TTL and an optional `forceRefresh: boolean` parameter in `leadDiscoveryQuerySchema`.
- **Acceptance Criteria**:
  Duplicate discovery queries for the same niche and location within TTL resolve from PostgreSQL cache without triggering third-party provider requests, reducing query latency to under 50ms.

---

#### Item P4-2: Multi-Field Search & Server-Side Sorting on `/leads`
- **Priority**: `P4 Low`
- **Workstream & Domain**: Leads API & Query Performance
- **Exact Affected Files**:
  - `backend/src/modules/leads/lead.schema.ts` (lines 60-66)
  - `backend/src/modules/leads/lead.service.ts` (lines 35-50)
  - `backend/src/database/repository.ts` (`LeadRepository.findManyPaginated`, lines 260-310)
  - `backend/tests/leads.test.ts`
- **Existing Implementation Summary**:
  The `leadQuerySchema` in `backend/src/modules/leads/lead.schema.ts` only accepts `campaignId`, `status`, `search`, `page`, and `limit`. In `LeadRepository.findManyPaginated()`, the query hardcodes `orderBy: { createdAt: 'desc' }` and only filters `search` across `businessName`, `domain`, and `address`. Sorting by lead qualification score, business name, rating, or creation date, as well as multi-field filtering by location, minimum qualification score, or practice attributes, is unsupported at the database level, forcing the frontend UI to load all leads and perform inefficient client-side sorting and filtering.
- **Required Change / Implementation Details**:
  1. Expand `leadQuerySchema` in `backend/src/modules/leads/lead.schema.ts`:
     ```typescript
     export const leadQuerySchema = z.object({
       campaignId: z.string().uuid().optional(),
       status: leadStatusEnum.optional(),
       search: z.string().max(100).optional(),
       location: z.string().max(100).optional(),
       minScore: z.coerce.number().min(0).max(100).optional(),
       sortBy: z.enum(['createdAt', 'businessName', 'score', 'googleRating']).default('createdAt').optional(),
       sortOrder: z.enum(['asc', 'desc']).default('desc').optional(),
       page: z.coerce.number().int().positive().default(1),
       limit: z.coerce.number().int().positive().max(100).default(20),
     });
     ```
  2. In `LeadRepository.findManyPaginated()`, construct dynamic Prisma `where` conditions:
     - If `filter.location`: add `{ address: { contains: filter.location, mode: 'insensitive' } }`.
     - If `filter.minScore`: add `{ leadScore: { overallScore: { gte: filter.minScore } } }`.
  3. Construct dynamic Prisma `orderBy`:
     - If `sortBy === 'score'`: `orderBy: { leadScore: { overallScore: sortOrder } }`.
     - If `sortBy === 'businessName'`: `orderBy: { businessName: sortOrder }`.
     - If `sortBy === 'googleRating'`: `orderBy: { googleRating: sortOrder }`.
     - Default: `orderBy: { [sortBy]: sortOrder }`.
- **Dependencies & Prerequisites**:
  `LeadRepository`, `leadQuerySchema`, PostgreSQL Prisma relations (`leadScore`).
- **Test Cases & Verification Method**:
  - Test server-side sorting: Query `GET /api/v1/leads?sortBy=score&sortOrder=desc`; assert returned records are ordered monotonically descending by `leadScore.overallScore`.
  - Test multi-field filter: Query `GET /api/v1/leads?location=Austin&minScore=75`; assert only leads matching both conditions are returned.
  - Test pagination stability: Verify `totalPages` and `total` count reflect filtered set accurately.
  - Verification command: `npm test` executing `tests/leads.test.ts`.
- **Risk Level & Mitigation Strategy**:
  Very Low. Fully backward-compatible: defaults to `sortBy: 'createdAt'` and `sortOrder: 'desc'` if query parameters are omitted.
- **Acceptance Criteria**:
  Server-side sorting and multi-field filtering execute directly in PostgreSQL, eliminating the need for client-side lead re-sorting in the frontend data table.

---

#### Item P4-3: Live HTML Crawling & Real TLS Certificate Verification
- **Priority**: `P4 Low`
- **Workstream & Domain**: Lead Research & Technical Audit Engine
- **Exact Affected Files**:
  - `backend/src/modules/lead-research/research.service.ts` (lines 40-125)
  - `backend/src/modules/lead-research/research.schema.ts`
  - `backend/src/security/ssrf.guard.ts`
  - `backend/src/integrations/ai/ai.adapter.ts`
  - `backend/tests/discovery-research.test.ts`
- **Existing Implementation Summary**:
  In `ResearchDomainService.executeResearch()` (`backend/src/modules/lead-research/research.service.ts`), website auditing relies entirely on either user-supplied `manualObservations` or passing a client-provided `htmlSnippet` to `AIService.analyzeWebsite()`. If neither is provided and no mock analyzer is configured, it returns an explicit `unavailable` status. The backend does not independently crawl the dental clinic's website over HTTP/HTTPS, does not establish a TLS handshake to check certificate validity/expiration, and cannot autonomously detect booking widgets (NexHealth, LocalMed, Zocdoc, PatientPrism).
- **Required Change / Implementation Details**:
  1. Add an autonomous live audit scanner in `backend/src/modules/lead-research/` with strict security and network controls:
     - Run `validateUrlForAudit(targetDomain)` through `ssrf.guard.ts` to block loopback (127.0.0.1, ::1), RFC 1918 private subnets, and AWS/GCP cloud metadata IPs (169.254.169.254).
     - Implement TLS inspector using Node.js `node:tls`:
       ```typescript
       const socket = tls.connect({ host: domain, port: 443, servername: domain, timeout: 5000 });
       const cert = socket.getPeerCertificate();
       // Extract valid_to, issuer, daysRemaining, authorized
       ```
     - Implement bounded HTTP fetch with a 5000ms timeout and 512KB payload ceiling to prevent memory denial-of-service.
     - Parse DOM (or regex token scan) for known dental booking iframe/script signatures (`nexhealth.com`, `localmed.com`, `zocdoc.com`, `smilesnap.com`, `patientprism.com`, `appointlet.com`).
  2. Populate `WebsiteAudit` with real audited metrics:
     - `mobileOptimized`: based on viewport meta tag presence.
     - `bookingCtaVisible`: based on detection of booking engine widgets or appointment booking links.
     - `auditGaps`: array listing specific deficiencies (e.g. `['NO_ONLINE_BOOKING', 'SSL_EXPIRING_SOON', 'SLOW_LOAD_TIME']`).
     - `rawAuditData`: JSON storing certificate expiry date, issuer, HTTP status, and detected widget signatures.
- **Dependencies & Prerequisites**:
  Node.js `node:tls`, `node:https`, `ssrf.guard.ts`, `WebsiteAuditRepository`.
- **Test Cases & Verification Method**:
  - Test SSRF guard: Pass internal IP `http://10.0.0.1`; assert rejected with HTTP 400 `ValidationError`.
  - Test TLS inspection: Test against mock TLS socket returning 30-day certificate; assert `rawAuditData.tlsDaysRemaining <= 30`.
  - Test widget detection: Feed HTML containing `<script src="https://assets.nexhealth.com/widget.js">`; assert `bookingCtaVisible: true`.
  - Verification command: `npm test` executing `tests/discovery-research.test.ts`.
- **Risk Level & Mitigation Strategy**:
  Low. External website crawling could hang or fail; mitigated by strict 5-second socket timeouts, 512KB response caps, SSRF validation, and fail-safe fallback to manual observation ingestion if clinic site is down.
- **Acceptance Criteria**:
  Lead research autonomously extracts real TLS certificate validity and dental booking widget presence from public dental clinic websites without requiring manual HTML snippets from the client.

---

#### Item P4-4: Batch Lead Operations (`bulk-update`, `bulk-delete`)
- **Priority**: `P4 Low`
- **Workstream & Domain**: Leads API & Bulk Processing
- **Exact Affected Files**:
  - `backend/src/modules/leads/lead.router.ts` (add route handlers)
  - `backend/src/modules/leads/lead.service.ts` (add `bulkUpdateLeads`, `bulkDeleteLeads`)
  - `backend/src/modules/leads/lead.schema.ts` (add `bulkUpdateLeadSchema`, `bulkDeleteLeadSchema`)
  - `backend/src/database/repository.ts` (`LeadRepository`)
  - `backend/tests/leads.test.ts`
- **Existing Implementation Summary**:
  The `leadRouter` in `backend/src/modules/leads/lead.router.ts` only exposes single-lead mutation endpoints: `PATCH /:id` and `DELETE /:id`. When users in the frontend Leads dashboard select multiple rows to batch-update status (e.g. mark 50 leads as `QUALIFIED`), assign them to a campaign, or delete disqualified leads, the frontend must execute N separate HTTP requests. This saturates HTTP connections, risks partial failure mid-batch, and lacks transactional atomicity.
- **Required Change / Implementation Details**:
  1. Define batch schemas in `backend/src/modules/leads/lead.schema.ts`:
     ```typescript
     export const bulkUpdateLeadSchema = z.object({
       leadIds: z.array(z.string().uuid()).min(1).max(200),
       data: z.object({
         status: leadStatusEnum.optional(),
         campaignId: z.string().uuid().nullable().optional(),
       }),
     });

     export const bulkDeleteLeadSchema = z.object({
       leadIds: z.array(z.string().uuid()).min(1).max(200),
     });
     ```
  2. Implement `bulkUpdateLeads` and `bulkDeleteLeads` in `LeadService` using Prisma operations scoped to `workspaceId`:
     ```typescript
     async bulkUpdateLeads(workspaceId: string, input: BulkUpdateLeadInput) {
       return this.prisma.lead.updateMany({
         where: { id: { in: input.leadIds }, workspaceId },
         data: input.data,
       });
     }

     async bulkDeleteLeads(workspaceId: string, leadIds: string[]) {
       return this.prisma.lead.deleteMany({
         where: { id: { in: leadIds }, workspaceId },
       });
     }
     ```
  3. Mount `POST /api/v1/leads/bulk-update` and `POST /api/v1/leads/bulk-delete` in `lead.router.ts` guarded by `requireRole(['OWNER', 'ADMIN'])` for deletions.
- **Dependencies & Prerequisites**:
  `LeadRepository`, `lead.router.ts`, `prisma.lead`.
- **Test Cases & Verification Method**:
  - Test batch update: Create 5 test leads; post `bulk-update` with `status: 'QUALIFIED'`; assert all 5 records updated in single response `{ count: 5 }`.
  - Test tenant isolation: Include a `leadId` belonging to Workspace B in a request from Workspace A; assert Workspace B record is not modified.
  - Test batch delete: Post `bulk-delete` with 5 IDs; assert records removed and cascade to contacts/scores.
  - Verification command: `npm test` executing `tests/leads.test.ts`.
- **Risk Level & Mitigation Strategy**:
  Very Low. Standard atomic relational operations. Accidental deletion risk is mitigated by requiring `ADMIN`/`OWNER` role and capping batch size at 200 items per request.
- **Acceptance Criteria**:
  Batches of up to 200 leads can be updated or deleted in a single transactional HTTP request with strict workspace scoping.

---

### PRIORITY P5: POLISH (Telemetry & Sequences)

#### Item P5-1: Campaign Performance Telemetry Rollup Table (`WorkspaceDailyMetric`)
- **Priority**: `P5 Polish`
- **Workstream & Domain**: Analytics, Telemetry & Performance Optimization
- **Exact Affected Files**:
  - `backend/prisma/schema.prisma` (add `model WorkspaceDailyMetric`)
  - `backend/prisma/migrations/` (migration to create `workspace_daily_metrics` table)
  - `backend/src/modules/analytics/analytics.service.ts` (lines 35-120)
  - `backend/src/modules/analytics/analytics.types.ts`
  - `backend/src/jobs/metric-rollup.job.ts`
  - `backend/tests/analytics.test.ts`
- **Existing Implementation Summary**:
  In `AnalyticsService` (`backend/src/modules/analytics/analytics.service.ts`), high-level overview metrics (`getOverview`, `getLeadsAnalytics`, `getOutreachAnalytics`, `getVoiceAnalytics`) are calculated by issuing unindexed, full-table scans across `Lead`, `Campaign`, `EmailMessage`, `CRMActivity`, and `Call` on every request. As database volume scales to tens of thousands of outbound calls and leads, on-demand aggregation causes severe query latency and database lock contention.
- **Required Change / Implementation Details**:
  1. Add `model WorkspaceDailyMetric` in `backend/prisma/schema.prisma`:
     ```prisma
     model WorkspaceDailyMetric {
       id                   String   @id @default(uuid())
       workspaceId          String
       date                 DateTime // Midnight UTC
       leadsDiscovered      Int      @default(0)
       leadsContacted       Int      @default(0)
       leadsQualified       Int      @default(0)
       callsDispatched      Int      @default(0)
       callsCompleted       Int      @default(0)
       callsAnswered        Int      @default(0)
       emailsSent           Int      @default(0)
       emailsOpened         Int      @default(0)
       emailsReplied        Int      @default(0)
       appointmentsBooked   Int      @default(0)
       totalCallDurationSec Int      @default(0)
       createdAt            DateTime @default(now())
       updatedAt            DateTime @updatedAt

       workspace            Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

       @@unique([workspaceId, date])
       @@index([workspaceId, date])
       @@map("workspace_daily_metrics")
     }
     ```
  2. Create a daily/hourly rollup background worker in `backend/src/jobs/metric-rollup.job.ts` that calculates and upserts summary rows for each active workspace.
  3. Update `AnalyticsService.getOverview()` and trend endpoints to query pre-aggregated `workspace_daily_metrics` for historical date ranges (`filter.from` to `filter.to`), falling back to live count only for the current in-progress day.
- **Dependencies & Prerequisites**:
  Prisma ORM, PostgreSQL, `AnalyticsService`, background job scheduler.
- **Test Cases & Verification Method**:
  - Test rollup calculation: Seed test workspace with 10 leads, 5 calls, and 3 appointments; run rollup job; assert `WorkspaceDailyMetric` row accurately matches totals.
  - Test analytics query acceleration: Query `GET /api/v1/analytics/overview?from=2026-10-01&to=2026-10-31`; assert query executes via `workspaceDailyMetric.findMany` instead of raw multi-table scans.
  - Verification command: `npm test` executing `tests/analytics.test.ts`.
- **Risk Level & Mitigation Strategy**:
  Very Low. Rollup table is purely additive and optimizes read performance. Real-time accuracy for today's activity is preserved by combining historical rollup rows with live counts for `today()`.
- **Acceptance Criteria**:
  Historical analytics queries over 30-to-90 day ranges execute in under 20ms using indexed rollup tables rather than multi-table aggregation scans.

---

#### Item P5-2: Provider Breakdown Telemetry in Voice Analytics
- **Priority**: `P5 Polish`
- **Workstream & Domain**: Voice AI Subsystem & Telemetry Reporting
- **Exact Affected Files**:
  - `backend/src/modules/analytics/analytics.service.ts` (lines 140-195)
  - `backend/src/modules/analytics/analytics.types.ts` (`VoiceAnalytics` interface)
  - `backend/tests/analytics.test.ts`
  - `backend/tests/voice-ai-providers.test.ts`
- **Existing Implementation Summary**:
  `AnalyticsService.getVoiceAnalytics()` aggregates calls into `byStatus` and `byOutcome` maps, but completely lacks provider-level telemetry breakdown. The system integrates three distinct voice providers (Twilio for telephony transport, Retell AI for natural turn-taking conversational voice, and Vapi for custom assistants), but the analytics API does not report call volume, latency, or completion rates partitioned by provider (`twilio`, `retell`, `vapi`). Frontend telemetry charts cannot display provider distribution or diagnose provider-specific failure spikes.
- **Required Change / Implementation Details**:
  1. Expand `VoiceAnalytics` interface in `backend/src/modules/analytics/analytics.types.ts`:
     ```typescript
     export interface VoiceAnalytics {
       totalCalls: number;
       byStatus: Record<string, number>;
       byOutcome: Record<string, number>;
       byProvider: {
         telephony: Record<string, number>; // e.g. { twilio: 120 }
         voiceAi: Record<string, number>;   // e.g. { retell: 85, vapi: 35 }
       };
       providerPerformance: Record<string, {
         totalCalls: number;
         completedCalls: number;
         averageDurationSeconds: number;
         errorCount: number;
       }>;
       totalDuration: number;
       averageDurationSeconds: number;
       approvalRate: number;
       meetingsRequested: number;
       callbacksRequested: number;
       optOutCount: number;
     }
     ```
  2. In `AnalyticsService.getVoiceAnalytics()`, inspect provider metadata from `call.campaign.voiceCampaign.provider` or call events during the call aggregation loop:
     - Tally `byProvider.telephony['twilio']`.
     - Tally `byProvider.voiceAi[providerKey]`.
     - Compute per-provider average duration and completion rate.
  3. Include `byProvider` and `providerPerformance` in the returned response object.
- **Dependencies & Prerequisites**:
  `AnalyticsService`, `Call` model, `VoiceCampaign` model.
- **Test Cases & Verification Method**:
  - Seed calls created via Retell and Vapi adapters; invoke `GET /api/v1/analytics/voice`.
  - Assert response payload contains `byProvider.voiceAi.retell` and `byProvider.voiceAi.vapi` with matching integer counts.
  - Assert `providerPerformance` accurately calculates per-provider completion rates.
  - Verification command: `npm test` executing `tests/analytics.test.ts`.
- **Risk Level & Mitigation Strategy**:
  Very Low. Pure additive extension to the existing analytics JSON payload; existing frontend charts reading `byStatus` and `byOutcome` continue unaffected.
- **Acceptance Criteria**:
  Voice analytics API delivers granular provider breakdown telemetry (`twilio`, `retell`, `vapi`), enabling multi-provider performance comparison in the frontend UI.

---

#### Item P5-3: Multi-Touch Sequence Steps Engine (`CampaignStep`)
- **Priority**: `P5 Polish`
- **Workstream & Domain**: Campaigns Orchestration & Multi-Channel Sequences
- **Exact Affected Files**:
  - `backend/prisma/schema.prisma` (add `model CampaignStep` and `enum CampaignStepChannel`)
  - `backend/prisma/migrations/` (migration to create `campaign_steps` table)
  - `backend/src/modules/campaigns/campaign.service.ts` (lines 80-160)
  - `backend/src/modules/campaigns/campaign.schema.ts`
  - `backend/src/modules/campaigns/campaign.router.ts`
  - `backend/src/database/repository.ts` (add `CampaignStepRepository`)
  - `backend/tests/campaigns.test.ts`
- **Existing Implementation Summary**:
  The `Campaign` entity in `backend/prisma/schema.prisma` only supports mutually exclusive single-channel campaigns via 1-to-1 relations to `EmailCampaign?` or `VoiceCampaign?`. There is no data model, scheduling engine, or execution state machine for multi-touch cadences (e.g. Step 1: AI Phone Call -> If no answer, wait 24 hours -> Step 2: Automated WhatsApp message -> If no reply in 48 hours -> Step 3: Cold Email with clinic case study). Outreach is currently executed as disconnected single-channel blasts.
- **Required Change / Implementation Details**:
  1. Add `model CampaignStep` and enums in `backend/prisma/schema.prisma`:
     ```prisma
     enum CampaignStepChannel {
       VOICE
       EMAIL
       WHATSAPP
       SMS
     }

     enum StepTriggerCondition {
       ALWAYS
       ON_NO_ANSWER
       ON_VOICEMAIL
       ON_NO_REPLY
       ON_INTERESTED
     }

     model CampaignStep {
       id               String                @id @default(uuid())
       campaignId       String
       stepOrder        Int                   // 1, 2, 3...
       channel          CampaignStepChannel
       condition        StepTriggerCondition  @default(ALWAYS)
       delayHours       Int                   @default(0) // Delay relative to previous step
       templateId       String?               // Email template or WhatsApp template ID
       voiceAgentConfig Json?                 // Overrides for AI voice script if channel is VOICE
       createdAt        DateTime              @default(now())
       updatedAt        DateTime              @updatedAt

       campaign         Campaign              @relation(fields: [campaignId], references: [id], onDelete: Cascade)

       @@unique([campaignId, stepOrder])
       @@index([campaignId])
       @@map("campaign_steps")
     }
     ```
  2. Implement `CampaignStepRepository` in `backend/src/database/repository.ts` with `findStepsByCampaign(campaignId)`, `reorderSteps(campaignId, stepIds)`, and step CRUD.
  3. Mount sequence step endpoints in `campaign.router.ts`:
     - `GET /api/v1/campaigns/:id/steps`
     - `POST /api/v1/campaigns/:id/steps`
     - `PATCH /api/v1/campaigns/:id/steps/:stepId`
     - `DELETE /api/v1/campaigns/:id/steps/:stepId`
  4. Extend `CampaignService` to manage steps and integrate sequence transition logic within outbound dispatch queues.
- **Dependencies & Prerequisites**:
  Prisma ORM, PostgreSQL, `Campaign` model, `VoiceCampaign`, `EmailCampaign`, `WhatsAppMessage`.
- **Test Cases & Verification Method**:
  - Test sequence creation: Create a 3-step sequence (Voice -> WhatsApp -> Email); assert steps persist with correct `stepOrder` (1, 2, 3).
  - Test step reordering: Swap order of steps 2 and 3; assert unique constraint on `[campaignId, stepOrder]` is maintained.
  - Test cascade deletion: Delete campaign; assert all associated `campaign_steps` are cleanly removed.
  - Verification command: `npm test` executing `tests/campaigns.test.ts`.
- **Risk Level & Mitigation Strategy**:
  Low. Additive data model; existing single-channel campaigns continue functioning normally without defining sequence steps.
- **Acceptance Criteria**:
  Campaigns support multi-touch, multi-channel sequences with configurable delay hours and trigger conditions persisted in PostgreSQL.

---

## 4. Phased Implementation Roadmap for Phase R2

Upon user review and approval, Phase R2 execution will proceed through five structured workstreams:

```
[ PHASE R1: Complete Audit & Deliverables ]  <=== (WE ARE HERE: APPROVED BASELINE)
                    |
                    v
[ WORKSTREAM 1: P0 Security & Multi-Tenant Isolations ]
- Eliminate process.env mutations in voice-ai.service.ts
- Hydrate telephony credentials & phone numbers from PostgreSQL
- Verify multi-tenant credential isolation in automated test suites
                    |
                    v
[ WORKSTREAM 2: P1 Critical Safety & Contract Alignment ]
- Remove short-circuits from Safety Gates 14 & 16
- Persist webhook audio recordings to Call table
- Apply dual-key response aliasing on /campaigns and /leads
- Wrap /lead-discovery/query responses in data envelope
- Implement WorkspaceSetting model in PostgreSQL
                    |
                    v
[ WORKSTREAM 3: P2 Governance, RBAC & Schema Expansions ]
- Enforce requireRole(['OWNER', 'ADMIN']) on mutative endpoints
- Add dental clinic columns (practiceType, chairCount, doctorCount) to Lead model
- Expose GET /api/v1/settings/audit-logs
- Implement Appointment model for CRM calendar booking
- Unify lead deduplication on 3-tier fuzzy match
                    |
                    v
[ WORKSTREAM 4: P3 Refinements & Hardening ]
- Format PostgreSQL connection pool parameters (?connection_limit=)
- Scope webhook routing by outbound provider message IDs
- Apply anti-SSRF to outbound n8n webhook deliveries
- Clean up Voice Agent Studio native column storage
                    |
                    v
[ WORKSTREAM 5: Final Verification & Handover ]
- Run strict TypeScript typecheck (tsc --noEmit)
- Execute all 33+ automated test suites
- Generate Final Verification Report and notify User
```

---

## 5. Verification Commands & Independent Test Criteria

To verify any stage of this backlog, execute the standard verification commands from `backend/`:

```powershell
cd "C:\Users\Admin\Desktop\CloseBDS OS\CloseBDS Backend\backend"

# 1. Typecheck: Verify 0 compilation errors under strict NodeNext settings
npm run typecheck

# 2. Automated Test Suite: Execute full test runner
npm test

# 3. Prisma Schema Validation
npx prisma validate
```

All 25 items in this backlog are defined with exact files, existing code summaries, required implementation changes, risk assessments, test cases, and acceptance criteria, ready for immediate execution in Phase R2 upon user approval.
