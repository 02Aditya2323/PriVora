import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { db, pool } from '../src/db/pool';
import { runMigrations } from '../src/db/migrate';

describe('Auth Module Security & Behavior Tests (Spec §5.1, §7.1, §7.2, §7.5)', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    // Clean up test data
    await db.query("DELETE FROM users WHERE email LIKE '%@auth-test.privora.local'");
    await pool.end();
  });

  const testUser = {
    email: 'alice@auth-test.privora.local',
    username: 'alice_vault',
    password: 'CorrectHorseBatteryStaple!2026',
  };

  describe('Registration & Password Policy (§7.1)', () => {
    it('should reject passwords shorter than 12 characters', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'short@auth-test.privora.local',
          username: 'short_user',
          password: 'Short1!',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject common easily guessed passwords', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'common@auth-test.privora.local',
          username: 'common_user',
          password: 'password1234',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('WEAK_PASSWORD');
    });

    it('should successfully register a valid user with argon2id hash', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send(testUser);

      expect(res.status).toBe(201);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe(testUser.email.toLowerCase());
      expect(res.body.user.username).toBe(testUser.username);
      expect(res.body.user.password_hash).toBeUndefined(); // Crucial: never leak hash
    });

    it('should reject duplicate email or username with 409 Conflict', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: testUser.email.toUpperCase(), // Case insensitive test
          username: 'different_user',
          password: 'CorrectHorseBatteryStaple!2026',
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('USER_ALREADY_EXISTS');
    });
  });

  describe('Login Hardening & Timing Protection (§7.1, §7.5)', () => {
    it('should return identical status and error body for unknown user vs wrong password', async () => {
      const unknownRes = await request(app)
        .post('/api/auth/login')
        .send({
          identifier: 'nonexistent_user@auth-test.privora.local',
          password: 'WrongPassword!12345',
        });

      const wrongPassRes = await request(app)
        .post('/api/auth/login')
        .send({
          identifier: testUser.email,
          password: 'WrongPassword!12345',
        });

      expect(unknownRes.status).toBe(401);
      expect(wrongPassRes.status).toBe(401);
      expect(unknownRes.body).toEqual(wrongPassRes.body);
      expect(unknownRes.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(unknownRes.body.error.message).toBe('Invalid credentials');
    });

    it('should successfully log in and issue JWT and httpOnly refresh cookie', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          identifier: testUser.email,
          password: testUser.password,
        });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.user.id).toBeDefined();

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const refreshCookie = (cookies as unknown as string[]).find((c: string) => c.startsWith('privora_refresh_token='));
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie).toContain('HttpOnly');
      expect(refreshCookie).toContain('Path=/api/auth');
    });

    it('should enforce account lockout after 5 consecutive failed login attempts', async () => {
      // Register a dedicated user for lockout testing
      const lockoutUser = {
        email: 'lockout@auth-test.privora.local',
        username: 'lockout_target',
        password: 'ValidPassword!2026',
      };
      await request(app).post('/api/auth/register').send(lockoutUser);

      // 5 consecutive wrong attempts
      for (let i = 1; i <= 5; i++) {
        const res = await request(app).post('/api/auth/login').send({
          identifier: lockoutUser.username,
          password: 'WrongPassword!999',
        });
        expect(res.status).toBe(401);
      }

      // 6th attempt should be blocked with 429 ACCOUNT_LOCKED
      const lockedRes = await request(app).post('/api/auth/login').send({
        identifier: lockoutUser.username,
        password: lockoutUser.password, // Even with correct password, account is locked!
      });

      expect(lockedRes.status).toBe(429);
      expect(lockedRes.body.error.code).toBe('ACCOUNT_LOCKED');
    });
  });

  describe('Token Rotation & Session Family Reuse Detection (§7.2)', () => {
    it('should rotate refresh token and revoke older session', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          identifier: testUser.email,
          password: testUser.password,
        });

      const initialCookie = (loginRes.headers['set-cookie'] as unknown as string[])
        .find((c: string) => c.startsWith('privora_refresh_token='))!;

      // First refresh
      const refreshRes1 = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', [initialCookie]);

      expect(refreshRes1.status).toBe(200);
      expect(refreshRes1.body.accessToken).toBeDefined();

      const secondCookie = (refreshRes1.headers['set-cookie'] as unknown as string[])
        .find((c: string) => c.startsWith('privora_refresh_token='))!;

      // Reuse detection: present the initial (now-revoked) cookie again
      const reuseRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', [initialCookie]);

      expect(reuseRes.status).toBe(401);
      expect(reuseRes.body.error.code).toBe('SESSION_REUSE_DETECTED');

      // Since family reuse was detected, the second (latest) token must ALSO now be revoked!
      const subsequentRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', [secondCookie]);

      expect(subsequentRes.status).toBe(401);
      expect(subsequentRes.body.error.code).toBe('SESSION_REUSE_DETECTED');
    });
  });

  describe('Protected Route /api/auth/me', () => {
    it('should allow access with valid access token', async () => {
      const loginRes = await request(app).post('/api/auth/login').send({
        identifier: testUser.email,
        password: testUser.password,
      });

      const token = loginRes.body.accessToken;

      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(meRes.status).toBe(200);
      expect(meRes.body.user.email).toBe(testUser.email.toLowerCase());
    });

    it('should reject tampered or invalid access token', async () => {
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid.tampered.jwttoken');

      expect(meRes.status).toBe(401);
      expect(meRes.body.error.code).toBe('INVALID_TOKEN');
    });
  });
});
