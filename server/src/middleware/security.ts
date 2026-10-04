import { Express } from 'express';
import { logger } from '../utils/logger';

/**
 * SECURITY MIDDLEWARE STUB (Part 1)
 * =================================
 * Part 3 will implement:
 * 1. Helmet with strict CSP, HSTS, nosniff, COOP, CORP, Referrer-Policy, remove X-Powered-By
 * 2. Strict CORS allowlist for CORS_ORIGIN
 * 3. CSRF origin and custom header verification on refresh/logout
 */
export function applySecurity(app: Express): void {
  logger.info('[SECURITY STUB] applySecurity initialized (Part 3 will replace with Helmet + CORS + CSRF guards)');
  
  // Disable X-Powered-By header immediately for basic information leakage prevention
  app.disable('x-powered-by');
}
