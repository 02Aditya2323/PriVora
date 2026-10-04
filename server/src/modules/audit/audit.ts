import { db } from '../../db/pool';
import { logger } from '../../utils/logger';

export interface AuditLogParams {
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  roomId?: string | null;
  outcome: 'success' | 'denied' | 'failure';
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
}

const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'key',
  'authorization',
  'cookie',
  'dek',
  'kek',
]);

/**
 * Recursively redacts sensitive keys from audit metadata
 */
export function sanitizeAuditMetadata(metadata?: Record<string, any>): Record<string, any> | null {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }

  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = sanitizeAuditMetadata(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * AUDIT LOGGING SERVICE (Spec §7.12)
 * =================================
 * Asynchronously logs security and domain events to the PostgreSQL audit_logs table.
 * 
 * Invariants:
 * 1. Failsafe: Never throws into the HTTP request flow if a DB write fails.
 * 2. Sensitive data sanitization: Passwords, tokens, share keys, and cookies are redacted.
 * 3. Also logs via structured Pino logger for stdout observability.
 */
export const audit = {
  log: async (params: AuditLogParams): Promise<void> => {
    // 1. Redact any sensitive properties from metadata
    const safeMetadata = sanitizeAuditMetadata(params.metadata);

    // 2. Structured log to Pino logger
    logger.info(
      {
        audit: {
          action: params.action,
          outcome: params.outcome,
          actorId: params.actorId,
          targetType: params.targetType,
          targetId: params.targetId,
          roomId: params.roomId,
          ip: params.ip,
        },
      },
      `[AUDIT] ${params.action} - ${params.outcome}`
    );

    // 3. Asynchronous DB insert into audit_logs table
    try {
      await db.query(
        `INSERT INTO audit_logs (
           actor_id, action, target_type, target_id, room_id, outcome, ip, user_agent, metadata
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          params.actorId || null,
          params.action,
          params.targetType || null,
          params.targetId || null,
          params.roomId || null,
          params.outcome,
          params.ip || null,
          params.userAgent || null,
          safeMetadata ? JSON.stringify(safeMetadata) : null,
        ]
      );
    } catch (err: any) {
      // Must NEVER throw into request flow
      logger.error({ err: err.message, action: params.action }, '[AUDIT ERROR] Failed to persist audit log to DB');
    }
  },
};
