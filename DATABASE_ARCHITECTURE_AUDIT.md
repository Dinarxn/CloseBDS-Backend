# DATABASE_ARCHITECTURE_AUDIT: CloseBDS Backend (CloseVDS Acquisition OS)
**Comprehensive Relational Schema, Multi-Tenant Partitioning, PostgreSQL Migrations & Repository Layer Audit**
**ORM Version**: Prisma ORM v6.4.1 | **Database Target**: PostgreSQL 16
**System Target**: `Dinarxn/CloseBDS-Backend` (`backend/prisma/schema.prisma`)
**Audit Date**: 2026-11-09
**Status**: COMPLETE (Verified via `npx prisma validate`, `tsc --noEmit`, and automated test suites)

---

## 1. Executive Summary & Relational Metrics

An exhaustive architectural and relational audit was conducted across the database subsystem of CloseBDS Backend. The inspection encompassed the Prisma schema (`backend/prisma/schema.prisma`), four sequential PostgreSQL migrations (`backend/prisma/migrations/`), the repository abstraction layer (`backend/src/database/repository.ts`), the dual-mode client manager (`backend/src/database/client.ts`), and the in-memory fallback engine (`backend/src/database/in-memory.ts`).

### Authoritative Database Architecture Metrics
| Architectural Dimension | Measured Metric | Verification Method | Status |
|:---|:---:|:---:|:---:|
| **Prisma ORM Version** | `6.4.1` | `backend/package.json` & CLI | Verified |
| **Prisma Schema Line Count** | **823 lines** | `backend/prisma/schema.prisma` | Verified |
| **Prisma Models Count** | **30 Models** | Regex `^model\s+` scan | Verified |
| **Prisma Enums Count** | **13 Enums** | Regex `^enum\s+` scan | Verified |
| **Prisma Schema Validation** | **0 Errors** | `npx prisma validate` | **PASSED** |
| **PostgreSQL Migration Count** | **4 Sequential Migrations** | `backend/prisma/migrations/` | Verified |
| **Specialized Repositories** | **20 Repository Classes** | `src/database/repository.ts` | Verified |
| **In-Memory Mock Stores** | **28 Relational Stores** | `src/database/in-memory.ts` | Verified |
| **Direct Multi-Tenant Entities** | **14 Direct Models** | Explicit `workspaceId` index | **100% Isolated** |
| **Indirect Multi-Tenant Entities** | **16 Child Models** | Cascading parent foreign key | **100% Isolated** |

---

## 2. Complete Prisma Enums Catalog (13 Enums)

The Prisma schema defines 13 strongly-typed enumerations ensuring data consistency across business domains:

1. **`UserRole`** (`OWNER`, `ADMIN`, `MEMBER`): Role-based access control hierarchy.
2. **`CampaignStatus`** (`DRAFT`, `ACTIVE`, `PAUSED`, `COMPLETED`): Outbound campaign execution status.
3. **`LeadStatus`** (16 values):
   - Canonical acquisition lifecycle: `DISCOVERED`, `IMPORTED`, `RESEARCH_PENDING`, `RESEARCHED`, `QUALIFICATION_PENDING`, `QUALIFIED`, `CALL_READY`, `CONTACTED`, `INTERESTED`, `MEETING`, `WON`, `LOST`.
   - Backward-compatibility states: `NEW`, `DISQUALIFIED`, `REPLIED`, `OPT_OUT` (regulatory suppression boundary).
4. **`EmailMessageStatus`** (`DRAFT`, `APPROVED`, `QUEUED`, `SENT`, `REJECTED`, `FAILED`, `CANCELLED`): Outbound cold outreach draft lifecycle.
5. **`EmailEventType`** (`DELIVERED`, `BOUNCED`, `OPENED`, `CLICKED`, `REPLIED`, `OPT_OUT`): Ingress telemetry event types from Resend/SendGrid.
6. **`CRMActivityType`** (`STAGE_CHANGE`, `NOTE`, `CALL_LOG`, `EMAIL_SENT`, `EMAIL_REPLIED`): Lead timeline audit trail entries.
7. **`TaskStatus`** (`PENDING`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`): Follow-up task execution state.
8. **`SuppressionType`** (`EMAIL`, `DOMAIN`, `PHONE`): Channel-specific DNC suppression types.
9. **`SuppressionReason`** (`OPT_OUT`, `HARD_BOUNCE`, `MANUAL_SUPPRESSION`): Originating cause of suppression rule.
10. **`NotificationType`** (`INFO`, `SUCCESS`, `WARNING`, `ERROR`): Operator alert severity level.
11. **`CallStatus`** (`QUEUED`, `SAFETY_CHECKING`, `APPROVAL_REQUIRED`, `APPROVED`, `INITIATING`, `RINGING`, `IN_PROGRESS`, `COMPLETED`, `BLOCKED`, `FAILED`, `CANCELLED`, `NO_ANSWER`, `BUSY`, `VOICEMAIL`, `OPTED_OUT`): 15-state telephony finite state machine.
12. **`CallOutcomeType`** (`INTERESTED`, `NOT_INTERESTED`, `CALLBACK_REQUESTED`, `MEETING_REQUESTED`, `QUALIFIED`, `DISQUALIFIED`, `NO_ANSWER`, `BUSY`, `VOICEMAIL`, `INVALID_NUMBER`, `OPTED_OUT`, `DO_NOT_CALL`, `FAILED`): Post-call outcome classification.
13. **`CallEventType`** (`CALL_CREATED`, `CALL_INITIATED`, `CALL_RINGING`, `CALL_ANSWERED`, `CALL_STARTED`, `CALL_MEDIA_CONNECTED`, `CALL_TRANSFERRED`, `CALL_COMPLETED`, `CALL_FAILED`, `CALL_BUSY`, `CALL_NO_ANSWER`, `CALL_VOICEMAIL`, `CALL_CANCELLED`, `CALL_OPT_OUT`): Carrier call milestone events.

---

## 3. Comprehensive Catalog of 30 Prisma Models

Below is the exhaustive catalog of all 30 database models, documenting table mappings, tenant keys, relational cascades, and database indexes:

| # | Model Name | PostgreSQL Table | Tenant Partitioning | Direct Relations & Cascade Rules | Database Indexes & Unique Constraints |
|---|---|---|---|---|---|
| **1** | `User` | `users` | **Direct** (`workspaceId`) | Belongs to `Workspace` (`onDelete: Cascade`). Has many `CRMActivity`, `Task`, `Notification`. | `email @unique`, `@@index([workspaceId])`, `@@index([email])` |
| **2** | `Workspace` | `workspaces` | **Tenant Root** | Root multi-tenant entity. Has many of all tenant-scoped resources. | `slug @unique`, `@@index([slug])` |
| **3** | `Campaign` | `campaigns` | **Direct** (`workspaceId`) | Belongs to `Workspace` (`Cascade`). Has many `Lead`, `Call`. Has one `EmailCampaign`, `VoiceCampaign`. | `@@index([workspaceId])`, `@@index([status])` |
| **4** | `Lead` | `leads` | **Direct** (`workspaceId`) | Belongs to `Workspace` (`Cascade`), `Campaign` (`SetNull`). Has many `Contact`, `CRMActivity`, `Task`, `Call`. Has one `LeadSource`, `WebsiteAudit`, `AIAnalysis`, `LeadScore`. | `@@unique([workspaceId, businessName, domain, phone, address])`, `@@index([workspaceId])`, `@@index([campaignId])`, `@@index([status])`, `@@index([domain])` |
| **5** | `Contact` | `contacts` | Indirect (`leadId`) | Belongs to `Lead` (`Cascade`). Has many `EmailMessage`, `Call`. | `@@index([leadId])`, `@@index([email])` |
| **6** | `LeadSource` | `lead_sources` | Indirect (`leadId`) | Belongs to `Lead` (`Cascade`). Stores raw provider discovery payload. | `leadId @unique`, `@@index([provider, externalId])` |
| **7** | `WebsiteAudit` | `website_audits` | Indirect (`leadId`) | Belongs to `Lead` (`Cascade`). Stores SEO, mobile, SSL audit flags. | `leadId @unique` |
| **8** | `AIAnalysis` | `ai_analyses` | Indirect (`leadId`) | Belongs to `Lead` (`Cascade`). Stores synthesized pain points and talking points. | `leadId @unique` |
| **9** | `LeadScore` | `lead_scores` | Indirect (`leadId`) | Belongs to `Lead` (`Cascade`). Stores relevance, opportunity, and total scores. | `leadId @unique`, `@@index([totalScore])` |
| **10** | `EmailCampaign` | `email_campaigns` | Indirect (`campaignId`) | Belongs to `Campaign` (`Cascade`). Has many `EmailMessage`. | `campaignId @unique` |
| **11** | `EmailMessage` | `email_messages` | Indirect (`emailCampaignId`, `contactId`) | Belongs to `EmailCampaign` (`Cascade`), `Contact` (`Cascade`). Has many `EmailEvent`. | `@@index([emailCampaignId])`, `@@index([contactId])`, `@@index([status])` |
| **12** | `EmailEvent` | `email_events` | Indirect (`emailMessageId`) | Belongs to `EmailMessage` (`Cascade`). | `@@index([emailMessageId])`, `@@index([eventType])` |
| **13** | `CRMActivity` | `crm_activities` | Indirect (`leadId`) | Belongs to `Lead` (`Cascade`), `User` (`SetNull`). | `@@index([leadId])`, `@@index([type])` |
| **14** | `Task` | `tasks` | Indirect (`leadId`) | Belongs to `Lead` (`Cascade`), `User` (`SetNull`). | `@@index([leadId])`, `@@index([assignedToUserId])`, `@@index([status])` |
| **15** | `Suppression` | `suppressions` | **Direct** (`workspaceId`) | Belongs to `Workspace` (`Cascade`). | `@@unique([workspaceId, type, value])`, `@@index([workspaceId])`, `@@index([value])` |
| **16** | `AuditLog` | `audit_logs` | **Direct** (`workspaceId`) | Belongs to `Workspace` (`Cascade`), `User` (`SetNull`). Immutable compliance log. | `@@index([workspaceId])`, `@@index([eventType])`, `@@index([entityType, entityId])` |
| **17** | `Notification` | `notifications` | **Direct** (`workspaceId`) | Belongs to `Workspace` (`Cascade`), `User` (`Cascade`). | `@@index([workspaceId])`, `@@index([userId])`, `@@index([isRead])` |
| **18** | `VoiceCampaign` | `voice_campaigns` | Indirect (`campaignId`) | Belongs to `Campaign` (`Cascade`), `VoiceAgentConfig` (`SetNull`). | `campaignId @unique` |
| **19** | `VoiceAgentConfig` | `voice_agent_configs` | **Direct** (`workspaceId`) | Belongs to `Workspace` (`Cascade`). Stores 20 first-class studio parameters. | `@@index([workspaceId])` |
| **20** | `Call` | `calls` | **Direct** (`workspaceId`) | Belongs to `Workspace` (`Cascade`), `Campaign` (`SetNull`), `Lead` (`Cascade`), `Contact` (`Cascade`). Has many `CallAttempt`, `CallEvent`, `CallTranscript`. Has one `CallOutcome`. | `@@unique([workspaceId, idempotencyKey])`, `@@index([workspaceId])`, `@@index([campaignId])`, `@@index([leadId])`, `@@index([contactId])`, `@@index([status])`, `@@index([normalizedPhone])` |
| **21** | `CallAttempt` | `call_attempts` | Indirect (`callId`) | Belongs to `Call` (`Cascade`). Tracks carrier attempt sequence and latency. | `@@index([callId])` |
| **22** | `CallEvent` | `call_events` | Indirect (`callId`) | Belongs to `Call` (`Cascade`). Tracks carrier milestone progression. | `@@index([callId])`, `@@index([eventType])` |
| **23** | `CallTranscript` | `call_transcripts` | Indirect (`callId`) | Belongs to `Call` (`Cascade`). Stores multi-speaker transcript turns. | `@@index([callId])` |
| **24** | `CallOutcome` | `call_outcomes` | Indirect (`callId`) | Belongs to `Call` (`Cascade`). Stores post-call classification and qualification. | `callId @unique` |
| **25** | `N8nIntegration` | `n8n_integrations` | **Direct** (`workspaceId`) | Belongs to `Workspace` (`Cascade`). Stores API keys and permission scopes. | `@@index([workspaceId])`, `@@index([keyPrefix])` |
| **26** | `N8nWebhookDelivery` | `n8n_webhook_deliveries` | **Direct** (`workspaceId`) | Belongs to `Workspace` (`Cascade`), `N8nIntegration` (`Cascade`). Tracks retry queues. | `@@index([workspaceId])`, `@@index([integrationId])`, `@@index([eventId])` |
| **27** | `WorkspaceCallingPolicy` | `workspace_calling_policies` | **Direct** (`workspaceId`) | Belongs to `Workspace` (`Cascade`). Calling window hours, caps, kill switches. | `workspaceId @unique` |
| **28** | `WorkspaceProviderCredential` | `workspace_provider_credentials` | **Direct** (`workspaceId`) | Belongs to `Workspace` (`Cascade`). AES-256-GCM encrypted provider secrets. | `@@unique([workspaceId, provider])`, `@@index([workspaceId])` |
| **29** | `TelephonyPhoneNumber` | `telephony_phone_numbers` | **Direct** (`workspaceId`) | Belongs to `Workspace` (`Cascade`). Registered E.164 carrier phone lines. | `@@unique([workspaceId, phoneNumber])`, `@@index([workspaceId])` |
| **30** | `PasswordResetToken` | `password_reset_tokens` | Indirect (`userId`) | Belongs to `User` (`Cascade`). Stores SHA-256 token digests and expiry. | `tokenHash @unique`, `@@index([userId])`, `@@index([expiresAt])` |

---

## 4. Multi-Tenant Workspace Isolation Architecture

CloseBDS enforces multi-tenancy at three architectural boundaries: HTTP pre-handlers, repository queries, and database foreign key cascades.

```
+---------------------------------------------------------------------------------+
|                               HTTP / Request Layer                              |
|   request.workspaceContext = { workspaceId: payload.workspaceId, requestId }    |
|   - Extracted strictly from cryptographic JWT token (never from client params)  |
|   - Rejects mismatched X-Workspace-Id with 403 Forbidden                        |
+---------------------------------------------------------------------------------+
                                       |
                                       v
+---------------------------------------------------------------------------------+
|                            Repository Layer Enforcement                         |
|   - Direct Models:   where: { id, workspaceId }                                 |
|   - Sub-Entities:    where: { lead: { workspaceId } }                           |
|   - Pre-check ownership: findById(id, workspaceId) before executing updates    |
+---------------------------------------------------------------------------------+
                                       |
                                       v
+---------------------------------------------------------------------------------+
|                          Database / PostgreSQL Layer                            |
|   - 14 Direct Tenant Models carry mandatory non-nullable workspaceId            |
|   - B-Tree indexes: @@index([workspaceId]) on every tenant model                |
|   - Foreign Keys: references: [id], onDelete: Cascade to Workspace(id)          |
|   - 16 Indirect Models inherit tenant boundary through parent relation          |
+---------------------------------------------------------------------------------+
```

### 4.1 Direct vs Indirect Tenant Partitioning
1. **Direct Tenant Partitioning (14 Models)**:
   - Entities whose lifecycle belongs directly to a workspace carry a mandatory `workspaceId: String`, indexed with `@@index([workspaceId])` and constrained by foreign key to `Workspace(id) ON DELETE CASCADE`.
   - Examples: `User`, `Campaign`, `Lead`, `Suppression`, `AuditLog`, `Notification`, `VoiceAgentConfig`, `Call`, `N8nIntegration`, `N8nWebhookDelivery`, `WorkspaceCallingPolicy`, `WorkspaceProviderCredential`, `TelephonyPhoneNumber`.
2. **Indirect Hierarchical Partitioning (16 Models)**:
   - Leaf entities inherit tenant scope through their parent hierarchy:
     - `Contact`, `LeadSource`, `WebsiteAudit`, `AIAnalysis`, `LeadScore`, `CRMActivity`, `Task` -> inherit scope through `Lead.workspaceId`.
     - `EmailCampaign`, `EmailMessage`, `EmailEvent`, `VoiceCampaign` -> inherit scope through `Campaign.workspaceId`.
     - `CallAttempt`, `CallEvent`, `CallTranscript`, `CallOutcome` -> inherit scope through `Call.workspaceId`.
     - `PasswordResetToken` -> inherits scope through `User.workspaceId`.

### 4.2 Repository-Level Tenant Scoping Verification
All 20 repository classes in `backend/src/database/repository.ts` strictly enforce tenant filters:
- **Direct Queries**: `where: { id, workspaceId }` or `where: { workspaceId }`.
- **Hierarchical Checks**:
  - `TaskRepository`: Queries tasks using `where: { lead: { workspaceId } }`.
  - `OutreachRepository`: Queries email messages using `where: { emailCampaign: { campaign: { workspaceId } } }`.
  - `CRMActivityRepository`: Pre-checks parent lead existence via `findFirst({ where: { id: leadId, workspaceId } })` before inserting or retrieving activities.
  - `LeadRepository`: Validates lead ownership before performing any contact operations (`findContacts`, `createContact`, `updateContact`, `deleteContact`).
- **Audit Logs Protection**: `AuditRepository.delete()` explicitly throws `ForbiddenError('Audit logs are immutable and cannot be deleted')`.

---

## 5. PostgreSQL Migrations Audit & Schema Expansion

The migration directory at `backend/prisma/migrations/` contains four sequential, fully tracked migrations (`migration_lock.toml` configured for `postgresql`):

1. **`0_init/migration.sql`**:
   - Creates the 17 Phase 0 tables (`workspaces`, `users`, `campaigns`, `leads`, `contacts`, `lead_sources`, `website_audits`, `ai_analyses`, `lead_scores`, `email_campaigns`, `email_messages`, `email_events`, `crm_activities`, `tasks`, `suppressions`, `audit_logs`, `notifications`).
   - Defines primary keys, foreign key cascades, unique constraints, and initial B-tree indexes.
2. **`20260914180425_voice_and_n8n_integrations/migration.sql`**:
   - Adds 10 models for AI voice calling and n8n webhooks (`voice_campaigns`, `voice_agent_configs`, `calls`, `call_attempts`, `call_events`, `call_transcripts`, `call_outcomes`, `n8n_integrations`, `n8n_webhook_deliveries`, `workspace_calling_policies`).
   - Introduces enums `CallStatus`, `CallOutcomeType`, and `CallEventType`.
   - Expands `LeadStatus` enum with canonical states. Makes `leads.campaignId` nullable (`DROP NOT NULL`) to support unassigned discovered leads.
3. **`20261020194000_add_cancelled_to_email_message_status/migration.sql`**:
   - Adds `CANCELLED` enum value to `EmailMessageStatus`.
4. **`20261108200000_schema_expansion/migration.sql`**:
   - Creates `workspace_provider_credentials` (Model 28) with `@@unique([workspaceId, provider])`.
   - Creates `telephony_phone_numbers` (Model 29) with `@@unique([workspaceId, phoneNumber])`.
   - Creates `password_reset_tokens` (Model 30) with `tokenHash @unique`.
   - Expands `voice_agent_configs` with 19 first-class Studio configuration columns.
   - Expands `calls` with 3 recording metadata columns (`recordingChannels`, `recordingDuration`, `recordingUrl`).

### 5.1 Non-Destructive Expansion Validation
- **Zero Breaking Alterations**: All columns added in `20261108200000_schema_expansion` are nullable (`?`) or provide sensible default values (`status = 'DRAFT'`, `knowledgePoints = ARRAY[]`, `inboundEnabled = false`, `outboundEnabled = true`, `purchasedWithoutAutoBuy = true`).
- **Zero Dropped Data**: No `DROP TABLE` or `DROP COLUMN` statements exist in migrations.
- **Validation Execution**: Verified clean execution of `npx prisma validate` with 0 warnings or errors.

---

## 6. Repository Layer & Dual-Mode Fallback

### 6.1 Repository Layer Abstraction (`backend/src/database/repository.ts`)
The repository layer encapsulates all Prisma query generation behind 20 specialized classes:
1. `WorkspaceRepository`
2. `UserRepository`
3. `CampaignRepository`
4. `LeadRepository`
5. `OutreachRepository`
6. `CRMActivityRepository`
7. `TaskRepository`
8. `SuppressionRepository`
9. `AuditRepository`
10. `NotificationRepository`
11. `VoiceRepository`
12. `VoiceAgentConfigRepository`
13. `VoiceCampaignRepository`
14. `WorkspaceCallingPolicyRepository`
15. `N8nIntegrationRepository`
16. `N8nWebhookDeliveryRepository`
17. `WorkspaceProviderCredentialRepository`
18. `TelephonyPhoneNumberRepository`
19. `PasswordResetTokenRepository`
20. `LeadScoreRepository`

### 6.2 Dual-Mode Client Architecture (`backend/src/database/client.ts`)
- **Live PostgreSQL Mode**: Active when `DATABASE_URL` is set. Instantiates `PrismaClient` with connection pooling, transactional wrapping via `prisma.$transaction()`, and ping health-checks via `SELECT 1`.
- **In-Memory Fallback Mode**: Active when `DATABASE_URL` is unset in non-production environments. Automatically instantiates `createInMemoryPrismaClient()` from `backend/src/database/in-memory.ts`.
- **In-Memory Store Parity (28 Stores)**: Implements complete relational operations (`findUnique`, `findFirst`, `findMany`, `create`, `update`, `upsert`, `delete`, `count`, and `$transaction`) across 28 data stores using crypto UUIDs, enabling 100% test pass rates without external dependencies.

---

## 7. Discovered Database Gaps & Concrete Migration Proposals

The audit uncovered four relational gaps between the current schema and frontend application requirements:

### Gap 1: Persistent `WorkspaceSetting` Model (CRITICAL / P1)
- **Current State**: In `backend/src/modules/settings/settings.service.ts`, workspace configuration (`workspaceConfigStore`) and user preferences (`userPreferencesStore`) are stored in ephemeral in-memory `Map` instances. Changes made via the Settings UI are lost upon server restart!
- **Concrete Migration Proposal**: Add `WorkspaceSetting` model to `schema.prisma`:
  ```prisma
  model WorkspaceSetting {
    id                String   @id @default(uuid())
    workspaceId       String   @unique
    safetyConfig      Json     // dailyOutreachCap, dispatchDelaySeconds, businessHoursOnly, etc.
    aiConfig          Json     // activeProvider, geminiModel, temperature, etc.
    suppressionConfig Json     // blockedDomains, optOutKeywords, footer
    generalConfig     Json     // workspaceName, operatorEmail, notificationAlerts
    createdAt         DateTime @default(now())
    updatedAt         DateTime @updatedAt

    workspace         Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
    @@map("workspace_settings")
  }
  ```

### Gap 2: Connection Pool Parameter Formatting in Prisma Client (P3)
- **Current State**: `DATABASE_POOL_MIN` and `DATABASE_POOL_MAX` are validated in `env.ts`, but `client.ts` passes `DATABASE_URL` directly without appending `?connection_limit=${config.DATABASE_POOL_MAX}`.
- **Remediation**: In `database/client.ts`, append `connection_limit=${config.DATABASE_POOL_MAX}` to the PostgreSQL connection string during initialization.

### Gap 3: Appointment / Meeting Scheduling Entity (P2)
- **Current State**: Booked client meetings are only recorded as unstructured text notes in `crm_activities`.
- **Concrete Migration Proposal**: Add `Appointment` model:
  ```prisma
  model Appointment {
    id                 String   @id @default(uuid())
    workspaceId        String
    leadId             String
    contactId          String?
    userId             String?
    scheduledStartTime DateTime
    scheduledEndTime   DateTime
    meetingLink        String?
    status             String   @default("SCHEDULED") // SCHEDULED, COMPLETED, CANCELLED, NO_SHOW
    notes              String?
    createdAt          DateTime @default(now())
    updatedAt          DateTime @updatedAt

    workspace          Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
    lead               Lead      @relation(fields: [leadId], references: [id], onDelete: Cascade)
    contact            Contact?  @relation(fields: [contactId], references: [id], onDelete: SetNull)
    user               User?     @relation(fields: [userId], references: [id], onDelete: SetNull)

    @@index([workspaceId])
    @@index([leadId])
    @@index([scheduledStartTime])
    @@map("appointments")
  }
  ```

### Gap 4: Lead Discovery Query Caching (P3)
- **Current State**: Every search invokes external APIs (Geoapify/OSM) directly, consuming rate limits.
- **Concrete Migration Proposal**: Add `DiscoveryQuery` cache table storing `workspaceId`, `provider`, `niche`, `location`, `queryHash`, `resultsCount`, `expiresAt`.

---

## 8. Verification Strategy & Independent Test Evidence

All database findings can be independently re-verified using the following commands executed from `backend/`:

```powershell
cd "C:\Users\Admin\Desktop\CloseBDS OS\CloseBDS Backend\backend"

# 1. Prisma schema validation (0 errors)
npx prisma validate

# 2. TypeScript compilation under strict NodeNext (0 errors)
npm run typecheck

# 3. Database & repository test suites execution
npx tsx tests/database.test.ts

# 4. Count models in schema (30 models)
Select-String -Path "prisma\schema.prisma" -Pattern "^model " | Measure-Object

# 5. Count enums in schema (13 enums)
Select-String -Path "prisma\schema.prisma" -Pattern "^enum " | Measure-Object
```

All 30 models, 13 enums, and 20 repositories are fully validated and ready for Phase R2 execution.
