import { Server as SocketIOServer, Socket } from 'socket.io';
import { verifyAccessToken } from '../crypto/tokens';
import { db } from '../db/pool';
import { logger } from '../utils/logger';
import { presence } from './presence';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SocketUser {
  id: string;
  username: string;
  email: string;
  globalRole: string;
}

export function setupSocketIO(io: SocketIOServer): void {
  // 1. Handshake Authentication Middleware (Spec §8.2)
  io.use(async (socket: Socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token || typeof token !== 'string') {
        return next(new Error('Authentication token required in auth.token handshake'));
      }

      const payload = verifyAccessToken(token);

      // Verify user validity and active status in DB
      const result = await db.query(
        'SELECT id, username, email, global_role AS "globalRole", locked_until FROM users WHERE id = $1',
        [payload.sub]
      );

      if (result.rows.length === 0) {
        return next(new Error('User account not found'));
      }

      const user = result.rows[0];
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        return next(new Error('Account is locked'));
      }

      socket.data.user = {
        id: user.id,
        username: user.username,
        email: user.email,
        globalRole: user.globalRole,
      };

      next();
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Socket.IO handshake authentication failed');
      next(new Error('Authentication failed'));
    }
  });

  // 2. Connection and Event Handling (Spec §8.3, §8.5, §8.6)
  io.on('connection', (socket: Socket) => {
    const user = socket.data.user as SocketUser;
    logger.debug({ userId: user.id, socketId: socket.id }, 'Socket client connected');

    // Automatically join private room for personal notifications
    socket.join(`user:${user.id}`);

    // Join room event (enforces DB membership check)
    socket.on('room:join', async (payload: { roomId: string }, callback?: (res: any) => void) => {
      try {
        const roomId = payload?.roomId;

        if (!roomId || !UUID_REGEX.test(roomId)) {
          if (callback) callback({ error: 'Invalid room ID format' });
          socket.emit('error', { code: 'INVALID_ROOM_ID', message: 'Room ID must be a valid UUID' });
          return;
        }

        // Database authorization check (Token is NEVER trusted for room access)
        const memberRes = await db.query(
          'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
          [roomId, user.id]
        );

        if (memberRes.rows.length === 0) {
          logger.warn({ userId: user.id, roomId }, 'Socket unauthorized room:join rejected');
          if (callback) callback({ error: 'Room access denied' });
          socket.emit('error', { code: 'ROOM_ACCESS_DENIED', message: 'You are not a member of this room' });
          return;
        }

        // Join socket room
        socket.join(`room:${roomId}`);

        // Update in-memory presence
        const { isFirstSocketForUser } = presence.addUserSocket(roomId, user.id, user.username, socket.id);

        // Emit presence update if this user transitioned from offline to online
        if (isFirstSocketForUser) {
          socket.to(`room:${roomId}`).emit('presence:update', {
            roomId,
            userId: user.id,
            username: user.username,
            status: 'online',
          });
        }

        // Provide caller with snapshot of all currently online users in this room
        const onlineUsers = presence.getOnlineUsersInRoom(roomId);
        socket.emit('presence:snapshot', {
          roomId,
          users: onlineUsers,
        });

        if (callback) callback({ success: true });
      } catch (err: any) {
        logger.error({ err, userId: user.id }, 'Error during socket room:join');
        if (callback) callback({ error: 'Failed to join room' });
      }
    });

    // Leave room event
    socket.on('room:leave', (payload: { roomId: string }, callback?: (res: any) => void) => {
      const roomId = payload?.roomId;
      if (!roomId) return;

      const { isLastSocketForUser } = presence.removeUserSocket(roomId, user.id, socket.id);
      socket.leave(`room:${roomId}`);

      if (isLastSocketForUser) {
        io.to(`room:${roomId}`).emit('presence:update', {
          roomId,
          userId: user.id,
          username: user.username,
          status: 'offline',
        });
      }

      if (callback) callback({ success: true });
    });

    // Disconnect cleanup
    socket.on('disconnect', () => {
      logger.debug({ userId: user.id, socketId: socket.id }, 'Socket client disconnected');
      const transitions = presence.cleanupSocket(socket.id, user.id);

      for (const t of transitions) {
        io.to(`room:${t.roomId}`).emit('presence:update', {
          roomId: t.roomId,
          userId: t.userId,
          username: t.username,
          status: 'offline',
        });
      }
    });
  });
}
