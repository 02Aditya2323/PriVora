import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { logger } from './utils/logger';
import { applySecurity } from './middleware/security';
import { limiters } from './middleware/rateLimit';
import { errorHandler } from './middleware/errorHandler';
import { authRouter } from './modules/auth/router';
import { roomsRouter } from './modules/rooms/router';
import { shareLinksRouter } from './modules/shareLinks/router';
import { adminRouter } from './modules/admin/router';

export function createApp(): Express {
  const app = express();

  // Behind Nginx proxy
  app.set('trust proxy', 1);

  // 1. Security Headers, CORS, CSRF (Part 3 will enhance applySecurity)
  applySecurity(app);

  // 2. HTTP Request Logging with Sensitive Field Redaction
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.headers['x-request-id'] || crypto.randomUUID(),
      autoLogging: {
        ignore: (req) => req.url === '/api/health',
      },
    })
  );

  // 3. Request Body Size Limits
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // 4. Global Rate Limiter
  app.use(limiters.global);

  // 5. Cookie Parser (for refresh token cookie)
  app.use(cookieParser());

  // Health check endpoint
  app.get('/api/health', (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'privora-api' });
  });

  // 6. Application Routes
  app.use('/api/auth', authRouter);
  app.use('/api/rooms', roomsRouter);
  app.use('/api/s', shareLinksRouter);
  app.use('/api/admin', adminRouter);

  // 7. Uniform 404 Not Found Handler
  app.use((_req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Endpoint not found',
      },
    });
  });

  // 8. Central Error Handler
  app.use(errorHandler);

  return app;
}

export const app = createApp();
