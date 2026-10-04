import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { db, pool } from '../src/db/pool';
import { runMigrations } from '../src/db/migrate';
import { storage } from '../src/storage/S3Adapter';

describe('File Pipeline Security & Validation Tests (Spec §5.3, §5.4, §7.7)', () => {
  let ownerToken: string;
  let ownerId: string;
  let editorToken: string;
  let editorId: string;
  let viewerToken: string;
  let roomId: string;

  beforeAll(async () => {
    await runMigrations();
    await storage.ensureBucket();

    async function createUser(username: string, email: string) {
      const password = 'StrongPassword!2026';
      await request(app).post('/api/auth/register').send({ email, username, password });
      const loginRes = await request(app).post('/api/auth/login').send({ identifier: email, password });
      return { id: loginRes.body.user.id, token: loginRes.body.accessToken };
    }

    const owner = await createUser('file_owner', 'file_owner@files-test.privora.local');
    ownerToken = owner.token;
    ownerId = owner.id;

    const editor = await createUser('file_editor', 'file_editor@files-test.privora.local');
    editorToken = editor.token;
    editorId = editor.id;

    const viewer = await createUser('file_viewer', 'file_viewer@files-test.privora.local');
    viewerToken = viewer.token;

    // Owner creates room and adds members
    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'File Pipeline Test Room' });

    roomId = roomRes.body.room.id;

    await request(app)
      .post(`/api/rooms/${roomId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ identifier: 'file_editor@files-test.privora.local', role: 'editor' });

    await request(app)
      .post(`/api/rooms/${roomId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ identifier: 'file_viewer@files-test.privora.local', role: 'viewer' });
  });

  afterAll(async () => {
    const fileKeys = await db.query(
      "SELECT storage_key FROM files WHERE room_id IN (SELECT id FROM rooms WHERE owner_id IN (SELECT id FROM users WHERE email LIKE '%@files-test.privora.local'))"
    );
    for (const row of fileKeys.rows) {
      try { await storage.deleteObject(row.storage_key); } catch {}
    }
    await db.query("DELETE FROM rooms WHERE owner_id IN (SELECT id FROM users WHERE email LIKE '%@files-test.privora.local')");
    await db.query("DELETE FROM users WHERE email LIKE '%@files-test.privora.local'");
    await pool.end();
  });

  // Valid 1x1 PNG buffer
  const validPngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  describe('Upload File Validation (§7.7)', () => {
    it('Viewer role is forbidden from uploading files (403)', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/files`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .attach('file', validPngBuffer, 'sample.png');

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('Editor role can upload a valid file', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/files`)
        .set('Authorization', `Bearer ${editorToken}`)
        .attach('file', validPngBuffer, 'avatar.png');

      expect(res.status).toBe(201);
      expect(res.body.file).toBeDefined();
      expect(res.body.file.name).toBe('avatar.png');
      expect(res.body.file.detectedType).toBe('image/png');
      expect(res.body.file.uploaderId).toBe(editorId);
    });

    it('Rejects disguised executable renamed to PNG (magic bytes mismatch)', async () => {
      // Fake Windows PE executable header MZ
      const fakeExeBuffer = Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00');
      const res = await request(app)
        .post(`/api/rooms/${roomId}/files`)
        .set('Authorization', `Bearer ${editorToken}`)
        .attach('file', fakeExeBuffer, 'innocent_photo.png');

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/magic bytes|mismatch|unable to determine|forbidden/i);
    });

    it('Rejects dangerous blocked extensions (.html, .svg, .exe)', async () => {
      const htmlBuffer = Buffer.from('<html><body><script>alert(1)</script></body></html>');
      const res = await request(app)
        .post(`/api/rooms/${roomId}/files`)
        .set('Authorization', `Bearer ${editorToken}`)
        .attach('file', htmlBuffer, 'index.html');

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/prohibited|not allowed/i);
    });

    it('Rejects double extension attacks (e.g. invoice.pdf.exe)', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/files`)
        .set('Authorization', `Bearer ${editorToken}`)
        .attach('file', validPngBuffer, 'invoice.pdf.exe');

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/prohibited|double extension/i);
    });

    it('Rejects text file with binary null bytes', async () => {
      const malformedText = Buffer.from('Hello world\x00hidden binary code\x00');
      const res = await request(app)
        .post(`/api/rooms/${roomId}/files`)
        .set('Authorization', `Bearer ${editorToken}`)
        .attach('file', malformedText, 'notes.txt');

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/null bytes/i);
    });
  });

  describe('Download & Deletion Hardening (§5.4, §7.8)', () => {
    let uploadedFileId: string;

    beforeAll(async () => {
      const uploadRes = await request(app)
        .post(`/api/rooms/${roomId}/files`)
        .set('Authorization', `Bearer ${editorToken}`)
        .attach('file', validPngBuffer, 'secure_document.png');

      uploadedFileId = uploadRes.body.file.id;
    });

    it('Viewer can download file with safe HTTP headers', async () => {
      const res = await request(app)
        .get(`/api/rooms/${roomId}/files/${uploadedFileId}/download`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/octet-stream');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['content-disposition']).toContain("filename*=UTF-8''secure_document.png");
      expect(res.body).toEqual(validPngBuffer);
    });

    it('Viewer CANNOT delete file (403)', async () => {
      const res = await request(app)
        .delete(`/api/rooms/${roomId}/files/${uploadedFileId}`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(403);
    });

    it('Owner CAN delete any file in room (200)', async () => {
      const res = await request(app)
        .delete(`/api/rooms/${roomId}/files/${uploadedFileId}`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('File deleted successfully');

      // Subsequent download returns 404
      const downloadRes = await request(app)
        .get(`/api/rooms/${roomId}/files/${uploadedFileId}/download`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(downloadRes.status).toBe(404);
    });
  });
});
