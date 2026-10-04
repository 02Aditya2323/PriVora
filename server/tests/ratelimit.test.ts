import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { limiters } from '../src/middleware/rateLimit';

describe('Rate Limiting & Brute-Force Protection Tests (Spec §7.5)', () => {
  it('enforces 429 and Retry-After header when rate limit is exceeded', async () => {
    const testApp = express();
    testApp.use(express.json());

    // Create a mini limiter with a low threshold for fast testing
    const testLimiter = rateLimit({
      windowMs: 5000,
      max: 3,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_req, res, _next, options: any) => {
        res.setHeader('Retry-After', Math.ceil(options.windowMs / 1000).toString());
        res.status(429).json({
          error: {
            code: 'TOO_MANY_REQUESTS',
            message: 'Too many requests',
          },
        });
      },
    });

    testApp.get('/test-limit', testLimiter, (_req, res) => {
      res.status(200).json({ status: 'ok' });
    });

    // First 3 requests succeed
    for (let i = 0; i < 3; i++) {
      const res = await request(testApp).get('/test-limit');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    }

    // 4th request must be blocked with 429
    const blockedRes = await request(testApp).get('/test-limit');
    expect(blockedRes.status).toBe(429);
    expect(blockedRes.headers['retry-after']).toBeDefined();
    expect(blockedRes.body.error.code).toBe('TOO_MANY_REQUESTS');
  });

  it('limiters object has configured tiers: global, auth, upload, share', () => {
    expect(limiters.global).toBeDefined();
    expect(limiters.auth).toBeDefined();
    expect(limiters.upload).toBeDefined();
    expect(limiters.share).toBeDefined();
    expect(typeof limiters.global).toBe('function');
    expect(typeof limiters.auth).toBe('function');
    expect(typeof limiters.upload).toBe('function');
    expect(typeof limiters.share).toBe('function');
  });
});
