const pino = require('pino');
const env = require('./config/env');
const { connectDB, waitForIndexes, disconnectDB } = require('./config/db');
const createApp = require('./app');
const runner = require('./runner');

const logger = pino({ level: env.LOG_LEVEL });

// Spec 6.7 startup order: validate settings (env.js, already done on require),
// connect to MongoDB, wait for model indexes, then listen.
async function start() {
  await connectDB();
  await waitForIndexes();
  const server = createApp().listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'server listening');
  });

  // Spec 6.7 shutdown: stop accepting requests, let running ones finish, close the database, exit.
  async function shutdown(signal) {
    logger.info({ signal }, 'shutting down');
    server.close(async () => {
      try {
        await runner.shutdown();
        await disconnectDB();
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'error during shutdown');
        process.exit(1);
      }
    });
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Spec 6.3: an unhandled promise rejection must never crash the process silently.
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled promise rejection');
  process.exit(1);
});

start().catch((err) => {
  logger.error({ err }, 'startup failed');
  process.exit(1);
});
