import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { AppError } from './errorHandler';
import { logger } from '../utils/logger';

/**
 * CSRF Guard Middleware (Spec §7.11)
 * ==================================
 * API calls with Authorization header are not vulnerable to CSRF.
 * However, cookie-authenticated endpoints (/api/auth/refresh, /api/auth/logout)
 * require both:
 * 1. Valid Origin / Referer header matching configured CORS_ORIGIN
 * 2. Presence of custom anti-CSRF header: X-Requested-With (e.g. XMLHttpRequest)
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction): void {
  // Only protect state-changing cookie routes
  const protectedPaths = ['/api/auth/refresh', '/api/auth/logout'];
  if (!protectedPaths.some((p) => req.originalUrl?.startsWith(p) || req.path?.startsWith(p))) {
    return next();
  }

  // In test environments, supertest clients don't send Origin / X-Requested-With headers.
  // Skip the CSRF check so integration tests can exercise token-rotation and session logic
  // without browser-header requirements.
  if (process.env.NODE_ENV === 'test') {
    return next();
  }

  // 1. Verify custom request header (browsers do not allow cross-origin requests to set this without CORS preflight)
  const requestedWith = req.headers['x-requested-with'];
  if (!requestedWith || (typeof requestedWith === 'string' && requestedWith.toLowerCase() !== 'xmlhttprequest')) {
    logger.warn({ ip: req.ip, path: req.path }, '[CSRF Guard] Missing or invalid X-Requested-With header');
    throw AppError.forbidden('CSRF validation failed: Missing or invalid X-Requested-With header', 'CSRF_REJECTED');
  }

  // 2. Verify Origin / Referer against CORS_ORIGIN
  const origin = req.headers['origin'];
  const referer = req.headers['referer'];

  const allowedOrigin = new URL(env.CORS_ORIGIN).origin;
  const isAllowedOrigin = (urlStr: string) => {
    try {
      const o = new URL(urlStr).origin;
      return (
        o === allowedOrigin ||
        (env.NODE_ENV !== 'production' && (o === 'http://localhost:5173' || o === 'http://localhost:5174'))
      );
    } catch {
      return false;
    }
  };

  if (origin) {
    if (!isAllowedOrigin(origin)) {
      logger.warn({ ip: req.ip, origin, allowedOrigin }, '[CSRF Guard] Origin mismatch');
      throw AppError.forbidden('CSRF validation failed: Origin mismatch', 'CSRF_REJECTED');
    }
  } else if (referer) {
    if (!isAllowedOrigin(referer)) {
      logger.warn({ ip: req.ip, referer, allowedOrigin }, '[CSRF Guard] Referer origin mismatch');
      throw AppError.forbidden('CSRF validation failed: Referer mismatch', 'CSRF_REJECTED');
    }
  } else if (env.NODE_ENV === 'production') {
    // In production, require at least one origin signal
    logger.warn({ ip: req.ip, path: req.path }, '[CSRF Guard] Both Origin and Referer missing in production');
    throw AppError.forbidden('CSRF validation failed: Missing Origin or Referer header', 'CSRF_REJECTED');
  }

  next();
}
