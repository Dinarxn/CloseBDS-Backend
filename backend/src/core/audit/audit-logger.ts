export type AuditEventType =
  | 'LEAD_DISCOVERED'
  | 'LEAD_QUALIFIED'
  | 'LEAD_DISQUALIFIED'
  | 'MESSAGE_DRAFTED'
  | 'MESSAGE_APPROVED'
  | 'MESSAGE_REJECTED'
  | 'MESSAGE_DISPATCHED'
  | 'FOLLOW_UP_APPROVED'
  | 'FOLLOW_UP_DISPATCHED'
  | 'SUPPRESSION_TRIGGERED'
  | 'KILL_SWITCH_ACTIVATED'
  | 'KILL_SWITCH_DEACTIVATED'
  | 'SETTINGS_UPDATED'
  | 'API_KEY_ROTATED';

export interface AuditLogEntry {
  id?: string;
  workspaceId: string;
  userId?: string;
  eventType: AuditEventType;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  timestamp: Date;
}

export interface AuditRecorder {
  record(entry: Omit<AuditLogEntry, 'timestamp'>): Promise<void>;
}

/**
 * In-memory / console audit recorder placeholder for backend foundation.
 * Production persistence to PostgreSQL will be wired in future database phases.
 */
export class FoundationAuditRecorder implements AuditRecorder {
  async record(entry: Omit<AuditLogEntry, 'timestamp'>): Promise<void> {
    // Foundation boundary: log structured audit event without leaking PII
    if (process.env.NODE_ENV !== 'test') {
      console.log(
        JSON.stringify({
          level: 'AUDIT',
          eventType: entry.eventType,
          workspaceId: entry.workspaceId,
          userId: entry.userId,
          entityType: entry.entityType,
          entityId: entry.entityId,
          timestamp: new Date().toISOString(),
        })
      );
    }
  }
}
