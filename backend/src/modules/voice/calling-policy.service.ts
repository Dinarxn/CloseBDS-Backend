import type { WorkspaceCallingPolicy } from './voice.types.js';
import {
  workspaceCallingPolicyRepository,
  WorkspaceCallingPolicyRepository,
} from '../../database/repository.js';

export interface UpdateCallingPolicyInput {
  dailyCallLimit?: number;
  maxConcurrentCalls?: number;
  maxAttemptsPerLead?: number;
  retryDelayMinutes?: number;
  allowedCallingDays?: number[];
  callingWindowStart?: string;
  callingWindowEnd?: string;
  recordingConsent?: boolean;
  humanApprovalRequired?: boolean;
  providerRestrictions?: string[];
  isActive?: boolean;
}

export class CallingPolicyService {
  constructor(
    private policyRepo: WorkspaceCallingPolicyRepository = workspaceCallingPolicyRepository
  ) {}

  /**
   * Retrieves or initializes the default calling policy for a workspace.
   */
  async getOrCreatePolicy(workspaceId: string): Promise<WorkspaceCallingPolicy> {
    const existing = await this.policyRepo.findByWorkspaceId(workspaceId);
    if (existing) {
      return existing;
    }

    return this.policyRepo.upsert(workspaceId, {
      dailyCallLimit: 25,
      maxConcurrentCalls: 1,
      maxAttemptsPerLead: 3,
      retryDelayMinutes: 120,
      allowedCallingDays: [1, 2, 3, 4, 5],
      callingWindowStart: '09:00',
      callingWindowEnd: '17:00',
      recordingConsent: false,
      humanApprovalRequired: true,
      providerRestrictions: [],
      isActive: true,
    });
  }

  /**
   * Updates calling policy for a workspace.
   */
  async updatePolicy(
    workspaceId: string,
    input: UpdateCallingPolicyInput
  ): Promise<WorkspaceCallingPolicy> {
    return this.policyRepo.upsert(workspaceId, input);
  }

  /**
   * Evaluates whether the given timestamp is within the policy's allowed calling window.
   */
  isWithinCallingWindow(
    policy: WorkspaceCallingPolicy,
    date: Date = new Date()
  ): { inside: boolean; currentHHMM: string; window: string } {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const currentHHMM = `${hours}:${minutes}`;
    const windowStart = policy.callingWindowStart || '09:00';
    const windowEnd = policy.callingWindowEnd || '17:00';
    const inside = currentHHMM >= windowStart && currentHHMM <= windowEnd;
    return {
      inside,
      currentHHMM,
      window: `${windowStart}-${windowEnd}`,
    };
  }

  /**
   * Evaluates whether the given date is an allowed calling day.
   */
  isAllowedCallingDay(
    policy: WorkspaceCallingPolicy,
    date: Date = new Date()
  ): { allowed: boolean; dayOfWeek: number } {
    const dayOfWeek = date.getDay();
    const allowedDays = policy.allowedCallingDays || [1, 2, 3, 4, 5];
    return {
      allowed: allowedDays.includes(dayOfWeek),
      dayOfWeek,
    };
  }
}

export const callingPolicyService = new CallingPolicyService();
