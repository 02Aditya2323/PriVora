import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'authorization',
      'cookie',
      'password',
      'token',
      'accessToken',
      'refreshToken',
      'shareKey',
      '*.password',
      '*.token',
      '*.key',
    ],
    censor: '[REDACTED]',
  },
  transport:
    env.NODE_ENV !== 'production' && env.NODE_ENV !== 'test'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            ignore: 'pid,hostname',
            translateTime: 'SYS:standard',
          },
        }
      : undefined,
});
