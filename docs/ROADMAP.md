# closeVDS Roadmap & Milestone Plan

## 1. Roadmap Overview

This roadmap defines the sequential development phases for closeVDS, moving from initial Phase 0 architecture freezing through Phase 7 end-to-end validation, followed by long-term post-MVP expansion boundaries.

---

## 2. Phase Breakdown

### Phase 0 — Product & Architecture Foundation (CURRENT)
- [x] Product positioning & brand rules frozen (Monochrome black & white theme)
- [x] Architecture principles & backend authority rules frozen
- [x] Conceptual database model (17 entities) & relationships frozen
- [x] Conceptual API endpoints (10 route groups) frozen
- [x] Tech stack & provider abstraction contracts frozen
- [x] End-to-end data flows (A through E) specified
- [x] Security architecture, safety gates & anti-spam compliance frozen
- [x] Free-tier $0 development strategy & vendor terms frozen
- [x] MVP scope (20 capabilities) & exclusions (12 items) frozen
- [x] Documentation standardized to `.md` files

### Phase 1 — Project Initialization (NEXT PHASE)
- [ ] Initialize Next.js frontend project structure with TypeScript & Tailwind CSS
- [ ] Initialize Fastify backend project structure with TypeScript & Zod
- [ ] Configure PostgreSQL database connection & ORM query builder
- [ ] Implement server-side environment configuration & secret isolation
- [ ] Establish repository branching rules & initial CI checks
- [ ] Verify baseline client-server REST handshake

### Phase 2 — Lead System & Discovery Module
- [ ] Implement Campaign data model & API endpoints (`/api/v1/campaigns`)
- [ ] Implement Lead & Contact data models (`/api/v1/leads`)
- [ ] Build Lead Discovery Provider Abstraction & integration
- [ ] Implement 4-Factor Lead Normalization & Deduplication algorithm
- [ ] Develop Lead management UI & candidate listing tables

### Phase 3 — Intelligence & Qualification Module
- [ ] Build Website Audit Service & HTTP gap detection engine
- [ ] Build AI Service Provider Abstraction & prompt executor
- [ ] Implement AI Lead Qualification & 0-100 scoring engine
- [ ] Implement anti-hallucination guardrails & structured JSON parsing
- [ ] Develop lead scoring & opportunity breakdown UI

### Phase 4 — CRM Pipeline Module
- [ ] Implement CRM pipeline data structures & lead stage transitions
- [ ] Build visual Kanban pipeline interface & list filtering
- [ ] Implement manual notes, call logs, and contact editing
- [ ] Build task assignment and timeline activity logging

### Phase 5 — Cold Email Engine & Follow-Up Module
- [ ] Implement Email Provider Abstraction & sending queue
- [ ] Build AI Personalization Engine for subject & body generation
- [ ] Implement pre-send Safety Gates (Suppression check, Daily caps, Kill switch)
- [ ] Implement Follow-Up Sequence Orchestrator & delay timer logic
- [ ] Build Inbound Reply Webhook listener & AI Reply Classifier
- [ ] Implement automatic opt-out processing & sequence halting

### Phase 6 — Analytics & Dashboard Module
- [ ] Build Analytics Aggregation Queries for campaign performance
- [ ] Implement acquisition metric cards (Leads found, Qualification %, Reply %, Won deals)
- [ ] Build conversion funnel chart & CSV report exporter
- [ ] Develop System Settings & server key management UI

### Phase 7 — End-to-End MVP Validation
- [ ] Execute 50-lead daily campaign end-to-end test
- [ ] Validate deduplication, qualification, email dispatch & reply classification
- [ ] Perform security review, prompt injection testing & rate limit validation
- [ ] Deploy MVP staging instance on free-tier infrastructure
- [ ] Freeze MVP release build

---

## 3. Future Post-MVP Expansion Backlog

The following capabilities are explicitly deferred to post-MVP development phases:
- Official WhatsApp Business Cloud API integration (compliant APIs)
- AI Reply Assistant (automated reply drafting for human review)
- Proposal & Agreement PDF generation
- Smart Calendar integration & automated meeting scheduling
- Multi-user teams with fine-grained RBAC permissions
- Customer billing & subscription management
- Omnichannel social messaging inbox
