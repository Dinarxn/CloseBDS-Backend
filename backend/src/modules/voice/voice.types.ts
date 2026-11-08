import type {
  CallStatus,
  VoiceCampaign,
  VoiceAgentConfig,
  Lead,
  Contact,
  Campaign,
} from '@prisma/client';
import type { CallWithRelations } from '../../database/repository.js';

export interface WorkspaceCallingPolicy {
  id: string;
  workspaceId: string;
  dailyCallLimit: number;
  maxConcurrentCalls: number;
  maxAttemptsPerLead: number;
  retryDelayMinutes: number;
  allowedCallingDays: number[];
  callingWindowStart: string;
  callingWindowEnd: string;
  recordingConsent: boolean;
  humanApprovalRequired: boolean;
  providerRestrictions: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type CanonicalLeadStatus =
  | 'DISCOVERED'
  | 'IMPORTED'
  | 'NEW'
  | 'RESEARCH_PENDING'
  | 'RESEARCHED'
  | 'QUALIFICATION_PENDING'
  | 'QUALIFIED'
  | 'CALL_READY'
  | 'CONTACTED'
  | 'REPLIED'
  | 'INTERESTED'
  | 'MEETING'
  | 'WON'
  | 'LOST'
  | 'DISQUALIFIED'
  | 'OPT_OUT';

export interface VoiceSafetyCheckResult {
  passed: boolean;
  blockedReason?: string;
  evaluatedGates: Array<{
    gateNumber: number;
    gateName: string;
    passed: boolean;
    reason?: string;
  }>;
}

export interface VoiceSafetyContext {
  workspaceId: string;
  leadId: string;
  contactId: string;
  recipientPhone: string;
  normalizedPhone: string;
  callingPolicy: WorkspaceCallingPolicy;
  lead: Lead;
  contact: Contact;
  agentConfig?: VoiceAgentConfig | null;
  currentCall?: CallWithRelations | null;
  currentTime?: Date;
  activeCallsCount?: number;
  campaignId?: string | null;
  campaign?: Campaign | null;
  voiceCampaign?: VoiceCampaign | null;
  recipientTimezone?: string;
}

export interface CallPreparationResult {
  callId: string;
  status: CallStatus;
  safetyCheck: VoiceSafetyCheckResult;
  normalizedPhone: string;
  groundedContext: Record<string, unknown>;
  requiresApproval: boolean;
  lead?: {
    id: string;
    businessName: string;
    domain?: string | null;
  };
  contact?: {
    id: string;
    fullName: string;
    title?: string | null;
    phone?: string | null;
  };
  agentConfig?: {
    id: string;
    name: string;
    callObjective?: string;
  } | null;
}

export type CallMilestoneStep =
  | 'PREPARED'
  | 'APPROVED'
  | 'QUEUED'
  | 'INITIATING'
  | 'RINGING'
  | 'CONNECTED'
  | 'TRANSCRIBING'
  | 'ENDED';

export interface CallTimelineMilestone {
  step: CallMilestoneStep;
  label: string;
  status: 'COMPLETED' | 'ACTIVE' | 'PENDING' | 'FAILED' | 'SKIPPED';
  timestamp?: Date | string | null;
  durationSeconds?: number;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface CallDispatchResult {
  callId: string;
  status: CallStatus;
  providerCallId?: string;
  startedAt?: Date;
  blockedReason?: string;
  idempotencyToken?: string;
}

export interface CallTurnInput {
  turnIndex: number;
  speaker: 'agent' | 'lead' | 'system';
  text: string;
  confidence?: number;
  timestampMs?: number;
  sentiment?: 'positive' | 'neutral' | 'skeptical' | 'negative';
  latencyMs?: number;
}

// ==============================================================================
// SHARED INTEGRATION CONTRACTS & MULTI-PROVIDER ARCHITECTURE (R1)
// ==============================================================================

/**
 * Strict normalized call status shared across all telephony and voice AI providers.
 */
export type NormalizedCallStatus =
  | 'queued'
  | 'initiated'
  | 'ringing'
  | 'in-progress'
  | 'completed'
  | 'failed'
  | 'busy'
  | 'no-answer'
  | 'canceled';

/**
 * Bidirectional mapping between Prisma CallStatus and NormalizedCallStatus.
 */
export function normalizeCallStatus(status: CallStatus | string): NormalizedCallStatus {
  const s = String(status).toUpperCase();
  switch (s) {
    case 'QUEUED':
    case 'SAFETY_CHECKING':
    case 'APPROVAL_REQUIRED':
    case 'APPROVED':
      return 'queued';
    case 'INITIATING':
      return 'initiated';
    case 'RINGING':
      return 'ringing';
    case 'IN_PROGRESS':
      return 'in-progress';
    case 'COMPLETED':
      return 'completed';
    case 'FAILED':
    case 'BLOCKED':
      return 'failed';
    case 'BUSY':
      return 'busy';
    case 'NO_ANSWER':
    case 'VOICEMAIL':
      return 'no-answer';
    case 'CANCELLED':
    case 'OPTED_OUT':
      return 'canceled';
    default:
      return 'failed';
  }
}

export function toPrismaCallStatus(normalized: NormalizedCallStatus | string): CallStatus {
  const n = String(normalized).toLowerCase();
  switch (n) {
    case 'queued':
      return 'QUEUED';
    case 'initiated':
      return 'INITIATING';
    case 'ringing':
      return 'RINGING';
    case 'in-progress':
      return 'IN_PROGRESS';
    case 'completed':
      return 'COMPLETED';
    case 'failed':
      return 'FAILED';
    case 'busy':
      return 'BUSY';
    case 'no-answer':
      return 'NO_ANSWER';
    case 'canceled':
      return 'CANCELLED';
    default:
      return 'FAILED';
  }
}

/**
 * Granular capability flags exposed by any calling or voice provider adapter.
 */
export interface ProviderCapabilities {
  supportsInbound: boolean;
  supportsOutbound: boolean;
  supportsCustomVoices: boolean;
  supportsTransfer: boolean;
  supportsRecording: boolean;
  supportsTranscripts: boolean;
  supportsRealtimeTranscription: boolean;
  supportedCodecs: string[];
}

export type ProviderConnectionState =
  | 'NOT_CONFIGURED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'CONNECTION_FAILED'
  | 'DEGRADED'
  | 'DISCONNECTED';

export type ProviderVerificationState = 'UNVERIFIED' | 'VERIFIED' | 'TEST_MODE';

// ------------------------------------------------------------------------------
// TELEPHONY LAYER CONTRACTS (Twilio & Carrier Providers)
// ------------------------------------------------------------------------------

export type TelephonyProviderId = 'twilio' | 'mock-telephony';

export interface PhoneNumberCapabilities {
  voice: boolean;
  sms: boolean;
  mms: boolean;
  e164: boolean;
  tollFree: boolean;
}

export interface TelephonyPhoneNumber {
  id: string;
  workspaceId: string;
  phoneNumber: string; // E.164
  friendlyName: string;
  provider: TelephonyProviderId;
  capabilities: PhoneNumberCapabilities;
  status: 'ACTIVE' | 'INACTIVE' | 'PENDING_VERIFICATION' | 'RELEASED';
  assignedAgentId?: string | null;
  assignedAgentName?: string | null;
  inboundWebhookUrl?: string | null;
  outboundCallerIdEnabled: boolean;
  purchasedWithoutAutoBuy?: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface InboundRoutingConfig {
  phoneNumber: string;
  targetAgentId?: string;
  forwardToNumber?: string;
  webhookUrl?: string;
  recordingEnabled: boolean;
}

export interface OutboundRoutingConfig {
  callerId: string;
  maxDurationSeconds?: number;
  statusCallbackUrl?: string;
  recordingConsent: boolean;
}

export interface NormalizedTelephonyEvent {
  eventId: string;
  provider: TelephonyProviderId;
  providerCallId: string;
  eventType: string;
  normalizedStatus: NormalizedCallStatus;
  durationSeconds?: number;
  occurredAt: Date;
  rawPayload?: Record<string, unknown>;
}

export interface MaskedTwilioCredentials {
  accountSid: string;
  authTokenMasked: string;
  apiKeyMasked?: string;
  primaryPhoneNumber?: string;
  isConfigured: boolean;
  verificationStatus: ProviderVerificationState;
}

/**
 * Authoritative Telephony Provider Interface
 */
export interface TelephonyProvider {
  readonly providerId: TelephonyProviderId;
  readonly providerName: string;

  isConfigured(): boolean;
  getProviderCapabilities(): ProviderCapabilities;
  testConnection(credentials?: Record<string, unknown>): Promise<{
    connected: boolean;
    status: ProviderConnectionState;
    message: string;
    accountDetails?: Record<string, unknown>;
  }>;

  listPhoneNumbers(): Promise<TelephonyPhoneNumber[]>;
  importPhoneNumber(phoneNumber: string): Promise<TelephonyPhoneNumber>;
  validateCapabilities(phoneNumber: string): Promise<PhoneNumberCapabilities>;

  configureInboundRouting(config: InboundRoutingConfig): Promise<boolean>;
  configureOutboundRouting(config: OutboundRoutingConfig): Promise<boolean>;

  verifyWebhookSignature(
    rawPayload: string | Buffer,
    signatureHeader?: string,
    secret?: string,
    url?: string
  ): boolean;

  parseCallStatusEvent(rawPayload: unknown): NormalizedTelephonyEvent;
}

// ------------------------------------------------------------------------------
// VOICE AI LAYER CONTRACTS (Retell AI, Vapi & Mock Engine)
// ------------------------------------------------------------------------------

export type VoiceAIProviderId = 'retell' | 'vapi' | 'mock-voice-ai';

export interface VoiceAIModel {
  id: string;
  provider: VoiceAIProviderId;
  name: string;
  description?: string;
  contextWindow?: number;
  recommendedFor?: string;
}

export interface VoiceAIVoice {
  id: string;
  provider: VoiceAIProviderId;
  name: string;
  gender: 'male' | 'female' | 'neutral';
  accent?: string;
  sampleUrl?: string;
  supportedLanguages?: string[];
}

export interface VoiceAIAssistantConfig {
  assistantId?: string;
  provider: VoiceAIProviderId;
  name: string;
  model: string;
  voice: string;
  systemPrompt: string;
  firstMessage: string;
  temperature?: number;
  talkingPoints?: string[];
  objections?: Record<string, string>;
  qualificationQuestions?: string[];
}

export interface VoiceAIAssistantSyncResult {
  assistantId: string;
  provider: VoiceAIProviderId;
  syncedAt: Date;
  version?: string;
  status: 'SYNCED' | 'FAILED' | 'PENDING';
}

export interface VoiceAIDispatchPayload {
  callId: string;
  leadId: string;
  contactId: string;
  recipientPhone: string;
  assistantId: string;
  dynamicVariables?: Record<string, string>;
  recordingEnabled?: boolean;
}

export interface VoiceAICallDispatchResult {
  providerCallId: string;
  provider: VoiceAIProviderId;
  status: NormalizedCallStatus;
  startedAt: Date;
}

export interface NormalizedVoiceAIEvent {
  eventId: string;
  provider: VoiceAIProviderId;
  providerCallId: string;
  eventType: string;
  normalizedStatus: NormalizedCallStatus;
  transcriptTurns?: CallTurnInput[];
  recordingUrl?: string;
  durationSeconds?: number;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
}

export interface CallRecordingMetadata {
  callId: string;
  recordingUrl?: string;
  recordingSid?: string;
  durationSeconds?: number;
  channels?: number;
  status: 'PROCESSING' | 'AVAILABLE' | 'FAILED' | 'NOT_RECORDED';
  authorizedPlaybackUrl?: string;
}

export interface MaskedRetellCredentials {
  apiKeyMasked: string;
  isConfigured: boolean;
  verificationStatus: ProviderVerificationState;
}

export interface MaskedVapiCredentials {
  apiKeyMasked: string;
  orgIdMasked?: string;
  isConfigured: boolean;
  verificationStatus: ProviderVerificationState;
}

export interface ProviderIntegrationCard {
  providerId: string;
  name: string;
  category: 'TELEPHONY' | 'VOICE_AI';
  connectionState: ProviderConnectionState;
  verificationState: ProviderVerificationState;
  capabilities: ProviderCapabilities;
  maskedCredentials?: Record<string, string>;
  lastHealthCheck?: string;
  statusMessage?: string;
}

/**
 * Authoritative Voice AI Intelligence Provider Contract
 */
export interface VoiceAIProviderContract {
  readonly providerId: VoiceAIProviderId;
  readonly providerName: string;

  isConfigured(): boolean;
  getVoiceAICapabilities(): ProviderCapabilities;
  testConnection(credentials?: Record<string, unknown>): Promise<{
    connected: boolean;
    status: ProviderConnectionState;
    message: string;
  }>;

  listModels(): Promise<VoiceAIModel[]>;
  listVoices(): Promise<VoiceAIVoice[]>;
  syncAssistant(config: VoiceAIAssistantConfig): Promise<VoiceAIAssistantSyncResult>;
  dispatchCall(payload: VoiceAIDispatchPayload): Promise<VoiceAICallDispatchResult>;

  verifyWebhookSignature(
    rawPayload: string | Buffer,
    signatureHeader?: string,
    secret?: string
  ): boolean;

  parseWebhookEvent(rawPayload: unknown): NormalizedVoiceAIEvent;
  fetchTranscript(callId: string): Promise<CallTurnInput[]>;
  fetchRecordingMetadata(callId: string): Promise<CallRecordingMetadata>;
}

// ------------------------------------------------------------------------------
// VOICE AGENT STUDIO & LIFECYCLE STATE MACHINE
// ------------------------------------------------------------------------------

export type VoiceAgentLifecycleStatus =
  | 'DRAFT'
  | 'INCOMPLETE'
  | 'READY_FOR_TEST'
  | 'TESTED'
  | 'ACTIVE'
  | 'PAUSED'
  | 'ERROR';

export interface ObjectionHandlingRule {
  id: string;
  category: string;
  triggerPhrases: string[];
  responseGuidance: string;
  priority: number;
}

export interface QualificationQuestion {
  id: string;
  questionText: string;
  required: boolean;
  expectedAnswerType: 'BOOLEAN' | 'TEXT' | 'NUMBER' | 'CHOICE';
  choices?: string[];
  criteriaRule?: string;
}

export interface VoiceAgentSafetyGuardrails {
  maxDurationSeconds: number;
  callingWindowStart: string;
  callingWindowEnd: string;
  allowedDays: number[];
  optOutKeywords: string[];
  enforceDnc: boolean;
  humanApprovalRequired: boolean;
  emergencyKillSwitch: boolean;
  dailyCallCap: number;
}

export interface ReadinessCheckItem {
  id: string;
  stepNumber: number;
  stepName: string;
  passed: boolean;
  required: boolean;
  details?: string;
}

export interface VoiceAgentReadinessReport {
  agentId: string;
  currentStatus: VoiceAgentLifecycleStatus;
  canActivate: boolean;
  checks: ReadinessCheckItem[];
  blockers: string[];
  evaluatedAt: Date;
}

export type VoiceAgentProviderType = 'retell' | 'vapi' | 'mock';

export interface VoiceModelOption {
  id: string;
  provider: VoiceAgentProviderType;
  name: string;
  description: string;
  contextWindow: number;
  recommendedFor: string;
  isDefault?: boolean;
}

export interface VoiceOption {
  id: string;
  provider: VoiceAgentProviderType;
  name: string;
  gender: 'male' | 'female' | 'neutral';
  accent?: string;
  previewAudioUrl?: string;
  sampleRateHz?: number;
  tags?: string[];
}

export interface VoiceAgentKnowledgePoint {
  id: string;
  category: string;
  title: string;
  content: string;
  isMandatory: boolean;
}

export interface VoiceAgentStudioConfig {
  id: string;
  workspaceId: string;
  name: string;
  status: VoiceAgentLifecycleStatus;

  // Step 1: Provider Selection
  provider: VoiceAgentProviderType;
  providerConfigured: boolean;

  // Step 2: Model Configuration
  modelId: string;
  temperature: number;
  maxTokens: number;

  // Step 3: Voice Selection
  voiceId: string;
  voiceProvider: string;
  voiceSpeed?: number;
  voicePitch?: number;
  voiceStability?: number;

  // Step 4: System Prompt & Persona
  callObjective: string;
  openingScript: string;
  agentPersona: string;
  speakingStyle: string;

  // Step 5: Knowledge Base & Talking Points
  approvedTalkingPoints: string[];
  knowledgePoints?: VoiceAgentKnowledgePoint[];
  prohibitedClaims: string[];

  // Step 6: Objection Handling
  objectionRules: ObjectionHandlingRule[];
  objectionHandling?: Record<string, string>;

  // Step 7: Qualification Questions
  qualificationQuestions: string[];
  structuredQuestions?: QualificationQuestion[];

  // Step 8: Phone Number Assignment & Compatibility
  assignedPhoneNumberId?: string | null;
  assignedPhoneNumber?: string | null;
  numberProviderCompatible?: boolean;

  // Step 9: Safety & Guardrails
  safety: VoiceAgentSafetyGuardrails;
  escalationConditions: string[];
  fallbackBehavior?: string;

  // Step 10: Test Configuration
  testPhoneNumber?: string | null;
  lastTestedAt?: string | null;
  testNotes?: string | null;

  // Step 11: Review & Readiness
  readinessReport?: VoiceAgentReadinessReport | null;
  activatedAt?: string | null;

  // Timestamps
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface CreateVoiceAgentStudioInput {
  name: string;
  provider: VoiceAgentProviderType;
  modelId?: string;
  voiceId?: string;
  callObjective: string;
  openingScript: string;
  agentPersona?: string;
  speakingStyle?: string;
  approvedTalkingPoints: string[];
  prohibitedClaims: string[];
  qualificationQuestions: string[];
  structuredQuestions?: QualificationQuestion[];
  objectionRules?: ObjectionHandlingRule[];
  objectionHandling?: Record<string, string>;
  escalationConditions?: string[];
  fallbackBehavior?: string;
  assignedPhoneNumberId?: string | null;
  safety?: Partial<VoiceAgentSafetyGuardrails>;
  maxDurationSeconds?: number;
}

export interface UpdateVoiceAgentStudioInput extends Partial<CreateVoiceAgentStudioInput> {
  status?: VoiceAgentLifecycleStatus;
  testPhoneNumber?: string | null;
}
