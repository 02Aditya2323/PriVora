import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { db, pool } from '../src/db/pool';
import { runMigrations } from '../src/db/migrate';
import { storage } from '../src/storage/S3Adapter';

describe('Secure Share Keys & Concurrency Race Tests (Spec §5.5, §7.9, §12.1)', () => {
  let ownerToken: string;
  let editorToken: string;
  let viewerToken: string;
  let roomId: string;
  let fileId: string;

  beforeAll(async () => {
    await runMigrations();
    await storage.ensureBucket();

    // Clean up test data
    await db.query("DELETE FROM users WHERE email LIKE '%@share-race.privora.local'");

    async function createUser(username: string, email: string) {
      const password = 'StrongPassword!2026';
      await request(app).post('/api/auth/register').send({ email, username, password });
      const loginRes = await request(app).post('/api/auth/login').send({ identifier: email, password });
      return { id: loginRes.body.user.id, token: loginRes.body.accessToken };
    }

    const owner = await createUser('share_owner', 'share_owner@share-race.privora.local');
    ownerToken = owner.token;

    const editor = await createUser('share_editor', 'share_editor@share-race.privora.local');
    editorToken = editor.token;

    const viewer = await createUser('share_viewer', 'share_viewer@share-race.privora.local');
    viewerToken = viewer.token;

    // Create room
    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Share Race Room' });
    roomId = roomRes.body.room.id;

    // Add members
    await request(app)
      .post(`/api/rooms/${roomId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ identifier: 'share_editor@share-race.privora.local', role: 'editor' });

    await request(app)
      .post(`/api/rooms/${roomId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ identifier: 'share_viewer@share-race.privora.local', role: 'viewer' });

    // Upload file
    const sampleBuffer = Buffer.from('Privora high-concurrency race test file content');
    const uploadRes = await request(app)
      .post(`/api/rooms/${roomId}/files`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('file', sampleBuffer, 'financial_ledger.txt');

    fileId = uploadRes.body.file.id;
  });

  afterAll(async () => {
    const fileKeys = await db.query(
      "SELECT storage_key FROM files WHERE room_id IN (SELECT id FROM rooms WHERE owner_id IN (SELECT id FROM users WHERE email LIKE '%@share-race.privora.local'))"
    );
    for (const row of fileKeys.rows) {
      try { await storage.deleteObject(row.storage_key); } catch {}
    }
    await db.query("DELETE FROM rooms WHERE owner_id IN (SELECT id FROM users WHERE email LIKE '%@share-race.privora.local')");
    await db.query("DELETE FROM users WHERE email LIKE '%@share-race.privora.local'");
  });

  it('viewer cannot create share links (403 Forbidden)', async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomId}/files/${fileId}/share-links`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ expiresInMinutes: 60 });

    expect(res.status).toBe(403);
  });

  it('password-protected share key requires correct password to redeem', async () => {
    const createRes = await request(app)
      .post(`/api/rooms/${roomId}/files/${fileId}/share-links`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        expiresInMinutes: 60,
        maxDownloads: 5,
        password: 'PassPhraseProtection!2026',
      });

    expect(createRes.status).toBe(201);
    const key = createRes.body.shareLink.key;

    // Check meta
    const metaRes = await request(app).get(`/api/s/${key}/meta`);
    expect(metaRes.status).toBe(200);
    expect(metaRes.body.file.requiresPassword).toBe(true);

    // Download without password fails with 400
    const noPassRes = await request(app).post(`/api/s/${key}/download`).send({});
    expect(noPassRes.status).toBe(400);

    // Download with wrong password fails with 401
    const wrongPassRes = await request(app)
      .post(`/api/s/${key}/download`)
      .send({ password: 'WrongPasswordGuess!' });
    expect(wrongPassRes.status).toBe(401);

    // Download with correct password succeeds
    const correctPassRes = await request(app)
      .post(`/api/s/${key}/download`)
      .send({ password: 'PassPhraseProtection!2026' });
    expect(correctPassRes.status).toBe(200);
    expect(correctPassRes.body.toString()).toContain('Privora high-concurrency race test file content');
  });

  it('50 concurrent redeems on max_downloads = 1: exactly 1 succeeds (§12.1 race condition test)', async () => {
    // 1. Create a share link with max_downloads = 1
    const createRes = await request(app)
      .post(`/api/rooms/${roomId}/files/${fileId}/share-links`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        expiresInMinutes: 60,
        maxDownloads: 1,
      });

    expect(createRes.status).toBe(201);
    const singleUseKey = createRes.body.shareLink.key;
    const linkId = createRes.body.shareLink.id;

    // 2. Fire 50 simultaneous HTTP requests to download the file
    const concurrentRequests = Array.from({ length: 50 }, () =>
      request(app).post(`/api/s/${singleUseKey}/download`).send({})
    );

    const responses = await Promise.all(concurrentRequests);

    // 3. Count status codes
    const successResponses = responses.filter((r) => r.status === 200);
    const deniedResponses = responses.filter((r) => r.status === 404);

    expect(successResponses.length).toBe(1);
    expect(deniedResponses.length).toBe(49);

    // 4. Verify in DB that download_count is strictly 1
    const dbRes = await db.query('SELECT download_count FROM share_links WHERE id = $1', [linkId]);
    expect(Number(dbRes.rows[0].download_count)).toBe(1);
  });
});
