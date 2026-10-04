import { Pool, QueryResult, QueryResultRow } from 'pg';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected error on idle PostgreSQL client');
});

export const db = {
  query: <T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> => {
    return pool.query<T>(text, params);
  },
  getClient: () => pool.connect(),
  pool,
};
