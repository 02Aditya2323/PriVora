import { User, Room, RoomMember, VaultFile, RoomJoinKey, FileShareLink } from './types';

class ApiClient {
  private inMemoryAccessToken: string | null = null;
  private refreshPromise: Promise<string | null> | null = null;

  setToken(token: string | null) {
    this.inMemoryAccessToken = token;
  }

  getToken(): string | null {
    return this.inMemoryAccessToken;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers || {});

    // Attach in-memory Bearer token
    if (this.inMemoryAccessToken && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${this.inMemoryAccessToken}`);
    }

    // Always include credentials for cookies (refresh token)
    const config: RequestInit = {
      ...options,
      headers,
      credentials: 'include',
    };

    let response = await fetch(endpoint, config);

    // Silent refresh on 401 Unauthorized (unless the failed request was already refresh or login)
    if (response.status === 401 && !endpoint.includes('/api/auth/login') && !endpoint.includes('/api/auth/register')) {
      const newToken = await this.refreshToken();
      if (newToken) {
        headers.set('Authorization', `Bearer ${newToken}`);
        response = await fetch(endpoint, {
          ...options,
          headers,
          credentials: 'include',
        });
      }
    }

    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch {
        errorData = { error: { code: 'HTTP_ERROR', message: `Request failed with status ${response.status}` } };
      }
      throw errorData;
    }

    // Check if response has body (e.g. 204 or file stream)
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return (await response.json()) as T;
    }
    return null as unknown as T;
  }

  /**
   * Refreshes the access token using the HTTP-only cookie.
   * Utilizes a single in-flight promise to prevent concurrent rotation collisions.
   */
  async refreshToken(): Promise<string | null> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
          },
          credentials: 'include',
        });

        if (!res.ok) {
          this.setToken(null);
          return null;
        }

        const data = await res.json();
        this.setToken(data.accessToken);
        return data.accessToken;
      } catch {
        this.setToken(null);
        return null;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  // --- Auth APIs ---
  async login(identifier: string, password: string) {
    const data = await this.request<{ user: User; accessToken: string }>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });
    this.setToken(data.accessToken);
    return data;
  }

  async register(email: string, username: string, password: string) {
    return this.request<{ user: User }>('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, username, password }),
    });
  }

  async logout() {
    try {
      await this.request<{ message: string }>('/api/auth/logout', {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
    } finally {
      this.setToken(null);
    }
  }

  async getMe() {
    return this.request<{ user: User }>('/api/auth/me');
  }

  // --- Rooms APIs ---
  async getRooms() {
    return this.request<{ rooms: Room[] }>('/api/rooms');
  }

  async createRoom(name: string) {
    return this.request<{ room: Room }>('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  }

  async getRoom(roomId: string) {
    return this.request<{ room: Room }>(`/api/rooms/${roomId}`);
  }

  async deleteRoom(roomId: string) {
    return this.request<{ message: string }>(`/api/rooms/${roomId}`, {
      method: 'DELETE',
    });
  }

  async getRoomMembers(roomId: string) {
    return this.request<{ members: RoomMember[] }>(`/api/rooms/${roomId}/members`);
  }

  async addRoomMember(roomId: string, identifier: string, role: 'editor' | 'viewer') {
    return this.request<{ member: RoomMember }>(`/api/rooms/${roomId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, role }),
    });
  }

  async updateMemberRole(roomId: string, userId: string, role: 'editor' | 'viewer') {
    return this.request<{ member: { userId: string; role: string } }>(
      `/api/rooms/${roomId}/members/${userId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      }
    );
  }

  async removeMember(roomId: string, userId: string) {
    return this.request<{ message: string }>(`/api/rooms/${roomId}/members/${userId}`, {
      method: 'DELETE',
    });
  }

  // --- Files APIs ---
  async getRoomFiles(roomId: string) {
    return this.request<{ files: VaultFile[] }>(`/api/rooms/${roomId}/files`);
  }

  async uploadFile(roomId: string, file: File) {
    const formData = new FormData();
    formData.append('file', file);

    const headers = new Headers();
    if (this.inMemoryAccessToken) {
      headers.set('Authorization', `Bearer ${this.inMemoryAccessToken}`);
    }

    const response = await fetch(`/api/rooms/${roomId}/files`, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
    });

    if (!response.ok) {
      const err = await response.json();
      throw err;
    }

    return (await response.json()) as { file: VaultFile };
  }

  async downloadFile(roomId: string, fileId: string, filename: string) {
    const headers = new Headers();
    if (this.inMemoryAccessToken) {
      headers.set('Authorization', `Bearer ${this.inMemoryAccessToken}`);
    }

    const response = await fetch(`/api/rooms/${roomId}/files/${fileId}/download`, {
      headers,
      credentials: 'include',
    });

    if (!response.ok) {
      const err = await response.json();
      throw err;
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }

  async deleteFile(roomId: string, fileId: string) {
    return this.request<{ message: string }>(`/api/rooms/${roomId}/files/${fileId}`, {
      method: 'DELETE',
    });
  }

  // --- Room Join Keys APIs ---
  async joinRoomWithKey(key: string, password?: string) {
    return this.request<{ room: Room; alreadyMember: boolean }>('/api/rooms/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, password }),
    });
  }

  async createRoomJoinKey(
    roomId: string,
    options: { role?: 'editor' | 'viewer'; expiresInHours?: number; maxUses?: number; password?: string }
  ) {
    return this.request<{ joinKey: RoomJoinKey }>(`/api/rooms/${roomId}/join-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
  }

  async getRoomJoinKeys(roomId: string) {
    return this.request<{ joinKeys: RoomJoinKey[] }>(`/api/rooms/${roomId}/join-keys`);
  }

  async revokeRoomJoinKey(roomId: string, keyId: string) {
    return this.request<{ message: string }>(`/api/rooms/${roomId}/join-keys/${keyId}`, {
      method: 'DELETE',
    });
  }

  // --- File Share Links APIs ---
  async createFileShareLink(
    roomId: string,
    fileId: string,
    options: { expiresInMinutes?: number; maxDownloads?: number; password?: string }
  ) {
    return this.request<{ shareLink: FileShareLink }>(`/api/rooms/${roomId}/files/${fileId}/share-links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
  }

  async getFileShareLinks(roomId: string, fileId: string) {
    return this.request<{ shareLinks: FileShareLink[] }>(`/api/rooms/${roomId}/files/${fileId}/share-links`);
  }

  async revokeFileShareLink(roomId: string, linkId: string) {
    return this.request<{ message: string }>(`/api/rooms/${roomId}/share-links/${linkId}`, {
      method: 'DELETE',
    });
  }

  async getShareMeta(key: string) {
    return this.request<{ file: any }>(`/api/s/${key}/meta`);
  }

  async downloadSharedFile(key: string, filename: string, password?: string) {
    const response = await fetch(`/api/s/${key}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw err;
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }
}

export const api = new ApiClient();
