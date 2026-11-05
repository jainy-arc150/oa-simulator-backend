const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const pinoHttp = require('pino-http');
const env = require('./config/env');
const requestIdMiddleware = require('./middleware/requestId');
const notFoundMiddleware = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');

function createApp() {
  const app = express();

  // Security headers (section 6.1)
  app.use(helmet());

  // CORS (section 6.1: section says only listed origins, methods, and headers)
  const corsOptions = {
    origin: env.CORS_ORIGIN ? env.CORS_ORIGIN.split(',') : '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    credentials: false,
  };
  app.use(cors(corsOptions));

  // Request ID middleware (section 6.3)
  app.use(requestIdMiddleware);

  // JSON logging with pino (section 6.5)
  // In test environment, suppress logs
  if (env.NODE_ENV !== 'test') {
    app.use(pinoHttp({
      level: env.LOG_LEVEL,
    }));
  } else {
    // In test, use a silent logger
    app.use(pinoHttp({
      level: 'silent',
      autoLogging: false,
    }));
  }

  // Body parser (built into express)
  app.use(express.json());

  // Health check (E1, section 4.4)
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Base path for API (section 4.1)
  // Routes will be mounted here by server.js or in a separate routes module
  // For Phase 0, only /health exists

  // 404 handler (section 6.2, 6.3)
  app.use(notFoundMiddleware);

  // Error handler (section 6.3, central middleware for all errors)
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
