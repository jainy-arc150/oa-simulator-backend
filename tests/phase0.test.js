const request = require('supertest');
const express = require('express');
const createApp = require('../src/app');
const AppError = require('../src/errors/AppError');

// Mock mongoose connection since we're not using real DB in Phase 0
jest.mock('../src/config/db', () => ({
  connectDB: jest.fn(),
  waitForIndexes: jest.fn(),
  disconnectDB: jest.fn(),
}));

describe('Phase 0: Skeleton - Acceptance Checks', () => {
  describe('E1 - Health endpoint', () => {
    test('E1 answers with { status: "ok" } at 200', async () => {
      const app = createApp();
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });
  });

  describe('Request ID header', () => {
    test('Every response has X-Request-Id header', async () => {
      const app = createApp();
      const res = await request(app).get('/health');
      expect(res.headers['x-request-id']).toBeDefined();
      expect(res.headers['x-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    test('Unknown route response also has X-Request-Id header', async () => {
      const app = createApp();
      const res = await request(app).get('/unknown-route');
      expect(res.headers['x-request-id']).toBeDefined();
      expect(res.headers['x-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });
  });

  describe('Unknown route handling', () => {
    test('Unknown route returns standard error JSON at 404', async () => {
      const app = createApp();
      const res = await request(app).get('/unknown-route');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        error: {
          code: 'NOT_FOUND',
          message: expect.any(String),
        },
      });
    });

    test('Unknown route response format has error.code and error.message', async () => {
      const app = createApp();
      const res = await request(app).get('/api/nonexistent');
      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(typeof res.body.error.message).toBe('string');
    });
  });

  describe('Error handling', () => {
    test('Thrown error returns standard error JSON at 500', async () => {
      // Create a test app with error-throwing route BEFORE notFound middleware
      const helmet = require('helmet');
      const cors = require('cors');
      const pinoHttp = require('pino-http');
      const env = require('../src/config/env');
      const requestIdMiddleware = require('../src/middleware/requestId');
      const errorHandler = require('../src/middleware/errorHandler');

      const app = express();
      app.use(helmet());
      app.use(cors());
      app.use(requestIdMiddleware);
      if (env.NODE_ENV !== 'test') {
        app.use(pinoHttp({ level: env.LOG_LEVEL }));
      } else {
        app.use(pinoHttp({ level: 'silent', autoLogging: false }));
      }
      app.use(express.json());

      // Test route that throws
      app.get('/test-error', (req, res, next) => {
        next(new Error('Test error'));
      });

      app.use(errorHandler);

      const res = await request(app).get('/test-error');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: {
          code: 'INTERNAL_ERROR',
          message: expect.any(String),
        },
      });
    });

    test('AppError is formatted correctly', async () => {
      const helmet = require('helmet');
      const cors = require('cors');
      const pinoHttp = require('pino-http');
      const env = require('../src/config/env');
      const requestIdMiddleware = require('../src/middleware/requestId');
      const errorHandler = require('../src/middleware/errorHandler');

      const app = express();
      app.use(helmet());
      app.use(cors());
      app.use(requestIdMiddleware);
      if (env.NODE_ENV !== 'test') {
        app.use(pinoHttp({ level: env.LOG_LEVEL }));
      } else {
        app.use(pinoHttp({ level: 'silent', autoLogging: false }));
      }
      app.use(express.json());

      app.get('/test-app-error', (req, res, next) => {
        next(new AppError('TEST_ERROR', 400, 'Test message', { field: 'value' }));
      });

      app.use(errorHandler);

      const res = await request(app).get('/test-app-error');
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: {
          code: 'TEST_ERROR',
          message: 'Test message',
          details: { field: 'value' },
        },
      });
    });

    test('AppError without details is formatted correctly', async () => {
      const helmet = require('helmet');
      const cors = require('cors');
      const pinoHttp = require('pino-http');
      const env = require('../src/config/env');
      const requestIdMiddleware = require('../src/middleware/requestId');
      const errorHandler = require('../src/middleware/errorHandler');

      const app = express();
      app.use(helmet());
      app.use(cors());
      app.use(requestIdMiddleware);
      if (env.NODE_ENV !== 'test') {
        app.use(pinoHttp({ level: env.LOG_LEVEL }));
      } else {
        app.use(pinoHttp({ level: 'silent', autoLogging: false }));
      }
      app.use(express.json());

      app.get('/test-app-error-no-details', (req, res, next) => {
        next(new AppError('TEST_ERROR', 400, 'Test message'));
      });

      app.use(errorHandler);

      const res = await request(app).get('/test-app-error-no-details');
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: {
          code: 'TEST_ERROR',
          message: 'Test message',
        },
      });
    });
  });

  describe('CORS and Security Headers', () => {
    test('Response includes security headers from helmet', async () => {
      const app = createApp();
      const res = await request(app).get('/health');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      // helmet default is SAMEORIGIN, not DENY
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    });
  });

  describe('JSON validation', () => {
    test('Malformed JSON is handled by error middleware', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/health')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }');

      // Express's built-in JSON parser returns 400 for syntax errors
      expect([400, 500]).toContain(res.status);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBeDefined();
    });
  });
});
