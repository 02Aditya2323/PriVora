import fs from 'fs';
import path from 'path';
import { pool } from './pool';
import { logger } from '../utils/logger';

export async function runMigrations() {
  const client = await pool.connect();
  try {
    logger.info('Starting database migrations...');
    await client.query('BEGIN');

    // Migration tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      const { rows } = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file]);
      if (rows.length === 0) {
        logger.info(`Applying migration: ${file}`);
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        logger.info(`Successfully applied migration: ${file}`);
      } else {
        logger.debug(`Migration already applied: ${file}`);
      }
    }

    await client.query('COMMIT');
    logger.info('All database migrations completed successfully.');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error }, 'Migration failed, transaction rolled back');
    throw error;
  } finally {
    client.release();
  }
}

// Run directly if invoked via CLI
if (require.main === module) {
  runMigrations()
    .then(() => {
      logger.info('Migration process finished.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration error:', err);
      process.exit(1);
    });
}
