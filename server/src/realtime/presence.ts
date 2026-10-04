/**
 * In-memory Presence Manager (Spec §8.6)
 * =====================================
 * Structure: Map<roomId, Map<userId, Set<socketId>>>
 * Multi-tab aware: A user is considered 'online' while their socket set is non-empty.
 * State resets on process restart (appropriate for single-instance v1 without Redis).
 */
export class PresenceManager {
  // roomId -> (userId -> Set<socketId>)
  private rooms = new Map<string, Map<string, Set<string>>>();
  // userId -> username cache
  private usernames = new Map<string, string>();
  // socketId -> Set<roomId>
  private socketRooms = new Map<string, Set<string>>();

  addUserSocket(
    roomId: string,
    userId: string,
    username: string,
    socketId: string
  ): { isFirstSocketForUser: boolean } {
    this.usernames.set(userId, username);

    // Track room for socket cleanup on disconnect
    if (!this.socketRooms.has(socketId)) {
      this.socketRooms.set(socketId, new Set());
    }
    this.socketRooms.get(socketId)!.add(roomId);

    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Map());
    }

    const roomUsers = this.rooms.get(roomId)!;
    if (!roomUsers.has(userId)) {
      roomUsers.set(userId, new Set());
    }

    const userSockets = roomUsers.get(userId)!;
    const isFirstSocketForUser = userSockets.size === 0;
    userSockets.add(socketId);

    return { isFirstSocketForUser };
  }

  removeUserSocket(
    roomId: string,
    userId: string,
    socketId: string
  ): { isLastSocketForUser: boolean } {
    const socketRoomsSet = this.socketRooms.get(socketId);
    if (socketRoomsSet) {
      socketRoomsSet.delete(roomId);
      if (socketRoomsSet.size === 0) {
        this.socketRooms.delete(socketId);
      }
    }

    const roomUsers = this.rooms.get(roomId);
    if (!roomUsers) {
      return { isLastSocketForUser: false };
    }

    const userSockets = roomUsers.get(userId);
    if (!userSockets) {
      return { isLastSocketForUser: false };
    }

    userSockets.delete(socketId);
    const isLastSocketForUser = userSockets.size === 0;

    if (isLastSocketForUser) {
      roomUsers.delete(userId);
      if (roomUsers.size === 0) {
        this.rooms.delete(roomId);
      }
    }

    return { isLastSocketForUser };
  }

  cleanupSocket(
    socketId: string,
    userId: string
  ): Array<{ roomId: string; userId: string; username: string; isLastSocket: boolean }> {
    const transitions: Array<{ roomId: string; userId: string; username: string; isLastSocket: boolean }> = [];
    const roomsSet = this.socketRooms.get(socketId);

    if (!roomsSet) {
      return transitions;
    }

    const username = this.usernames.get(userId) || 'Anonymous';

    for (const roomId of Array.from(roomsSet)) {
      const { isLastSocketForUser } = this.removeUserSocket(roomId, userId, socketId);
      if (isLastSocketForUser) {
        transitions.push({
          roomId,
          userId,
          username,
          isLastSocket: true,
        });
      }
    }

    this.socketRooms.delete(socketId);
    return transitions;
  }

  getOnlineUsersInRoom(roomId: string): Array<{ userId: string; username: string }> {
    const roomUsers = this.rooms.get(roomId);
    if (!roomUsers) {
      return [];
    }

    const result: Array<{ userId: string; username: string }> = [];
    for (const userId of roomUsers.keys()) {
      result.push({
        userId,
        username: this.usernames.get(userId) || 'User',
      });
    }
    return result;
  }
}

export const presence = new PresenceManager();
