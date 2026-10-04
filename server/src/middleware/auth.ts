import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../crypto/tokens';
import { AppError } from './errorHandler';

export interface AuthenticatedUser {
  id: string;
  email: string;
  username: string;
  globalRole: string;
  sessionId: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function auth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw AppError.unauthorized('Authentication token required', 'UNAUTHORIZED');
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    throw AppError.unauthorized('Bearer token cannot be empty', 'UNAUTHORIZED');
  }

  const payload = verifyAccessToken(token);

  req.user = {
    id: payload.sub,
    email: payload.email,
    username: payload.username,
    globalRole: payload.role,
    sessionId: payload.sid,
  };

  next();
}
