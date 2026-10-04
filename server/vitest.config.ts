import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for Privora server integration tests.
 *
 * Key decisions:
 * - fileParallelism: false — tests that hit PostgreSQL and MinIO share real
 *   infrastructure state (the same DB and the same S3 bucket). Running files
 *   in parallel workers causes race conditions (e.g. concurrent ensureBucket()
 *   calls, conflicting test users, NoSuchBucket before another worker creates it).
 *   Sequential execution eliminates these races while keeping each test file's
 *   internal cases fast.
 * - NODE_ENV=test is set here as a fallback; it is also set by the npm test
 *   script so that rate limiters and CSRF guard bypass their in-memory
 *   counters/checks that are incompatible with supertest's loopback IP.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
