import { Request, Response, NextFunction } from 'express';
import { db } from '../db/pool';
import { AppError } from './errorHandler';

export type RoomRole = 'viewer' | 'editor' | 'owner';

const ROLE_HIERARCHY: Record<RoomRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

declare global {
  namespace Express {
    interface Request {
      roomMembership?: {
        roomId: string;
        role: RoomRole;
      };
    }
  }
}

/**
 * RBAC & IDOR Middleware:
 * Loads the caller's membership for :roomId from the database.
 * - If the room doesn't exist OR the user is NOT a member: returns 404 Not Found (prevents enumeration).
 * - If the user is a member but lacks sufficient privileges: returns 403 Forbidden.
 */
export function requireRoomRole(minRole: RoomRole) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const roomId = req.params.roomId;
      const user = req.user;

      if (!user) {
        throw AppError.unauthorized('Authentication required', 'UNAUTHORIZED');
      }

      if (!roomId) {
        throw AppError.badRequest('Room ID parameter missing', 'MISSING_ROOM_ID');
      }

      // Real-time database membership query (Token claims are NEVER trusted for room roles)
      const result = await db.query<{ role: RoomRole }>(
        `SELECT role
         FROM room_members
         WHERE room_id = $1 AND user_id = $2`,
        [roomId, user.id]
      );

      // Uniform 404 if not found or non-member (mitigates IDOR enumeration)
      if (result.rows.length === 0) {
        throw AppError.notFound('Room not found', 'ROOM_NOT_FOUND');
      }

      const userRole = result.rows[0].role;
      const userLevel = ROLE_HIERARCHY[userRole] || 0;
      const requiredLevel = ROLE_HIERARCHY[minRole];

      if (userLevel < requiredLevel) {
        throw AppError.forbidden(
          `Insufficient permissions: action requires ${minRole} role, you are ${userRole}`,
          'INSUFFICIENT_PERMISSIONS'
        );
      }

      req.roomMembership = {
        roomId,
        role: userRole,
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}
