-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('QUEUED', 'SAFETY_CHECKING', 'APPROVAL_REQUIRED', 'APPROVED', 'INITIATING', 'RINGING', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED', 'FAILED', 'CANCELLED', 'NO_ANSWER', 'BUSY', 'VOICEMAIL', 'OPTED_OUT');

-- CreateEnum
CREATE TYPE "CallOutcomeType" AS ENUM ('INTERESTED', 'NOT_INTERESTED', 'CALLBACK_REQUESTED', 'MEETING_REQUESTED', 'QUALIFIED', 'DISQUALIFIED', 'NO_ANSWER', 'BUSY', 'VOICEMAIL', 'INVALID_NUMBER', 'OPTED_OUT', 'DO_NOT_CALL', 'FAILED');

-- CreateEnum
CREATE TYPE "CallEventType" AS ENUM ('CALL_CREATED', 'CALL_INITIATED', 'CALL_RINGING', 'CALL_ANSWERED', 'CALL_STARTED', 'CALL_MEDIA_CONNECTED', 'CALL_TRANSFERRED', 'CALL_COMPLETED', 'CALL_FAILED', 'CALL_BUSY', 'CALL_NO_ANSWER', 'CALL_VOICEMAIL', 'CALL_CANCELLED', 'CALL_OPT_OUT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LeadStatus" ADD VALUE 'DISCOVERED';
ALTER TYPE "LeadStatus" ADD VALUE 'IMPORTED';
ALTER TYPE "LeadStatus" ADD VALUE 'RESEARCH_PENDING';
ALTER TYPE "LeadStatus" ADD VALUE 'RESEARCHED';
ALTER TYPE "LeadStatus" ADD VALUE 'QUALIFICATION_PENDING';
ALTER TYPE "LeadStatus" ADD VALUE 'CALL_READY';
ALTER TYPE "LeadStatus" ADD VALUE 'INTERESTED';
ALTER TYPE "LeadStatus" ADD VALUE 'MEETING';
ALTER TYPE "LeadStatus" ADD VALUE 'WON';
ALTER TYPE "LeadStatus" ADD VALUE 'LOST';

-- AlterEnum
ALTER TYPE "SuppressionType" ADD VALUE 'PHONE';

-- DropForeignKey
ALTER TABLE "leads" DROP CONSTRAINT "leads_campaignId_fkey";

-- AlterTable
ALTER TABLE "leads" ALTER COLUMN "campaignId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "voice_campaigns" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "dailyCallCap" INTEGER NOT NULL DEFAULT 25,
    "maxAttemptsPerLead" INTEGER NOT NULL DEFAULT 3,
    "retryDelayMinutes" INTEGER NOT NULL DEFAULT 120,
    "allowedCallingDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "callingWindowStart" TEXT NOT NULL DEFAULT '09:00',
    "callingWindowEnd" TEXT NOT NULL DEFAULT '17:00',
    "recordingConsent" BOOLEAN NOT NULL DEFAULT false,
    "agentConfigId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_agent_configs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "callObjective" TEXT NOT NULL,
    "openingScript" TEXT NOT NULL,
    "qualificationQuestions" TEXT[],
    "approvedTalkingPoints" TEXT[],
    "objectionHandling" JSONB,
    "prohibitedClaims" TEXT[],
    "escalationConditions" TEXT[],
    "fallbackBehavior" TEXT,
    "maxDurationSeconds" INTEGER NOT NULL DEFAULT 300,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_agent_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calls" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "campaignId" TEXT,
    "voiceCampaignId" TEXT,
    "leadId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "agentConfigId" TEXT,
    "recipientPhone" TEXT NOT NULL,
    "normalizedPhone" TEXT NOT NULL,
    "status" "CallStatus" NOT NULL DEFAULT 'QUEUED',
    "humanApprovalRequired" BOOLEAN NOT NULL DEFAULT true,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "initiatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "providerName" TEXT NOT NULL DEFAULT 'twilio',
    "providerCallId" TEXT,
    "blockedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_attempts" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "providerCallId" TEXT,
    "status" "CallStatus" NOT NULL,
    "durationSeconds" INTEGER,
    "failureReason" TEXT,
    "isRetryable" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "call_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_events" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "eventType" "CallEventType" NOT NULL,
    "eventPayload" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_transcripts" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "turnIndex" INTEGER NOT NULL,
    "speaker" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "timestampMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_transcripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_outcomes" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "outcome" "CallOutcomeType" NOT NULL,
    "interestLevel" TEXT NOT NULL,
    "objections" TEXT[],
    "requestedFollowUp" TEXT,
    "nextAction" TEXT,
    "sentiment" TEXT,
    "optOutDetected" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT NOT NULL,
    "derivedFromActual" BOOLEAN NOT NULL DEFAULT true,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "n8n_integrations" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "apiKeyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "scopes" TEXT[],
    "webhookUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "n8n_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "n8n_webhook_deliveries" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "statusCode" INTEGER,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "n8n_webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_calling_policies" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "dailyCallLimit" INTEGER NOT NULL DEFAULT 25,
    "maxConcurrentCalls" INTEGER NOT NULL DEFAULT 1,
    "maxAttemptsPerLead" INTEGER NOT NULL DEFAULT 3,
    "retryDelayMinutes" INTEGER NOT NULL DEFAULT 120,
    "allowedCallingDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "callingWindowStart" TEXT NOT NULL DEFAULT '09:00',
    "callingWindowEnd" TEXT NOT NULL DEFAULT '17:00',
    "recordingConsent" BOOLEAN NOT NULL DEFAULT false,
    "humanApprovalRequired" BOOLEAN NOT NULL DEFAULT true,
    "providerRestrictions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_calling_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "voice_campaigns_campaignId_key" ON "voice_campaigns"("campaignId");

-- CreateIndex
CREATE INDEX "voice_agent_configs_workspaceId_idx" ON "voice_agent_configs"("workspaceId");

-- CreateIndex
CREATE INDEX "calls_workspaceId_idx" ON "calls"("workspaceId");

-- CreateIndex
CREATE INDEX "calls_campaignId_idx" ON "calls"("campaignId");

-- CreateIndex
CREATE INDEX "calls_leadId_idx" ON "calls"("leadId");

-- CreateIndex
CREATE INDEX "calls_contactId_idx" ON "calls"("contactId");

-- CreateIndex
CREATE INDEX "calls_status_idx" ON "calls"("status");

-- CreateIndex
CREATE INDEX "calls_normalizedPhone_idx" ON "calls"("normalizedPhone");

-- CreateIndex
CREATE UNIQUE INDEX "calls_workspaceId_idempotencyKey_key" ON "calls"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "call_attempts_callId_idx" ON "call_attempts"("callId");

-- CreateIndex
CREATE INDEX "call_events_callId_idx" ON "call_events"("callId");

-- CreateIndex
CREATE INDEX "call_events_eventType_idx" ON "call_events"("eventType");

-- CreateIndex
CREATE INDEX "call_transcripts_callId_idx" ON "call_transcripts"("callId");

-- CreateIndex
CREATE UNIQUE INDEX "call_outcomes_callId_key" ON "call_outcomes"("callId");

-- CreateIndex
CREATE INDEX "n8n_integrations_workspaceId_idx" ON "n8n_integrations"("workspaceId");

-- CreateIndex
CREATE INDEX "n8n_integrations_keyPrefix_idx" ON "n8n_integrations"("keyPrefix");

-- CreateIndex
CREATE INDEX "n8n_webhook_deliveries_workspaceId_idx" ON "n8n_webhook_deliveries"("workspaceId");

-- CreateIndex
CREATE INDEX "n8n_webhook_deliveries_integrationId_idx" ON "n8n_webhook_deliveries"("integrationId");

-- CreateIndex
CREATE INDEX "n8n_webhook_deliveries_eventId_idx" ON "n8n_webhook_deliveries"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_calling_policies_workspaceId_key" ON "workspace_calling_policies"("workspaceId");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_campaigns" ADD CONSTRAINT "voice_campaigns_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_campaigns" ADD CONSTRAINT "voice_campaigns_agentConfigId_fkey" FOREIGN KEY ("agentConfigId") REFERENCES "voice_agent_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_agent_configs" ADD CONSTRAINT "voice_agent_configs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_voiceCampaignId_fkey" FOREIGN KEY ("voiceCampaignId") REFERENCES "voice_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_agentConfigId_fkey" FOREIGN KEY ("agentConfigId") REFERENCES "voice_agent_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_attempts" ADD CONSTRAINT "call_attempts_callId_fkey" FOREIGN KEY ("callId") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_events" ADD CONSTRAINT "call_events_callId_fkey" FOREIGN KEY ("callId") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_transcripts" ADD CONSTRAINT "call_transcripts_callId_fkey" FOREIGN KEY ("callId") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_outcomes" ADD CONSTRAINT "call_outcomes_callId_fkey" FOREIGN KEY ("callId") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "n8n_integrations" ADD CONSTRAINT "n8n_integrations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "n8n_webhook_deliveries" ADD CONSTRAINT "n8n_webhook_deliveries_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "n8n_webhook_deliveries" ADD CONSTRAINT "n8n_webhook_deliveries_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "n8n_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_calling_policies" ADD CONSTRAINT "workspace_calling_policies_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
