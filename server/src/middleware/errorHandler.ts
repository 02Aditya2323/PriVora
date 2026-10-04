import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  static badRequest(message = 'Bad Request', code = 'BAD_REQUEST'): AppError {
    return new AppError(400, code, message);
  }

  static unauthorized(message = 'Unauthorized', code = 'UNAUTHORIZED'): AppError {
    return new AppError(401, code, message);
  }

  static forbidden(message = 'Forbidden', code = 'FORBIDDEN'): AppError {
    return new AppError(403, code, message);
  }

  static notFound(message = 'Not Found', code = 'NOT_FOUND'): AppError {
    return new AppError(404, code, message);
  }

  static conflict(message = 'Conflict', code = 'CONFLICT'): AppError {
    return new AppError(409, code, message);
  }

  static payloadTooLarge(message = 'Payload Too Large', code = 'PAYLOAD_TOO_LARGE'): AppError {
    return new AppError(413, code, message);
  }

  static tooManyRequests(message = 'Too Many Requests', code = 'TOO_MANY_REQUESTS'): AppError {
    return new AppError(429, code, message);
  }

  static internal(message = 'Internal Server Error', code = 'INTERNAL_ERROR'): AppError {
    return new AppError(500, code, message);
  }
}

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction): void {
  // Handle AppError
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err, path: req.path, method: req.method }, err.message);
    } else {
      logger.warn({ code: err.code, message: err.message, path: req.path, method: req.method }, 'Application error handled');
    }

    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
      },
    });
    return;
  }

  // Handle Zod Validation Errors
  if (err instanceof ZodError) {
    const issueMessages = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    logger.warn({ issues: err.issues, path: req.path }, 'Validation failure');
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: issueMessages || 'Invalid request parameters',
      },
    });
    return;
  }

  // Handle Multer upload errors
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        error: {
          code: 'FILE_TOO_LARGE',
          message: 'Uploaded file exceeds the maximum allowed size of 25 MB',
        },
      });
      return;
    }
    res.status(400).json({
      error: {
        code: 'UPLOAD_ERROR',
        message: err.message,
      },
    });
    return;
  }

  // Handle JSON parse errors
  if (err.type === 'entity.parse.failed') {
    res.status(400).json({
      error: {
        code: 'INVALID_JSON',
        message: 'Malformed JSON payload in request body',
      },
    });
    return;
  }

  // Unexpected / unhandled errors (do not leak internal stack traces)
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled internal server error');
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected internal error occurred',
    },
  });
}
