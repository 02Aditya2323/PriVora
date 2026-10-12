import { useEffect, useState, useRef } from 'react';
import { io as createSocket, Socket } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { VaultFile } from '../api/types';

interface PresenceUser {
  userId: string;
  username: string;
}

interface UseSocketOptions {
  roomId?: string;
  onFileUploaded?: (file: VaultFile) => void;
  onFileDeleted?: (fileId: string) => void;
  onMemberChanged?: () => void;
  onRoomAccessRevoked?: (roomId: string) => void;
}

export function useSocket({
  roomId,
  onFileUploaded,
  onFileDeleted,
  onMemberChanged,
  onRoomAccessRevoked,
}: UseSocketOptions = {}) {
  const { token, logout } = useAuth();
  const [connected, setConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!token) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setConnected(false);
      setOnlineUsers([]);
      return;
    }

    const socket = createSocket('/', {
      auth: { token },
      transports: ['websocket'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      if (roomId) {
        socket.emit('room:join', { roomId });
      }
    });

    socket.on('disconnect', () => {
      setConnected(false);
      setOnlineUsers([]);
    });

    // Real-time Presence
    socket.on('presence:snapshot', (data: { roomId: string; users: PresenceUser[] }) => {
      if (data.roomId === roomId) {
        setOnlineUsers(data.users);
      }
    });

    socket.on(
      'presence:update',
      (data: { roomId: string; userId: string; username: string; status: 'online' | 'offline' }) => {
        if (data.roomId !== roomId) return;

        setOnlineUsers((prev) => {
          if (data.status === 'online') {
            if (prev.some((u) => u.userId === data.userId)) return prev;
            return [...prev, { userId: data.userId, username: data.username }];
          } else {
            return prev.filter((u) => u.userId !== data.userId);
          }
        });
      }
    );

    // File events
    socket.on('file:uploaded', (data: { roomId: string; file: VaultFile }) => {
      if (data.roomId === roomId && onFileUploaded) {
        onFileUploaded(data.file);
      }
    });

    socket.on('file:deleted', (data: { roomId: string; fileId: string }) => {
      if (data.roomId === roomId && onFileDeleted) {
        onFileDeleted(data.fileId);
      }
    });

    // Membership events
    socket.on('member:added', () => onMemberChanged?.());
    socket.on('member:removed', () => onMemberChanged?.());
    socket.on('member:role_changed', () => onMemberChanged?.());

    // Security Revocations
    socket.on('room:access_revoked', (data: { roomId: string }) => {
      if (data.roomId === roomId && onRoomAccessRevoked) {
        onRoomAccessRevoked(data.roomId);
      }
    });

    socket.on('session:expired', async () => {
      await api.refreshToken();
    });

    socket.on('session:revoked', () => {
      logout();
    });

    return () => {
      if (roomId) {
        socket.emit('room:leave', { roomId });
      }
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, roomId]);

  return {
    socket: socketRef.current,
    connected,
    onlineUsers,
  };
}
