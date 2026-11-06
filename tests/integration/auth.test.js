const request = require('supertest');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const createApp = require('../../src/app');
const User = require('../../src/models/User');
const { useTestDb } = require('../helpers/factories');
const { useFakeClock } = require('../helpers/fakeClock');
const { createLogCapture } = require('../helpers/logCapture');

useTestDb();

const PASSWORD = 'correct horse battery';
const credentials = (overrides = {}) => ({ name: 'Ann Student', email: 'ann@example.com', password: PASSWORD, ...overrides });

let app;
let logs;
beforeEach(() => {
  const capture = createLogCapture();
  logs = capture.lines;
  app = createApp({ logStream: capture.stream });
});

const register = (body = credentials()) => request(app).post('/api/auth/register').send(body);
const login = (body) => request(app).post('/api/auth/login').send(body);
const me = (token) => request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
const expectErrorShape = (res, status, code) => {
  expect(res.status).toBe(status);
  expect(res.body).toEqual({ error: { code, message: expect.any(String) } });
};

describe('E2 POST /api/auth/register (spec 4.4)', () => {
  test('creates the user and returns 201 with a token and { id, name, email }', async () => {
    const res = await register(credentials({ name: '  Ann Student ', email: '  Ann@Example.COM ' }));
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(['token', 'user']);
    expect(res.body.user).toEqual({ id: expect.stringMatching(/^[0-9a-f]{24}$/), name: 'Ann Student', email: 'ann@example.com' });
    const stored = await User.findById(res.body.user.id).select('+passwordHash');
    expect(stored.email).toBe('ann@example.com');
  });

  test('stores a bcrypt hash at the configured cost, never the password', async () => {
    const res = await register();
    const stored = await User.findById(res.body.user.id).select('+passwordHash');
    expect(stored.passwordHash).not.toBe(PASSWORD);
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$10\$/);
    expect(await bcrypt.compare(PASSWORD, stored.passwordHash)).toBe(true);
  });

  test('D21: the token is a valid HS256 JWT for the new user, valid for 1 day', async () => {
    const res = await register();
    const decoded = jwt.decode(res.body.token, { complete: true });
    expect(decoded.header.alg).toBe('HS256');
    expect(decoded.payload.sub).toBe(res.body.user.id);
    expect(decoded.payload.exp - decoded.payload.iat).toBe(24 * 60 * 60);
    expect((await me(res.body.token)).status).toBe(200);
  });

  test('3.4: registering the same email twice, in any letter case, returns 409 EMAIL_TAKEN', async () => {
    expect((await register()).status).toBe(201);
    for (const email of ['ann@example.com', 'ANN@Example.com', '  ann@example.com  ']) {
      const res = await register(credentials({ email }));
      expectErrorShape(res, 409, 'EMAIL_TAKEN');
    }
    expect(await User.countDocuments()).toBe(1);
  });

  test('two simultaneous registrations of one email end with one 201 and one 409', async () => {
    const results = await Promise.all([register(), register()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await User.countDocuments()).toBe(1);
  });

  test('3.4: no response contains passwordHash or the password', async () => {
    const res = await register();
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|correct horse/);
    const conflict = await register();
    expect(JSON.stringify(conflict.body)).not.toMatch(/passwordHash|correct horse/);
  });

  test('unknown fields in the body are removed, not stored', async () => {
    const res = await register({ ...credentials(), passwordHash: 'attacker-hash', _id: '000000000000000000000000', role: 'admin' });
    expect(res.status).toBe(201);
    const stored = await User.findById(res.body.user.id).select('+passwordHash').lean();
    expect(String(stored._id)).not.toBe('000000000000000000000000');
    expect(stored.passwordHash).not.toBe('attacker-hash');
    expect(stored.role).toBeUndefined();
  });

  test('400 VALIDATION_ERROR lists each bad field and never echoes the password', async () => {
    const res = await register({ name: 'A', email: 'not-an-email', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.field).sort()).toEqual(['body.email', 'body.name', 'body.password']);
    expect(JSON.stringify(res.body)).not.toContain('short');
    expect(await User.countDocuments()).toBe(0);
  });

  test('400 when fields are missing', async () => {
    const res = await register({});
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field).sort()).toEqual(['body.email', 'body.name', 'body.password']);
  });

  test('name must be 2 to 50 characters after trimming', async () => {
    expect((await register(credentials({ name: ' A ' }))).status).toBe(400);
    expect((await register(credentials({ name: 'A'.repeat(51) }))).status).toBe(400);
    expect((await register(credentials({ name: 'Al' }))).status).toBe(201);
  });

  test('email must be valid and at most 254 characters', async () => {
    expect((await register(credentials({ email: 'a'.repeat(250) + '@b.co' }))).status).toBe(400);
    const longButValid = `${'a'.repeat(60)}@${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.com`;
    expect(longButValid.length).toBeLessThanOrEqual(254);
    expect((await register(credentials({ email: longButValid }))).status).toBe(201);
  });

  test('password must be 8 to 72 bytes: 7 and 73 bytes fail, 8 and 72 pass', async () => {
    expect((await register(credentials({ password: 'a'.repeat(7) }))).status).toBe(400);
    expect((await register(credentials({ email: 'b@example.com', password: 'a'.repeat(73) }))).status).toBe(400);
    expect((await register(credentials({ email: 'c@example.com', password: 'a'.repeat(8) }))).status).toBe(201);
    expect((await register(credentials({ email: 'd@example.com', password: 'a'.repeat(72) }))).status).toBe(201);
  });

  test('password length counts bytes, not characters', async () => {
    const twentyFiveEuros = '€'.repeat(25); // 25 characters, 75 bytes
    expect((await register(credentials({ password: twentyFiveEuros }))).status).toBe(400);
    expect((await register(credentials({ email: 'e@example.com', password: '€'.repeat(24) }))).status).toBe(201);
  });

  test('wrong types are rejected with 400: object, number, array', async () => {
    expect((await register(credentials({ email: { $gt: '' } }))).status).toBe(400);
    expect((await register(credentials({ password: 12345678 }))).status).toBe(400);
    expect((await register(credentials({ name: ['Ann'] }))).status).toBe(400);
  });
});

describe('E3 POST /api/auth/login (spec 4.4)', () => {
  beforeEach(async () => {
    await register();
  });

  test('returns 200 with a token and { id, name, email }', async () => {
    const res = await login({ email: 'ann@example.com', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: expect.any(String), name: 'Ann Student', email: 'ann@example.com' });
    expect((await me(res.body.token)).body.user.email).toBe('ann@example.com');
  });

  test('the email is matched in any letter case and with spaces around it', async () => {
    const res = await login({ email: '  ANN@Example.com ', password: PASSWORD });
    expect(res.status).toBe(200);
  });

  test('6.8: an unknown email and a wrong password return identical responses', async () => {
    const unknown = await login({ email: 'nobody@example.com', password: PASSWORD });
    const wrong = await login({ email: 'ann@example.com', password: 'wrong password!' });
    expectErrorShape(unknown, 401, 'INVALID_CREDENTIALS');
    expect(unknown.status).toBe(wrong.status);
    expect(unknown.body).toEqual(wrong.body);
  });

  test('6.1: an unknown email still runs one bcrypt comparison, so timing matches', async () => {
    const compare = jest.spyOn(bcrypt, 'compare');
    try {
      await login({ email: 'nobody@example.com', password: PASSWORD });
      expect(compare).toHaveBeenCalledTimes(1);
      compare.mockClear();
      await login({ email: 'ann@example.com', password: 'wrong password!' });
      expect(compare).toHaveBeenCalledTimes(1);
    } finally {
      compare.mockRestore();
    }
  });

  test('3.4: no response contains passwordHash or the password', async () => {
    const ok = await login({ email: 'ann@example.com', password: PASSWORD });
    const bad = await login({ email: 'ann@example.com', password: 'wrong password!' });
    for (const res of [ok, bad]) expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|correct horse|wrong password/);
  });

  test('6.8: an email sent as an object (NoSQL injection attempt) returns 400', async () => {
    const res = await login({ email: { $gt: '' }, password: PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('400 for missing fields and a password of the wrong type', async () => {
    expect((await login({})).status).toBe(400);
    expect((await login({ email: 'ann@example.com', password: { $ne: '' } })).status).toBe(400);
  });
});

describe('E4 GET /api/auth/me (spec 4.4, 6.1)', () => {
  let token;
  let userId;
  beforeEach(async () => {
    const res = await register();
    token = res.body.token;
    userId = res.body.user.id;
  });

  test('returns 200 with { user: { id, name, email } } and nothing else', async () => {
    const res = await me(token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: { id: userId, name: 'Ann Student', email: 'ann@example.com' } });
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  test('4.6: a protected endpoint without a token returns 401 UNAUTHORIZED', async () => {
    expectErrorShape(await request(app).get('/api/auth/me'), 401, 'UNAUTHORIZED');
  });

  test('bad Authorization headers return 401', async () => {
    for (const header of ['Bearer', 'Bearer ', `Basic ${token}`, `bearer ${token}`, token, 'Bearer not.a.jwt', 'Bearer abc']) {
      const res = await request(app).get('/api/auth/me').set('Authorization', header);
      expectErrorShape(res, 401, 'UNAUTHORIZED');
    }
  });

  test('a token signed with another secret returns 401', async () => {
    const forged = jwt.sign({ sub: userId }, 'another-secret-that-is-also-32-chars-long!!', { expiresIn: '1d' });
    expectErrorShape(await me(forged), 401, 'UNAUTHORIZED');
  });

  test('a token with algorithm "none" or HS512 returns 401', async () => {
    const none = jwt.sign({ sub: userId }, '', { algorithm: 'none' });
    const hs512 = jwt.sign({ sub: userId }, process.env.JWT_SECRET, { algorithm: 'HS512', expiresIn: '1d' });
    expectErrorShape(await me(none), 401, 'UNAUTHORIZED');
    expectErrorShape(await me(hs512), 401, 'UNAUTHORIZED');
  });

  test('a token without an expiry returns 401', async () => {
    const noExpiry = jwt.sign({ sub: userId }, process.env.JWT_SECRET, { algorithm: 'HS256' });
    expectErrorShape(await me(noExpiry), 401, 'UNAUTHORIZED');
  });

  test('a token whose sub is not a user id returns 401', async () => {
    const options = { algorithm: 'HS256', expiresIn: '1d' };
    const badSub = jwt.sign({ sub: 'not-an-object-id' }, process.env.JWT_SECRET, options);
    const objectSub = jwt.sign({ sub: { $ne: null } }, process.env.JWT_SECRET, options);
    const noSub = jwt.sign({}, process.env.JWT_SECRET, options);
    for (const bad of [badSub, objectSub, noSub]) expectErrorShape(await me(bad), 401, 'UNAUTHORIZED');
  });

  test('6.8: an expired token returns 401, using the fake clock', async () => {
    const fake = useFakeClock();
    try {
      const { body } = await register(credentials({ email: 'clock@example.com' }));
      fake.advance(24 * 60 * 60 * 1000 - 1000);
      expect((await me(body.token)).status).toBe(200);
      fake.advance(1000);
      expectErrorShape(await me(body.token), 401, 'UNAUTHORIZED');
    } finally {
      fake.restore();
    }
  });

  test('6.8: a token for a deleted user returns 401', async () => {
    await User.deleteOne({ _id: userId });
    expectErrorShape(await me(token), 401, 'UNAUTHORIZED');
  });

  test('6.4: /me is not limited by the register and login limit', async () => {
    for (let i = 0; i < 15; i++) expect((await me(token)).status).toBe(200);
  });
});

describe('Rate limit on register and login (spec 6.4, 6.8)', () => {
  test('6.8: the 11th login request from one IP within a minute returns 429 with Retry-After', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await login({ email: 'nobody@example.com', password: PASSWORD });
      expect(res.status).toBe(401);
    }
    const res = await login({ email: 'nobody@example.com', password: PASSWORD });
    expectErrorShape(res, 429, 'TOO_MANY_REQUESTS');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('register and login share one limit of 10 per minute per IP', async () => {
    for (let i = 0; i < 5; i++) await register(credentials({ email: `u${i}@example.com` }));
    for (let i = 0; i < 5; i++) await login({ email: 'nobody@example.com', password: PASSWORD });
    expect((await register(credentials({ email: 'late@example.com' }))).status).toBe(429);
    expect((await login({ email: 'nobody@example.com', password: PASSWORD })).status).toBe(429);
  });

  test('requests that fail validation also count', async () => {
    for (let i = 0; i < 10; i++) await login({});
    expect((await login({})).status).toBe(429);
  });
});

describe('Logging (spec 6.5, 6.8)', () => {
  test('6.8: no log line contains a password, token, password hash or the Authorization header', async () => {
    const reg = await register();
    const log = await login({ email: 'ann@example.com', password: PASSWORD });
    await login({ email: 'ann@example.com', password: 'wrong password!' });
    await register({ name: 'A', email: 'bad', password: 'secretly-short' });
    await me(reg.body.token);
    await request(app).get('/api/auth/me').set('Authorization', 'Bearer header-secret-value');
    const stored = await User.findOne({ email: 'ann@example.com' }).select('+passwordHash');

    const output = JSON.stringify(logs);
    expect(logs.length).toBeGreaterThan(0);
    for (const secret of [PASSWORD, 'wrong password!', 'secretly-short', reg.body.token, log.body.token, stored.passwordHash, 'header-secret-value']) {
      expect(output).not.toContain(secret);
    }
  });
});

describe('Input filtering (spec 6.2)', () => {
  test('sanitizeFilter is on: an operator inside a filter is treated as a plain value', async () => {
    await register();
    expect(mongoose.get('sanitizeFilter')).toBe(true);
    let found;
    try {
      found = await User.findOne({ email: { $ne: 'nobody@example.com' } });
    } catch (err) {
      found = null;
    }
    expect(found).toBeNull();
  });
});
