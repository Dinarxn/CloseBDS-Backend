import type { CallStatus } from '@prisma/client';
import { BadRequestError } from '../../core/errors/api-error.js';

/**
 * Server-authoritative Call state transition matrix.
 * Disallows invalid state jumps (e.g. QUEUED directly to IN_PROGRESS without approval/initiation).
 */
export const ALLOWED_CALL_TRANSITIONS: Record<CallStatus, readonly CallStatus[]> = {
  QUEUED: ['SAFETY_CHECKING', 'CANCELLED'],
  SAFETY_CHECKING: ['APPROVAL_REQUIRED', 'APPROVED', 'BLOCKED', 'CANCELLED'],
  APPROVAL_REQUIRED: ['APPROVED', 'BLOCKED', 'CANCELLED'],
  APPROVED: ['INITIATING', 'APPROVAL_REQUIRED', 'CANCELLED', 'BLOCKED'],
  INITIATING: ['RINGING', 'IN_PROGRESS', 'FAILED', 'BUSY', 'NO_ANSWER', 'CANCELLED'],
  RINGING: ['IN_PROGRESS', 'COMPLETED', 'FAILED', 'BUSY', 'NO_ANSWER', 'VOICEMAIL', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'FAILED', 'BUSY', 'NO_ANSWER', 'VOICEMAIL', 'OPTED_OUT', 'CANCELLED'],

  // Terminal States
  COMPLETED: [],
  BLOCKED: [],
  FAILED: [],
  CANCELLED: [],
  NO_ANSWER: [],
  BUSY: [],
  VOICEMAIL: [],
  OPTED_OUT: [],
} as const;

export const TERMINAL_CALL_STATUSES: readonly CallStatus[] = [
  'COMPLETED',
  'BLOCKED',
  'FAILED',
  'CANCELLED',
  'NO_ANSWER',
  'BUSY',
  'VOICEMAIL',
  'OPTED_OUT',
];

export function isTerminalCallStatus(status: CallStatus): boolean {
  return TERMINAL_CALL_STATUSES.includes(status);
}

export function isValidCallTransition(current: CallStatus, next: CallStatus): boolean {
  // Self transition is allowed if idempotently re-asserting same status
  if (current === next) {
    return true;
  }

  const allowed = ALLOWED_CALL_TRANSITIONS[current];
  if (!allowed) {
    return false;
  }

  return allowed.includes(next);
}

export function assertValidCallTransition(current: CallStatus, next: CallStatus): void {
  if (!isValidCallTransition(current, next)) {
    throw new BadRequestError(
      `Invalid call status transition from '${current}' to '${next}'. Allowed next states: [${(ALLOWED_CALL_TRANSITIONS[current] || []).join(', ')}]`
    );
  }
}

// ==============================================================================
// VOICE AGENT STUDIO LIFECYCLE STATE MACHINE (R4)
// Transitions: DRAFT -> INCOMPLETE -> READY_FOR_TEST -> TESTED -> ACTIVE -> PAUSED / ERROR
// ==============================================================================

import type { VoiceAgentLifecycleStatus } from './voice.types.js';

export const ALLOWED_AGENT_LIFECYCLE_TRANSITIONS: Record<
  VoiceAgentLifecycleStatus,
  readonly VoiceAgentLifecycleStatus[]
> = {
  DRAFT: ['INCOMPLETE', 'READY_FOR_TEST', 'ERROR'],
  INCOMPLETE: ['DRAFT', 'READY_FOR_TEST', 'ERROR'],
  READY_FOR_TEST: ['INCOMPLETE', 'TESTED', 'ERROR'],
  TESTED: ['READY_FOR_TEST', 'ACTIVE', 'INCOMPLETE', 'PAUSED', 'ERROR'],
  ACTIVE: ['PAUSED', 'TESTED', 'INCOMPLETE', 'ERROR'],
  PAUSED: ['ACTIVE', 'TESTED', 'INCOMPLETE', 'ERROR'],
  ERROR: ['DRAFT', 'INCOMPLETE', 'READY_FOR_TEST', 'PAUSED'],
} as const;

export function isValidAgentLifecycleTransition(
  current: VoiceAgentLifecycleStatus,
  next: VoiceAgentLifecycleStatus
): boolean {
  // Idempotent self-transition
  if (current === next) {
    return true;
  }

  const allowed = ALLOWED_AGENT_LIFECYCLE_TRANSITIONS[current];
  if (!allowed) {
    return false;
  }

  return allowed.includes(next);
}

export function assertValidAgentLifecycleTransition(
  current: VoiceAgentLifecycleStatus,
  next: VoiceAgentLifecycleStatus
): void {
  if (!isValidAgentLifecycleTransition(current, next)) {
    throw new BadRequestError(
      `Invalid voice agent lifecycle transition from '${current}' to '${next}'. Allowed next states: [${(
        ALLOWED_AGENT_LIFECYCLE_TRANSITIONS[current] || []
      ).join(', ')}]`
    );
  }
}
