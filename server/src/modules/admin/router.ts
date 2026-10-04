import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../../db/pool';
import { auth } from '../../middleware/auth';
import { validate, uuidParamSchema } from '../../middleware/validate';
import { AppError } from '../../middleware/errorHandler';
import { audit } from '../audit/audit';
import { emit } from '../../realtime/emit';

export const adminRouter = Router();

// All admin routes require authentication
adminRouter.use(auth);

/**
 * Global Admin RBAC Middleware
 * Verifies that the authenticated caller has globalRole === 'admin'
 */
export function requireGlobalAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    throw AppError.unauthorized('Authentication required', 'UNAUTHORIZED');
  }

  if (req.user.globalRole !== 'admin') {
    throw AppError.forbidden('Global admin privileges required to access this endpoint', 'FORBIDDEN');
  }

  next();
}

adminRouter.use(requireGlobalAdmin);

const auditQuerySchema = z
  .object({
    actor: z.string().optional(),
    actorId: z.string().optional(),
    action: z.string().optional(),
    outcome: z.enum(['success', 'denied', 'failure']).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

const lockUserSchema = z
  .object({
    locked: z.boolean(),
    durationMinutes: z.number().int().min(1).max(525600).optional(), // up to 1 year
    reason: z.string().max(255).optional(),
  })
  .strict();

// 1. GET /api/admin/audit-logs
adminRouter.get(
  '/audit-logs',
  validate({ query: auditQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { actor, actorId, action, outcome, from, to, limit, offset } = req.query as any;

      const conditions: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      const filterActor = actorId || actor;
      if (filterActor) {
        conditions.push(`actor_id = $${paramIndex++}`);
        values.push(filterActor);
      }

      if (action) {
        conditions.push(`action ILIKE $${paramIndex++}`);
        values.push(`%${action}%`);
      }

      if (outcome) {
        conditions.push(`outcome = $${paramIndex++}`);
        values.push(outcome);
      }

      if (from) {
        conditions.push(`ts >= $${paramIndex++}`);
        values.push(from);
      }

      if (to) {
        conditions.push(`ts <= $${paramIndex++}`);
        values.push(to);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const countRes = await db.query(
        `SELECT COUNT(*) AS total FROM audit_logs ${whereClause}`,
        values
      );
      const total = Number(countRes.rows[0]?.total || 0);

      const logsRes = await db.query(
        `SELECT id, ts, actor_id AS "actorId", action, target_type AS "targetType",
                target_id AS "targetId", room_id AS "roomId", outcome,
                ip, user_agent AS "userAgent", metadata
         FROM audit_logs
         ${whereClause}
         ORDER BY ts DESC
         LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
        [...values, limit, offset]
      );

      res.status(200).json({
        logs: logsRes.rows,
        total,
        limit,
        offset,
      });
    } catch (err) {
      next(err);
    }
  }
);

// 2. PATCH /api/admin/users/:userId/lock
adminRouter.patch(
  '/users/:userId/lock',
  validate({
    params: z.object({ userId: uuidParamSchema }).strict(),
    body: lockUserSchema,
  }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { userId } = req.params;
      const { locked, durationMinutes, reason } = req.body;

      // Check if user exists
      const userRes = await db.query(
        'SELECT id, username, email, global_role AS "globalRole", locked_until AS "lockedUntil" FROM users WHERE id = $1',
        [userId]
      );

      if (userRes.rows.length === 0) {
        throw AppError.notFound('User not found', 'USER_NOT_FOUND');
      }

      const targetUser = userRes.rows[0];

      // Prevent locking other global admins
      if (targetUser.globalRole === 'admin' && locked) {
        throw AppError.forbidden('Cannot lock an account with global admin privileges', 'CANNOT_LOCK_ADMIN');
      }

      let lockedUntil: Date | null = null;
      if (locked) {
        const mins = durationMinutes || 60 * 24 * 365; // Default 1 year if not specified
        lockedUntil = new Date(Date.now() + mins * 60 * 1000);
      }

      const updateRes = await db.query(
        `UPDATE users
         SET locked_until = $1::timestamptz,
             failed_login_count = CASE WHEN $1::timestamptz IS NULL THEN 0 ELSE failed_login_count END
         WHERE id = $2
         RETURNING id, username, email, locked_until AS "lockedUntil", failed_login_count AS "failedLoginCount"`,
        [lockedUntil, userId]
      );

      // If locking user, revoke all active sessions immediately
      if (locked) {
        await db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
        emit.sessionRevoked(userId);
      }

      await audit.log({
        actorId: req.user!.id,
        action: locked ? 'admin.lock_user' : 'admin.unlock_user',
        targetType: 'user',
        targetId: userId,
        outcome: 'success',
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        metadata: {
          reason: reason || (locked ? 'Admin locked account' : 'Admin unlocked account'),
          lockedUntil,
        },
      });

      res.status(200).json({
        message: locked ? 'User account locked successfully' : 'User account unlocked successfully',
        user: updateRes.rows[0],
      });
    } catch (err) {
      next(err);
    }
  }
);
