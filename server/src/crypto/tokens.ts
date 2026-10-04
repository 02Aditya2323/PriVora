import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  email: string;
  username: string;
  role: string;
  jti: string;
  iat?: number;
  exp?: number;
}

export function generateAccessToken(
  user: { id: string; email: string; username: string; globalRole: string },
  sessionId: string
): string {
  const payload: Omit<AccessTokenPayload, 'iat' | 'exp'> = {
    sub: user.id,
    sid: sessionId,
    email: user.email,
    username: user.username,
    role: user.globalRole,
    jti: crypto.randomUUID(),
  };

  return jwt.sign(payload, env.ACCESS_TOKEN_SECRET, {
    algorithm: 'HS256', // Pinned algorithm
    expiresIn: env.ACCESS_TOKEN_TTL as any,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env.ACCESS_TOKEN_SECRET, {
      algorithms: ['HS256'], // Strictly reject 'none' or foreign algs
    }) as AccessTokenPayload;

    return decoded;
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      throw AppError.unauthorized('Access token has expired', 'TOKEN_EXPIRED');
    }
    throw AppError.unauthorized('Invalid or tampered access token', 'INVALID_TOKEN');
  }
}

/**
 * Generates an unguessable 256-bit opaque refresh token encoded as base64url.
 */
export function generateOpaqueRefreshToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * SHA-256 hash of opaque token to be safely stored in sessions table.
 */
export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
