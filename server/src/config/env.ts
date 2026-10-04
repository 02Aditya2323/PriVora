import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load .env from project root or server root
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  ACCESS_TOKEN_SECRET: z.string().min(32, 'ACCESS_TOKEN_SECRET must be at least 32 characters long'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(7),
  FILE_KEK_V1: z.string().refine((val) => {
    try {
      const buf = Buffer.from(val, 'base64');
      return buf.length === 32;
    } catch {
      return false;
    }
  }, 'FILE_KEK_V1 must be a valid base64-encoded 32-byte key'),
  FILE_KEK_CURRENT_VERSION: z.coerce.number().default(1),
  S3_ENDPOINT: z.string().url('S3_ENDPOINT must be a valid URL'),
  S3_BUCKET: z.string().min(3, 'S3_BUCKET must be at least 3 characters'),
  S3_ACCESS_KEY: z.string().min(3, 'S3_ACCESS_KEY is required'),
  S3_SECRET_KEY: z.string().min(8, 'S3_SECRET_KEY must be at least 8 characters'),
  S3_REGION: z.string().default('us-east-1'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  MAX_UPLOAD_BYTES: z.coerce.number().default(26214400), // 25 MB
  USER_QUOTA_BYTES: z.coerce.number().default(524288000), // 500 MB
}).refine((data) => {
  // Disallow default minio credentials
  const defaultKeys = ['minioadmin', 'admin', 'password', 'root'];
  if (defaultKeys.includes(data.S3_ACCESS_KEY.toLowerCase()) || defaultKeys.includes(data.S3_SECRET_KEY.toLowerCase())) {
    return false;
  }
  return true;
}, {
  message: 'Insecure or default MinIO credentials detected (minioadmin/admin/password). Please set strong custom credentials.',
  path: ['S3_ACCESS_KEY'],
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Environment validation failed:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
