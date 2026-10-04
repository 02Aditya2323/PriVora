import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import request from 'supertest';
import { httpServer, io } from '../src/server';
import { app } from '../src/app';
import { db, pool } from '../src/db/pool';
import { runMigrations } from '../src/db/migrate';
import { AddressInfo } from 'net';

describe('WebSocket Signaling & Presence Security Tests (Spec §8.1-§8.7)', () => {
  let serverPort: number;
  let serverUrl: string;

  let ownerToken: string;
  let ownerId: string;
  let memberToken: string;
  let memberId: string;
  let nonMemberToken: string;

  let roomId: string;

  beforeAll(async () => {
    await runMigrations();

    // Start HTTP server on dynamic port
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address() as AddressInfo;
        serverPort = addr.port;
        serverUrl = `http://localhost:${serverPort}`;
        resolve();
      });
    });

    async function createUser(username: string, email: string) {
      const password = 'StrongPassword!2026';
      await request(app).post('/api/auth/register').send({ email, username, password });
      const loginRes = await request(app).post('/api/auth/login').send({ identifier: email, password });
      return { id: loginRes.body.user.id, token: loginRes.body.accessToken };
    }

    const owner = await createUser('ws_owner', 'ws_owner@socket-test.privora.local');
    ownerToken = owner.token;
    ownerId = owner.id;

    const member = await createUser('ws_member', 'ws_member@socket-test.privora.local');
    memberToken = member.token;
    memberId = member.id;

    const nonMember = await createUser('ws_nonmember', 'ws_nonmember@socket-test.privora.local');
    nonMemberToken = nonMember.token;

    // Owner creates room and adds member
    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Socket Signaling Room' });

    roomId = roomRes.body.room.id;

    await request(app)
      .post(`/api/rooms/${roomId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ identifier: 'ws_member@socket-test.privora.local', role: 'editor' });
  });

  afterAll(async () => {
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await db.query("DELETE FROM rooms WHERE owner_id IN (SELECT id FROM users WHERE email LIKE '%@socket-test.privora.local')");
    await db.query("DELETE FROM users WHERE email LIKE '%@socket-test.privora.local'");
    await pool.end();
  });

  describe('Handshake Authentication (§8.2)', () => {
    it('Refuses connection when no token is supplied in handshake', async () => {
      const socket = ClientSocket(serverUrl, {
        transports: ['websocket'],
        autoConnect: false,
      });

      const errorPromise = new Promise((resolve) => {
        socket.on('connect_error', (err) => resolve(err.message));
      });

      socket.connect();
      const msg = await errorPromise;
      expect(msg).toMatch(/authentication/i);
      socket.disconnect();
    });

    it('Refuses connection when an invalid/tampered token is supplied', async () => {
      const socket = ClientSocket(serverUrl, {
        auth: { token: 'invalid.forged.jwt' },
        transports: ['websocket'],
        autoConnect: false,
      });

      const errorPromise = new Promise((resolve) => {
        socket.on('connect_error', (err) => resolve(err.message));
      });

      socket.connect();
      const msg = await errorPromise;
      expect(msg).toMatch(/authentication/i);
      socket.disconnect();
    });

    it('Successfully authenticates with valid JWT and joins personal user room', async () => {
      const socket = ClientSocket(serverUrl, {
        auth: { token: ownerToken },
        transports: ['websocket'],
      });

      await new Promise<void>((resolve) => socket.on('connect', () => resolve()));
      expect(socket.connected).toBe(true);
      socket.disconnect();
    });
  });

  describe('Room Join Authorization & Presence (§8.3, §8.6)', () => {
    let ownerSocket: ClientSocketType;
    let memberSocket: ClientSocketType;
    let nonMemberSocket: ClientSocketType;

    afterEach(() => {
      ownerSocket?.disconnect();
      memberSocket?.disconnect();
      nonMemberSocket?.disconnect();
    });

    it('Refuses room:join if user is NOT a member of the room', async () => {
      nonMemberSocket = ClientSocket(serverUrl, {
        auth: { token: nonMemberToken },
        transports: ['websocket'],
      });
      await new Promise<void>((resolve) => nonMemberSocket.on('connect', () => resolve()));

      const errorPromise = new Promise((resolve) => {
        nonMemberSocket.on('error', (err) => resolve(err));
      });

      nonMemberSocket.emit('room:join', { roomId });
      const errResponse: any = await errorPromise;

      expect(errResponse.code).toBe('ROOM_ACCESS_DENIED');
    });

    it('Member room:join receives presence:snapshot and broadcasts online presence:update', async () => {
      ownerSocket = ClientSocket(serverUrl, {
        auth: { token: ownerToken },
        transports: ['websocket'],
      });
      await new Promise<void>((resolve) => ownerSocket.on('connect', () => resolve()));

      // Owner joins first
      const ownerSnapshotPromise = new Promise<any>((resolve) => {
        ownerSocket.on('presence:snapshot', (data) => resolve(data));
      });
      ownerSocket.emit('room:join', { roomId });
      const ownerSnapshot = await ownerSnapshotPromise;

      expect(ownerSnapshot.roomId).toBe(roomId);
      expect(ownerSnapshot.users.some((u: any) => u.userId === ownerId)).toBe(true);

      // Now member joins; owner should receive presence:update { status: 'online' }
      memberSocket = ClientSocket(serverUrl, {
        auth: { token: memberToken },
        transports: ['websocket'],
      });
      await new Promise<void>((resolve) => memberSocket.on('connect', () => resolve()));

      const presenceUpdatePromise = new Promise<any>((resolve) => {
        ownerSocket.on('presence:update', (data) => resolve(data));
      });

      memberSocket.emit('room:join', { roomId });
      const presenceUpdate = await presenceUpdatePromise;

      expect(presenceUpdate.roomId).toBe(roomId);
      expect(presenceUpdate.userId).toBe(memberId);
      expect(presenceUpdate.status).toBe('online');
    });
  });

  describe('Revocation Signalling (§8.4)', () => {
    it('Triggers room:access_revoked when member is removed from room', async () => {
      const socket = ClientSocket(serverUrl, {
        auth: { token: memberToken },
        transports: ['websocket'],
      });
      await new Promise<void>((resolve) => socket.on('connect', () => resolve()));
      socket.emit('room:join', { roomId });

      const revokedPromise = new Promise<any>((resolve) => {
        socket.on('room:access_revoked', (data) => resolve(data));
      });

      // Owner removes member via REST API
      const delRes = await request(app)
        .delete(`/api/rooms/${roomId}/members/${memberId}`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(delRes.status).toBe(200);

      const revokedData = await revokedPromise;
      expect(revokedData.roomId).toBe(roomId);

      socket.disconnect();
    });
  });
});
