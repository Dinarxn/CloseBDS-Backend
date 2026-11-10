# CloseVDS — Final AI Calling Safety & Governance Audit Report (Deliverable 5)

**Document Version:** 1.0.0  
**Phase:** Phase 7 — Complete Regression and Security Testing  
**Auditor / Specialist:** QA & Security Verification Specialist  
**Execution Environment:** Windows Server / Node.js tsx runtime / PostgreSQL In-Memory & Prisma  
**Classification:** Server-Authoritative Voice Safety Compliance Audit  
**Date:** November 10, 2026  

---

## 1. Executive Summary & Voice Safety Mandate

In autonomous AI calling and programmatic telephony operations, a software bug or loose safety invariant can lead to severe regulatory fines (TCPA violations, Do-Not-Call infractions, out-of-hours harassment penalties) and catastrophic brand damage.

CloseVDS enforces **11 Non-Negotiable Voice Safety Invariants**. These invariants are server-authoritative, fail-closed, and strictly independent of client intent or UI state.

Every invariant was empirically tested and verified against real system execution in:
- `tests/workstream1-p0-persistence.test.ts` (Sections 1–5)
- `tests/voice-safety-operations.test.ts` (Sections 1–10)
- `tests/voice-shared-contracts.test.ts` (Tests 1–5)
- `tests/twilio-telephony.test.ts` (Tests 1–8)

All safety suites passed with exit code `0` and zero regressions.

---

## 2. The 11 Mandatory Calling Safety Invariants Audit

### Invariant 1: Workspace-Specific Kill-Switch Enforcement (503 Fail-Closed)
- **Invariant Statement:** Activating an emergency kill switch for a workspace immediately halts all outbound voice dispatches, pre-flight evaluations, and telephony scheduling for that workspace, returning HTTP 503 `KillSwitchActiveError`.
- **Implementation:** `backend/src/modules/voice/voice.service.ts:250`, `calling-policy.service.ts:167`, `voice.router.ts:77`
- **Error Returned:** `KillSwitchActiveError: Emergency kill switch is active for this workspace. Outbound calling is strictly halted.` (HTTP 503, operational code: `KILL_SWITCH_ACTIVE`).
- **Audit Verification:**
  - `tests/voice-safety-operations.test.ts` Section 7.2 calls `callingPolicyService.triggerEmergencyKillSwitch(wsId, 'Security maintenance')`.
  - Calling `voiceService.dispatchCall(callId, wsId)` throws `KillSwitchActiveError`.
  - Multi-tenant check: Workspace B continues outreach uninterrupted while Workspace A is halted.

---

### Invariant 2: Fail-Closed Behaviour When Settings Cannot Be Verified
- **Invariant Statement:** If the database connection drops, connection pools exhaust, or settings cannot be retrieved, the system must fail closed — defaulting the kill switch to **ACTIVE (`true`)** rather than permitting unverified calls.
- **Implementation:** `backend/src/database/repository.ts` (`SettingsRepository.getWorkspaceSettings`)
- **Code Audit:**
```typescript
try {
  const row = await this.client.setting.findFirst({ where: { workspaceId } });
  if (!row) return defaultSettings;
  return row.value;
} catch (error) {
  // FAIL-CLOSED: Force emergency kill switch active and zero cap on failure
  return {
    killSwitchActive: true,
    defaultDailyCap: 0,
    safetyThreshold: 100,
    allowedCallingHours: { start: '09:00', end: '17:00' }
  };
}
```
- **Audit Verification:**
  - `tests/workstream1-p0-persistence.test.ts` Section 4.1 injects a throwing mock:
    ```typescript
    findFirst: async () => { throw new Error('Database connection pool exhausted / PostgreSQL unavailable'); }
    ```
  - Asserted: `failClosedSettings.killSwitchActive === true`.

---

### Invariant 3: Zero Daily Cap When Settings Are Unavailable
- **Invariant Statement:** Under degraded or unverified infrastructure state, allowable daily outbound call volume must drop to exactly zero (`0`), preventing calls from slipping through due to missing rate-limit counters.
- **Implementation:** `backend/src/database/repository.ts` (`SettingsRepository`)
- **Audit Verification:**
  - `tests/workstream1-p0-persistence.test.ts` Section 4.1 asserts:
    ```typescript
    assert.equal(failClosedSettings.defaultDailyCap, 0,
      'FAIL-CLOSED: If settings read fails, daily cap MUST be 0');
    ```
  - Gate 6 in `VoiceSafetyEvaluator` immediately rejects any call attempt because `currentCallsToday (0) >= dailyCap (0)`.

---

### Invariant 4: No Outbound Dispatch When Database Safety State is Unknown
- **Invariant Statement:** If the database state cannot confirm compliance attributes (prior attempts, current call status, suppression records), outbound dispatch must be rejected before any provider API call is made.
- **Implementation:** `backend/src/modules/voice/voice.service.ts` (`dispatchCall`) and `VoiceSafetyEvaluator.evaluate`
- **Audit Verification:**
  - `tests/workstream1-p0-persistence.test.ts` Section 4.2 & Section 5.1 confirm that when database queries fail, no calls can transition from `APPROVED` to `QUEUED` or `INITIATED`.

---

### Invariant 5: No Dispatch Using Unhydrated or Unverified Phone Numbers
- **Invariant Statement:** Outbound calls require an imported, carrier-verified, and database-hydrated phone number. Unregistered or synthetic numbers are strictly blocked at dispatch.
- **Implementation:** `backend/src/modules/voice/phone-numbers.service.ts` (`hydrateFromDatabase`), `voice.service.ts:285`
- **Audit Verification:**
  - `tests/workstream1-p0-persistence.test.ts` Section 5.2 assigns an unhydrated number `num_fake_unverified_line_99999` to an agent config.
  - Calling `voiceService.dispatchCall()` rejects with:
    `BadRequestError: Assigned phone number is not hydrated or verified for outbound calls.`
  - Container restart hydration test (`workstream1-p0-persistence.test.ts` Section 2.3) proves phone numbers persist across process restarts and must be explicitly hydrated.

---

### Invariant 6: No Cross-Workspace Credential Access
- **Invariant Statement:** Telephony and Voice AI credentials (Twilio Account SID, Twilio Auth Token, Retell Key, Vapi Key) belonging to Workspace A must never be accessible, visible, or usable by Workspace B.
- **Implementation:** `backend/src/database/repository.ts` (`WorkspaceProviderCredentialRepository`), `telephony.service.ts`, `voice-ai.service.ts`
- **Audit Verification:**
  - `tests/workstream1-p0-persistence.test.ts` Section 1.2 stores distinct Retell keys for Workspace A and Workspace B.
  - The repository stores distinct AES-256-GCM ciphertexts.
  - Workspace A card returns masked key ending in `2345`; Workspace B returns masked key ending in `7890`. Cross-workspace queries return empty/null results.

---

### Invariant 7: No Global `process.env` Mutation for Workspace Credentials
- **Invariant Statement:** Workspace credentials must remain in dedicated memory and database vault storage. They must **never** be injected into global `process.env`, which would bleed across concurrently running requests in Node.js.
- **Implementation:** `backend/src/modules/voice/telephony.service.ts`, `voice-ai.service.ts`
- **Audit Verification:**
  - `tests/workstream1-p0-persistence.test.ts` Section 1.1 records `process.env.RETELL_API_KEY` and `process.env.VAPI_API_KEY` before and after multi-workspace credential updates.
  - Asserted: `process.env` variables remain identical, verifying 0 side-effects in global runtime memory.

---

### Invariant 8: No Duplicate Calls Caused by Retries / Concurrency Locks
- **Invariant Statement:** Rapid consecutive clicks or retried webhook requests must not initiate duplicate outbound phone calls for the same lead.
- **Implementation:** `backend/src/modules/voice/voice.service.ts` (`createCall`), `voice.router.ts`, Prisma unique constraint `unique_workspace_call_idempotency`
- **Audit Verification:**
  - `tests/voice-safety-operations.test.ts` Section 8.1: Creating a call with an existing `idempotencyKey` returns the original call record without creating a new record.
  - Section 8.2: Creating a new call for a lead that currently has an active call (`QUEUED`, `INITIATED`, `RINGING`, `CONNECTED`) throws `BadRequestError: Lead already has an active call in progress.`

---

### Invariant 9: Human Approval Gate and DNC Suppression Enforcement
- **Invariant Statement:**
  1. If `humanApprovalRequired: true` is configured in policy or campaign, calls must enter `APPROVAL_REQUIRED` status and cannot be dispatched without operator sign-off.
  2. Modifying call parameters (e.g. phone number) immediately invalidates approval back to `APPROVAL_REQUIRED`.
  3. Numbers registered on the workspace Do-Not-Call (DNC) or Phone Suppression list are unconditionally blocked.
- **Implementation:** `backend/src/modules/voice/voice.safety.ts` (Gate 2 & Gate 3), `voice.service.ts:320-360`
- **Audit Verification:**
  - `tests/voice-safety-operations.test.ts` Section 2.1: Unapproved call dispatch throws `ForbiddenError: Call requires human approval before dispatch.`
  - Section 2.2: `approveCall()` by operator transitions status to `APPROVED` and records `approvedByUserId`.
  - Section 2.3: `invalidateCallApproval()` transitions status back to `APPROVAL_REQUIRED`.
  - Section 3.1: Lead with phone `+14155550999` matching suppression table fails Gate 3 with reason `"Phone number +14155550999 is suppressed"`.

---

### Invariant 10: Timezone-Aware Calling Windows (09:00–17:00 Recipient Local) & Retry Cooldowns
- **Invariant Statement:**
  1. Recipient phone numbers must be resolved to their local IANA timezone based on E.164 country and area code.
  2. Calls are permitted only within 09:00 to 17:00 recipient local time on approved calling days (Monday–Friday).
  3. Re-dialing an unanswered or busy lead requires a configurable cooldown interval (e.g. 60 minutes).
- **Implementation:** `backend/src/modules/voice/voice.safety.ts` (`resolveTimezoneFromPhone`, Gate 8, Gate 10), `calling-policy.service.ts` (`isWithinCallingWindow`)
- **Audit Verification:**
  - `tests/voice-safety-operations.test.ts` Section 4.1: Area code `212` resolves to `America/New_York`, `312` to `America/Chicago`, `415` to `America/Los_Angeles`, `+44` to `Europe/London`.
  - Section 4.2: 14:00 UTC (10:00 AM EDT) is permitted; 03:00 UTC (11:00 PM EDT) is blocked by Gate 10.
  - Section 6.1: An attempt made 10 minutes after a `BUSY` attempt is blocked by Gate 8 with reason `"Retry cooldown active"`.

---

### Invariant 11: Emergency Kill Switch Blocks Dispatch Across Router, Service, and Provider
- **Invariant Statement:** The kill switch operates in depth: if triggered, it halts dispatch at the HTTP route handler, at the core domain service, and at the outbound provider adapter layer.
- **Implementation:**
  1. **Router Layer:** `voice.router.ts:77` checks policy before queuing.
  2. **Service Layer:** `voice.service.ts:250` checks `callingPolicyService.isWorkspaceKillSwitchActive(workspaceId)`.
  3. **Provider Layer:** `mock-telephony.adapter.ts` and `twilio.adapter.ts` check global safety kill-switch flag before network execution.
- **Audit Verification:**
  - `tests/voice-safety-operations.test.ts` Section 7.1 verifies Global Kill Switch stops all dispatches.
  - Section 7.2 verifies Workspace Kill Switch halts dispatch.
  - Section 10.1 tests Fastify route `POST /api/v1/voice/policy/kill-switch` activating and deactivating the kill switch via authenticated HTTP request.

---

## 3. End-to-End Milestone Progression Timeline Verification

During an authorized call lifecycle, CloseVDS records an immutable, chronological progression of milestones:
`PREPARED` → `APPROVED` → `QUEUED` → `INITIATED` → `RINGING` → `CONNECTED` → `TRANSCRIBING` → `ENDED`

In `tests/voice-safety-operations.test.ts` Section 9.1:
- All 8 milestone transitions were evaluated sequentially.
- Timestamps and event payloads were verified in the `CallTimeline` projection.
- Any illegal transition (e.g. transitioning directly from `PREPARED` to `CONNECTED`) is rejected by the lifecycle state machine in `src/modules/voice/call-status-machine.ts`.

---

## 4. Summary Compliance Matrix

| Invariant # | Safety Principle | Enforcement Layer | Test Verification | Verdict |
|---|---|---|---|---|
| **Inv 1** | Workspace Kill Switch (503) | Router / Service / Evaluator | `voice-safety-operations.test.ts:S7.2` | **VERIFIED** |
| **Inv 2** | Fail-Closed on Settings DB Error | SettingsRepository | `workstream1-p0-persistence.test.ts:S4.1` | **VERIFIED** |
| **Inv 3** | Zero Daily Cap on DB Disconnect | SettingsRepository / Gate 6 | `workstream1-p0-persistence.test.ts:S4.1` | **VERIFIED** |
| **Inv 4** | Block Dispatch on Unknown State | VoiceService / Evaluator | `workstream1-p0-persistence.test.ts:S5.1` | **VERIFIED** |
| **Inv 5** | Unhydrated / Unverified Phone Block | PhoneNumbersService / VoiceService | `workstream1-p0-persistence.test.ts:S5.2` | **VERIFIED** |
| **Inv 6** | No Cross-Workspace Credential Bleed | ProviderCredentialRepo | `workstream1-p0-persistence.test.ts:S1.2` | **VERIFIED** |
| **Inv 7** | No `process.env` Mutation | Telephony & Voice AI Services | `workstream1-p0-persistence.test.ts:S1.1` | **VERIFIED** |
| **Inv 8** | Idempotency & Concurrency Locks | Call Repository / Database Key | `voice-safety-operations.test.ts:S8.1-S8.2`| **VERIFIED** |
| **Inv 9** | Human Approval Gate & DNC List | VoiceSafetyEvaluator (Gate 2 & 3) | `voice-safety-operations.test.ts:S2 & S3` | **VERIFIED** |
| **Inv 10** | Calling Windows & Retry Cooldown | VoiceSafetyEvaluator (Gate 8 & 10)| `voice-safety-operations.test.ts:S4 & S6` | **VERIFIED** |
| **Inv 11** | Multi-Layer Kill Switch Halting | Fastify Router / Service / Provider| `voice-safety-operations.test.ts:S7 & S10` | **VERIFIED** |

All 11 mandatory calling safety invariants are fully implemented, verified, and operational in production code.
