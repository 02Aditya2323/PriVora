import { Socket } from 'socket.io';
import { env } from '../config/env';
import { logger } from '../utils/logger';

// Track active socket connections per user
const userSocketCounts = new Map<string, Set<string>>();

// Connection cap per user (spec §8.7)
export const MAX_SOCKETS_PER_USER = 10;

// Rate limit: 20 events per 10 seconds per socket (spec §8.7)
const RATE_LIMIT_WINDOW_MS = 10_000;
const MAX_EVENTS_PER_WINDOW = 20;
const MAX_VIOLATIONS_BEFORE_DISCONNECT = 3;

interface RateLimitTracker {
  tokens: number;
  lastRefill: number;
  violations: number;
}

const socketRateLimits = new Map<string, RateLimitTracker>();

/**
 * Validates handshake Origin against CORS_ORIGIN
 */
export function validateSocketOrigin(originHeader?: string): boolean {
  if (!originHeader) return true; // Non-browser clients or direct tests
  try {
    const allowed = new URL(env.CORS_ORIGIN).origin;
    const incoming = new URL(originHeader).origin;
    return allowed === incoming;
  } catch {
    return false;
  }
}

/**
 * Enforces per-user connection cap (max 10 sockets)
 */
export function enforceUserConnectionCap(userId: string, socketId: string): boolean {
  let sockets = userSocketCounts.get(userId);
  if (!sockets) {
    sockets = new Set();
    userSocketCounts.set(userId, sockets);
  }

  if (sockets.size >= MAX_SOCKETS_PER_USER) {
    logger.warn({ userId, socketId, count: sockets.size }, '[WS HARDENING] Per-user connection cap exceeded');
    return false;
  }

  sockets.add(socketId);
  return true;
}

/**
 * Cleans up user connection tracking on disconnect
 */
export function cleanupUserConnection(userId: string, socketId: string): void {
  const sockets = userSocketCounts.get(userId);
  if (sockets) {
    sockets.delete(socketId);
    if (sockets.size === 0) {
      userSocketCounts.delete(userId);
    }
  }
  socketRateLimits.delete(socketId);
}

/**
 * Schedules automatic disconnect when the JWT expires (spec §7.13, §8.2)
 */
export function scheduleTokenExpiryDisconnect(socket: Socket, expTimestampSeconds: number): void {
  const now = Date.now();
  const expMs = expTimestampSeconds * 1000;
  const msUntilExp = expMs - now;

  if (msUntilExp <= 0) {
    logger.warn({ socketId: socket.id }, '[WS HARDENING] Connected with already-expired token');
    socket.emit('session:expired', { message: 'Token has already expired' });
    socket.disconnect(true);
    return;
  }

  const timer = setTimeout(() => {
    logger.info({ socketId: socket.id }, '[WS HARDENING] Token reached exp. Forcing disconnect');
    socket.emit('session:expired', { message: 'Access token expired, please reconnect' });
    socket.disconnect(true);
  }, msUntilExp);

  // Ensure timer does not prevent process exit, and clean up on disconnect
  timer.unref();
  socket.on('disconnect', () => {
    clearTimeout(timer);
  });
}

/**
 * Per-socket token-bucket rate limiter (20 events / 10s)
 * Automatically disconnects clients that repeatedly flood events
 */
export function applySocketRateLimiting(socket: Socket): void {
  const socketId = socket.id;
  socketRateLimits.set(socketId, {
    tokens: MAX_EVENTS_PER_WINDOW,
    lastRefill: Date.now(),
    violations: 0,
  });

  // Intercept all incoming events from the client
  socket.use(([eventName, ..._args], next) => {
    // Ignore internal socket.io events
    if (eventName === 'disconnect' || eventName === 'error') {
      return next();
    }

    const tracker = socketRateLimits.get(socketId);
    if (!tracker) return next();

    const now = Date.now();
    const elapsed = now - tracker.lastRefill;

    // Refill tokens proportionally over the 10-second window
    if (elapsed >= RATE_LIMIT_WINDOW_MS) {
      tracker.tokens = MAX_EVENTS_PER_WINDOW;
      tracker.lastRefill = now;
    } else {
      const tokensToAdd = Math.floor((elapsed / RATE_LIMIT_WINDOW_MS) * MAX_EVENTS_PER_WINDOW);
      if (tokensToAdd > 0) {
        tracker.tokens = Math.min(MAX_EVENTS_PER_WINDOW, tracker.tokens + tokensToAdd);
        tracker.lastRefill = now;
      }
    }

    if (tracker.tokens > 0) {
      tracker.tokens -= 1;
      return next();
    }

    // Rate limit violated!
    tracker.violations += 1;
    logger.warn(
      { socketId, eventName, violations: tracker.violations },
      '[WS HARDENING] Socket event rate limit exceeded'
    );

    socket.emit('error', {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many events sent. Please slow down.',
    });

    if (tracker.violations >= MAX_VIOLATIONS_BEFORE_DISCONNECT) {
      logger.error(
        { socketId, violations: tracker.violations },
        '[WS HARDENING] Disconnecting abusive socket for repeated flood violations'
      );
      socket.disconnect(true);
      return;
    }

    // Drop the rate-limited event
    return;
  });
}
