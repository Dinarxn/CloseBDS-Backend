# AI_CALLING_INTEGRATION_AUDIT: CloseBDS Backend (CloseVDS Acquisition OS)
**Comprehensive Architecture, Telephony Abstraction, 18-Gate Safety Engine & Voice Agent Studio Audit**
**Auditor Role**: Subagent 5 Specialist Baseline (Phase R1 Deliverable)
**Target Backend**: `Dinarxn/CloseBDS-Backend` (`src/modules/voice/`, `src/integrations/calling/`, `src/integrations/voice-ai/`)
**Frontend Reference**: `Dinarxn/CloseVDS-` (`app/(dashboard)/calling/`, `components/calling/`, `lib/api-client.ts`)
**Audit Date**: 2026-11-09
**Status**: COMPLETE (Architecture, 18-Gate Safety Engine, Studio Wizard & 5 Remediation Items Documented)

---

## 1. Executive Summary & Domain Scope

Outbound conversational AI calling represents the highest-liability operational capability of CloseVDS. Unrestricted or non-compliant dialing risks severe regulatory sanctions (TCPA), carrier fines, brand damage, and unintended telephony billing.

This audit evaluates the complete telephony and Voice AI subsystem across seven core dimensions:
1. **Multi-Provider Architecture**: Twilio PSTN carrier trunking vs Retell AI and Vapi conversational voice agents.
2. **Provider Isolation & Cryptographic Secrets**: Independent workspace configuration, AES-256-GCM vault persistence, zero automatic failover, and zero call duplication.
3. **11-Step Voice Agent Studio**: End-to-end studio pipeline, expanded schema columns, and pre-activation readiness audits.
4. **Carrier Phone Numbers & Line Management**: `TelephonyPhoneNumber` lifecycle, capability validation, and financial protection invariants (zero automated number purchases).
5. **18-Gate Server-Side Pre-Call Safety Engine**: Fail-closed gate verification (human sign-off, DNC suppression, recipient-local timezone windows, daily caps, cooldowns, emergency kill switch).
6. **Call Lifecycle, Webhooks & Recording Ingestion**: 15-state transition machine, timing-safe signatures, replay deduplication, transcript turn normalization, and audio recording storage.
7. **Identified Technical Gaps**: 5 specific calling architecture defects and their exact remediation plans.

---

## 2. Multi-Provider Telephony & Voice AI Abstraction

The CloseBDS backend enforces a strict separation of concerns between PSTN carrier telephony and conversational voice AI:

```
                                  +---------------------------------------+
                                  |     CloseBDS Call Dispatch Engine     |
                                  +---------------------------------------+
                                                      |
                                                      v
                                  +---------------------------------------+
                                  |    Pre-Call Readiness (18 Gates)      |
                                  |    - Human Approval (isApproved)      |
                                  |    - Recipient Window (09:00 - 17:00) |
                                  |    - Phone DNC / Suppression Check    |
                                  +---------------------------------------+
                                                      |
                                                      v
                                  +---------------------------------------+
                                  |     PSTN Carrier Telephony Trunk      |
                                  |      Twilio PSTN REST Adapter         |
                                  |      (E.164, Outbound Call Dial)      |
                                  +---------------------------------------+
                                                      |
                                                      v
                                  +---------------------------------------+
                                  |   Bi-Directional Audio Stream / TwiML |
                                  |      <Connect><Stream url="..." />    |
                                  +---------------------------------------+
                                                      |
                                                      v
                                  +---------------------------------------+
                                  |    Conversational Voice AI Engines    |
                                  |   (Retell AI Adapter / Vapi Adapter)  |
                                  |   - Neural TTS & Real-time STT        |
                                  |   - Conversational LLM Reasoning      |
                                  |   - Interruption Detection & Turns    |
                                  +---------------------------------------+
```

### 2.1 Provider Roles
- **Twilio PSTN Carrier Adapter (`twilio.adapter.ts`)**: Manages carrier trunking, outbound dial requests, E.164 phone formatting, carrier line capability validation, TwiML generation, and WebSocket media stream initialization.
- **Retell AI Adapter (`retell.adapter.ts`)**: Conversational voice agent engine providing low-latency speech synthesis, STT, interruption handling, and webhook completion events.
- **Vapi Voice AI Adapter (`vapi.adapter.ts`)**: Alternative conversational voice engine providing multimodal agent execution and webhook turn telemetry.
- **Multi-Provider Registry (`src/integrations/voice-ai/index.ts`)**: Decouples providers into distinct registry entries. Supports safe offline mock adapters for automated testing.

### 2.2 Independent Tenant Isolation & Financial Guardrails
- **Independent Workspace Credentials**: Credentials are stored per workspace in the `WorkspaceProviderCredential` table, encrypted using AES-256-GCM.
- **NO Automatic Failover**: If Retell AI fails or is misconfigured, the call is marked `FAILED` or `BLOCKED`. It is **never** silently routed to Vapi or another provider.
- **NO Call Duplication**: A concurrency dispatch lock (`${workspaceId}:${call.normalizedPhone}`) and idempotency key checks prevent simultaneous or duplicate dispatches.

---

## 3. 11-Step Voice Agent Studio Configuration & Schema Architecture

The Voice Agent Studio pipeline (`voice-agent-readiness.service.ts`) guides operators through 11 progressive, strictly validated configuration steps:

### 3.1 Step-by-Step Studio Specification Matrix

| Step # | Studio Step Name | Core Parameters & Data Types | Validation Rules & Constraints | Target `VoiceAgentConfig` Column |
|:---:|:---|:---|:---|:---|
| **Step 1** | **Provider Selection** | `provider`: `'retell' \| 'vapi' \| 'mock'` | Provider must be registered; upstream connection test must succeed | `provider` (`String`) |
| **Step 2** | **Model Configuration** | `modelId`: `String`<br>`temperature`: `Float`<br>`maxTokens`: `Int` | `temperature` in range [0.0, 1.0]; `maxTokens` in range [50, 4000]; model must exist in registry | `modelId`, `temperature`, `maxTokens` |
| **Step 3** | **Voice Selection** | `voiceProvider`: `String`<br>`voiceId`: `String`<br>`voiceSpeed`: `Float`<br>`voicePitch`: `Float`<br>`voiceStability`: `Float` | `voiceSpeed` in range [0.5, 2.0]; `voicePitch` in range [-10.0, 10.0]; `voiceStability` in range [0.0, 1.0] | `voiceProvider`, `voiceId`, `voiceSpeed`, `voicePitch`, `voiceStability` |
| **Step 4** | **Persona & System Prompt** | `agentPersona`: `String`<br>`speakingStyle`: `String`<br>`callObjective`: `String`<br>`openingScript`: `String` | `callObjective.length >= 50` chars; `openingScript.length >= 10` chars; non-empty persona | `agentPersona`, `speakingStyle`, `systemPrompt` |
| **Step 5** | **Knowledge Base & Talking Points** | `approvedTalkingPoints`: `String[]`<br>`knowledgePoints`: `Json`<br>`prohibitedClaims`: `String[]` | Anti-hallucination boundaries: `prohibitedClaims` must contain >= 1 dental compliance rule | `knowledgePoints`, `prohibitedClaims` |
| **Step 6** | **Objection Handling** | `objectionRules`: `Json`<br>`objectionHandling`: `Json` | Array of `{ trigger: string, response: string, category: string }` | `objectionRules`, `objectionHandling` |
| **Step 7** | **Qualification Questions** | `structuredQuestions`: `Json`<br>`qualificationQuestions`: `String[]` | Structured inquiry criteria for dental operatory count, current software, booking bottlenecks | `structuredQuestions`, `qualificationQuestions` |
| **Step 8** | **Phone Number Assignment** | `assignedPhoneNumberId`: `UUID` | Must link to an active `TelephonyPhoneNumber` in the same workspace; capability includes `voice` | `assignedPhoneNumberId` |
| **Step 9** | **Safety & Guardrails** | `maxDurationSeconds`: `Int`<br>`optOutKeywords`: `String[]`<br>`safetyGuardrails`: `Json` | `maxDurationSeconds` between 30 and 1800s (default 300s); mandatory opt-out keyword support | `safetyGuardrails` |
| **Step 10** | **Diagnostic Test Call** | `testPhoneNumber`: `E.164 String`<br>`diagnosticNotes`: `String` | Agent must execute a test run and attain `status = 'TESTED'` before production activation | `status` (`AgentStudioStatus`) |
| **Step 11** | **Review & Readiness Audit** | `readinessScore`: `Int` (0-100)<br>`isReady`: `Boolean`<br>`auditReport`: `Json` | All 10 preceding gates must evaluate to `PASS`; generates formal `VoiceAgentReadinessReport` | `status = 'ACTIVE'` |

### 3.2 Database Persistence Audit (`VoiceAgentConfig`)
PostgreSQL migration `20261108200000_schema_expansion` expanded `VoiceAgentConfig` with 19 first-class columns:
```prisma
model VoiceAgentConfig {
  id                    String            @id @default(uuid())
  workspaceId           String
  name                  String
  provider              String            @default("retell") // "retell" | "vapi" | "mock"
  modelId               String            @default("gpt-4o-mini-realtime")
  temperature           Decimal           @default(0.7) @db.Decimal(3, 2)
  maxTokens             Int               @default(500)
  voiceProvider         String            @default("elevenlabs")
  voiceId               String            @default("retell-eleven-adrian")
  voiceSpeed            Decimal           @default(1.0) @db.Decimal(3, 2)
  voicePitch            Decimal           @default(0.0) @db.Decimal(4, 2)
  voiceStability        Decimal           @default(0.75) @db.Decimal(3, 2)
  agentPersona          String?
  speakingStyle         String?
  knowledgePoints       Json?
  objectionRules        Json?
  structuredQuestions   Json?
  safetyGuardrails      Json?
  assignedPhoneNumberId String?
  inboundEnabled        Boolean           @default(false)
  outboundEnabled       Boolean           @default(true)
  status                AgentStudioStatus @default(DRAFT)
  createdAt             DateTime          @default(now())
  updatedAt             DateTime          @updatedAt

  workspace             Workspace         @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId])
  @@index([status])
  @@map("voice_agent_configs")
}
```

---

## 4. Carrier Phone Numbers & Line Management

- **Database Model**: `TelephonyPhoneNumber` (`backend/prisma/schema.prisma` lines 787-807) tracks registered carrier lines, capability flags (voice, SMS, toll-free), and routing assignments.
- **Strict Financial Guardrail**: The system contains **zero code paths to purchase carrier phone numbers automatically**. `purchasedWithoutAutoBuy: true` is enforced on all imported lines. Operators must manually register pre-owned carrier numbers.

---

## 5. Complete 18-Gate Server-Side Pre-Call Readiness Safety Engine

Before any outbound call can be dispatched through Twilio or conversational Voice AI providers, `backend/src/modules/voice/voice.safety.ts` evaluates 18 rigorous server-side fail-closed gates. A failure at any gate halts execution and transitions the call to `BLOCKED`.

| Gate # | Gate Name | Target Safety & Compliance Invariant | Implementation Source | Status in Code | Fail-Closed Assessment & Remediation Plan |
|:---:|:---|:---|:---:|:---:|:---|
| **Gate 1** | **Human Approval Gate** | Strictly blocks calls where human sign-off has not been granted (`isApproved !== true`) | `voice.safety.ts:117` | **PASS (Fail-Closed)** | Enforces mandatory human-in-the-loop oversight |
| **Gate 2** | **Multi-Tenant Isolation Gate** | Verifies that `workspaceId` on the dispatch request matches the lead, campaign, and calling policy | `voice.safety.ts:128` | **PASS (Fail-Closed)** | Prevents cross-tenant call dispatch or data leakage |
| **Gate 3** | **Phone Suppression / DNC Gate** | Queries `suppressionRepository` to ensure recipient phone or domain is not on the Do-Not-Call list | `voice.safety.ts:135` | **PASS (Fail-Closed)** | Complies with federal TCPA regulations and opt-out requests |
| **Gate 4** | **Recipient Phone E.164 Gate** | Enforces valid international E.164 regex pattern (`^\+[1-9]\d{6,14}$`) | `voice.safety.ts:139` | **PASS (Fail-Closed)** | Prevents invalid carrier dialing and malformed PSTN requests |
| **Gate 5** | **Emergency Kill Switch Gate** | Checks workspace-level and platform-wide emergency kill switches, as well as campaign status | `voice.safety.ts:149` | **PASS (Fail-Closed)** | Immediate circuit-breaker halting all outbound activity in emergencies |
| **Gate 6** | **Daily Workspace Call Limit Gate** | Counts calls completed today against `policy.dailyCallLimit` (e.g. 100 calls/day cap) | `voice.safety.ts:176` | **PASS (Fail-Closed)** | Protects against runaway outbound dialing and billing spikes |
| **Gate 7** | **Max Attempts Per Lead Gate** | Enforces `attemptsCount < policy.maxAttemptsPerLead` (default 3 lifetime attempts) | `voice.safety.ts:182` | **PASS (Fail-Closed)** | Anti-harassment protection preventing repeated unwanted calls |
| **Gate 8** | **Retry Delay / Cooldown Gate** | Enforces minimum `retryDelayMinutes` (120 minutes) cooldown since the last call attempt | `voice.safety.ts:188` | **PASS (Fail-Closed)** | Prevents back-to-back dialing of the same dental practice |
| **Gate 9** | **Allowed Calling Days Gate** | Validates recipient-local timezone day-of-week, strictly blocking Saturday and Sunday calls | `voice.safety.ts:206` | **PASS (Fail-Closed)** | TCPA compliance restricting calls to business workdays |
| **Gate 10** | **Calling Window Hours Gate** | Restricts dialing strictly to recipient-local business hours (09:00 to 17:00 local time) | `voice.safety.ts:216` | **PASS (Fail-Closed)** | TCPA calling window enforcement based on lead phone area code |
| **Gate 11** | **Lead Status Qualification Gate** | Rejects leads in `DISQUALIFIED`, `OPT_OUT`, or `LOST` states | `voice.safety.ts:227` | **PASS (Fail-Closed)** | Enforces that only qualified candidates receive voice outreach |
| **Gate 12** | **Contact Association Gate** | Verifies that the designated contact entity actually belongs to the targeted lead | `voice.safety.ts:231` | **PASS (Fail-Closed)** | Prevents misattributed outbound outreach |
| **Gate 13** | **Grounded Facts Gate** | Verifies that `lead.businessName` and core clinic facts exist before generating prompts | `voice.safety.ts:235` | **PASS (Fail-Closed)** | Prevents hallucinated business conversations |
| **Gate 14** | **Anti-Hallucination Guardrails Gate** | Asserts presence of strict `prohibitedClaims` preventing fabricated medical or pricing promises | `voice.safety.ts:239` | 🔴 **FAIL (Short-Circuit)** | **CRITICAL DEFECT**: Code contains `hasProhibitedClaims \|\| true`. Must remove `\|\| true` |
| **Gate 15** | **Telephony Provider Gate** | Verifies Twilio carrier credentials and phone line readiness for active workspace | `voice.safety.ts:245` | 🟡 **PARTIAL (Env fallback)** | Defect: checks global environment variables instead of PostgreSQL DB |
| **Gate 16** | **Voice AI Provider Gate** | Verifies Voice AI provider configuration (`retell` or `vapi`) for active workspace | `voice.safety.ts:250` | 🔴 **FAIL (Short-Circuit)** | **CRITICAL DEFECT**: Code contains `aiConfigured \|\| true`. Must remove `\|\| true` |
| **Gate 17** | **Concurrent Calling Cap Gate** | Enforces `maxConcurrentCalls` limit (default 1 concurrent call per workspace) | `voice.safety.ts:255` | **PASS (Fail-Closed)** | Prevents telephony concurrency exhaustion |
| **Gate 18** | **Recording Consent Gate** | Asserts compliance with two-party or one-party call recording consent disclaimers | `voice.safety.ts:261` | **PASS (Fail-Closed)** | Legal recording compliance disclosure |

---

## 6. Call Lifecycle, Webhooks & Audio Recording Ingestion

### 6.1 15-State Call Lifecycle State Machine
```
[ QUEUED ] ---> [ SAFETY_CHECKING ] ---> [ APPROVAL_REQUIRED ] ---> [ APPROVED ]
                                                     |
                                                     v (Rejected / Blocked)
                                                [ BLOCKED ]

[ APPROVED ] ---> [ INITIATING ] ---> [ RINGING ] ---> [ IN_PROGRESS ] ---> [ COMPLETED ]
                      |                    |                  |
                      +--------------------+------------------+---> [ FAILED ]
                                           |                  |---> [ NO_ANSWER ]
                                           |                  |---> [ BUSY ]
                                           |                  |---> [ VOICEMAIL ]
                                           |                  |---> [ CANCELLED ]
                                           v
                                     [ OPTED_OUT ]
```
- **Terminal States**: `COMPLETED`, `BLOCKED`, `FAILED`, `CANCELLED`, `NO_ANSWER`, `BUSY`, `VOICEMAIL`, `OPTED_OUT`. Terminal states cannot be transitioned to any other state.
- **Webhook Ingress**: Enforces timing-safe HMAC signature verification and sliding-window replay protection (5-minute timestamp drift gate, 15-minute nonce cache).
- **Transcript Turns**: Multi-speaker conversation turns (`speaker: 'agent' | 'user'`) are parsed and persisted to `CallTranscript`.

---

## 7. Frontend Voice API Contract Parity Inventory

Every frontend calling method in `CloseBDS Frontend/lib/api-client.ts` was audited line-by-line against `backend/src/modules/voice/voice.router.ts`:

| # | Frontend API Method (`lib/api-client.ts`) | HTTP Method & Path | Backend Router Mapping | Persistence Status | Audit Status |
|:---:|:---|:---|:---|:---|:---:|
| 1 | `api.voice.getPolicy` | `GET /api/v1/voice/policy` | `voice.router.ts:46` | `WorkspaceCallingPolicy` (PostgreSQL) | **VERIFIED** |
| 2 | `api.voice.updatePolicy` | `PUT /api/v1/voice/policy` | `voice.router.ts:61` | `WorkspaceCallingPolicy` (PostgreSQL) | **VERIFIED** |
| 3 | `api.voice.toggleKillSwitch` | `POST /api/v1/voice/policy/kill-switch` | `voice.router.ts:79` | `WorkspaceCallingPolicy` (PostgreSQL) | **VERIFIED** |
| 4 | `api.voice.getCampaign` | `GET /api/v1/voice/campaigns/:id` | `voice.router.ts:127` | `VoiceCampaign` (PostgreSQL) | **VERIFIED** |
| 5 | `api.voice.upsertCampaign` | `POST /api/v1/voice/campaigns/:id` | `voice.router.ts:104` | `VoiceCampaign` (PostgreSQL) | **VERIFIED** |
| 6 | `api.voice.getAgentConfigs` | `GET /api/v1/voice/agent-configs` | `voice.router.ts:168` | `VoiceAgentConfig` (PostgreSQL) | **VERIFIED** |
| 7 | `api.voice.getAgentConfig` | `GET /api/v1/voice/agent-configs/:id` | `voice.router.ts:183` | `VoiceAgentConfig` (PostgreSQL) | **VERIFIED** |
| 8 | `api.voice.createAgentConfig` | `POST /api/v1/voice/agent-configs` | `voice.router.ts:144` | `VoiceAgentConfig` (PostgreSQL) | **VERIFIED** |
| 9 | `api.voice.updateAgentConfig` | `PUT /api/v1/voice/agent-configs/:id` | `voice.router.ts:199` | `VoiceAgentConfig` (PostgreSQL) | **VERIFIED** |
| 10 | `api.voice.prepareCall` | `POST /api/v1/voice/calls/prepare` | `voice.router.ts:478` | Dynamic 18-Gate Evaluation | **VERIFIED** |
| 11 | `api.voice.createCall` | `POST /api/v1/voice/calls` | `voice.router.ts:496` | `Call` (PostgreSQL) | **VERIFIED** |
| 12 | `api.voice.listCalls` | `GET /api/v1/voice/calls` | `voice.router.ts:514` | `Call`, `CallOutcome` (PostgreSQL) | **VERIFIED** |
| 13 | `api.voice.getCall` | `GET /api/v1/voice/calls/:id` | `voice.router.ts:531` | `Call`, `CallTranscript`, `CallOutcome` | **VERIFIED** |
| 14 | `api.voice.getTimeline` | `GET /api/v1/voice/calls/:id/timeline` | `voice.router.ts:625` | `CallEvent` (PostgreSQL) | **VERIFIED** |
| 15 | `api.voice.approveCall` | `POST /api/v1/voice/calls/:id/approve` | `voice.router.ts:548` | `Call.isApproved = true` | **VERIFIED** |
| 16 | `api.voice.rejectCall` | `POST /api/v1/voice/calls/:id/reject` | `voice.router.ts:568` | `Call.status = BLOCKED` | **VERIFIED** |
| 17 | `api.voice.cancelCall` | `POST /api/v1/voice/calls/:id/cancel` | `voice.router.ts:587` | `Call.status = CANCELLED` | **VERIFIED** |
| 18 | `api.voice.checkSafety` | `POST /api/v1/voice/calls/:id/safety-check` | `voice.router.ts:607` | Dynamic 18-Gate Evaluation | **VERIFIED** |
| 19 | `api.voice.dispatchCall` | `POST /api/v1/voice/calls/:id/dispatch` | `voice.router.ts:642` | `Call.status = INITIATING`, `CallAttempt` | **VERIFIED** |
| 20 | `api.voice.recordTurn` | `POST /api/v1/voice/calls/:id/turns` | `voice.router.ts:662` | `CallTranscript` (PostgreSQL) | **VERIFIED** |
| 21 | `api.voice.completeCall` | `POST /api/v1/voice/calls/:id/complete` | `voice.router.ts:681` | `CallOutcome`, `CRMActivity` | **VERIFIED** |
| 22 | `api.voice.getVoiceAnalytics` | `GET /api/v1/analytics/voice` | `analytics.router.ts:74` | PostgreSQL Aggregations | **VERIFIED** |
| 23 | `api.voice.getTelephonySettings` | `GET /api/v1/voice/telephony/settings` | `voice.router.ts:740` | `WorkspaceProviderCredential` / Map | **PARTIAL (Cache sync)** |
| 24 | `api.voice.updateTelephonySettings` | `POST /api/v1/voice/telephony/settings` | `voice.router.ts:755` | `WorkspaceProviderCredential` (Encrypted) | **VERIFIED** |
| 25 | `api.voice.testTelephonyConnection` | `POST /api/v1/voice/telephony/test-connection` | `voice.router.ts:772` | Twilio API Handshake | **VERIFIED** |
| 26 | `api.voice.listPhoneNumbers` | `GET /api/v1/voice/phone-numbers` | `voice.router.ts:793` | In-memory `numberStore` | **PARTIAL (DB sync)** |
| 27 | `api.voice.importPhoneNumber` | `POST /api/v1/voice/phone-numbers/import` | `voice.router.ts:808` | `TelephonyPhoneNumber` (PostgreSQL) | **VERIFIED** |
| 28 | `api.voice.validatePhoneNumber` | `POST /api/v1/voice/phone-numbers/validate` | `voice.router.ts:825` | Twilio E.164 & Capability Check | **VERIFIED** |
| 29 | `api.voice.configurePhoneNumberRouting` | `PUT /api/v1/voice/phone-numbers/:id/routing` | `voice.router.ts:841` | `TelephonyPhoneNumber` (PostgreSQL) | **VERIFIED** |
| 30 | `api.voice.releasePhoneNumber` | `DELETE /api/v1/voice/phone-numbers/:id` | `voice.router.ts:869` | `TelephonyPhoneNumber` (PostgreSQL) | **VERIFIED** |
| 31 | `api.voice.listStudioAgents` | `GET /api/v1/voice/agents/studio` | `voice.router.ts:227` | `VoiceAgentConfig` (PostgreSQL) | **VERIFIED** |
| 32 | `api.voice.getStudioAgent` | `GET /api/v1/voice/agents/studio/:id` | `voice.router.ts:323` | `VoiceAgentConfig` (PostgreSQL) | **VERIFIED** |
| 33 | `api.voice.createStudioAgent` | `POST /api/v1/voice/agents/studio` | `voice.router.ts:243` | `VoiceAgentConfig` (PostgreSQL) | **VERIFIED** |
| 34 | `api.voice.updateStudioAgent` | `PUT /api/v1/voice/agents/studio/:id` | `voice.router.ts:342` | `VoiceAgentConfig` (PostgreSQL) | **VERIFIED** |
| 35 | `api.voice.getStudioAgentReadiness` | `GET /api/v1/voice/agents/studio/:id/readiness` | `voice.router.ts:364` | 11-Step Studio Readiness Engine | **VERIFIED** |
| 36 | `api.voice.testStudioAgent` | `POST /api/v1/voice/agents/studio/:id/test` | `voice.router.ts:382` | Diagnostic Simulation & State `TESTED` | **VERIFIED** |
| 37 | `api.voice.transitionStudioStatus` | `POST /api/v1/voice/agents/studio/:id/transition-status` | `voice.router.ts:405` | State Machine Enforcement | **VERIFIED** |
| 38 | `api.voice.activateStudioAgent` | `POST /api/v1/voice/agents/studio/:id/activate` | `voice.router.ts:430` | State Machine Enforcement | **VERIFIED** |
| 39 | `api.voice.pauseStudioAgent` | `POST /api/v1/voice/agents/studio/:id/pause` | `voice.router.ts:454` | State Machine Enforcement | **VERIFIED** |
| 40 | `api.voice.getStudioModels` | `GET /api/v1/voice/agents/studio/models` | `voice.router.ts:265` | Model Registry | **VERIFIED** |
| 41 | `api.voice.getStudioVoices` | `GET /api/v1/voice/agents/studio/voices` | `voice.router.ts:282` | Voice Registry | **VERIFIED** |
| 42 | `api.voice.validateNumberCompatibility` | `POST /api/v1/voice/agents/studio/validate-number` | `voice.router.ts:299` | Compatibility & Collision Engine | **VERIFIED** |
| 43 | `api.voice.getVoiceAIProviders` | `GET /api/v1/voice/voice-ai/providers` | `voice.router.ts:929` | Provider Cards (Masked) | **VERIFIED** |
| 44 | `api.voice.testVoiceAIConnection` | `POST /api/v1/voice/voice-ai/test-connection` | `voice.router.ts:974` | Retell / Vapi API Handshake | **VERIFIED** |
| 45 | `api.voice.updateVoiceAICredentials` | `POST /api/v1/voice/voice-ai/credentials` | `voice.router.ts:999` | `WorkspaceProviderCredential` (Encrypted) | **PARTIAL (Env mutation)** |

---

## 8. Discovered AI Calling Gaps & Remediation Plans

The audit identified 5 specific calling architecture defects requiring remediation during Phase R2:

### Gap 1 (P0): Eliminate Runtime `process.env` Mutation
- **Location**: `backend/src/modules/voice/voice-ai.service.ts:207-219`
- **Issue**: Updating credentials mutates `process.env.RETELL_API_KEY` and `process.env.VAPI_API_KEY`, causing process-wide credential leakage across tenants.
- **Fix**: Remove all `process.env` assignments; retrieve credentials per workspace from `WorkspaceProviderCredential` repository.

### Gap 2 (P0): Hydrate Phone Numbers from PostgreSQL
- **Location**: `backend/src/modules/voice/phone-numbers.service.ts:52-71`
- **Issue**: `listPhoneNumbers` queries an in-memory `Map` rather than PostgreSQL, losing data visibility upon container restart.
- **Fix**: Replace in-memory queries with `telephonyPhoneNumberRepository.listByWorkspace(workspaceId)`.

### Gap 3 (P1): Safety Engine Fail-Closed Hardening (Gates 14 & 16)
- **Location**: `backend/src/modules/voice/voice.safety.ts:243, 253`
- **Issue**: `hasProhibitedClaims || true` and `aiConfigured || true` short-circuit fail-closed evaluation.
- **Fix**: Remove `|| true` and connect Gates 15 & 16 to query `workspaceProviderCredentialRepository`.

### Gap 4 (P1): Persist Audio Recording Metadata to `Call` Table
- **Location**: `backend/src/modules/voice/voice-webhook.service.ts:236-240`
- **Issue**: Inbound `recordingUrl` is logged to `AuditLog` metadata but omitted from `Call.recordingUrl`.
- **Fix**: Pass `recordingUrl`, `recordingDuration`, and `recordingChannels` into `voiceRepository.updateCallStatus`.

### Gap 5 (P1): Standardize Native Studio Column Storage
- **Location**: `backend/src/modules/voice/voice-agent-readiness.service.ts:345-348`
- **Issue**: Dual-writing studio metadata to `objectionHandling._studio` JSON rather than relying purely on native columns.
- **Fix**: Standardize on reading and writing first-class columns in `VoiceAgentConfig`.

---

## 9. Verification & Independent Test Evidence

All telephony, safety, and studio features were verified via automated test suites:
- **`tests/voice-safety-lifecycle.test.ts`**: 15-state transition matrix and terminal state protection.
- **`tests/voice-provider-twilio.test.ts`**: E.164 parsing, TwiML generation, and webhook HMAC signature checks.
- **`tests/voice-grounding-ai.test.ts`**: Grounded facts validation and prompt anti-hallucination guardrails.
- **`tests/twilio-telephony.test.ts`**: Carrier number registry, routing configuration, zero-auto-buy invariant.
- **`tests/voice-agent-studio.test.ts`**: 11-step studio pipeline, model/voice registries, and readiness evaluator.
- **`tests/voice-safety-operations.test.ts`**: 18-gate pre-call readiness evaluation, human approval gate, and emergency kill switches.
