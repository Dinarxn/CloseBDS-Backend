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
}

export interface CallPreparationResult {
  callId: string;
  status: CallStatus;
  safetyCheck: VoiceSafetyCheckResult;
  normalizedPhone: string;
  groundedContext: Record<string, unknown>;
  requiresApproval: boolean;
}

export interface CallDispatchResult {
  callId: string;
  status: CallStatus;
  providerCallId?: string;
  startedAt?: Date;
  blockedReason?: string;
}

export interface CallTurnInput {
  turnIndex: number;
  speaker: 'agent' | 'lead' | 'system';
  text: string;
  confidence?: number;
  timestampMs?: number;
}
