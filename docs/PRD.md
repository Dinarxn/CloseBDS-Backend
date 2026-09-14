# closeVDS Product Requirements Document (PRD)

## 1. Product Overview

- **Product Name**: closeVDS
- **Product Category**: AI Client Acquisition OS
- **Tagline**: Find. Qualify. Reach. Close.
- **MVP Capacity Target**: Up to ~50 **QUALIFIED** prospects per day per campaign.

## 2. Core User Experience Flow

```text
USER INPUT (Niche + Location + Criteria)
   │
   ▼
1. CAMPAIGN BUILDER ────────► Configures targeting rules & value proposition
   │
   ▼
2. LEAD DISCOVERY ──────────► Fetches candidate businesses from provider APIs
   │
   ▼
3. DEDUPLICATION & NORM ────► Normalizes fields & filters existing leads
   │
   ▼
4. WEBSITE ANALYSIS ────────► Audits domain, UX, CTA, mobile responsiveness
   │
   ▼
5. AI QUALIFICATION ────────► Scores lead relevance (0-100) & opportunity
   │
   ▼
6. AI PERSONALIZATION ──────► Drafts personalized cold email subject & body
   │
   ▼
7. COLD EMAIL DISPATCH ─────► Enqueues and sends email via provider
   │
   ▼
8. FOLLOW-UP AUTOMATION ────► Schedules follow-up touches if no reply
   │
   ▼
9. REPLY CLASSIFICATION ────► Webhook receives reply -> AI classifies -> updates CRM
   │
   ▼
10. CRM & ANALYTICS ────────► Visual pipeline management & campaign performance metrics
```

---

## 3. Comprehensive Module Specifications

### Module A: Campaign Builder
- **Purpose**: Allow users to create, configure, pause, and manage targeted client acquisition campaigns.
- **Inputs**: Campaign Name, Niche (e.g. Dental Clinics), Location (e.g. London, UK), Lead Criteria Rules, Target Offer/Service description, Daily Limit (default max 50).
- **Outputs**: Configured `Campaign` record with active status and targeting configuration.
- **Dependencies**: Backend Campaign Service, Database.
- **User Actions**: Create campaign, set niche/location/criteria, pause/resume campaign, set daily lead limit.
- **System Actions**: Validate campaign parameters, initialize queue state, enforce daily capacity bounds.
- **Future Expansion**: Multi-niche campaign groups, automated AI prompt selection per campaign tier.

### Module B: Lead Discovery
- **Purpose**: Discover prospective business targets matching the campaign's niche and location criteria.
- **Inputs**: Campaign target parameters (niche, location, daily target limit).
- **Outputs**: Normalized, deduplicated candidate business records queued for analysis.
- **Dependencies**: Lead Discovery Provider Abstraction, Backend Lead Service, Database.
- **User Actions**: View discovery logs, trigger manual discovery batch, set search filters.
- **System Actions**: Query lead source APIs, normalize data fields (business name, website, address, phone), perform 4-factor deduplication against existing database records, store discovery metadata.
- **Future Expansion**: Multi-source enrichment aggregation, automatic fallback discovery providers.

### Module C: Lead Qualification
- **Purpose**: Systematically evaluate discovered leads against campaign criteria to filter out non-viable prospects.
- **Inputs**: Raw lead data, website audit signals, campaign qualification rules.
- **Outputs**: `LeadScore` (0-100), qualification status (QUALIFIED vs DISQUALIFIED), and explicit AI reasoning rationale.
- **Dependencies**: AI Service Abstraction, Backend Qualification Service, Website Audit Service.
- **User Actions**: Adjust score thresholds, override qualification status, view qualification breakdown.
- **System Actions**: Evaluate business relevance, score opportunity gaps, save score and reasoning, filter out unqualified leads from outreach queues.
- **Future Expansion**: Custom custom-scoring weight matrices, multi-judge LLM evaluation.

### Module D: Website & Business Analysis
- **Purpose**: Conduct automated analysis of candidate business websites to uncover tangible business opportunities.
- **Inputs**: Target business URL, website HTML metadata, homepage content.
- **Outputs**: `WebsiteAudit` record detailing site availability, mobile optimization indicators, SSL status, clear CTA presence, booking system presence, and observed digital gaps.
- **Dependencies**: Backend Website Audit Service, HTTP Client.
- **User Actions**: View audit summary, trigger re-audit for a specific lead.
- **System Actions**: Fetch website metadata, verify page load health, inspect DOM for key elements (booking links, phone numbers, broken links), structure audit summary.
- **Future Expansion**: Full lighthouse performance scoring, tech stack detection (builtwith style), SEO deficit analysis.

### Module E: AI Personalization
- **Purpose**: Draft highly specific, relevant cold email copy for qualified leads based on verified facts.
- **Inputs**: Qualified Lead details, Website Audit findings, Campaign Offer details.
- **Outputs**: `EmailMessage` draft containing personalized subject line, opening hook, specific business observation, value proposition, and CTA.
- **Dependencies**: AI Service Abstraction, AI Anti-Hallucination Guardrails.
- **User Actions**: Review generated draft, edit draft manually, approve draft for sending, enable auto-sending.
- **System Actions**: Execute structured AI prompt, enforce anti-hallucination rules (never invent reviews, prices, or false claims), validate text output, store message draft.
- **Future Expansion**: A/B testing prompt variants, sentiment alignment matching recipient persona.

### Module F: CRM Pipeline
- **Purpose**: Provide a single visual pipeline interface to manage lead statuses and sales progress.
- **Inputs**: Lead state updates, manual status changes, user notes, reply events.
- **Outputs**: Visual Kanban pipeline view, lead activity logs, status history.
- **Dependencies**: Backend CRM Service, Database.
- **User Actions**: Move leads between stages, add manual notes, log phone calls/meetings, edit lead contact info.
- **System Actions**: Maintain audit log of state changes, trigger sequence pauses on pipeline progression (e.g. moving to Meeting Booked).
- **Future Expansion**: Task reminders, custom pipeline stages, auto-assignment rules.

### Module G: Cold Email Engine
- **Purpose**: Execute controlled, compliant cold email outreach to qualified leads.
- **Inputs**: Approved `EmailMessage` draft, recipient email address, sending provider configuration.
- **Outputs**: Email dispatch status (SENT, FAILED, SUPPRESSED), provider message ID, email activity log.
- **Dependencies**: Email Provider Abstraction, Suppression Service, Cold Email Safety Controls.
- **User Actions**: Configure sender address/signature, set daily sending caps, trigger/pause sending queue, trigger emergency kill switch.
- **System Actions**: Enforce suppression list check, check daily sending limit, log email dispatch event, record provider responses.
- **Future Expansion**: Multi-mailbox rotation, warm-up sequencing, custom domain tracking.

### Module H: Follow-Up Sequence Orchestrator
- **Purpose**: Automatically send scheduled follow-up emails to leads who have not replied or opted out.
- **Inputs**: Campaign follow-up configuration (delay days, max touches), lead status, email history.
- **Outputs**: Enqueued follow-up email messages, sequence state updates.
- **Dependencies**: Backend Outreach Service, Cold Email Engine, Database.
- **User Actions**: Define follow-up delays (e.g. Touch 2 after 3 days), edit follow-up templates.
- **System Actions**: Evaluate lead eligibility (Check: Replied = False, Opt-Out = False, Status = Contacted), generate follow-up copy, enqueue dispatch when delay timer expires.
- **Future Expansion**: Branching sequence logic based on email open/click engagement.

### Module I: Acquisition Analytics
- **Purpose**: Provide high-level visibility into campaign health, pipeline conversion rates, and acquisition ROI.
- **Inputs**: Lead counts, qualification metrics, email delivery events, CRM status transitions.
- **Outputs**: Analytics dashboard displaying total leads found, qualification rate, email delivery/bounce rate, reply rate, positive reply count, meetings booked, closed deals.
- **Dependencies**: Backend Analytics Service, Database Aggregation Queries.
- **User Actions**: Filter metrics by date range/campaign, export CSV summary reports.
- **System Actions**: Aggregate real-time statistics from database tables, calculate conversion percentages.
- **Future Expansion**: Revenue forecasting, campaign ROI calculator, comparative channel analysis.

### Module J: System Settings & Safety Controls
- **Purpose**: Manage system-wide configuration, API credentials, sending safety bounds, and global controls.
- **Inputs**: Provider API keys (stored server-side), global sending limits, opt-out suppression list.
- **Outputs**: Active system configuration state.
- **Dependencies**: Backend Settings Service, Encrypted Environment Storage.
- **User Actions**: Update provider keys (server-side only), update suppression rules, trigger Global Outreach Kill Switch.
- **System Actions**: Validate API credentials, mask sensitive key displays, enforce global kill switch state.
- **Future Expansion**: Team access roles (read-only vs admin), webhook endpoint management.
