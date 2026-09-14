# closeVDS Cold Email Engine Specification

## 1. Cold Email Engine Overview

The **Cold Email Engine** handles outreach execution, follow-up sequencing, suppression rules, and delivery monitoring for qualified leads within closeVDS.

```text
┌─────────────────┐      ┌─────────────────────────┐      ┌────────────────────────┐
│ Qualified Lead  ├─────►│ Pre-Send Safety Gates   ├─────►│ Email Provider API     │
└─────────────────┘      └────────────┬────────────┘      └───────────┬────────────┘
                                      │                               │
                                      ▼                               ▼
                         ┌─────────────────────────┐     ┌─────────────────────────┐
                         │ 1. Suppression Check    │     │ Dispatched -> Update    │
                         │ 2. Daily Limit Check    │     │ Lead Status: CONTACTED  │
                         │ 3. Verified Sender Check│     └─────────────────────────┘
                         └─────────────────────────┘
```

---

## 2. Mandatory Compliance & Safety Gates

Outreach execution is governed by non-negotiable safety and compliance rules enforced at the API layer:

### A. Suppression & Opt-Out Checks
- **Mandatory Pre-Send Check**: Before dispatching any email, the system verifies that neither the recipient's email address nor domain exists in the workspace `Suppression` table.
- **Instant Opt-Out Execution**: When an opt-out request is received (via unsubscribe link or AI reply classification), the contact is immediately added to the suppression list and active email sequences are permanently stopped.

### B. Sending Limits & Rate Controls
- **Hard Daily Caps**: Strict configurable sending caps per campaign and per sending domain (MVP capacity target: max ~50 qualified prospects/day).
- **Staggered Velocity**: Emails are dispatched in randomized intervals to maintain domain reputation and adhere to email provider velocity guidelines.

### C. Absolute Prohibition of Spam Evasion
- **No Spam-Evasion Tactics**: The engine will **NEVER** use deceptive subject lines, hidden text, zero-font characters, image-only emails, or artificial obfuscation to bypass spam filters.
- **Authentication Alignment**: All sending domains must configure SPF, DKIM, and DMARC records. Dispatches from unaligned or unverified domains are blocked.

### D. Absolute Prohibition of Fake Identities
- **Verified Senders Only**: Emails must be sent from authenticated, legitimate business identities owned by the user. Sender address spoofing is strictly prohibited.
- **Physical Address & Unsubscribe**: All cold emails must include legitimate sender contact details and an explicit opt-out mechanism as required by CAN-SPAM, GDPR, and ePrivacy regulations.

### E. Honest & Fact-Based Personalization
- **No Fabricated Claims**: Email personalization must rely strictly on verified, observed data from website audits or public business listings.
- **No Hallucinated Accolades**: The engine will **NEVER** fabricate false customer reviews, non-existent audits, or fictitious pricing claims.

### F. Sensitivity & Data Abuse Protection
- **No PII Abuse**: Outreach is strictly limited to public B2B commercial contacts. Private individual consumer communications and sensitive data processing are strictly forbidden.

---

## 3. Sequence & Follow-Up Mechanics

### Sequence Lifecycle
1. **Initial Email (Touch 1)**: Highly personalized email draft sent to qualified contact.
2. **Follow-Up Delay (Touch 2)**: Scheduled after a configurable delay (e.g., 3 to 5 business days). Sent ONLY if:
   $$\text{Replied} == \text{FALSE} \quad \text{AND} \quad \text{Suppressed} == \text{FALSE} \quad \text{AND} \quad \text{LeadStatus} == \text{CONTACTED}$$
3. **Final Touch (Touch 3)**: Final follow-up attempt. If no reply, sequence completes and lead status transitions to `NO_RESPONSE`.
4. **Sequence Halting**: Any inbound reply, manual status change (e.g. moved to Meeting Booked), or opt-out **IMMEDIATELY halts** all further follow-up touches.

---

## 4. Emergency Kill Switch & Campaign Pause

- **Global Kill Switch**: The backend API provides an instant emergency kill switch endpoint (`/api/v1/outreach/kill-switch`) that immediately halts all active email queues across all workspace campaigns.
- **Bounce Protection**: If the bounce rate for a campaign exceeds 5%, the backend automatically pauses sending for that campaign and notifies the user to verify contact data quality.
