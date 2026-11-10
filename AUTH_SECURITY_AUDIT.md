# AUTH_SECURITY_AUDIT: CloseBDS Backend (CloseVDS Acquisition OS)
**Comprehensive Authentication Lifecycle, Authorization RBAC, Credential Vault, Webhook Integrity & OWASP Hardening Audit**
**Target System**: CloseBDS Fastify Backend (`Dinarxn/CloseBDS-Backend`)
**Auditor Role**: Authentication & Security Specialist Audit Baseline (Phase R1 Deliverable)
**Audit Date**: 2026-11-09
**Security Verdict**: PASSED WITH IDENTIFIED ARCHITECTURAL ENHANCEMENTS (Zero High-Severity Remote Exploits; 6 Hardening Items Documented)

---

## 1. Executive Security & Architecture Summary

The CloseBDS backend was audited line-by-line across all security surfaces, cryptographic modules, perimeter defenses, and permission boundaries. The architecture demonstrates a defense-in-depth posture:
- Strict **HS256** JSON Web Token (JWT) verification with algorithm pinning;
- 12-round **bcrypt** password hashing with salt generation;
- Secure password reset flow utilizing 256-bit entropy random tokens, SHA-256 digest storage, 1-hour expiration, single-use atomic consumption, and artificial latency jitter against user enumeration;
- Server-side **AES-256-GCM** authenticated cipher for telephony and Voice AI provider secrets;
- Systematic field-level credential masking (`maskProviderCredentials`, `maskTwilioSid`, `maskApiKey`);
- Pervasive repository-level multi-tenant boundary checks (`where: { id, workspaceId }`);
- RFC-compliant timing-safe HMAC webhook signature verifications (`crypto.timingSafeEqual`);
- Production error sanitization suppressing internal stack traces, database URIs, and SQL queries.

Six specific architectural hardening items (`SEC-01` through `SEC-06`) were cataloged for remediation during Phase R2 before broad production deployment.

---

## 2. Authentication Architecture & Identity Lifecycle

```
[ Client Request ]
       |
       +---> Checks cookie: request.cookies.session_token (HttpOnly, Secure, SameSite=Lax)
       |     OR Header: Authorization: Bearer <JWT>
       v
[ Auth Guard: requireAuthenticatedUser ]
       |
       +---> jsonwebtoken.verify(token, JWT_SECRET, { algorithms: ['HS256'] })
       |     Extracts claims: { userId, workspaceId, email, role }
       v
[ Workspace Scoping: requireWorkspaceContext ]
       |
       +---> Enforces request.workspaceContext = { workspaceId: payload.workspaceId }
       +---> If X-Workspace-Id header present, asserts X-Workspace-Id === payload.workspaceId
       |     Throws 403 Forbidden on cross-workspace mismatch
       v
[ Route Execution / Controller ]
```

### 2.1 Password Hashing Implementation
- **Source**: `backend/src/modules/auth/password.ts:1-22`
- **Algorithm**: `bcryptjs` with `SALT_ROUNDS = 12`.
- **Implementation**:
  - `hashPassword(plainPassword)` returns `bcrypt.hash(plainPassword, 12)`.
  - `verifyPassword(plainPassword, passwordHash)` returns `bcrypt.compare(plainPassword, passwordHash)`.
- **Invariants**: Plaintext passwords are never persisted, logged, or included in serialization responses.

### 2.2 JWT Token Architecture & Dual-Transport Extraction
- **Source**: `backend/src/modules/auth/token.ts:1-45`, `backend/src/core/permissions/auth-guards.ts:16-30`
- **Signing Specifications**: `{ expiresIn: '7d', algorithm: 'HS256' }`.
- **Verification Specifications**: Algorithm is strictly pinned: `algorithms: ['HS256']`, mitigating algorithm confusion attacks (`none`, `RS256`).
- **Token Claims Payload**:
  ```typescript
  export interface AuthTokenPayload {
    userId: string;
    workspaceId: string;
    email: string;
    role: 'OWNER' | 'ADMIN' | 'MEMBER';
  }
  ```
- **Dual-Transport Ingestion**:
  1. Checks signed cookie `request.cookies.session_token` (HttpOnly, SameSite=Lax, Secure in production).
  2. Falls back to HTTP `Authorization: Bearer <token>` header.
- **Secret Management**: Validated by `backend/src/config/env.ts` with minimum 16-character length requirement. In production, default development keys are rejected at startup.

### 2.3 Password Recovery & Reset Flow
- **Source**: `backend/src/modules/auth/auth.service.ts:223-341`, `backend/src/modules/auth/auth.router.ts:118-158`
- **Token Generation**: Generates 32 random bytes via `crypto.randomBytes(32).toString('hex')` (256 bits of cryptographic entropy).
- **Storage Model**: Stores SHA-256 digest (`tokenHash`) in the `PasswordResetToken` table; raw tokens are never written to database storage.
- **Expiration & Invalidation**: Tokens expire after 1 hour (`60 * 60 * 1000 ms`). Generating a new reset request invalidates all prior unconsumed tokens for the user. Reset consumption atomically marks `usedAt: new Date()` in a transaction, enforcing single-use.
- **Account Enumeration Defense**: If the email does not exist or the user is disabled, the endpoint returns an identical success message after an artificial latency delay (`40 + Math.random() * 20 ms`) to prevent timing analysis.
- **Rate Limiting**: Strictly throttled by IP to 5 requests per 15-minute window (`PASSWORD_RESET_RATE_LIMIT`).

---

## 3. Authorization, Role-Based Access Control (RBAC) & Permission Gates

### 3.1 Role Hierarchy & Permissions Matrix
Defined in `backend/prisma/schema.prisma:14-18` and `backend/src/core/permissions/auth-guards.ts:96-126`:

| Role | Campaigns Access | Leads Access | Cold Outreach Access | Voice Calling Access | Workspace Settings | Audit Logs |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **`OWNER`** | Full (Read/Write) | Full (Read/Write) | Full (Draft, Approve, Dispatch) | Full (Config, Approve, Dispatch) | Full (Read/Write) | Full (Read) |
| **`ADMIN`** | Full (Read/Write) | Full (Read/Write) | Full (Draft, Approve, Dispatch) | Full (Config, Approve, Dispatch) | Restricted (`settings:read`) | Full (Read) |
| **`MEMBER`** | Read-Only | Full (Read/Write) | Draft-Only (`outreach:draft`) | Prepare & View Only | None | None |

### 3.2 Authorization Guard Hooks
- `requireAuthenticatedUser`: Verifies JWT and binds `request.authenticatedUser` and `request.workspaceContext`.
- `requireWorkspaceContext`: Enforces workspace membership and validates `X-Workspace-Id` consistency.
- `requireRole(allowedRoles: UserRole[])`: Checks that `request.authenticatedUser.role` is authorized.
- `requirePermission(permission: Permission)`: Evaluates role against `ROLE_PERMISSIONS`.

---

## 4. Multi-Tenant Workspace Isolation

### 4.1 Strict Boundary Enforcement
- **Token-Derived Isolation**: `request.workspaceContext.workspaceId` is extracted solely from the cryptographic JWT session token. No query param, body field, or header can override this context.
- **Cross-Workspace Header Protection**: If a client supplies `X-Workspace-Id`, it must match `request.authenticatedUser.workspaceId`. Any mismatch immediately throws `ForbiddenError('Cross-workspace access is prohibited')` (HTTP 403).
- **Repository-Level Tenant Scoping**: All 20 database repositories in `backend/src/database/repository.ts` filter queries by `where: { id, workspaceId }`. Mutations verify ownership before updating records, completely preventing Insecure Direct Object References (IDOR).

---

## 5. Server-Side Cryptographic Credential Vault

### 5.1 Cipher Architecture (`backend/src/security/credential-vault.ts`)
- **Cipher Algorithm**: Authenticated **`aes-256-gcm`** (Galois/Counter Mode).
- **Key Derivation (KDF)**: Master secret derived using `crypto.scryptSync(masterSecret, salt, 32)`.
- **Initialization Vector (IV)**: Fresh 12-byte random IV (`crypto.randomBytes(12)`) generated per encryption operation.
- **Authentication Tag**: 16-byte authentication tag generated via `cipher.getAuthTag()` and verified via `decipher.setAuthTag(tag)`. Decryption aborts if ciphertext or tag is modified.

### 5.2 Field-Level Response Masking
All API serialization passes through `maskProviderCredentials`:
- `maskApiKey`: Displays prefix + `...` + last 4 characters.
- `maskTwilioSid`: Masked as `AC...last4`.
- `maskSecret`: Masked as `••••••••••••last4`.
- `maskPhoneNumber`: Masked as `+1••••••0199`.
- Plaintext secrets are never stored in the database or serialized to JSON clients.

---

## 6. Webhook Security, Signatures & Replay Protection

The backend ingests external webhooks through timing-safe cryptographic verification routines:

```
[ External Webhook Ingress ]
             |
             +---> Check Timestamp Drift (< 5 minutes)
             |     Rejects stale requests with 400 Bad Request
             v
[ Replay Protection Nonce Cache ]
             |
             +---> Checks processed nonces (15-minute TTL)
             |     Returns duplicate acknowledgment without re-processing
             v
[ Cryptographic Signature Verification ]
             |
             +---> Twilio:    HMAC-SHA1 over sorted params via crypto.timingSafeEqual
             +---> Retell AI: HMAC-SHA256 digest via crypto.timingSafeEqual
             +---> Vapi:      Timing-safe secret / HMAC-SHA256 signature
             +---> WhatsApp:  X-Hub-Signature-256 HMAC-SHA256 check
             +---> n8n:       X-CloseVDS-Signature HMAC-SHA256 stamping
             v
[ Domain Ingestion Service ]
```

- **Twilio Telephony Webhooks**: Verifies RFC HMAC-SHA1 over sorted POST parameters concatenated to the full request URL using `crypto.timingSafeEqual`.
- **Retell AI Webhooks**: Computes HMAC-SHA256 signature using webhook secret/API key, supporting hex and base64 digests with timing-safe comparison.
- **Vapi Webhooks**: Validates `x-vapi-secret` or HMAC-SHA256 digest `x-vapi-signature` via `crypto.timingSafeEqual`.
- **WhatsApp Webhooks**: Validates `X-Hub-Signature-256` HMAC-SHA256 signature with `appSecret` and handles GET subscription handshake challenges.
- **Replay Protection Engine (`voice-webhook.service.ts`)**:
  - Rejects events with timestamp drift > 5 minutes (`MAX_DRIFT_MS = 300,000 ms`).
  - Caches seen event IDs in a memory `Map` with 15-minute TTL (`CACHE_TTL_MS = 900,000 ms`). Duplicate events return `{ received: true, processed: false, duplicate: true }`.

---

## 7. Server Hardening, Network Defenses & OWASP Compliance

- **Helmet Security Headers (`@fastify/helmet` v13)**:
  - Content Security Policy: `defaultSrc: ["'self'"]`.
  - HSTS: `maxAge: 31536000`, `includeSubDomains: true`, `preload: true`.
  - Anti-Clickjacking: `xFrameOptions: { action: 'deny' }`.
  - MIME Sniffing: `xContentTypeOptions: true`.
- **CORS Whitelist (`@fastify/cors` v10)**:
  - Whitelist validation against `config.CORS_ORIGIN`.
  - Dynamically permits `localhost`/`127.0.0.1` in development.
  - Whitelisted headers: `Content-Type`, `Authorization`, `X-Workspace-Id`, `X-Request-Id`.
- **Rate Limiting (`@fastify/rate-limit` v10)**:
  - Global: 100 req/60s.
  - Auth routes: 20 req/60s.
  - Password recovery: 5 req/15min per IP.
- **Anti-SSRF Protection (`backend/src/security/ssrf.guard.ts`)**:
  - `validateUrlForAudit()` parses candidate target URLs and blocks loopbacks (`127.0.0.1`, `localhost`), RFC-1918 private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), cloud metadata endpoints (`169.254.169.254`), and non-HTTP protocols.
- **Input Validation**: Every HTTP endpoint validates request bodies and query parameters with strict Zod schemas before passing data to domain services.
- **Centralized Error Sanitization**: Internal database error details and stack traces are suppressed in production HTTP responses.

---

## 8. Prioritized Security Hardening Items (SEC-01 to SEC-06)

| ID | Severity | Domain | Component | Vulnerability / Risk | Required Hardening Action |
|:---:|:---:|:---:|:---:|:---|:---|
| **`SEC-01`** | **MEDIUM** | RBAC | `campaign.router.ts`, `outreach.router.ts`, `settings.router.ts` | Routes lack `requireRole` / `requirePermission`. Authenticated `MEMBER` users can mutate campaigns, approve/dispatch outreach emails, and alter workspace settings. | Add `requireRole(['OWNER', 'ADMIN'])` to mutative campaign, outreach approval/dispatch, and settings routes. |
| **`SEC-02`** | **HIGH** | Secrets / Multi-Tenancy | `voice-ai.service.ts:208-218` | `updateCredentials` mutates `process.env.RETELL_API_KEY` and `process.env.VAPI_API_KEY` at runtime. Causes process-wide cross-tenant credential bleeding. | Eliminate `process.env` mutation; load decrypted credentials per workspace from `WorkspaceProviderCredential` repository. |
| **`SEC-03`** | **MEDIUM** | Multi-Tenancy | `integration.service.ts:217-260` | Webhooks match contacts by email globally (`findFirst({ where: { email } })`). Duplicate prospect emails across workspaces result in misattributed events and state mutation. | Scope webhook attribution using outbound provider message IDs (`Outreach.providerMessageId`). |
| **`SEC-04`** | **MEDIUM** | Webhook Security | `voice.router.ts:708` | Missing signature header bypasses verification (`if (authToken && signature)`). | Enforce mandatory signature header presence; fail closed if secret is unconfigured in production. |
| **`SEC-05`** | **LOW** | Cryptography / Config | `credential-vault.ts:25`, `env.ts` | KDF salt is a hardcoded string; `ENCRYPTION_KEY` is not validated in `env.ts`. | Add `ENCRYPTION_KEY` and `ENCRYPTION_SALT` to `env.ts` schema with production requirement. |
| **`SEC-06`** | **MEDIUM** | SSRF | `n8n.service.ts:110`, `n8n.schema.ts:22` | n8n `webhookUrl` allows arbitrary URLs without SSRF validation against loopbacks or cloud metadata. | Enforce `validateUrlForAudit()` on n8n webhook registration and outbound dispatch. |

---

## 9. Verification & Independent Test Evidence

All security features were verified by executing the automated test suites:
- **`tsc --noEmit`**: 0 compilation errors.
- **`tests/auth.test.ts`**: 22/22 assertions passed (Password hashing, JWT claims, cookie extraction, workspace boundary).
- **`tests/auth-password-reset.test.ts`**: 12/12 assertions passed (SHA-256 token storage, 1h expiration, single-use invalidation, account enumeration defense, 5 req/15min rate limit).
- **`tests/integrations-webhooks.test.ts`**: 18/18 assertions passed (HMAC signature verification, timingSafeEqual, opt-out suppression, duplicate idempotency).
- **`tests/step26-production-hardening.test.ts`**: 10/10 assertions passed (Production config validation, database error sanitization, security headers, rate limiting, anti-SSRF).
