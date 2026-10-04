import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { db, pool } from '../src/db/pool';
import { runMigrations } from '../src/db/migrate';
import { storage } from '../src/storage/S3Adapter';

describe('Room Join Keys & File Share Keys Security Tests (Spec §5.5, §7.9)', () => {
  let ownerToken: string;
  let ownerId: string;
  let userBToken: string;
  let userBId: string;
  let userCToken: string;
  let roomId: string;
  let fileId: string;

  beforeAll(async () => {
    await runMigrations();
    await storage.ensureBucket();

    async function createUser(username: string, email: string) {
      const password = 'StrongPassword!2026';
      await request(app).post('/api/auth/register').send({ email, username, password });
      const loginRes = await request(app).post('/api/auth/login').send({ identifier: email, password });
      return { id: loginRes.body.user.id, token: loginRes.body.accessToken };
    }

    const owner = await createUser('key_owner', 'key_owner@keys-test.privora.local');
    ownerToken = owner.token;
    ownerId = owner.id;

    const userB = await createUser('key_user_b', 'key_user_b@keys-test.privora.local');
    userBToken = userB.token;
    userBId = userB.id;

    const userC = await createUser('key_user_c', 'key_user_c@keys-test.privora.local');
    userCToken = userC.token;

    // Owner creates room
    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Keys Security Vault' });

    roomId = roomRes.body.room.id;

    // Owner uploads a sample file
    const sampleBuffer = Buffer.from('Privora secure file content for share keys');
    const uploadRes = await request(app)
      .post(`/api/rooms/${roomId}/files`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('file', sampleBuffer, 'contract.txt');

    fileId = uploadRes.body.file.id;
  });

  afterAll(async () => {
    const fileKeys = await db.query(
      "SELECT storage_key FROM files WHERE room_id IN (SELECT id FROM rooms WHERE owner_id IN (SELECT id FROM users WHERE email LIKE '%@keys-test.privora.local'))"
    );
    for (const row of fileKeys.rows) {
      try { await storage.deleteObject(row.storage_key); } catch {}
    }
    await db.query("DELETE FROM rooms WHERE owner_id IN (SELECT id FROM users WHERE email LIKE '%@keys-test.privora.local')");
    await db.query("DELETE FROM users WHERE email LIKE '%@keys-test.privora.local'");
    await pool.end();
  });

  describe('1. Room Join on Keys Flow', () => {
    let joinKey: string;
    let passwordProtectedKey: string;
    let singleUseKey: string;

    it('Owner can generate a room join key with viewer role', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/join-keys`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ role: 'viewer', expiresInHours: 24 });

      expect(res.status).toBe(201);
      expect(res.body.joinKey.key).toBeDefined();
      expect(res.body.joinKey.role).toBe('viewer');
      joinKey = res.body.joinKey.key;
    });

    it('Non-member CANNOT generate a join key (404 / IDOR protection)', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/join-keys`)
        .set('Authorization', `Bearer ${userBToken}`)
        .send({ role: 'viewer' });

      expect(res.status).toBe(404);
    });

    it('User B can join room using the join key', async () => {
      const res = await request(app)
        .post('/api/rooms/join')
        .set('Authorization', `Bearer ${userBToken}`)
        .send({ key: joinKey });

      expect(res.status).toBe(200);
      expect(res.body.room.id).toBe(roomId);
      expect(res.body.room.role).toBe('viewer');

      // Verify User B is now in member list
      const memberCheck = await request(app)
        .get(`/api/rooms/${roomId}/members`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(memberCheck.body.members.some((m: any) => m.userId === userBId)).toBe(true);
    });

    it('Supports password-protected room join keys with Argon2id', async () => {
      const createRes = await request(app)
        .post(`/api/rooms/${roomId}/join-keys`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ role: 'editor', password: 'SecretRoomPassword!123' });

      passwordProtectedKey = createRes.body.joinKey.key;

      // Attempt join without password -> 400
      const noPassRes = await request(app)
        .post('/api/rooms/join')
        .set('Authorization', `Bearer ${userCToken}`)
        .send({ key: passwordProtectedKey });

      expect(noPassRes.status).toBe(400);
      expect(noPassRes.body.error.code).toBe('PASSWORD_REQUIRED');

      // Attempt join with wrong password -> 401
      const wrongPassRes = await request(app)
        .post('/api/rooms/join')
        .set('Authorization', `Bearer ${userCToken}`)
        .send({ key: passwordProtectedKey, password: 'WrongPassword999' });

      expect(wrongPassRes.status).toBe(401);
      expect(wrongPassRes.body.error.code).toBe('INVALID_KEY_PASSWORD');

      // Join with correct password -> 200
      const correctRes = await request(app)
        .post('/api/rooms/join')
        .set('Authorization', `Bearer ${userCToken}`)
        .send({ key: passwordProtectedKey, password: 'SecretRoomPassword!123' });

      expect(correctRes.status).toBe(200);
      expect(correctRes.body.room.role).toBe('editor');
    });

    it('Enforces max usage cap on join keys (single-use key exhaustion)', async () => {
      const createRes = await request(app)
        .post(`/api/rooms/${roomId}/join-keys`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ maxUses: 1, role: 'viewer' });

      singleUseKey = createRes.body.joinKey.key;

      // User C joins (already member, but increments counter)
      const res1 = await request(app)
        .post('/api/rooms/join')
        .set('Authorization', `Bearer ${userCToken}`)
        .send({ key: singleUseKey });

      expect(res1.status).toBe(200);

      // Next user attempting to use exhausted key receives uniform 404
      const res2 = await request(app)
        .post('/api/rooms/join')
        .set('Authorization', `Bearer ${userBToken}`)
        .send({ key: singleUseKey });

      expect(res2.status).toBe(404);
      expect(res2.body.error.code).toMatch(/INVALID_JOIN_KEY|JOIN_KEY_EXHAUSTED/);
    });
  });

  describe('2. Secure File Share Keys Flow (§5.5, §7.9)', () => {
    let fileShareKey: string;

    it('Owner can generate public file share key', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/files/${fileId}/share-links`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ expiresInMinutes: 60, maxDownloads: 2 });

      expect(res.status).toBe(201);
      expect(res.body.shareLink.key).toBeDefined();
      fileShareKey = res.body.shareLink.key;
    });

    it('Public client can inspect file metadata at /api/s/:key/meta without auth', async () => {
      const res = await request(app).get(`/api/s/${fileShareKey}/meta`);
      expect(res.status).toBe(200);
      expect(res.body.file.name).toBe('contract.txt');
      expect(res.body.file.requiresPassword).toBe(false);
    });

    it('Public client can download decrypted file with atomic download count update', async () => {
      const res = await request(app).post(`/api/s/${fileShareKey}/download`).send({});
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/octet-stream');
      expect(res.body.toString()).toBe('Privora secure file content for share keys');
    });

    it('Reaching max downloads invalidates link with uniform 404', async () => {
      // 2nd download succeeds (max = 2)
      const res2 = await request(app).post(`/api/s/${fileShareKey}/download`).send({});
      expect(res2.status).toBe(200);

      // 3rd download exceeds cap -> uniform 404
      const res3 = await request(app).post(`/api/s/${fileShareKey}/download`).send({});
      expect(res3.status).toBe(404);
    });
  });
});
