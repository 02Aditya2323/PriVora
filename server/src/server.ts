import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { app } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { storage } from './storage/S3Adapter';
import { setSocketIOInstance } from './realtime/emit';
import { setupSocketIO } from './realtime/socket';
import { pool } from './db/pool';
import { runMigrations } from './db/migrate';

export const httpServer = http.createServer(app);

// Socket.IO server bootstrap (in-memory adapter for single instance)
export const io = new SocketIOServer(httpServer, {
  cors: {
    origin: env.CORS_ORIGIN,
    credentials: true,
  },
  maxHttpBufferSize: 10000, // 10 KB limit per spec §8.7
});

setSocketIOInstance(io);
setupSocketIO(io);

async function startServer() {
  try {
    logger.info('Initializing Privora Core Backend...');

    // 1. Run migrations to ensure database schema is ready
    await runMigrations();

    // 2. Ensure MinIO private storage bucket exists
    await storage.ensureBucket();

    // 3. Listen on configured port
    httpServer.listen(env.PORT, () => {
      logger.info(`🚀 Privora API server listening on http://localhost:${env.PORT} in ${env.NODE_ENV} mode`);
    });
  } catch (error) {
    logger.fatal({ error }, 'Failed to start Privora server');
    process.exit(1);
  }
}

// Graceful shutdown handling
function handleShutdown(signal: string) {
  logger.info(`${signal} received. Initiating graceful shutdown...`);
  httpServer.close(async () => {
    logger.info('HTTP server closed.');
    io.close(() => {
      logger.info('Socket.IO connections closed.');
    });
    await pool.end();
    logger.info('PostgreSQL connection pool drained. Exiting cleanly.');
    process.exit(0);
  });
}

if (env.NODE_ENV !== 'test') {
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}

if (require.main === module) {
  startServer();
}
