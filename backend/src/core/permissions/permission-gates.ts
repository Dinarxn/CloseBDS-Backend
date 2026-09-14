import { PermissionGatedError } from '../errors/api-error.js';

/**
 * Core Permission Identifiers in closeVDS
 */
export type Permission =
  | 'campaigns:read'
  | 'campaigns:write'
  | 'leads:read'
  | 'leads:write'
  | 'outreach:draft'
  | 'outreach:approve'
  | 'outreach:dispatch'
  | 'settings:read'
  | 'settings:write'
  | 'audit:read';

/**
 * Gate Identifiers requiring explicit Human Review before execution.
 * closeVDS NEVER automatically sends outreach merely because AI generated it.
 */
export type PermissionGateId =
  | 'GATE_INITIAL_OUTREACH_APPROVAL'
  | 'GATE_FOLLOW_UP_APPROVAL'
  | 'GATE_HIGH_VOLUME_CAMPAIGN_DISPATCH'
  | 'GATE_SUPPRESSION_OVERRIDE';

export interface GateApprovalState {
  gateId: PermissionGateId;
  isApproved: boolean;
  approvedByUserId?: string;
  approvedAt?: Date;
  rejectionReason?: string;
}

export interface PermissionChecker {
  hasPermission(userId: string, workspaceId: string, permission: Permission): Promise<boolean>;
  isGateApproved(gateId: PermissionGateId, targetEntityId: string): Promise<boolean>;
}

/**
 * Foundation check asserting that an AI-generated outreach or follow-up action
 * cannot proceed without confirmed human approval.
 */
export function assertHumanApprovalGranted(
  gateId: PermissionGateId,
  isApproved: boolean,
  contextMessage?: string
): void {
  if (!isApproved) {
    throw new PermissionGatedError(
      contextMessage ||
        `Action blocked by ${gateId}. Human review and explicit approval is mandatory before dispatch.`
    );
  }
}
