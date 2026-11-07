const request = require('supertest');
const createApp = require('../../src/app');
const limits = require('../../src/config/limits');
const { useTestDb } = require('../helpers/factories');
const { createLogCapture } = require('../helpers/logCapture');
const { registerStudent } = require('../helpers/rounds');

useTestDb();

let app;
beforeEach(() => {
  app = createApp({ logStream: createLogCapture().stream });
});

// Builds the app with other settings. env.js reads the settings once, so it is loaded again in an
// isolated module registry. These apps are used only for requests that never reach the database.
function appWithSettings(settings) {
  const saved = {};
  for (const [key, value] of Object.entries(settings)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  let isolatedCreateApp;
  try {
    jest.isolateModules(() => {
      isolatedCreateApp = require('../../src/app');
    });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  return isolatedCreateApp({ logStream: createLogCapture().stream });
}

// ---------- helmet ----------

describe('6.1: helmet sets the standard security headers on every response', () => {
  test.each([
    ['a success', (a) => request(a).get('/health'), 200],
    ['a 401', (a) => request(a).get('/api/auth/me'), 401],
    ['a 404', (a) => request(a).get('/no-such-route'), 404],
    ['a 400', (a) => request(a).post('/api/auth/login').set('Content-Type', 'application/json').send('{bad json'), 400],
  ])('%s', async (name, send, status) => {
    const res = await send(app);
    expect(res.status).toBe(status);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['strict-transport-security']).toEqual(expect.any(String));
    expect(res.headers['content-security-policy']).toEqual(expect.any(String));
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

// ---------- CORS ----------

describe('6.1: CORS allows only the listed origins, methods and headers', () => {
  const ALLOWED = 'https://app.example';
  const OTHER = 'https://admin.example';

  test('a listed origin is echoed back (never *), with no credentials mode', async () => {
    const corsApp = appWithSettings({ CORS_ORIGIN: `${ALLOWED}, ${OTHER}` });
    for (const origin of [ALLOWED, OTHER]) {
      const res = await request(corsApp).get('/health').set('Origin', origin);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    }
  });

  test('an origin that is not listed gets no Access-Control-Allow-Origin header', async () => {
    const corsApp = appWithSettings({ CORS_ORIGIN: ALLOWED });
    const res = await request(corsApp).get('/health').set('Origin', 'https://evil.example');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('a preflight from a listed origin allows GET, POST, PUT, DELETE and the Authorization and Content-Type headers', async () => {
    const corsApp = appWithSettings({ CORS_ORIGIN: ALLOWED });
    const res = await request(corsApp)
      .options('/api/assessments')
      .set('Origin', ALLOWED)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Authorization, Content-Type');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-allow-methods']).toBe('GET,POST,PUT,DELETE');
    expect(res.headers['access-control-allow-headers']).toBe('Authorization,Content-Type');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  test('a preflight from an origin that is not listed is not allowed', async () => {
    const corsApp = appWithSettings({ CORS_ORIGIN: ALLOWED });
    const res = await request(corsApp)
      .options('/api/assessments')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('error responses carry the CORS header too, so the browser can read the error', async () => {
    const corsApp = appWithSettings({ CORS_ORIGIN: ALLOWED });
    const res = await request(corsApp).get('/api/auth/me').set('Origin', ALLOWED);
    expect(res.status).toBe(401);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
  });

  test('without CORS_ORIGIN (development and test) no origin is allowed', async () => {
    const corsApp = appWithSettings({ CORS_ORIGIN: '' });
    const simple = await request(corsApp).get('/health').set('Origin', 'http://localhost:3000');
    expect(simple.status).toBe(200);
    expect(simple.headers['access-control-allow-origin']).toBeUndefined();

    const preflight = await request(corsApp)
      .options('/api/assessments')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST');
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
  });
});

// ---------- the request log line ----------

describe('6.5: one log line per request', () => {
  test('it holds the method, the route pattern, the status, the duration, the request id and the user id when known', async () => {
    const capture = createLogCapture();
    const logged = createApp({ logStream: capture.stream });
    const a = await registerStudent(logged);
    const id = '0123456789abcdef01234567';

    const res = await request(logged).get(`/api/assessments/${id}`).set('Authorization', `Bearer ${a.token}`);
    await request(logged).get('/api/topics');

    const lines = capture.lines.filter((line) => line.msg === 'request completed');
    expect(lines[lines.length - 2]).toMatchObject({
      req: { id: res.headers['x-request-id'], method: 'GET' },
      route: '/api/assessments/:id',
      res: { statusCode: 404 },
      userId: a.id,
      responseTime: expect.any(Number),
    });
    expect(lines[lines.length - 1]).toMatchObject({ route: '/api/topics', res: { statusCode: 401 } });
    expect(lines[lines.length - 1].userId).toBeUndefined();
    // The round id appears only in the route pattern, never as a value.
    expect(JSON.stringify(lines[lines.length - 2])).not.toContain(id);
  });
});

// ---------- the general rate limit ----------

describe('6.4: every other /api endpoint allows 200 requests per minute per user (IP address without a valid token)', () => {
  const me = (token) => request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

  async function useUp(send) {
    for (let i = 0; i < limits.API_RATE_LIMIT_MAX; i++) {
      const res = await send();
      expect(res.status).not.toBe(429);
    }
  }

  test('the 201st request of a user returns 429 TOO_MANY_REQUESTS with Retry-After; another user is not affected', async () => {
    const a = await registerStudent(app);
    const b = await registerStudent(app);

    await useUp(() => me(a.token));
    const refused = await me(a.token);
    expect(refused.status).toBe(429);
    expect(refused.body.error.code).toBe('TOO_MANY_REQUESTS');
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect(refused.headers['x-request-id']).toEqual(expect.any(String));

    expect((await me(b.token)).status).toBe(200);
  });

  test('requests without a valid token are counted by IP address, apart from the users', async () => {
    const a = await registerStudent(app);

    await useUp(() => request(app).get('/api/topics'));
    const refused = await request(app).get('/api/topics').set('Authorization', 'Bearer not-a-real-token');
    expect(refused.status).toBe(429);
    expect(refused.body.error.code).toBe('TOO_MANY_REQUESTS');

    expect((await me(a.token)).status).toBe(200);
  });

  test('register and login are not part of it; they keep their own limit', async () => {
    const a = await registerStudent(app);
    await useUp(() => request(app).get('/api/topics'));

    const login = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'whatever-password' });
    expect(login.status).toBe(401);
    expect(login.body.error.code).toBe('INVALID_CREDENTIALS');

    // And logging in does not use up the general limit: the user still has all 200.
    await useUp(() => me(a.token));
  });

  test('/health is not an /api endpoint and is not limited', async () => {
    for (let i = 0; i <= limits.API_RATE_LIMIT_MAX; i++) {
      expect((await request(app).get('/health')).status).toBe(200);
    }
  });
});
