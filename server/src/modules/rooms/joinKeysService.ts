import crypto from 'crypto';
import { db } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { hashPassword, verifyPassword } from '../../crypto/password';
import { audit } from '../audit/audit';
import { emit } from '../../realtime/emit';

export interface CreateJoinKeyParams {
  roomId: string;
  creatorId: string;
  role?: 'editor' | 'viewer';
  expiresInHours?: number;
  maxUses?: number;
  password?: string;
}

export interface JoinRoomParams {
  key: string;
  password?: string;
  userId: string;
  userEmail: string;
  username: string;
}

export class RoomJoinKeysService {
  /**
   * Generates a secure, cryptographically unguessable Room Join Key (Spec security principles).
   * Key is 256-bit CSPRNG base64url string. Only SHA-256(key) is stored in the database.
   */
  async createJoinKey(params: CreateJoinKeyParams) {
    const role = params.role || 'viewer';
    const hours = Math.min(Math.max(params.expiresInHours || 24, 1), 168); // 1h to 7 days
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

    // 256-bit unguessable random key
    const rawKey = crypto.randomBytes(32).toString('base64url');
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    let passwordHash: string | null = null;
    if (params.password) {
      passwordHash = await hashPassword(params.password);
    }

    const insertRes = await db.query(
      `INSERT INTO room_join_keys (
         room_id, created_by, key_hash, role, password_hash, expires_at, max_uses
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, room_id AS "roomId", role, expires_at AS "expiresAt",
                 max_uses AS "maxUses", created_at AS "createdAt"`,
      [
        params.roomId,
        params.creatorId,
        keyHash,
        role,
        passwordHash,
        expiresAt,
        params.maxUses || null,
      ]
    );

    await audit.log({
      actorId: params.creatorId,
      action: 'room.join_key_created',
      targetType: 'room_join_key',
      targetId: insertRes.rows[0].id,
      roomId: params.roomId,
      outcome: 'success',
      metadata: { role, maxUses: params.maxUses, expiresInHours: hours },
    });

    // The raw key is returned ONCE to the creator
    return {
      key: rawKey,
      ...insertRes.rows[0],
      requiresPassword: !!passwordHash,
    };
  }

  async listJoinKeys(roomId: string) {
    const result = await db.query(
      `SELECT id, role, expires_at AS "expiresAt", max_uses AS "maxUses",
              use_count AS "useCount", created_at AS "createdAt",
              password_hash IS NOT NULL AS "requiresPassword"
       FROM room_join_keys
       WHERE room_id = $1 AND revoked_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC`,
      [roomId]
    );

    return result.rows;
  }

  async revokeJoinKey(roomId: string, keyId: string, callerId: string) {
    const result = await db.query(
      `UPDATE room_join_keys
       SET revoked_at = now()
       WHERE id = $1 AND room_id = $2 AND revoked_at IS NULL
       RETURNING id`,
      [keyId, roomId]
    );

    if (result.rows.length === 0) {
      throw AppError.notFound('Join key not found or already revoked', 'KEY_NOT_FOUND');
    }

    await audit.log({
      actorId: callerId,
      action: 'room.join_key_revoked',
      targetType: 'room_join_key',
      targetId: keyId,
      roomId,
      outcome: 'success',
    });
  }

  /**
   * Joins a room using a cryptographic Join Key.
   * Atomically increments usage count to prevent race-condition over-joining.
   */
  async joinRoomWithKey(params: JoinRoomParams) {
    if (!params.key || typeof params.key !== 'string') {
      throw AppError.badRequest('Room join key is required', 'MISSING_KEY');
    }

    const keyHash = crypto.createHash('sha256').update(params.key.trim()).digest('hex');

    // 1. Lookup key and associated room
    const keyRes = await db.query(
      `SELECT k.id, k.room_id, k.created_by, k.role, k.password_hash, k.expires_at,
              k.max_uses, k.use_count, k.revoked_at, r.name AS room_name
       FROM room_join_keys k
       JOIN rooms r ON k.room_id = r.id
       WHERE k.key_hash = $1`,
      [keyHash]
    );

    // Uniform 404 for unknown, revoked, or expired keys
    if (keyRes.rows.length === 0) {
      throw AppError.notFound('Invalid or expired room join key', 'INVALID_JOIN_KEY');
    }

    const joinKey = keyRes.rows[0];

    if (joinKey.revoked_at !== null) {
      throw AppError.notFound('Invalid or expired room join key', 'INVALID_JOIN_KEY');
    }

    if (new Date(joinKey.expires_at) < new Date()) {
      throw AppError.notFound('Invalid or expired room join key', 'INVALID_JOIN_KEY');
    }

    if (joinKey.max_uses !== null && joinKey.use_count >= joinKey.max_uses) {
      throw AppError.notFound('Room join key has reached its maximum usage limit', 'INVALID_JOIN_KEY');
    }

    // 2. Verify password if protected
    if (joinKey.password_hash) {
      if (!params.password) {
        throw AppError.badRequest('This room key requires a password', 'PASSWORD_REQUIRED');
      }
      const valid = await verifyPassword(joinKey.password_hash, params.password);
      if (!valid) {
        throw AppError.unauthorized('Incorrect room key password', 'INVALID_KEY_PASSWORD');
      }
    }

    // 3. Atomic usage counter update (Prevents race conditions)
    const updateRes = await db.query(
      `UPDATE room_join_keys
       SET use_count = use_count + 1
       WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()
         AND (max_uses IS NULL OR use_count < max_uses)
       RETURNING id`,
      [joinKey.id]
    );

    if (updateRes.rows.length === 0) {
      throw AppError.notFound('Room join key has expired or reached usage limit', 'JOIN_KEY_EXHAUSTED');
    }

    // 4. Check if user is already a member
    const existingMember = await db.query(
      'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
      [joinKey.room_id, params.userId]
    );

    if (existingMember.rows.length > 0) {
      // User is already a member: return room info
      return {
        alreadyMember: true,
        room: {
          id: joinKey.room_id,
          name: joinKey.room_name,
          role: existingMember.rows[0].role,
        },
      };
    }

    // 5. Add user to room
    await db.query(
      `INSERT INTO room_members (room_id, user_id, role, added_by)
       VALUES ($1, $2, $3, $4)`,
      [joinKey.room_id, params.userId, joinKey.role, joinKey.created_by]
    );

    // Emit live real-time member event
    emit.memberAdded(joinKey.room_id, params.userId, joinKey.role);

    await audit.log({
      actorId: params.userId,
      action: 'room.join_by_key',
      targetType: 'room',
      targetId: joinKey.room_id,
      roomId: joinKey.room_id,
      outcome: 'success',
      metadata: { role: joinKey.role, joinKeyId: joinKey.id },
    });

    return {
      alreadyMember: false,
      room: {
        id: joinKey.room_id,
        name: joinKey.room_name,
        role: joinKey.role,
      },
    };
  }
}

export const roomJoinKeysService = new RoomJoinKeysService();
