import { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from '../config/env';
import { csrfGuard } from './csrf';
import { logger } from '../utils/logger';

/**
 * HTTP HARDENING MIDDLEWARE (Spec §7.11)
 * =====================================
 * Implements:
 * 1. Helmet with CSP, HSTS, COOP, CORP, Referrer-Policy, Permissions-Policy, nosniff
 * 2. Strict CORS allowlist for CORS_ORIGIN with credentials
 * 3. Removal of X-Powered-By header
 * 4. CSRF guard for cookie-authenticated refresh/logout routes
 */
export function applySecurity(app: Express): void {
  logger.info('[SECURITY] Initializing HTTP hardening (Helmet + CORS + CSRF guard)...');

  // Disable X-Powered-By header to prevent technology stack fingerprinting
  app.disable('x-powered-by');

  // 1. Helmet Security Headers
  const devOrigins = ['http://localhost:5173', 'http://localhost:5174'];
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", 'ws:', 'wss:', env.CORS_ORIGIN, ...(env.NODE_ENV !== 'production' ? devOrigins : [])],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      hsts: {
        maxAge: 31536000, // 1 year in seconds
        includeSubDomains: true,
        preload: true,
      },
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'no-referrer' },
      noSniff: true,
    })
  );

  // Additional Permissions-Policy header (disables invasive browser APIs)
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  // 2. Strict CORS Allowlist
  const allowedOrigin = new URL(env.CORS_ORIGIN).origin;
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, curl, server-to-server) or exact matching origin
        if (
          !origin ||
          new URL(origin).origin === allowedOrigin ||
          (env.NODE_ENV !== 'production' && devOrigins.includes(new URL(origin).origin))
        ) {
          callback(null, true);
        } else {
          logger.warn({ rejectedOrigin: origin, allowedOrigin }, '[CORS] Request origin blocked by CORS policy');
          callback(new Error('Blocked by CORS policy: Origin not allowed'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-Id'],
      maxAge: 86400, // Cache preflight for 24 hours
    })
  );

  // 3. CSRF Protection for state-changing cookie routes
  app.use(csrfGuard);
}
