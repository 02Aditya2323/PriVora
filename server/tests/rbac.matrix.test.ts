import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { db, pool } from '../src/db/pool';
import { runMigrations } from '../src/db/migrate';

describe('RBAC Matrix Automated Verification (Spec §4.2, §7.3)', () => {
  let ownerToken: string;
  let ownerId: string;

  let editorToken: string;
  let editorId: string;

  let viewerToken: string;
  let viewerId: string;

  let targetUserId: string;
  let roomId: string;

  beforeAll(async () => {
    await runMigrations();

    // Helper to register and login user
    async function createUser(username: string, email: string) {
      const password = 'StrongPassword!2026';
      await request(app).post('/api/auth/register').send({ email, username, password });
      const loginRes = await request(app).post('/api/auth/login').send({ identifier: email, password });
      return {
        id: loginRes.body.user.id,
        token: loginRes.body.accessToken,
      };
    }

    const owner = await createUser('owner_user', 'owner@rbac-test.privora.local');
    ownerToken = owner.token;
    ownerId = owner.id;

    const editor = await createUser('editor_user', 'editor@rbac-test.privora.local');
    editorToken = editor.token;
    editorId = editor.id;

    const viewer = await createUser('viewer_user', 'viewer@rbac-test.privora.local');
    viewerToken = viewer.token;
    viewerId = viewer.id;

    const target = await createUser('target_user', 'target@rbac-test.privora.local');
    targetUserId = target.id;

    // Owner creates room
    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'RBAC Test Vault' });

    roomId = roomRes.body.room.id;

    // Owner adds editor and viewer
    await request(app)
      .post(`/api/rooms/${roomId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ identifier: 'editor@rbac-test.privora.local', role: 'editor' });

    await request(app)
      .post(`/api/rooms/${roomId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ identifier: 'viewer@rbac-test.privora.local', role: 'viewer' });
  });

  afterAll(async () => {
    await db.query("DELETE FROM rooms WHERE owner_id IN (SELECT id FROM users WHERE email LIKE '%@rbac-test.privora.local')");
    await db.query("DELETE FROM users WHERE email LIKE '%@rbac-test.privora.local'");
    await pool.end();
  });

  describe('View & Read Permissions', () => {
    it('Owner can view room details', async () => {
      const res = await request(app).get(`/api/rooms/${roomId}`).set('Authorization', `Bearer ${ownerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.room.role).toBe('owner');
    });

    it('Editor can view room details', async () => {
      const res = await request(app).get(`/api/rooms/${roomId}`).set('Authorization', `Bearer ${editorToken}`);
      expect(res.status).toBe(200);
      expect(res.body.room.role).toBe('editor');
    });

    it('Viewer can view room details', async () => {
      const res = await request(app).get(`/api/rooms/${roomId}`).set('Authorization', `Bearer ${viewerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.room.role).toBe('viewer');
    });
  });

  describe('Member Management Permissions', () => {
    it('Viewer CANNOT add members (403)', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/members`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ identifier: 'target@rbac-test.privora.local', role: 'viewer' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('Editor CANNOT add members (403)', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/members`)
        .set('Authorization', `Bearer ${editorToken}`)
        .send({ identifier: 'target@rbac-test.privora.local', role: 'viewer' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('Owner CAN add members (201)', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/members`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ identifier: 'target@rbac-test.privora.local', role: 'viewer' });

      expect(res.status).toBe(201);
      expect(res.body.member.userId).toBe(targetUserId);
    });

    it('Viewer CANNOT change member roles (403)', async () => {
      const res = await request(app)
        .patch(`/api/rooms/${roomId}/members/${targetUserId}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ role: 'editor' });

      expect(res.status).toBe(403);
    });

    it('Editor CANNOT change member roles (403)', async () => {
      const res = await request(app)
        .patch(`/api/rooms/${roomId}/members/${targetUserId}`)
        .set('Authorization', `Bearer ${editorToken}`)
        .send({ role: 'editor' });

      expect(res.status).toBe(403);
    });

    it('Owner CAN change member roles (200)', async () => {
      const res = await request(app)
        .patch(`/api/rooms/${roomId}/members/${targetUserId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ role: 'editor' });

      expect(res.status).toBe(200);
      expect(res.body.member.role).toBe('editor');
    });

    it('Editor CANNOT remove other members (403)', async () => {
      const res = await request(app)
        .delete(`/api/rooms/${roomId}/members/${targetUserId}`)
        .set('Authorization', `Bearer ${editorToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('Owner CAN remove members (200)', async () => {
      const res = await request(app)
        .delete(`/api/rooms/${roomId}/members/${targetUserId}`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
    });
  });

  describe('Room Deletion Permissions', () => {
    it('Viewer CANNOT delete room (403)', async () => {
      const res = await request(app).delete(`/api/rooms/${roomId}`).set('Authorization', `Bearer ${viewerToken}`);
      expect(res.status).toBe(403);
    });

    it('Editor CANNOT delete room (403)', async () => {
      const res = await request(app).delete(`/api/rooms/${roomId}`).set('Authorization', `Bearer ${editorToken}`);
      expect(res.status).toBe(403);
    });

    it('Owner CAN delete room (200)', async () => {
      const res = await request(app).delete(`/api/rooms/${roomId}`).set('Authorization', `Bearer ${ownerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Room deleted successfully');
    });
  });
});
