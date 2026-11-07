const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const pino = require('pino');
const pinoHttp = require('pino-http');
const env = require('./config/env');
const limits = require('./config/limits');
const requestId = require('./middleware/requestId');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');
const { createAuthLimiter, createApiLimiter } = require('./middleware/rateLimit');
const createAuthRoutes = require('./routes/authRoutes');
const topicRoutes = require('./routes/topicRoutes');
const assessmentRoutes = require('./routes/assessmentRoutes');

// Spec 6.5: these fields are redacted in every log line, at any of the first four levels.
const REDACTED_FIELDS = ['password', 'authorization', 'token', 'code', 'hiddenTests'];
const redactPaths = REDACTED_FIELDS.flatMap((field) => [field, `*.${field}`, `*.*.${field}`, `*.*.*.${field}`]);

// Spec 6.5: the request's route pattern and user id, added to the one line written when the request
// ends (they are only known after routing and authentication). Express resets req.baseUrl when a
// router is left, so each router's mount path is recorded on the way in (see `mount`).
function routePattern(req) {
  if (!req.route) return 'unmatched';
  if (!req.mountPath) return req.route.path;
  return req.route.path === '/' ? req.mountPath : `${req.mountPath}${req.route.path}`;
}
const requestContext = (req) => ({ route: routePattern(req), userId: req.user ? String(req.user.id) : undefined });

const recordMountPath = (req, res, next) => {
  req.mountPath = req.baseUrl;
  next();
};

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
      customSuccessObject: (req, res, value) => ({ ...value, ...requestContext(req) }),
      customErrorObject: (req, res, err, value) => ({ ...value, ...requestContext(req) }),
    })
  );

  // Spec 6.1: the standard security headers on every response.
  app.use(helmet());

  // Spec 6.1: only the origins listed in CORS_ORIGIN (none when it is not set), the four methods
  // and the two headers the API uses. No credentials mode.
  app.use(
    cors({
      origin: env.CORS_ORIGIN.length > 0 ? env.CORS_ORIGIN : false,
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type'],
      credentials: false,
    })
  );

  app.use(express.json({ limit: limits.MAX_REQUEST_BODY }));

  // E1 (spec 4.4): only reports that the process is alive.
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Spec 6.4: register and login have their own limiter; every other /api endpoint shares this one.
  app.use('/api', createApiLimiter());
  app.use('/api/auth', recordMountPath, createAuthRoutes(createAuthLimiter()));
  app.use('/api/topics', recordMountPath, topicRoutes);
  app.use('/api/assessments', recordMountPath, assessmentRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
