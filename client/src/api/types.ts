export type RoomRole = 'owner' | 'editor' | 'viewer';

export interface User {
  id: string;
  email: string;
  username: string;
  globalRole: string;
  createdAt?: string;
  lastLoginAt?: string;
}

export interface Room {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  role: RoomRole;
  joinedAt: string;
}

export interface RoomMember {
  userId: string;
  username: string;
  email: string;
  role: RoomRole;
  joinedAt: string;
  addedBy?: string;
}

export interface VaultFile {
  id: string;
  name: string;
  size: number;
  detectedType: string;
  sha256?: string;
  uploaderId: string;
  uploaderUsername?: string;
  createdAt: string;
}

export interface RoomJoinKey {
  id: string;
  roomId?: string;
  role: 'editor' | 'viewer';
  expiresAt: string;
  maxUses: number | null;
  useCount: number;
  createdAt: string;
  requiresPassword: boolean;
  key?: string;
}

export interface FileShareLink {
  id: string;
  roomId?: string;
  fileId?: string;
  expiresAt: string;
  maxDownloads: number | null;
  downloadCount: number;
  createdAt: string;
  requiresPassword: boolean;
  key?: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}
