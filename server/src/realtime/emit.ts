import { Server as SocketIOServer } from 'socket.io';
import { logger } from '../utils/logger';

let ioInstance: SocketIOServer | null = null;

export function setSocketIOInstance(io: SocketIOServer): void {
  ioInstance = io;
}

export function getSocketIOInstance(): SocketIOServer | null {
  return ioInstance;
}

export const emit = {
  fileUploaded: (
    roomId: string,
    file: { id: string; name: string; size: number; uploaderId: string; createdAt: string }
  ): void => {
    if (!ioInstance) return;
    logger.debug({ roomId, fileId: file.id }, 'Emitting file:uploaded');
    ioInstance.to(`room:${roomId}`).emit('file:uploaded', { roomId, file });
  },

  fileDeleted: (roomId: string, fileId: string, deletedBy: string): void => {
    if (!ioInstance) return;
    logger.debug({ roomId, fileId }, 'Emitting file:deleted');
    ioInstance.to(`room:${roomId}`).emit('file:deleted', { roomId, fileId, deletedBy });
  },

  memberAdded: (roomId: string, userId: string, role: string): void => {
    if (!ioInstance) return;
    logger.debug({ roomId, userId, role }, 'Emitting member:added');
    ioInstance.to(`room:${roomId}`).emit('member:added', { roomId, userId, role });
  },

  memberRemoved: (roomId: string, userId: string): void => {
    if (!ioInstance) return;
    logger.debug({ roomId, userId }, 'Emitting member:removed');
    ioInstance.to(`room:${roomId}`).emit('member:removed', { roomId, userId });
  },

  memberRoleChanged: (roomId: string, userId: string, role: string): void => {
    if (!ioInstance) return;
    logger.debug({ roomId, userId, role }, 'Emitting member:role_changed');
    ioInstance.to(`room:${roomId}`).emit('member:role_changed', { roomId, userId, role });
  },

  roomAccessRevoked: (roomId: string, userId: string): void => {
    if (!ioInstance) return;
    logger.debug({ roomId, userId }, 'Evicting socket and emitting room:access_revoked');
    // Force socket out of room
    ioInstance.in(`user:${userId}`).socketsLeave(`room:${roomId}`);
    // Notify the user client to leave room UI
    ioInstance.to(`user:${userId}`).emit('room:access_revoked', { roomId });
  },

  sessionRevoked: (userId: string): void => {
    if (!ioInstance) return;
    logger.debug({ userId }, 'Emitting session:revoked and disconnecting sockets');
    ioInstance.to(`user:${userId}`).emit('session:revoked', {});
    ioInstance.in(`user:${userId}`).disconnectSockets();
  },

  /**
   * Stub for Part 3: shareRevoked
   */
  shareRevoked: (roomId: string, fileId: string, linkId: string): void => {
    if (!ioInstance) return;
    logger.debug({ roomId, fileId, linkId }, 'Emitting share:revoked');
    ioInstance.to(`room:${roomId}`).emit('share:revoked', { roomId, fileId, linkId });
  },

  /**
   * Stub for Part 3: notify
   */
  notify: (
    userId: string,
    notification: { id: string; type: string; message: string; createdAt: string }
  ): void => {
    if (!ioInstance) return;
    logger.debug({ userId, notificationId: notification.id }, 'Emitting notification:new');
    ioInstance.to(`user:${userId}`).emit('notification:new', notification);
  },
};
