-- AlterTable
ALTER TABLE "voice_agent_configs" ADD COLUMN     "agentPersona" TEXT,
ADD COLUMN     "assignedPhoneNumberId" TEXT,
ADD COLUMN     "inboundEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "knowledgePoints" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "maxTokens" INTEGER,
ADD COLUMN     "modelId" TEXT,
ADD COLUMN     "objectionRules" JSONB,
ADD COLUMN     "outboundEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'mock',
ADD COLUMN     "safetyGuardrails" JSONB,
ADD COLUMN     "speakingStyle" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "structuredQuestions" JSONB,
ADD COLUMN     "temperature" DOUBLE PRECISION,
ADD COLUMN     "voiceId" TEXT,
ADD COLUMN     "voicePitch" DOUBLE PRECISION,
ADD COLUMN     "voiceProvider" TEXT,
ADD COLUMN     "voiceSpeed" DOUBLE PRECISION,
ADD COLUMN     "voiceStability" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "calls" ADD COLUMN     "recordingChannels" INTEGER,
ADD COLUMN     "recordingDuration" INTEGER,
ADD COLUMN     "recordingUrl" TEXT;

-- CreateTable
CREATE TABLE "workspace_provider_credentials" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedPayload" JSONB NOT NULL,
    "maskedDisplay" JSONB NOT NULL,
    "connectionStatus" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
    "accountDetails" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_provider_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telephony_phone_numbers" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "friendlyName" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'twilio',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "capabilities" JSONB NOT NULL,
    "assignedAgentId" TEXT,
    "inboundWebhookUrl" TEXT,
    "outboundCallerIdEnabled" BOOLEAN NOT NULL DEFAULT true,
    "purchasedWithoutAutoBuy" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telephony_phone_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_provider_credentials_workspaceId_idx" ON "workspace_provider_credentials"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_provider_credentials_workspaceId_provider_key" ON "workspace_provider_credentials"("workspaceId", "provider");

-- CreateIndex
CREATE INDEX "telephony_phone_numbers_workspaceId_idx" ON "telephony_phone_numbers"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "telephony_phone_numbers_workspaceId_phoneNumber_key" ON "telephony_phone_numbers"("workspaceId", "phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expiresAt_idx" ON "password_reset_tokens"("expiresAt");

-- AddForeignKey
ALTER TABLE "workspace_provider_credentials" ADD CONSTRAINT "workspace_provider_credentials_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telephony_phone_numbers" ADD CONSTRAINT "telephony_phone_numbers_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
