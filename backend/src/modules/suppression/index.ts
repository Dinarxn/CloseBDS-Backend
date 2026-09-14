/**
 * Module Boundary: Suppression & Opt-Out
 * Pre-send suppression verification is mandatory for compliance.
 */
export interface SuppressionRecord {
  id: string;
  workspaceId: string;
  type: 'EMAIL' | 'DOMAIN';
  value: string; // e.g. "contact@example.com" or "example.com"
  reason: 'OPT_OUT' | 'HARD_BOUNCE' | 'MANUAL_SUPPRESSION';
  createdAt: Date;
}

export interface SuppressionChecker {
  isSuppressed(workspaceId: string, email: string, domain?: string): Promise<boolean>;
  addSuppression(workspaceId: string, value: string, type: 'EMAIL' | 'DOMAIN', reason: string): Promise<void>;
}
