# closeVDS Data Flow Specifications

## 1. Data Flow Overview

This document specifies the exact end-to-end data flows across closeVDS. Every data transition enforces backend authority, strict input validation, database immutability where appropriate, and status updates.

---

## 2. Flow A — Lead Discovery & Deduplication

```text
┌──────────┐      ┌──────────┐      ┌─────────────────┐      ┌───────────────┐
│ User     ├─────►│ Frontend ├─────►│ Backend API     ├─────►│ Lead Provider │
└──────────┘      └──────────┘      └────────┬────────┘      └───────┬───────┘
                                             │                       │
                                             ▼                       │
                                    ┌─────────────────┐              │
                                    │ Validate Input  │◄─────────────┘
                                    └────────┬────────┘ (Raw Candidates)
                                             │
                                             ▼
                                    ┌─────────────────┐
                                    │ Field Normalizer│
                                    └────────┬────────┘
                                             │
                                             ▼
                                    ┌─────────────────┐
                                    │ Deduplication   │ (Check: Name + Domain +
                                    │ Check Engine    │  Phone + Address)
                                    └────────┬────────┘
                                             │
                                             ├────────► Duplicate? ──► Log & Skip
                                             │
                                             ▼
                                    ┌─────────────────┐
                                    │ Save to DB      │ (Status: NEW)
                                    │ Queue Qual.     │
                                    └─────────────────┘
```

1. **User Action**: User submits campaign criteria (Niche: "Dental Clinics", Location: "London", Daily Limit: 50).
2. **API Handshake**: Frontend posts to `/api/v1/campaigns` -> Backend validates payload via Zod schema.
3. **Provider Execution**: Backend invokes `LeadDiscoveryService.discoverCandidates()` to fetch raw business results.
4. **Normalization**: Raw lead fields (company name, address, phone, URL) are normalized into standardized UTF-8 string representations.
5. **Deduplication Check**: Backend queries `Lead` table using a 4-factor match key:
   $$\text{Match Key} = \text{Normalize}(\text{Business Name}) + \text{Normalize}(\text{Domain}) + \text{Phone} + \text{Address}$$
   If a match exists within the active Workspace, the candidate is discarded as a duplicate and logged.
6. **Persistence**: New leads are saved to PostgreSQL with status `NEW` and enqueued for qualification.

---

## 3. Flow B — Website Audit & AI Qualification

```text
┌───────────────┐      ┌──────────────────────┐      ┌──────────────────────┐
│ Candidate Lead├─────►│ Website Audit Service├─────►│ AI Qualification Svc │
│ (Status: NEW) │      └──────────┬───────────┘      └──────────┬───────────┘
└───────────────┘                 │                             │
                                  ▼                             ▼
                         ┌──────────────────┐          ┌──────────────────┐
                         │ HTTP Head/DOM    │          │ AIService        │
                         │ Gap Audit        │          │ Prompt Execution │
                         └────────┬─────────┘          └────────┬─────────┘
                                  │                             │
                                  └──────────────┬──────────────┘
                                                 │
                                                 ▼
                                      ┌────────────────────┐
                                      │ Score Lead (0-100) │
                                      │ Rationale Synthesis│
                                      └──────────┬─────────┘
                                                 │
                         ┌───────────────────────┴───────────────────────┐
                         ▼                                               ▼
              Score >= Threshold?                              Score < Threshold?
                         │                                               │
                         ▼                                               ▼
         ┌──────────────────────────────┐                ┌──────────────────────────────┐
         │ Status: QUALIFIED            │                │ Status: DISQUALIFIED         │
         │ Queue for Personalization    │                │ Save Rationale & Stop        │
         └──────────────────────────────┘                └──────────────────────────────┘
```

1. **Audit Trigger**: Backend queues lead for analysis.
2. **Website Inspection**: `WebsiteAuditService` executes HTTP requests to evaluate URL availability, SSL validity, mobile viewport presence, CTA visibility, and booking links. `WebsiteAudit` record saved.
3. **AI Qualification Call**: `AIService.qualifyLead()` receives lead facts + website audit summary + campaign criteria.
4. **Scoring & Reasoning**: AI generates a quantified `RelevanceScore` (0-100), `OpportunityScore` (0-100), and structured reasoning rationale without inventing unobserved facts.
5. **State Transition**:
   - If Total Score $\ge$ Campaign Threshold: Lead status updated to `QUALIFIED`, enqueued for personalization.
   - If Total Score $<$ Campaign Threshold: Lead status updated to `DISQUALIFIED`, rationale recorded, outreach pipeline halted.

---

## 4. Flow C — AI Personalization & Cold Email Dispatch

```text
┌─────────────────┐      ┌────────────────────┐      ┌────────────────────┐
│ Qualified Lead  ├─────►│ AI Personalization ├─────►│ Email Safety Gate  │
└─────────────────┘      └─────────┬──────────┘      └─────────┬──────────┘
                                   │                           │
                                   ▼                           ▼
                         ┌──────────────────┐        ┌────────────────────┐
                         │ Generate Subject,│        │ 1. Suppression Check│
                         │ Hook, Obs & CTA  │        │ 2. Daily Limit Check│
                         └─────────┬────────┘        │ 3. Sender Identity │
                                   │                 └─────────┬──────────┘
                                   ▼                           │
                         ┌──────────────────┐                  │
                         │ EmailMessage     │◄─────────────────┘
                         │ (Status: QUEUED) │
                         └─────────┬────────┘
                                   │
                                   ▼
                         ┌──────────────────┐
                         │ Email Provider   │
                         │ Dispatch API     │
                         └─────────┬────────┘
                                   │
                                   ▼
                         ┌──────────────────┐
                         │ Update Lead:     │
                         │ CONTACTED        │
                         └──────────────────┘
```

1. **Personalization Prompt**: `AIService.personalizeOutreach()` converts verified business observations and offer parameters into a non-templated cold email draft.
2. **Safety Gate Verification**: Before enqueueing `EmailMessage`, backend runs mandatory checks:
   - Recipient email / domain check against `Suppression` table (Opt-Outs & Hard Bounces).
   - Campaign daily limit check (ensure count $<$ limit).
   - Global Kill Switch check.
3. **Message Draft Persistence**: Message stored as `EmailMessage` with status `QUEUED`.
4. **Dispatch**: `EmailService.sendEmail()` transmits payload to configured delivery provider.
5. **Status Update**: Upon provider HTTP 200/202 confirmation, message status becomes `SENT`, lead status becomes `CONTACTED`, and CRM activity log entry is written.

---

## 5. Flow D — Automated Follow-Up Sequence

```text
┌───────────────────┐      ┌───────────────────┐      ┌─────────────────────┐
│ Cron Trigger      ├─────►│ Backend Sequence  ├─────►│ Check Lead          │
│ (Daily Scheduler) │      │ Engine            │      │ Eligibility         │
└───────────────────┘      └───────────────────┘      └──────────┬──────────┘
                                                                 │
                                                                 ▼
                                                      ┌─────────────────────┐
                                                      │ Replied = False     │
                                                      │ Opt-Out = False     │
                                                      │ Delay Expired = True│
                                                      └──────────┬──────────┘
                                                                 │
                                        ┌────────────────────────┴────────────────────────┐
                                        ▼                                                 ▼
                                 Eligible Lead                                   Ineligible Lead
                                        │                                                 │
                                        ▼                                                 ▼
                        ┌──────────────────────────────┐                  ┌──────────────────────────────┐
                        │ Generate Follow-up Touch     │                  │ Skip & Update Sequence State │
                        │ Enqueue & Send               │                  └──────────────────────────────┘
                        └──────────────────────────────┘
```

1. **Trigger**: n8n or backend cron triggers `/api/v1/outreach/check-followups`.
2. **Eligibility Evaluation**: Backend queries `Lead` records in status `CONTACTED` where:
   - `has_replied = FALSE`
   - `is_suppressed = FALSE`
   - `last_contacted_at <= NOW() - interval (FollowUpDelay)`
3. **Follow-Up Dispatch**: Eligible leads receive generated follow-up Touch N email via Flow C safety gates.
4. **Sequence Termination**: If max follow-up count reached without reply, lead status transitions to `NO_RESPONSE` and sequence completes.

---

## 6. Flow E — Inbound Reply Handling & CRM Update

```text
┌─────────────────┐      ┌──────────────────┐      ┌──────────────────────┐
│ Email Provider  ├─────►│ Webhook Listener ├─────►│ Webhook Signature    │
│ Inbound Webhook │      │ /api/v1/email/wh │      │ Verification         │
└─────────────────┘      └──────────────────┘      └──────────┬───────────┘
                                                              │
                                                              ▼
                                                   ┌──────────────────────┐
                                                   │ Match Contact/Lead   │
                                                   └──────────┬───────────┘
                                                              │
                                                              ▼
                                                   ┌──────────────────────┐
                                                   │ AI Reply Classifier  │
                                                   └──────────┬───────────┘
                                                              │
                    ┌─────────────────────────────────────────┼─────────────────────────────────────────┐
                    ▼                                         ▼                                         ▼
            Category: OPT_OUT                        Category: INTERESTED                     Category: OBJECTION
                    │                                         │                                         │
                    ▼                                         ▼                                         ▼
      ┌───────────────────────────┐             ┌───────────────────────────┐             ┌───────────────────────────┐
      │ 1. Add to Suppression     │             │ 1. Halt Sequence          │             │ 1. Halt Sequence          │
      │ 2. Halt Sequence          │             │ 2. Lead Status: INTERESTED│             │ 2. Lead Status: REPLIED   │
      │ 3. Status: OPTED_OUT      │             │ 3. Notify User            │             │ 3. Create CRM Task        │
      └───────────────────────────┘             └───────────────────────────┘             └───────────────────────────┘
```

1. **Webhook Ingestion**: Provider POSTs inbound email event to `/api/v1/email/webhook`.
2. **Verification**: Backend verifies provider HMAC webhook signature before processing payload.
3. **Contact Match**: Sender address matched to `Contact` and `Lead` record in database.
4. **AI Reply Classification**: `AIService.classifyReply()` classifies response text into:
   - `INTERESTED`
   - `QUESTION`
   - `OBJECTION`
   - `NOT_INTERESTED`
   - `OPT_OUT`
   - `UNCLEAR`
5. **Action Routing**:
   - **`OPT_OUT`**: Email address immediately written to `Suppression` table, follow-up sequence halted, lead status updated to `OPTED_OUT`.
   - **`INTERESTED` / `QUESTION` / `OBJECTION`**: Automated email sequence **immediately halted**, lead status updated in CRM pipeline, notification dispatched to User.
