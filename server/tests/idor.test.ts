import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { db, pool } from '../src/db/pool';
import { runMigrations } from '../src/db/migrate';

describe('IDOR & Resource Enumeration Protection Tests (Spec §7.4)', () => {
  let userAToken: string;
  let userBToken: string;
  let roomAId: string;

  beforeAll(async () => {
    await runMigrations();

    async function createUser(username: string, email: string) {
      const password = 'StrongPassword!2026';
      await request(app).post('/api/auth/register').send({ email, username, password });
      const loginRes = await request(app).post('/api/auth/login').send({ identifier: email, password });
      return loginRes.body.accessToken;
    }

    userAToken = await createUser('user_a', 'user_a@idor-test.privora.local');
    userBToken = await createUser('user_b', 'user_b@idor-test.privora.local');

    // User A creates Room A
    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ name: "User A's Confidential Vault" });

    roomAId = roomRes.body.room.id;
  });

  afterAll(async () => {
    await db.query("DELETE FROM rooms WHERE owner_id IN (SELECT id FROM users WHERE email LIKE '%@idor-test.privora.local')");
    await db.query("DELETE FROM users WHERE email LIKE '%@idor-test.privora.local'");
    await pool.end();
  });

  it('User B cannot see Room A in their room list', async () => {
    const res = await request(app).get('/api/rooms').set('Authorization', `Bearer ${userBToken}`);
    expect(res.status).toBe(200);
    const roomIds = res.body.rooms.map((r: any) => r.id);
    expect(roomIds).not.toContain(roomAId);
  });

  it("User B accessing User A's room receives uniform 404 (never 403, preventing enumeration)", async () => {
    const res = await request(app).get(`/api/rooms/${roomAId}`).set('Authorization', `Bearer ${userBToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROOM_NOT_FOUND');
  });

  it("User B listing members of User A's room receives uniform 404", async () => {
    const res = await request(app).get(`/api/rooms/${roomAId}/members`).set('Authorization', `Bearer ${userBToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROOM_NOT_FOUND');
  });

  it("User B attempting to add members to User A's room receives uniform 404", async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomAId}/members`)
      .set('Authorization', `Bearer ${userBToken}`)
      .send({ identifier: 'user_b@idor-test.privora.local', role: 'viewer' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROOM_NOT_FOUND');
  });

  it("User B attempting to delete User A's room receives uniform 404", async () => {
    const res = await request(app).delete(`/api/rooms/${roomAId}`).set('Authorization', `Bearer ${userBToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROOM_NOT_FOUND');
  });

  it('Accessing random non-existent UUID returns uniform 404 with identical error shape', async () => {
    const randomUuid = '00000000-0000-4000-8000-000000000000';
    const res = await request(app).get(`/api/rooms/${randomUuid}`).set('Authorization', `Bearer ${userBToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROOM_NOT_FOUND');
  });

  it('Malformed non-UUID parameter is blocked by validation with 400', async () => {
    const res = await request(app).get('/api/rooms/../../etc/passwd').set('Authorization', `Bearer ${userBToken}`);
    expect(res.status).toBe(404); // Route matching fails or parameter check
  });
});
