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
  private globalKillSwitchOverride: boolean | null = null;

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
   * Triggers the emergency kill switch for a workspace, immediately halting outreach.
   */
  async triggerEmergencyKillSwitch(
    workspaceId: string,
    _reason?: string
  ): Promise<WorkspaceCallingPolicy> {
    return this.policyRepo.upsert(workspaceId, { isActive: false });
  }

  /**
   * Resets / deactivates the emergency kill switch for a workspace, resuming calling.
   */
  async resetEmergencyKillSwitch(
    workspaceId: string
  ): Promise<WorkspaceCallingPolicy> {
    return this.policyRepo.upsert(workspaceId, { isActive: true });
  }

  /**
   * Checks whether the emergency kill switch is active for a specific workspace.
   */
  async isWorkspaceKillSwitchActive(workspaceId: string): Promise<boolean> {
    const policy = await this.getOrCreatePolicy(workspaceId);
    return !policy.isActive;
  }

  /**
   * Sets or overrides the Global Emergency Kill Switch in-memory.
   */
  setGlobalKillSwitch(active: boolean): void {
    this.globalKillSwitchOverride = active;
  }

  /**
   * Clears any runtime override for the Global Emergency Kill Switch.
   */
  resetGlobalKillSwitch(): void {
    this.globalKillSwitchOverride = null;
  }

  /**
   * Checks whether the Global Emergency Kill Switch is active.
   */
  isGlobalKillSwitchActive(): boolean {
    if (this.globalKillSwitchOverride !== null) {
      return this.globalKillSwitchOverride;
    }
    return (
      process.env.KILL_SWITCH_ACTIVE === 'true' ||
      process.env.KILL_SWITCH_ACTIVE === '1'
    );
  }

  /**
   * Evaluates whether the given timestamp is within the policy's allowed calling window.
   * Supports recipient-aware timezone calculations.
   */
  isWithinCallingWindow(
    policy: WorkspaceCallingPolicy,
    date: Date = new Date(),
    timezone?: string
  ): { inside: boolean; currentHHMM: string; window: string; timezone: string } {
    let currentHHMM: string;
    let effectiveTz = timezone || 'UTC';

    if (timezone) {
      try {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).formatToParts(date);

        const h = parts.find((p) => p.type === 'hour')?.value || '00';
        const m = parts.find((p) => p.type === 'minute')?.value || '00';
        currentHHMM = `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
      } catch {
        // Fallback to local time if timezone identifier is unparseable
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        currentHHMM = `${hours}:${minutes}`;
        effectiveTz = 'Local';
      }
    } else {
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      currentHHMM = `${hours}:${minutes}`;
      effectiveTz = 'Local';
    }

    const windowStart = policy.callingWindowStart || '09:00';
    const windowEnd = policy.callingWindowEnd || '17:00';
    const inside = currentHHMM >= windowStart && currentHHMM <= windowEnd;
    return {
      inside,
      currentHHMM,
      window: `${windowStart}-${windowEnd}`,
      timezone: effectiveTz,
    };
  }

  /**
   * Evaluates whether the given date is an allowed calling day.
   * Supports recipient-aware timezone calculations.
   */
  isAllowedCallingDay(
    policy: WorkspaceCallingPolicy,
    date: Date = new Date(),
    timezone?: string
  ): { allowed: boolean; dayOfWeek: number; timezone: string } {
    let dayOfWeek: number;
    let effectiveTz = timezone || 'UTC';

    if (timezone) {
      try {
        const weekdayStr = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          weekday: 'short',
        }).format(date);
        const dayMap: Record<string, number> = {
          Sun: 0,
          Mon: 1,
          Tue: 2,
          Wed: 3,
          Thu: 4,
          Fri: 5,
          Sat: 6,
        };
        dayOfWeek = dayMap[weekdayStr] ?? date.getDay();
      } catch {
        dayOfWeek = date.getDay();
        effectiveTz = 'Local';
      }
    } else {
      dayOfWeek = date.getDay();
      effectiveTz = 'Local';
    }

    const allowedDays = policy.allowedCallingDays || [1, 2, 3, 4, 5];
    return {
      allowed: allowedDays.includes(dayOfWeek),
      dayOfWeek,
      timezone: effectiveTz,
    };
  }
}

export const callingPolicyService = new CallingPolicyService();
