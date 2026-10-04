import crypto from 'crypto';
import { db } from '../../db/pool';
import { env } from '../../config/env';
import { AppError } from '../../middleware/errorHandler';
import { hashPassword, verifyPassword, verifyDummyPassword, validatePasswordPolicy } from '../../crypto/password';
import {
  generateAccessToken,
  generateOpaqueRefreshToken,
  hashRefreshToken,
} from '../../crypto/tokens';
import { audit } from '../audit/audit';
import { emit } from '../../realtime/emit';

export interface RegisterDTO {
  email: string;
  username: string;
  password: string;
  ip?: string;
  userAgent?: string;
}

export interface LoginDTO {
  identifier: string; // email or username
  password: string;
  ip?: string;
  userAgent?: string;
}

export class AuthService {
  async register(data: RegisterDTO) {
    const email = data.email.trim().toLowerCase();
    const username = data.username.trim();

    // 1. Password policy verification
    const policyResult = validatePasswordPolicy(data.password);
    if (!policyResult.valid) {
      throw AppError.badRequest(policyResult.message || 'Password does not meet security requirements', 'WEAK_PASSWORD');
    }

    // 2. Check if user already exists
    const existing = await db.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );

    if (existing.rows.length > 0) {
      await audit.log({
        action: 'auth.register',
        outcome: 'failure',
        ip: data.ip,
        userAgent: data.userAgent,
        metadata: { reason: 'User already exists' },
      });
      throw AppError.conflict('An account with this email or username already exists', 'USER_ALREADY_EXISTS');
    }

    // 3. Hash with argon2id
    const passwordHash = await hashPassword(data.password);

    // 4. Insert user
    const result = await db.query(
      `INSERT INTO users (email, username, password_hash, global_role)
       VALUES ($1, $2, $3, 'user')
       RETURNING id, email, username, global_role AS "globalRole", created_at AS "createdAt"`,
      [email, username, passwordHash]
    );

    const user = result.rows[0];

    await audit.log({
      actorId: user.id,
      action: 'auth.register',
      targetType: 'user',
      targetId: user.id,
      outcome: 'success',
      ip: data.ip,
      userAgent: data.userAgent,
    });

    return user;
  }

  async login(data: LoginDTO) {
    const identifier = data.identifier.trim();

    // Lookup user by email or username
    const result = await db.query(
      `SELECT id, email, username, password_hash, global_role, failed_login_count, locked_until
       FROM users
       WHERE email = $1 OR username = $1`,
      [identifier]
    );

    // Constant-time execution path for unknown user
    if (result.rows.length === 0) {
      await verifyDummyPassword(data.password);
      await audit.log({
        action: 'auth.login.failure',
        outcome: 'failure',
        ip: data.ip,
        userAgent: data.userAgent,
        metadata: { identifier },
      });
      throw AppError.unauthorized('Invalid credentials', 'INVALID_CREDENTIALS');
    }

    const user = result.rows[0];

    // Check account lockout
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      await audit.log({
        actorId: user.id,
        action: 'auth.lockout',
        targetType: 'user',
        targetId: user.id,
        outcome: 'denied',
        ip: data.ip,
        userAgent: data.userAgent,
      });
      throw AppError.tooManyRequests(
        'Account is temporarily locked due to consecutive failed login attempts. Please try again later.',
        'ACCOUNT_LOCKED'
      );
    }

    // Verify password
    const passwordMatches = await verifyPassword(user.password_hash, data.password);

    if (!passwordMatches) {
      const newFailCount = user.failed_login_count + 1;
      let lockedUntil: Date | null = null;

      // Lock account after 5 consecutive failed attempts for 15 minutes
      if (newFailCount >= 5) {
        lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      }

      await db.query(
        'UPDATE users SET failed_login_count = $1, locked_until = $2 WHERE id = $3',
        [newFailCount, lockedUntil, user.id]
      );

      if (lockedUntil) {
        await audit.log({
          actorId: user.id,
          action: 'auth.lockout',
          targetType: 'user',
          targetId: user.id,
          outcome: 'denied',
          ip: data.ip,
          userAgent: data.userAgent,
        });
      }

      await audit.log({
        actorId: user.id,
        action: 'auth.login.failure',
        outcome: 'failure',
        ip: data.ip,
        userAgent: data.userAgent,
      });

      // Identical response for security: no information leakage
      throw AppError.unauthorized('Invalid credentials', 'INVALID_CREDENTIALS');
    }

    // Login successful: reset failed login count & lockout
    await db.query(
      'UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1',
      [user.id]
    );

    // Create session and rotating refresh token
    const sessionId = crypto.randomUUID();
    const familyId = crypto.randomUUID();
    const rawRefreshToken = generateOpaqueRefreshToken();
    const tokenHash = hashRefreshToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    await db.query(
      `INSERT INTO sessions (id, user_id, family_id, token_hash, expires_at, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [sessionId, user.id, familyId, tokenHash, expiresAt, data.ip || null, data.userAgent || null]
    );

    const accessToken = generateAccessToken(
      {
        id: user.id,
        email: user.email,
        username: user.username,
        globalRole: user.global_role,
      },
      sessionId
    );

    await audit.log({
      actorId: user.id,
      action: 'auth.login.success',
      targetType: 'user',
      targetId: user.id,
      outcome: 'success',
      ip: data.ip,
      userAgent: data.userAgent,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        globalRole: user.global_role,
      },
      accessToken,
      refreshToken: rawRefreshToken,
    };
  }

  async refresh(refreshToken: string, ip?: string, userAgent?: string) {
    if (!refreshToken) {
      throw AppError.unauthorized('Refresh token is required', 'REFRESH_TOKEN_REQUIRED');
    }

    const tokenHash = hashRefreshToken(refreshToken);

    const result = await db.query(
      `SELECT s.id, s.user_id, s.family_id, s.expires_at, s.revoked_at,
              u.email, u.username, u.global_role, u.locked_until
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token_hash = $1`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      throw AppError.unauthorized('Invalid refresh session', 'INVALID_REFRESH_TOKEN');
    }

    const session = result.rows[0];

    // Family Reuse Detection: if this session is already revoked, an attacker or victim is replaying an old token
    if (session.revoked_at !== null) {
      // Invalidate the entire family chain immediately
      await db.query('UPDATE sessions SET revoked_at = now() WHERE family_id = $1', [session.family_id]);

      await audit.log({
        actorId: session.user_id,
        action: 'session.reuse_detected',
        targetType: 'session',
        targetId: session.id,
        outcome: 'denied',
        ip,
        userAgent,
        metadata: { familyId: session.family_id },
      });

      // Force disconnect all active user sockets
      emit.sessionRevoked(session.user_id);

      throw AppError.unauthorized(
        'Session violation detected. All sessions in this rotation chain have been revoked.',
        'SESSION_REUSE_DETECTED'
      );
    }

    // Expiry check
    if (new Date(session.expires_at) < new Date()) {
      throw AppError.unauthorized('Refresh token has expired', 'REFRESH_TOKEN_EXPIRED');
    }

    // Check account lockout
    if (session.locked_until && new Date(session.locked_until) > new Date()) {
      throw AppError.unauthorized('Account is locked', 'ACCOUNT_LOCKED');
    }

    // Rotate token: issue new token in same family, invalidate previous one
    const newSessionId = crypto.randomUUID();
    const newRawRefreshToken = generateOpaqueRefreshToken();
    const newTokenHash = hashRefreshToken(newRawRefreshToken);

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Mark old session as revoked and record replacement
      await client.query(
        'UPDATE sessions SET revoked_at = now(), replaced_by = $1 WHERE id = $2',
        [newSessionId, session.id]
      );

      // Insert new session with same family_id and original absolute expiry
      await client.query(
        `INSERT INTO sessions (id, user_id, family_id, token_hash, expires_at, ip, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [newSessionId, session.user_id, session.family_id, newTokenHash, session.expires_at, ip || null, userAgent || null]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const newAccessToken = generateAccessToken(
      {
        id: session.user_id,
        email: session.email,
        username: session.username,
        globalRole: session.global_role,
      },
      newSessionId
    );

    await audit.log({
      actorId: session.user_id,
      action: 'session.refresh',
      targetType: 'session',
      targetId: newSessionId,
      outcome: 'success',
      ip,
      userAgent,
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRawRefreshToken,
    };
  }

  async logout(refreshToken?: string, userId?: string, ip?: string, userAgent?: string) {
    if (refreshToken) {
      const tokenHash = hashRefreshToken(refreshToken);
      const res = await db.query(
        'UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 RETURNING user_id',
        [tokenHash]
      );

      if (res.rows.length > 0) {
        const uId = res.rows[0].user_id;
        emit.sessionRevoked(uId);

        await audit.log({
          actorId: uId,
          action: 'auth.logout',
          outcome: 'success',
          ip,
          userAgent,
        });
        return;
      }
    }

    if (userId) {
      emit.sessionRevoked(userId);
      await audit.log({
        actorId: userId,
        action: 'auth.logout',
        outcome: 'success',
        ip,
        userAgent,
      });
    }
  }

  async me(userId: string) {
    const result = await db.query(
      `SELECT id, email, username, global_role AS "globalRole", created_at AS "createdAt", last_login_at AS "lastLoginAt"
       FROM users
       WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      throw AppError.notFound('User not found', 'USER_NOT_FOUND');
    }

    return result.rows[0];
  }
}

export const authService = new AuthService();
