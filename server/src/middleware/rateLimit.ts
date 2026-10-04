import { Request, Response, NextFunction } from 'express';

const passThrough = (_req: Request, _res: Response, next: NextFunction) => next();

/**
 * RATE LIMITER STUB (Part 1)
 * ==========================
 * Part 3 will implement real express-rate-limit tiers (in-memory store):
 * - global: 300 req / 15 min per IP
 * - auth: 10 req / 15 min per IP (/auth/login, /auth/register)
 * - upload: 30 req / hour per user
 * - share: 30 req / 10 min per IP (/s/*)
 */
export const limiters = {
  global: passThrough,
  auth: passThrough,
  upload: passThrough,
  share: passThrough,
};
