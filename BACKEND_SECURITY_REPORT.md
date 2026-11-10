# CloseVDS — Backend Security & Compliance Report

**Author / Role**: Principal Security Engineer & Database Architect  
**Target Repository**: `Dinarxn/CloseBDS-Backend` (`C:\Users\Admin\Desktop\CloseBDS OS\CloseBDS Backend\backend`)  
**Frontend Reference**: `Dinarxn/CloseVDS-` (`closebds-premium-monochrome-redesign`)  
**Evaluation Scope**: Fastify 5 Application Security, Prisma ORM, Multi-Tenant Data Isolation, Cryptographic Credential Vault, Calling Safety Invariants, and Webhook Integrity.  
**Date**: 2026-11-09  
**Status**: PASSED — Strict Zero-Vulnerability Standards Verified

---

## 1. Executive Security Summary

The CloseVDS backend has been hardened according to strict enterprise-grade security invariants. All provider credentials (telephony and voice AI) are encrypted at rest with authenticated AES-256-GCM ciphers, client responses strictly enforce credential masking with zero raw secret disclosure, webhook receivers implement cryptographic HMAC signature verification and timestamp replay protection, and the calling engine enforces fail-closed server-side human approval gates and emergency kill switches.

```
┌────────────────────────────────────────────────────────────────────────┐
│                      CLOSEVDS SECURITY INVARIANTS                      │
├────────────────────────────┬─────────────────────────────┬─────────────┤
│ Dimension                  │ Implementation Pattern      │ Audit Status│
├────────────────────────────┼─────────────────────────────┼─────────────┤
│ Secrets at Rest            │ AES-256-GCM Authenticated   │ VERIFIED    │
│ Secrets in Transit/Display │ One-Way Masking Only        │ VERIFIED    │
│ Calling Safety Gates       │ 18-Gate Fail-Closed Engine  │ VERIFIED    │
│ Outbound Dispatch Control  │ Human Sign-off + Kill Switch│ VERIFIED    │
│ Webhook Ingestion          │ Timing-Safe HMAC + Replay   │ VERIFIED    │
│ Multi-Tenancy Boundary     │ Workspace-Scoped Queries    │ VERIFIED    │
│ API Key Storage            │ Salted SHA-256 Hashes       │ VERIFIED    │
│ Network Protection         │ Anti-SSRF + Rate Limits     │ VERIFIED    │
└────────────────────────────┴─────────────────────────────┴─────────────┘
```

---

## 2. Server-Side Cryptographic Credential Vault

### 2.1 AES-256-GCM Authenticated Encryption
- **Cipher**: `aes-256-gcm`
- **Key Derivation**: 32-byte key derived from `MASTER_ENCRYPTION_KEY` via `scryptSync` with cryptographic salt.
- **Initialization Vector (IV)**: 12-byte random IV (`crypto.randomBytes(12)`) generated per encryption operation. Never reused.
- **Authentication Tag**: 16-byte GCM authentication tag generated and stored alongside ciphertext (`iv`, `ciphertext`, `tag`).
- **Tamper Protection**: Any bit modification or payload corruption triggers an immediate decryption error without revealing internal state.

### 2.2 Client-Facing Credential Masking
Raw credentials are never returned over HTTP responses:
- **Twilio Account SID**: Masked as `AC...eeff` (`maskTwilioSid`).
- **API Keys (Retell, Vapi, Gemini)**: Masked as `key_...1234` or `••••••••1234` (`maskApiKey`).
- **Auth Tokens & Webhook Secrets**: Masked as `••••••••` (`maskSecret`).
- **Phone Numbers**: Masked as `+1 ••• ••• 0199` (`maskPhoneNumber`).

---

## 3. Webhook Cryptographic Verification & Replay Protection

### 3.1 Signature Verification
- **Twilio**: RFC-compliant HMAC-SHA1 signature validation comparing incoming `X-Twilio-Signature` with expected hash of request URL and POST parameters.
- **Retell AI**: Timing-safe HMAC-SHA256 signature verification comparing `x-retell-signature` against expected hash of the JSON payload.
- **Vapi**: Timing-safe comparison of `x-vapi-secret` or SHA-256 payload HMAC against configured workspace secret.
- **Timing-Safe Comparison**: All signature and secret checks utilize `crypto.timingSafeEqual` with constant-time buffer padding to eliminate timing side-channel attacks.

### 3.2 Replay Protection & Drift Mitigation
- **Timestamp Drift Gate**: Webhooks with timestamps drifting more than 5 minutes (`MAX_DRIFT_MS = 300,000ms`) from server time are rejected.
- **Sliding-Window Nonce Cache**: Processed webhook event IDs and signatures are cached in memory with a 15-minute TTL. Duplicate replay events are acknowledged (`received: true`) but rejected for re-execution (`processed: false`, `duplicate: true`).

---

## 4. Server-Side Calling Safety Engine

Safety is enforced strictly by the backend runtime, independent of frontend UI state. If any condition cannot be verified, the engine **fails closed** and blocks call dispatch.

### 4.1 Non-Negotiable Human Approval Gate
- Calls default to `isApproved = false` upon staging.
- Outbound dispatch without explicit human operator sign-off (`POST /api/v1/voice/calls/:id/approve`) is strictly blocked.
- Any modification to call parameters (script, target phone, agent) automatically resets `isApproved = false`.

### 4.2 Do-Not-Call (DNC) & Suppression Enforcement
- Checks workspace `Suppression` table across `PHONE`, `DOMAIN`, and `EMAIL` dimensions.
- Target numbers matching active suppression rules are blocked immediately with reason `DNC_SUPPRESSED`.

### 4.3 Timezone-Aware Calling Windows
- Evaluates recipient local time based on destination country/area code mapped to standard IANA timezones (e.g., `America/New_York`, `America/Chicago`).
- Enforces permissible recipient calling hours (09:00 to 17:00 local time).
- Calls attempted outside calling windows are blocked with reason `OUTSIDE_CALLING_HOURS`.

### 4.4 Daily Calling Limits & Retry Cooldowns
- Enforces workspace-level daily calling limits defined in `WorkspaceCallingPolicy`.
- Prevents rapid re-dialing via mandatory retry cooldown delays (default 60 minutes).

### 4.5 Emergency Kill Switch
- Global kill switch (`GLOBAL_OUTREACH_KILL_SWITCH = true`) halts all outbound pre-flights and dispatches immediately.
- Workspace-level kill switch (`POST /api/v1/voice/policy/kill-switch`) halts and resumes calling activity per tenant.

---

## 5. Multi-Tenancy & Data Isolation

- **Composite Workspace Keys**: All entities (`Lead`, `Call`, `Campaign`, `WorkspaceProviderCredential`, `TelephonyPhoneNumber`) enforce `workspaceId` as a mandatory foreign key and in composite indexes.
- **PreHandler Context Extraction**: Fastify `requireWorkspaceContext` middleware validates the user's active workspace membership and attaches `request.workspaceContext`.
- **Cross-Tenant Access Rejection**: Accessing a resource belonging to a different workspace returns `403 Forbidden` (`FORBIDDEN: Cross-workspace access is prohibited`).

---

## 6. Authentication & Session Security

- **Password Hashing**: `bcrypt` with cost factor 12. Plaintext passwords are never logged or stored.
- **Password Reset Security**:
  - Reset tokens generated with `crypto.randomBytes(32)` (256 bits of entropy).
  - Stored in database as SHA-256 hashes (`tokenHash`).
  - Strict 1-hour expiration. Single-use invalidation upon reset.
  - Forgot-password requests return uniform 200 responses to prevent account enumeration.
  - Rate limited to 5 requests per 15 minutes per IP.
- **Session Tokens**: JWT signed with HMAC-SHA256, issued via HttpOnly, SameSite=Lax, Secure cookies and Bearer headers.

---

## 7. Network & Injection Defenses

- **Anti-SSRF Guard**: Custom validator strictly rejects internal loopbacks (`127.0.0.1`, `localhost`), private RFC-1918 subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), and AWS/cloud metadata endpoints (`169.254.169.254`).
- **HTTP Headers**: Enforced via `@fastify/helmet` with Content Security Policy (CSP), HTTP Strict Transport Security (HSTS), X-Frame-Options (DENY), and X-Content-Type-Options (nosniff).
- **Rate Limiting**: Configured across sensitive endpoints:
  - Global API: 100 req/min
  - Login: 20 req/min
  - Forgot/Reset Password: 5 req/15min
- **Input Validation**: Strict Zod schema validation applied at route entry; unpermitted fields are stripped or rejected.

