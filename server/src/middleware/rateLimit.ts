import { Request, Response, NextFunction, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';

/**
 * Standard 429 response handler matching Privora API error contract
 */
const rateLimitErrorHandler = (message: string) => {
  return (_req: Request, res: Response, _next: NextFunction, options: any) => {
    res.setHeader('Retry-After', Math.ceil(options.windowMs / 1000).toString());
    res.status(429).json({
      error: {
        code: 'TOO_MANY_REQUESTS',
        message,
      },
    });
  };
};

/**
 * In test environments, rate limiters share an in-memory store across sequential test cases
 * running from the same IP (127.0.0.1), causing spurious 429s that pollute unrelated tests.
 * Bypassing them in NODE_ENV=test lets each test exercise business logic (e.g. DB-backed
 * account lockout) without interference. The dedicated ratelimit.test.ts uses an isolated
 * express app with its own fresh limiter instance, so it is unaffected.
 */
const isTest = process.env.NODE_ENV === 'test';
const isDev = process.env.NODE_ENV === 'development';
const noopMiddleware: RequestHandler = (_req, _res, next) => next();

/**
 * testLimiters: real instances used only by ratelimit.test.ts for behaviour verification.
 * These are never applied to the main app in test mode.
 */
export const testLimiters = {
  global: rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitErrorHandler('Too many requests across the API, please try again later.'),
  }),
  auth: rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitErrorHandler('Too many authentication attempts, please try again in a few minutes.'),
  }),
  upload: rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => (req.user ? `user:${req.user.id}` : req.ip || 'anonymous'),
    validate: { keyGeneratorIpFallback: false },
    handler: rateLimitErrorHandler('Upload rate limit reached: Maximum 30 uploads per hour.'),
  }),
  share: rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitErrorHandler('Too many requests to public share links, please try again later.'),
  }),
};

/**
 * RATE LIMITER IMPLEMENTATION (Spec §7.5)
 * =======================================
 * Uses in-memory stores for single-instance Privora deployment.
 *
 * Tiers:
 * 1. global: 300 requests / 15 min per IP (1000 in dev)
 * 2. auth: failed login/register attempts only (skipSuccessfulRequests: true)
 * 3. upload: 30 requests / 1 hour per user (or IP if unauthenticated)
 * 4. share: 30 requests / 10 min per IP (/s/*)
 *
 * In NODE_ENV=test, all limiters are replaced with a no-op to prevent in-memory
 * counter accumulation across sequential test cases running from the same loopback IP.
 * Correct rate-limit behaviour is verified in isolation by ratelimit.test.ts.
 */
export const limiters = {
  // 1. Global API rate limit
  global: isTest
    ? noopMiddleware
    : rateLimit({
        windowMs: 15 * 60 * 1000,
        max: isDev ? 1000 : 300,
        standardHeaders: true,
        legacyHeaders: false,
        handler: rateLimitErrorHandler('Too many requests across the API, please try again later.'),
      }),

  // 2. Authentication rate limit (mitigates brute-force credential stuffing)
  auth: isTest
    ? noopMiddleware
    : rateLimit({
        windowMs: isDev ? 5 * 60 * 1000 : 15 * 60 * 1000,
        max: isDev ? 100 : 50,
        skipSuccessfulRequests: true,
        standardHeaders: true,
        legacyHeaders: false,
        handler: rateLimitErrorHandler('Too many authentication attempts, please try again in a few minutes.'),
      }),

  // 3. File upload rate limit (prevents disk & bandwidth exhaustion)
  upload: isTest
    ? noopMiddleware
    : rateLimit({
        windowMs: 60 * 60 * 1000,
        max: 30,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req: Request) => (req.user ? `user:${req.user.id}` : req.ip || 'anonymous'),
        validate: { keyGeneratorIpFallback: false },
        handler: rateLimitErrorHandler('Upload rate limit reached: Maximum 30 uploads per hour.'),
      }),

  // 4. Public share link rate limit (prevents key enumeration / brute force)
  share: isTest
    ? noopMiddleware
    : rateLimit({
        windowMs: 10 * 60 * 1000,
        max: 30,
        standardHeaders: true,
        legacyHeaders: false,
        handler: rateLimitErrorHandler('Too many requests to public share links, please try again later.'),
      }),
};
