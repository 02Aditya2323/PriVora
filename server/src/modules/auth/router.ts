import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authService } from './service';
import { validate } from '../../middleware/validate';
import { auth } from '../../middleware/auth';
import { limiters } from '../../middleware/rateLimit';
import { env } from '../../config/env';

export const authRouter = Router();

// Apply auth rate limiter per spec §7.5
authRouter.use(limiters.auth);

const registerSchema = z
  .object({
    email: z.string().email('Invalid email address').max(255),
    username: z
      .string()
      .min(3, 'Username must be at least 3 characters')
      .max(50, 'Username must not exceed 50 characters')
      .regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscores and hyphens'),
    password: z.string().min(12, 'Password must be at least 12 characters').max(128),
  })
  .strict();

const loginSchema = z
  .object({
    identifier: z.string().min(1, 'Email or username is required').max(255),
    password: z.string().min(1, 'Password is required').max(128),
  })
  .strict();

const REFRESH_COOKIE_NAME = 'privora_refresh_token';

const cookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/api/auth',
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
};

// 1. POST /api/auth/register
authRouter.post(
  '/register',
  validate({ body: registerSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await authService.register({
        email: req.body.email,
        username: req.body.username,
        password: req.body.password,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.status(201).json({ user });
    } catch (err) {
      next(err);
    }
  }
);

// 2. POST /api/auth/login
authRouter.post(
  '/login',
  validate({ body: loginSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await authService.login({
        identifier: req.body.identifier,
        password: req.body.password,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, cookieOptions);

      res.status(200).json({
        user: result.user,
        accessToken: result.accessToken,
      });
    } catch (err) {
      next(err);
    }
  }
);

// 3. POST /api/auth/refresh
authRouter.post('/refresh', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rawToken = req.cookies[REFRESH_COOKIE_NAME];
    const result = await authService.refresh(rawToken, req.ip, req.headers['user-agent']);

    res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, cookieOptions);

    res.status(200).json({
      accessToken: result.accessToken,
    });
  } catch (err) {
    next(err);
  }
});

// 4. POST /api/auth/logout
authRouter.post('/logout', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rawToken = req.cookies[REFRESH_COOKIE_NAME];
    await authService.logout(rawToken, req.user?.id, req.ip, req.headers['user-agent']);

    res.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/auth',
    });

    res.status(200).json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});

// 5. GET /api/auth/me
authRouter.get('/me', auth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await authService.me(req.user!.id);
    res.status(200).json({ user });
  } catch (err) {
    next(err);
  }
});
