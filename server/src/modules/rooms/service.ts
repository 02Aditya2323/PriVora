import { db } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { RoomRole } from '../../middleware/rbac';
import { audit } from '../audit/audit';
import { emit } from '../../realtime/emit';
import { storage } from '../../storage/S3Adapter';
import { logger } from '../../utils/logger';

export class RoomsService {
  async createRoom(ownerId: string, name: string) {
    const sanitizedName = name.trim().normalize('NFC');
    if (!sanitizedName || sanitizedName.length > 100) {
      throw AppError.badRequest('Room name must be between 1 and 100 characters', 'INVALID_ROOM_NAME');
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const roomRes = await client.query(
        `INSERT INTO rooms (name, owner_id)
         VALUES ($1, $2)
         RETURNING id, name, owner_id AS "ownerId", created_at AS "createdAt"`,
        [sanitizedName, ownerId]
      );

      const room = roomRes.rows[0];

      // Add creator as owner member in the same transaction
      await client.query(
        `INSERT INTO room_members (room_id, user_id, role, added_by)
         VALUES ($1, $2, 'owner', $2)`,
        [room.id, ownerId]
      );

      await client.query('COMMIT');

      await audit.log({
        actorId: ownerId,
        action: 'room.create',
        targetType: 'room',
        targetId: room.id,
        roomId: room.id,
        outcome: 'success',
      });

      return room;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async listUserRooms(userId: string) {
    const result = await db.query(
      `SELECT r.id, r.name, r.owner_id AS "ownerId", r.created_at AS "createdAt",
              rm.role, rm.joined_at AS "joinedAt"
       FROM rooms r
       JOIN room_members rm ON r.id = rm.room_id
       WHERE rm.user_id = $1
       ORDER BY r.created_at DESC`,
      [userId]
    );

    return result.rows;
  }

  async getRoom(roomId: string, userId: string) {
    const result = await db.query(
      `SELECT r.id, r.name, r.owner_id AS "ownerId", r.created_at AS "createdAt",
              rm.role, rm.joined_at AS "joinedAt"
       FROM rooms r
       JOIN room_members rm ON r.id = rm.room_id
       WHERE r.id = $1 AND rm.user_id = $2`,
      [roomId, userId]
    );

    if (result.rows.length === 0) {
      throw AppError.notFound('Room not found', 'ROOM_NOT_FOUND');
    }

    return result.rows[0];
  }

  async deleteRoom(roomId: string, ownerId: string) {
    // 1. Fetch all storage keys of files in this room for MinIO cleanup
    const filesRes = await db.query<{ storage_key: string }>(
      'SELECT storage_key FROM files WHERE room_id = $1',
      [roomId]
    );

    // 2. Cascade delete in DB
    const deleteRes = await db.query(
      'DELETE FROM rooms WHERE id = $1 AND owner_id = $2 RETURNING id',
      [roomId, ownerId]
    );

    if (deleteRes.rows.length === 0) {
      throw AppError.notFound('Room not found or unauthorized', 'ROOM_NOT_FOUND');
    }

    // 3. Best-effort MinIO object deletion cleanup loop
    for (const file of filesRes.rows) {
      try {
        await storage.deleteObject(file.storage_key);
      } catch (err) {
        logger.warn({ err, storageKey: file.storage_key }, 'Failed to delete room file object from storage during room cleanup');
      }
    }

    await audit.log({
      actorId: ownerId,
      action: 'room.delete',
      targetType: 'room',
      targetId: roomId,
      roomId,
      outcome: 'success',
    });
  }

  async listMembers(roomId: string) {
    const result = await db.query(
      `SELECT rm.user_id AS "userId", u.username, u.email, rm.role,
              rm.joined_at AS "joinedAt", rm.added_by AS "addedBy"
       FROM room_members rm
       JOIN users u ON rm.user_id = u.id
       WHERE rm.room_id = $1
       ORDER BY rm.joined_at ASC`,
      [roomId]
    );

    return result.rows;
  }

  async addMember(roomId: string, addedById: string, identifier: string, role: 'editor' | 'viewer') {
    const cleanIdentifier = identifier.trim();

    // Look up target user
    const userRes = await db.query(
      'SELECT id, username, email FROM users WHERE email = $1 OR username = $1',
      [cleanIdentifier]
    );

    if (userRes.rows.length === 0) {
      throw AppError.notFound('User to add was not found', 'USER_NOT_FOUND');
    }

    const targetUser = userRes.rows[0];

    // Check if user is already a member
    const existing = await db.query(
      'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, targetUser.id]
    );

    if (existing.rows.length > 0) {
      throw AppError.conflict('User is already a member of this room', 'MEMBER_ALREADY_EXISTS');
    }

    const insertRes = await db.query(
      `INSERT INTO room_members (room_id, user_id, role, added_by)
       VALUES ($1, $2, $3, $4)
       RETURNING joined_at AS "joinedAt"`,
      [roomId, targetUser.id, role, addedById]
    );

    emit.memberAdded(roomId, targetUser.id, role);

    await audit.log({
      actorId: addedById,
      action: 'member.add',
      targetType: 'room_member',
      targetId: targetUser.id,
      roomId,
      outcome: 'success',
      metadata: { role },
    });

    return {
      userId: targetUser.id,
      username: targetUser.username,
      email: targetUser.email,
      role,
      joinedAt: insertRes.rows[0].joinedAt,
    };
  }

  async updateMemberRole(roomId: string, updatedById: string, targetUserId: string, newRole: 'editor' | 'viewer') {
    const memberRes = await db.query(
      'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, targetUserId]
    );

    if (memberRes.rows.length === 0) {
      throw AppError.notFound('Member not found in room', 'MEMBER_NOT_FOUND');
    }

    if (memberRes.rows[0].role === 'owner') {
      throw AppError.forbidden('Cannot modify the role of the room owner', 'CANNOT_MODIFY_OWNER');
    }

    await db.query(
      'UPDATE room_members SET role = $1 WHERE room_id = $2 AND user_id = $3',
      [newRole, roomId, targetUserId]
    );

    emit.memberRoleChanged(roomId, targetUserId, newRole);

    await audit.log({
      actorId: updatedById,
      action: 'member.role_changed',
      targetType: 'room_member',
      targetId: targetUserId,
      roomId,
      outcome: 'success',
      metadata: { newRole },
    });

    return {
      userId: targetUserId,
      role: newRole,
    };
  }

  async removeMember(roomId: string, callerId: string, callerRole: RoomRole, targetUserId: string) {
    if (callerRole !== 'owner' && callerId !== targetUserId) {
      throw AppError.forbidden('Only the room owner can remove other members', 'INSUFFICIENT_PERMISSIONS');
    }

    const memberRes = await db.query(
      'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, targetUserId]
    );

    if (memberRes.rows.length === 0) {
      throw AppError.notFound('Member not found in room', 'MEMBER_NOT_FOUND');
    }

    if (memberRes.rows[0].role === 'owner') {
      throw AppError.forbidden(
        'Room owner cannot leave or be removed. Delete the room instead.',
        'CANNOT_REMOVE_OWNER'
      );
    }

    await db.query(
      'DELETE FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, targetUserId]
    );

    // Revocation: force sockets out of room and broadcast removal
    emit.roomAccessRevoked(roomId, targetUserId);
    emit.memberRemoved(roomId, targetUserId);

    await audit.log({
      actorId: callerId,
      action: callerId === targetUserId ? 'member.leave' : 'member.remove',
      targetType: 'room_member',
      targetId: targetUserId,
      roomId,
      outcome: 'success',
    });
  }
}

export const roomsService = new RoomsService();
