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

export const audit = {
  /**
   * Part 1 Stub: Logs audit event via Pino with field redaction.
   * Part 3 will replace this with asynchronous DB insert into audit_logs table.
   */
  log: async (params: AuditLogParams): Promise<void> => {
    logger.info({ audit: params }, `[AUDIT] ${params.action} - ${params.outcome}`);
  },
};
