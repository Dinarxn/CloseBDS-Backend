# closeVDS MVP Scope & Exclusion Boundaries

## 1. Executive Scope Summary

The objective of the **closeVDS MVP** is to deliver a production-ready, fully functional client acquisition pipeline capable of processing up to **50 qualified prospects per day per campaign**.

---

## 2. Frozen List of 20 Mandatory MVP Capabilities

1. **Campaign Creation & Builder**: User can define campaign name, niche, location, qualification rules, target offer description, and daily cap.
2. **Niche Input & Configuration**: Niche specification is parameter-driven (e.g. Dental Clinics, Med Spas, Gyms, Real Estate).
3. **Location Input**: Location targeting is fully parameter-driven (e.g. London, New York, Austin).
4. **Lead Limit Enforcement**: Strict configurable capacity limit (default max ~50 qualified prospects/day).
5. **Lead Discovery Integration**: Automated candidate discovery via provider APIs based on niche and location.
6. **Field Normalization**: Standardized field parsing for company name, domain, address, phone, and contact details.
7. **4-Factor Lead Deduplication**: Automatic deduplication against workspace leads matching business name + domain + phone + address.
8. **AI Lead Qualification**: AI evaluation resulting in a 0-100 relevance/opportunity score and clear reasoning rationale.
9. **Basic Website & Business Analysis**: Automated HTTP analysis verifying domain health, mobile readiness, and visible CTA/booking gaps.
10. **Lead Scoring Engine**: Quantified scoring matrix separating qualified leads from disqualified prospects.
11. **AI Outreach Personalization**: AI drafting of non-templated cold email copy grounded strictly in verified lead facts.
12. **Cold Email Dispatch Engine**: Email sending via provider abstraction with sending rate controls.
13. **Automated Follow-Up Sequences**: Multi-touch follow-up scheduling for un-replied, eligible leads.
14. **Inbound Reply Tracking & Webhooks**: Ingesting incoming replies via provider webhooks.
15. **Opt-Out & Suppression List**: Automatic suppression of opted-out or bounced contacts across workspace campaigns.
16. **Integrated CRM Sales Pipeline**: Visual lead stage management (New, Qualified, Contacted, Replied, Interested, Meeting, Proposal, Won, Lost, Opted-Out).
17. **Acquisition Analytics Dashboard**: Performance metrics displaying leads found, qualification rates, emails sent, reply rates, and pipeline status.
18. **Campaign Controls**: Pause, resume, edit, and stop campaign controls.
19. **System Settings & Safety Controls**: Server-side credential management and Global Outreach Kill Switch.
20. **Security Foundation**: AuthN/AuthZ, zero frontend secrets, rate limiting, and audit logging.

---

## 3. Frozen List of 12 Explicit MVP Exclusions (Non-Goals)

To prevent scope creep and maintain development focus, the following capabilities are **EXPLICITLY EXCLUDED** from the MVP:

1. **Unofficial / Bulk WhatsApp Automation**: No unofficial WhatsApp web scraping, bulk messaging, or anti-ban bypass scripts.
2. **SMS Automation**: No SMS messaging rails in MVP.
3. **Full Proposal & Agreement Generation**: Contract drafting, PDF proposal compilation, and e-signatures are deferred to post-MVP.
4. **Full Contract & Legal Automation**: Legal document generation is deferred.
5. **Integrated Billing & Invoicing Platform**: Payment gateways (Stripe/PayPal), subscriber billing, and invoicing are deferred.
6. **Multi-Tenant Enterprise Admin Controls**: Advanced multi-organization enterprise billing and global tenant switching are deferred.
7. **Advanced Team & Granular Permissions**: Multi-user role permissions (e.g. custom RBAC per team member) deferred; single workspace role model used for MVP.
8. **Complex AI Autonomous Sales Negotiation**: AI will not autonomously negotiate pricing or close binding contracts without human review.
9. **Autonomous Deal Closing**: Closing transactions is handled by human sales reps via CRM stage tracking.
10. **Large-Scale Scraping Infrastructure**: No distributed proxy networks, browser farm clusters, or CAPTCHA solving farms.
11. **Unlimited Outreach**: System strictly enforces rate caps and compliance limits; infinite sending is prohibited.
12. **Multi-Channel Unified Inbox**: Omnichannel social media messaging (LinkedIn DMs, Instagram DMs, X DMs) is deferred to future post-MVP phases.
