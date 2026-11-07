const request = require('supertest');
const createApp = require('../../src/app');
const limits = require('../../src/config/limits');
const { useTestDb, createProblem } = require('../helpers/factories');
const { useFakeClock } = require('../helpers/fakeClock');
const { createLogCapture } = require('../helpers/logCapture');
const { START, roundApi, slot } = require('../helpers/rounds');

// Spec 7.9: the demonstration script. "The project is done when this works." Every step runs
// through the API with the real runner and real Python; only the clock is controlled.

useTestDb();

let app;
let clock;
beforeEach(() => {
  clock = useFakeClock(START);
  app = createApp({ logStream: createLogCapture().stream });
});
afterEach(() => clock.restore());

const api = roundApi(() => app);
const python = (code) => ({ language: 'python', code });
const SUBMIT_COOLDOWN_MS = limits.SUBMIT_COOLDOWN_SECONDS * 1000;

const CORRECT = 'a, b = map(int, input().split())\nprint(a + b)\n';
const WRONG = 'a, b = map(int, input().split())\nprint(a - b)\n';
const CRASHING = 'a, b = map(int, input().split())\nprint(a // 0)\n';
const INFINITE = 'while True:\n    pass\n';
const SYNTAX_ERROR = 'a, b = map(int, input().split())\nif a > b\n    print(a)\n';

test('[slow] 7.9: the demonstration script, steps 1 to 8', async () => {
  // Three approved problems (print a + b) in three topics, with a short time limit.
  for (const topic of ['arrays', 'strings', 'math']) await createProblem({ topic, difficulty: 'easy', timeLimitMs: 600 });

  // 1. Register and log in; call /me.
  const registered = await request(app).post('/api/auth/register').send({ name: 'Demo Student', email: 'demo@example.com', password: 'demo-password-1' });
  expect(registered.status).toBe(201);
  const login = await request(app).post('/api/auth/login').send({ email: 'demo@example.com', password: 'demo-password-1' });
  expect(login.status).toBe(200);
  const token = login.body.token;
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
  expect(me.body.user).toEqual({ id: registered.body.user.id, name: 'Demo Student', email: 'demo@example.com' });

  // 2. List topics; build a round with three questions; list rounds; get the round (no statements yet).
  const topics = await request(app).get('/api/topics').set('Authorization', `Bearer ${token}`);
  expect(topics.body.topics.map((t) => t.topic)).toEqual(['arrays', 'strings', 'math']);
  const created = await api.createRound(token, { slots: [slot('arrays', 'easy'), slot('strings', 'easy'), slot('math', 'easy')] });
  expect(created.status).toBe(201);
  const id = created.body.id;
  expect((await api.listRounds(token)).body.items.map((item) => item.id)).toEqual([id]);
  const ready = await api.getRound(token, id);
  expect(ready.body.status).toBe('READY');
  expect(JSON.stringify(ready.body)).not.toMatch(/statement|samples|"code"/);

  // 3. Start it; see the deadline and server time; try to start a second round (409).
  const started = await api.startRound(token, id);
  expect(started.body).toMatchObject({ status: 'ACTIVE', startedAt: START.toISOString(), serverTime: START.toISOString() });
  expect(new Date(started.body.deadline) - START).toBe(started.body.durationMin * 60000);
  const second = await api.createRound(token, { slots: [slot('math', 'easy')] });
  const secondStart = await api.startRound(token, second.body.id);
  expect(secondStart.status).toBe(409);
  expect(secondStart.body.error.code).toBe('ACTIVE_ROUND_EXISTS');

  // 4. Open a question; autosave code; Run on samples; Submit a correct solution (ACCEPTED).
  const opened = await api.openQuestion(token, id, 1);
  expect(opened.body).toMatchObject({ index: 1, statement: expect.any(String), samples: [{ input: '1 2\n', output: '3\n' }] });
  expect((await api.saveCode(token, id, 1, { code: CORRECT })).status).toBe(204);
  const run = await api.runCode(token, id, 1, python(CORRECT));
  expect(run.body).toMatchObject({ compilation: null, testsPassed: 1, totalTests: 1 });
  const accepted = await api.submitCode(token, id, 1, python(CORRECT));
  expect(accepted.body).toMatchObject({ verdict: 'ACCEPTED', solved: true });

  // 5. Wrong, crashing and infinite-loop solutions on other questions (NOT_ACCEPTED); a syntax error
  //    (COMPILATION_ERROR with its line number).
  await api.openQuestion(token, id, 2);
  await api.openQuestion(token, id, 3);
  const attempts = [
    [2, WRONG],
    [3, CRASHING],
    [2, INFINITE],
  ];
  for (const [index, code] of attempts) {
    clock.advance(SUBMIT_COOLDOWN_MS);
    const res = await api.submitCode(token, id, index, python(code));
    expect(res.body).toEqual({ verdict: 'NOT_ACCEPTED', solved: false, submitsLeft: expect.any(Number), serverTime: expect.any(String) });
  }
  clock.advance(SUBMIT_COOLDOWN_MS);
  const syntax = await api.submitCode(token, id, 3, python(SYNTAX_ERROR));
  expect(syntax.body.verdict).toBe('COMPILATION_ERROR');
  expect(syntax.body.errorMessage).toMatch(/^Line 2: SyntaxError: /);

  // 6. Submit again within the cooldown (429).
  const tooSoon = await api.submitCode(token, id, 3, python(CORRECT));
  expect(tooSoon.status).toBe(429);
  expect(tooSoon.body.error.code).toBe('COOLDOWN');

  // 7. Let the deadline pass and read the report; try to submit afterwards (409).
  clock.set(new Date(new Date(started.body.deadline).getTime() + 60000));
  const report = await api.getRound(token, `${id}/report`);
  expect(report.status).toBe(200);
  expect(report.body).toMatchObject({
    finishReason: 'EXPIRED',
    finishedAt: started.body.deadline,
    grade: 'PARTIAL',
    summary: { solved: 1, total: 3 },
  });
  expect(report.body.questions.map((q) => q.failureReason)).toEqual([null, 'TOO_SLOW', 'SYNTAX_ERROR']);
  const late = await api.submitCode(token, id, 3, python(CORRECT));
  expect(late.status).toBe(409);
  expect(late.body.error.code).toBe('ROUND_EXPIRED');

  // 8. Try to read the round as a second user (404).
  const other = await request(app).post('/api/auth/register').send({ name: 'Other Student', email: 'other@example.com', password: 'other-password-1' });
  const stranger = await api.getRound(other.body.token, id);
  expect(stranger.status).toBe(404);
  expect(stranger.body.error.code).toBe('NOT_FOUND');
});
