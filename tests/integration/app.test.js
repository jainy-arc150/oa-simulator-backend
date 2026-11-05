jest.mock('../../src/middleware/notFound', () => jest.fn());

const request = require('supertest');
const AppError = require('../../src/errors/AppError');
const { buildApp } = require('../helpers/appFactory');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('E1 GET /health', () => {
  test('answers 200 with { status: "ok" }', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('X-Request-Id (spec 6.3)', () => {
  test('every response has a UUID X-Request-Id, and each request gets a different one', async () => {
    const { app } = buildApp();
    const first = await request(app).get('/health');
    const second = await request(app).get('/health');
    expect(first.headers['x-request-id']).toMatch(UUID);
    expect(second.headers['x-request-id']).toMatch(UUID);
    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
  });

  test('error responses have it too: 404, malformed JSON, body too large, 500', async () => {
    const normal = buildApp().app;
    const notFound = await request(normal).get('/nope');
    const malformed = await request(normal).post('/health').set('Content-Type', 'application/json').send('{ bad json');
    const tooLarge = await request(normal)
      .post('/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ code: 'x'.repeat(600 * 1024) }));
    const failing = buildApp((req, res, next) => next(new Error('boom'))).app;
    const serverError = await request(failing).get('/anything');

    for (const res of [notFound, malformed, tooLarge, serverError]) {
      expect(res.headers['x-request-id']).toMatch(UUID);
    }
  });
});

describe('Standard error JSON (spec 4.2, 6.2, 6.3)', () => {
  test('an unknown route returns 404 NOT_FOUND', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });

  test('a malformed JSON body returns 400 VALIDATION_ERROR', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/health').set('Content-Type', 'application/json').send('{ bad json');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: expect.any(String) } });
  });

  test('a body over 512 KB returns 413 CODE_TOO_LARGE', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ code: 'x'.repeat(600 * 1024) }));
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: { code: 'CODE_TOO_LARGE', message: expect.any(String) } });
  });

  test('an AppError keeps its code, status, message and details', async () => {
    const { app } = buildApp((req, res, next) =>
      next(new AppError('NOT_ENOUGH_PROBLEMS', 422, 'Cannot fill slot', [{ slot: 1 }]))
    );
    const res = await request(app).get('/anything');
    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      error: { code: 'NOT_ENOUGH_PROBLEMS', message: 'Cannot fill slot', details: [{ slot: 1 }] },
    });
  });

  test('an AppError without details has no details field', async () => {
    const { app } = buildApp((req, res, next) => next(new AppError('ROUND_NOT_READY', 409, 'Not ready')));
    const res = await request(app).get('/anything');
    expect(res.body.error).not.toHaveProperty('details');
  });

  test('a duplicate users.email key becomes 409 EMAIL_TAKEN', async () => {
    const dup = Object.assign(new Error('E11000'), { code: 11000, keyPattern: { email: 1 } });
    const { app } = buildApp((req, res, next) => next(dup));
    const res = await request(app).get('/anything');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  test('a duplicate on the unique ACTIVE-round index becomes 409 ACTIVE_ROUND_EXISTS', async () => {
    const dup = Object.assign(new Error('E11000'), { code: 11000, keyPattern: { user: 1 } });
    const { app } = buildApp((req, res, next) => next(dup));
    const res = await request(app).get('/anything');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ACTIVE_ROUND_EXISTS');
  });
});

describe('Unexpected errors (spec 6.3, 6.8)', () => {
  test('return a generic 500 with no stack or internal message, and the log has the full error under the same request id', async () => {
    const { app, logs } = buildApp((req, res, next) => next(new Error('secret internal detail')));
    const res = await request(app).get('/anything');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
    expect(JSON.stringify(res.body)).not.toMatch(/secret internal detail|at .*\.js/);

    const errorLine = logs.find((line) => line.level === 50);
    expect(errorLine.err.message).toBe('secret internal detail');
    expect(errorLine.err.stack).toEqual(expect.any(String));
    expect(errorLine.req.id).toBe(res.headers['x-request-id']);
  });
});

describe('Request logging (spec 6.5)', () => {
  test('writes one JSON line per request with method, route, status, duration and request id', async () => {
    const { app, logs } = buildApp();
    const res = await request(app).get('/health');

    const lines = logs.filter((line) => line.msg === 'request completed');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      req: { id: res.headers['x-request-id'], method: 'GET' },
      route: '/health',
      res: { statusCode: 200 },
    });
    expect(typeof lines[0].responseTime).toBe('number');
  });

  test('redacts password, authorization, token, code and hiddenTests in every log line', async () => {
    const { app, logs } = buildApp((req, res) => {
      req.log.info(
        { password: 'pw-secret', token: 'tok-secret', code: 'print(code-secret)', hiddenTests: ['hidden-secret'], body: { password: 'nested-secret' } },
        'sensitive fields'
      );
      res.json({});
    });
    await request(app).get('/anything').set('Authorization', 'Bearer header-secret');

    const output = JSON.stringify(logs);
    for (const secret of ['pw-secret', 'tok-secret', 'code-secret', 'hidden-secret', 'nested-secret', 'header-secret']) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain('[Redacted]');
  });
});
