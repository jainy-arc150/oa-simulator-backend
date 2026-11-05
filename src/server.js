const env = require('./config/env');
const { connectDB, disconnectDB } = require('./config/db');
const createApp = require('./app');

async function startServer() {
  try {
    // Section 6.7: Startup order:
    // 1. Validate settings (done in env.js, throws and exits if invalid)
    console.log(`Starting server in ${env.NODE_ENV} mode on port ${env.PORT}`);

    // 2. Connect to MongoDB
    await connectDB();

    // 3. Wait for model indexes to exist (models will be defined in later phases)
    // For Phase 0, this is a no-op

    // Create and start the app
    const app = createApp();

    const server = app.listen(env.PORT, () => {
      console.log(`Server listening on port ${env.PORT}`);
    });

    // Section 6.7: Graceful shutdown on SIGTERM or SIGINT
    const gracefulShutdown = async (signal) => {
      console.log(`Received ${signal}, shutting down gracefully...`);

      // Stop accepting new requests
      server.close(async () => {
        // Kill any running Python processes and delete temp folders (will be implemented in Phase 3)
        // Close the database connection
        await disconnectDB();
        console.log('Server shut down successfully');
        process.exit(0);
      });

      // Force exit after 30 seconds
      setTimeout(() => {
        console.error('Forced shutdown after 30 seconds');
        process.exit(1);
      }, 30000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

// Only start if this is the main module (not imported in tests)
if (require.main === module) {
  startServer();
}

module.exports = startServer;
