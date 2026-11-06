const express = require('express');
const pino = require('pino');
const pinoHttp = require('pino-http');
const env = require('./config/env');
const limits = require('./config/limits');
const requestId = require('./middleware/requestId');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');
const { createAuthLimiter } = require('./middleware/rateLimit');
const createAuthRoutes = require('./routes/authRoutes');

// Spec 6.5: these fields are redacted in every log line.
const REDACTED_FIELDS = ['password', 'authorization', 'token', 'code', 'hiddenTests'];
const redactPaths = [
  ...REDACTED_FIELDS,
  ...REDACTED_FIELDS.map((field) => `*.${field}`),
  ...REDACTED_FIELDS.map((field) => `*.*.${field}`),
];

// logStream is only for tests, so log lines can be captured.
function createApp({ logStream } = {}) {
  const app = express();

  const logger = pino({ level: env.LOG_LEVEL, redact: { paths: redactPaths, censor: '[Redacted]' } }, logStream);

  // Spec 6.4: behind a proxy the real client address is used for rate limiting.
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestId);

  // One JSON line per request: method, route, status, duration, request id, user id when known (spec 6.5).
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      serializers: {
        req: (req) => ({ id: req.id, method: req.method }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
      customProps: (req) => ({
        route: req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched',
        userId: req.user ? String(req.user.id) : undefined,
      }),
    })
  );

  app.use(express.json({ limit: limits.MAX_REQUEST_BODY }));

  // E1 (spec 4.4): only reports that the process is alive.
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/api/auth', createAuthRoutes(createAuthLimiter()));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
