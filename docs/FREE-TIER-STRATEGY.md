# closeVDS Free-Tier Infrastructure & Vendor Strategy

## 1. Executive Strategy

The primary goal of the closeVDS Phase 0 stack strategy is to enable **$0 initial infrastructure cost during development and early low-volume MVP validation**, utilizing legitimate free tiers and open-source components.

> [!IMPORTANT]
> **Commercial Use & Limit Clarification**: $0 infrastructure cost is targeted strictly as an **initial development and low-volume validation baseline** where provider commercial-use terms permit it. It is **NOT a permanent guarantee**. All third-party provider terms of service, acceptable use policies, commercial restrictions, and rate limits must be respected at all times.

---

## 2. MVP Free-Tier Component Mapping

```text
┌─────────────────────────────────────────────────────────┐
│ FRONTEND DEPLOYMENT: Free Tier (e.g. Vercel / Netlify)  │
├─────────────────────────────────────────────────────────┤
│ BACKEND API DEPLOYMENT: Free Tier / Self-Hosted Runner  │
├─────────────────────────────────────────────────────────┤
│ DATABASE: Free PostgreSQL Tier (e.g. Neon / Supabase)   │
├─────────────────────────────────────────────────────────┤
│ AUTOMATION ENGINE: n8n Community Edition (Self-Hosted) │
├─────────────────────────────────────────────────────────┤
│ AI MODEL PROVIDER: Low-Cost / Free Trial API Allocations│
├─────────────────────────────────────────────────────────┤
│ COLD EMAIL DISPATCH: Legitimate Low-Volume Free Tier    │
└─────────────────────────────────────────────────────────┘
```

### Component Breakdown & Limits

1. **Frontend Hosting**: Deployed on legitimate free tiers (Vercel / Netlify) respecting bandwidth and build-minute limits.
2. **Backend API Hosting**: Deployed on free-tier container platforms (Render / Fly.io / Railway) or self-hosted environments.
3. **PostgreSQL Database**: Deployed on free cloud PostgreSQL tiers (Neon / Supabase / Render Postgres) within storage limits (e.g., 500MB - 1GB).
4. **n8n Automation Engine**: Self-hosted n8n Community Edition running locally or on a standard free/low-cost VM.
5. **AI Services**: Utilizing low-cost model tiers (e.g., GPT-4o-mini, Claude 3 Haiku, or DeepSeek API) with strict usage caps.
6. **Cold Email Provider**: Legitimate low-volume transactional email provider (Resend free tier, SendGrid free tier, or standard SMTP) adhering strictly to provider terms.

---

## 3. Limit Thresholds & Graceful Degraded Behavior

When free-tier limits (storage, monthly email quotas, AI token caps) are reached, the system behaves deterministically without crashing:

```text
┌─────────────────────────┐
│ Free Limit Approached   │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ Alert Admin & Log Event │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ Enforce Safe Queue Pause│ (No data loss, transactions held in DB queue)
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ Upgrade or Resume       │ (Seamless transition to paid provider key)
└─────────────────────────┘
```

- **Email Daily Limit Reached**: Email dispatcher pauses queue processing, logs `LIMIT_EXCEEDED` alert, and resumes automatically when quota resets.
- **AI Token Limit Reached**: System pauses background qualification jobs and alerts user to upgrade key or wait for token reset.
- **Database Storage Threshold (80%)**: Cleanup job purges old raw HTTP audit logs while preserving structured Lead/CRM records.

---

## 4. Provider Replacement & Upgrade Pathways

Because all external providers are isolated behind TypeScript interface abstractions (`AIService`, `EmailService`, `LeadDiscoveryService`), upgrading from a free tier to a paid commercial provider requires **zero code rewrites**.

### Upgrade Mechanics
1. **Key Replacement**: Simply update the relevant server-side environment variable (e.g., `EMAIL_PROVIDER_API_KEY`).
2. **Provider Swap**: If switching vendors (e.g., from Resend Free to SendGrid Pro, or OpenAI to Anthropic), implement the service interface and update configuration. Core application logic remains untouched.
3. **No Lock-In Guarantee**: No custom vendor-locked database schemas or proprietary SDKs are embedded into core business services.
