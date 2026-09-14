# closeVDS Security Architecture & Safety Gates

## 1. Security Foundation Principles

closeVDS enforces enterprise-grade security controls, zero-trust backend isolation, and strict compliance boundaries across all system components.

```text
┌──────────────────────────────────────────────────────────┐
│                   SECURITY BOUNDARY                       │
├──────────────────────────────────────────────────────────┤
│ 1. Zero Frontend Secrets                                 │
│ 2. Strict Server-Side AuthN & AuthZ                      │
│ 3. Rate Limiting & Input Validation                      │
│ 4. Mandatory Compliance & Safety Gates                   │
│ 5. Audit Logging & Emergency Kill Switch                 │
└──────────────────────────────────────────────────────────┘
```

---

## 2. Mandatory Compliance & Safety Gates

### A. Suppression & Opt-Out Enforcement
- **Pre-Send Verification**: Every outgoing email dispatch MUST query the workspace `Suppression` table before sending.
- **Immediate Opt-Out Processing**: When an unsubscribe link is clicked or an inbound reply is classified as `OPT_OUT`, the email address and domain are immediately added to the `Suppression` table.
- **Immutable Suppression Rules**: Suppressed contacts can never be emailed by any campaign within the workspace.

### B. Sending Limits & Velocity Controls
- **Hard Daily Caps**: Enforce non-configurable daily sending caps per campaign and per sending domain (MVP max 50 qualified prospects/day).
- **Rate-Limited Dispatch**: Emails are dispatched with randomized delay intervals to prevent server spikes and respect provider sending quotas.

### C. Prohibition of Spam Evasion
- **No Spam-Evasion Tactics**: The system will **NEVER** employ spam-filter evasion tactics, deceptive headers, misleading subject lines, or hidden text tricks.
- **Valid Identifiers**: All outreach must include valid SPF, DKIM, DMARC alignment, and physical sender identification as required by applicable laws (CAN-SPAM, GDPR, PECR).

### D. Prohibition of Anti-Bot / CAPTCHA Bypass
- **No CAPTCHA Evasion**: closeVDS will **NEVER** integrate CAPTCHA-solving services, anti-bot circumvention tools, or unauthorized headless browser bypasses.
- **Approved API Sourcing**: Lead discovery relies strictly on legitimate data sources, open public registries, and provider-approved APIs.

### E. Prohibition of Fake Identities
- **No Fabricated Personas**: Outreach must be conducted under legitimate, verified sender identities belonging to the user's business.
- **No Spoofing**: Sender identity spoofing or unauthorized domain impersonation is strictly forbidden and blocked by backend validation.

### F. Anti-Hallucination & Honest Personalization
- **No Fabricated Personalization**: AI personalization prompts must adhere strictly to verified, observed lead data.
- **No Fake Reviews or Audit Claims**: The AI is strictly prohibited from fabricating fake customer reviews, false website audits, non-existent awards, or fictitious pricing claims.

### G. Protection Against Sensitive-Data Abuse
- **Data Minimization**: The system collects only public B2B business contact information necessary for legitimate outreach.
- **No PII Harvest**: No sensitive personal data (national IDs, personal financials, private health info) is collected, stored, or processed.

---

## 3. Application & Infrastructure Security Controls

### Authentication & Authorization
- **JWT / Session Security**: Auth tokens use short-lived HTTP-only cookies with `SameSite=Strict` and `Secure` flags.
- **Role-Based Access Control (RBAC)**: Workspace tenant boundary checks on every backend route ensure users cannot access or modify leads outside their authorized workspace.

### Secret Management & API Key Protection
- **Server Isolation**: All third-party credentials (AI API keys, Email provider tokens, Lead API keys, Database credentials) reside in server environment variables.
- **Zero Frontend Exposure**: No API keys are bundled into frontend static assets or client-side HTTP calls.

### Input & Output Sanitization
- **Strict Zod Schemas**: Every API payload is validated against Zod schemas. Invalid payloads are rejected with HTTP 400.
- **SQL Injection Prevention**: All database queries use parameterized SQL builders (Kysely/Prisma ORM). Raw unescaped string queries are prohibited.
- **XSS & SSRF Prevention**: Output HTML sanitization prevents stored XSS in CRM fields. Website audit HTTP clients enforce URL whitelist validation and internal IP blocking (anti-SSRF).

### Prompt Injection Resistance
- User inputs embedded into AI prompts are wrapped in strict delimiters and sanitized to prevent prompt injection attacks from altering model behavior or extracting system instructions.

### Audit Logging & Global Kill Switch
- **Audit Logs**: All campaign state changes, API key updates, manual overrides, and dispatch events are written to the immutable `AuditLog` table.
- **Global Kill Switch**: A dedicated backend toggle allows users or admins to instantly freeze all outgoing email dispatch queues across all active campaigns.
