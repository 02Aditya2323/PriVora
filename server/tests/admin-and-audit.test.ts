import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { db, pool } from '../src/db/pool';
import { runMigrations } from '../src/db/migrate';
import { hashPassword } from '../src/crypto/password';

describe('Admin Module & Audit Logging Tests (Spec §7.12, §4.2, §6)', () => {
  let adminToken: string;
  let regularToken: string;
  let targetUserId: string;

  beforeAll(async () => {
    await runMigrations();

    // Clean up any old test users
    await db.query("DELETE FROM users WHERE email LIKE '%@admin-test.privora.local'");

    // 1. Create a global admin user
    const adminPasswordHash = await hashPassword('AdminPasswordStrong!2026');
    const adminRes = await db.query(
      `INSERT INTO users (email, username, password_hash, global_role)
       VALUES ('superadmin@admin-test.privora.local', 'super_admin_test', $1, 'admin')
       RETURNING id`,
      [adminPasswordHash]
    );

    // 2. Create a regular user
    const regPasswordHash = await hashPassword('RegularUserStrong!2026');
    const regRes = await db.query(
      `INSERT INTO users (email, username, password_hash, global_role)
       VALUES ('reguser@admin-test.privora.local', 'regular_user_test', $1, 'user')
       RETURNING id`,
      [regPasswordHash]
    );
    targetUserId = regRes.rows[0].id;

    // Login admin to obtain access token
    const adminLoginRes = await request(app)
      .post('/api/auth/login')
      .send({
        identifier: 'superadmin@admin-test.privora.local',
        password: 'AdminPasswordStrong!2026',
      });
    adminToken = adminLoginRes.body.accessToken;

    // Login regular user to obtain access token
    const regLoginRes = await request(app)
      .post('/api/auth/login')
      .send({
        identifier: 'reguser@admin-test.privora.local',
        password: 'RegularUserStrong!2026',
      });
    regularToken = regLoginRes.body.accessToken;
  });

  afterAll(async () => {
    await db.query("DELETE FROM users WHERE email LIKE '%@admin-test.privora.local'");
  });

  describe('Admin Authorization (requireGlobalAdmin)', () => {
    it('rejects unauthenticated requests to admin audit-logs with 401', async () => {
      const res = await request(app).get('/api/admin/audit-logs');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects regular users with 403 Forbidden', async () => {
      const res = await request(app)
        .get('/api/admin/audit-logs')
        .set('Authorization', `Bearer ${regularToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('allows global admin to view audit logs with filters and pagination', async () => {
      const res = await request(app)
        .get('/api/admin/audit-logs?limit=10')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.logs).toBeDefined();
      expect(Array.isArray(res.body.logs)).toBe(true);
      expect(typeof res.body.total).toBe('number');
    });
  });

  describe('User Account Lockout (PATCH /api/admin/users/:userId/lock)', () => {
    it('regular user cannot lock accounts (403 Forbidden)', async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${targetUserId}/lock`)
        .set('Authorization', `Bearer ${regularToken}`)
        .send({ locked: true, durationMinutes: 60 });

      expect(res.status).toBe(403);
    });

    it('admin can successfully lock a regular user account', async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${targetUserId}/lock`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ locked: true, durationMinutes: 120, reason: 'Security investigation' });

      expect(res.status).toBe(200);
      expect(res.body.user.lockedUntil).not.toBeNull();

      // Now locked user cannot login
      const loginAttempt = await request(app)
        .post('/api/auth/login')
        .send({
          identifier: 'reguser@admin-test.privora.local',
          password: 'RegularUserStrong!2026',
        });

      expect(loginAttempt.status).toBe(429);
      expect(loginAttempt.body.error.code).toBe('ACCOUNT_LOCKED');
    });

    it('admin can unlock user account', async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${targetUserId}/lock`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ locked: false });

      expect(res.status).toBe(200);
      expect(res.body.user.lockedUntil).toBeNull();

      // User can login again
      const loginAttempt = await request(app)
        .post('/api/auth/login')
        .send({
          identifier: 'reguser@admin-test.privora.local',
          password: 'RegularUserStrong!2026',
        });

      expect(loginAttempt.status).toBe(200);
      expect(loginAttempt.body.accessToken).toBeDefined();
    });
  });

  describe('Audit Logging Verification (§7.12)', () => {
    it('persists audit events in audit_logs table and redacts sensitive metadata', async () => {
      const logsRes = await db.query(
        "SELECT * FROM audit_logs WHERE action IN ('auth.login.success', 'admin.lock_user') ORDER BY ts DESC LIMIT 5"
      );

      expect(logsRes.rows.length).toBeGreaterThan(0);
      const lockLog = logsRes.rows.find((r) => r.action === 'admin.lock_user');
      expect(lockLog).toBeDefined();
      expect(lockLog.target_id).toBe(targetUserId);

      // Check metadata does not contain sensitive raw secrets
      if (lockLog.metadata) {
        const str = JSON.stringify(lockLog.metadata);
        expect(str).not.toContain('AdminPasswordStrong!2026');
      }
    });
  });
});
