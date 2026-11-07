const request = require('supertest');
const createApp = require('../../src/app');
const RunnerUnavailableError = require('../../src/errors/RunnerUnavailableError');
const { useTestDb } = require('../helpers/factories');
const { useFakeClock } = require('../helpers/fakeClock');
const { createLogCapture } = require('../helpers/logCapture');
const { useFakeRunner, ok, crash } = require('../helpers/fakeRunner');
const { START, at, roundApi, slot, newId, rawRounds, markedProblem } = require('../helpers/rounds');

// Checks that hold across all 16 endpoints at once (spec 4.6, 3.5, 6.8, R1, R2).

useTestDb();

let app;
let logs;
let clock;
let runner;
beforeEach(() => {
  clock = useFakeClock(START);
  const capture = createLogCapture();
  logs = capture.lines;
  app = createApp({ logStream: capture.stream });
  runner = useFakeRunner();
});
afterEach(() => {
  clock.restore();
  jest.restoreAllMocks();
});

const api = roundApi(() => app);
const PASSWORD = 'sweep-password-123';
let emailCounter = 0;
async function register() {
  const email = `sweep${++emailCounter}@example.com`;
  const res = await request(app).post('/api/auth/register').send({ name: 'Sweep Student', email, password: PASSWORD });
  return { token: res.body.token, id: res.body.user.id, email };
}

const python = (code) => ({ language: 'python', code });

// Every endpoint that needs a token, called on a round id (E4 to E16).
const protectedCalls = (id, token) => [
  ['E4 GET /api/auth/me', () => withToken(request(app).get('/api/auth/me'), token)],
  ['E5 GET /api/topics', () => withToken(request(app).get('/api/topics'), token)],
  ['E6 POST /api/assessments', () => withToken(request(app).post('/api/assessments'), token).send({ slots: [slot('arrays', 'easy')] })],
  ['E7 GET /api/assessments', () => withToken(request(app).get('/api/assessments'), token)],
  ...roundCalls(id, token),
];
// Every endpoint about one round (E8 to E16).
const roundCalls = (id, token) => [
  ['E8 GET a round', () => api.getRound(token, id)],
  ['E9 DELETE a round', () => api.deleteRound(token, id)],
  ['E10 start', () => api.startRound(token, id)],
  ['E11 finish', () => api.finishRound(token, id)],
  ['E12 open', () => api.openQuestion(token, id, 1)],
  ['E13 autosave', () => api.saveCode(token, id, 1, { code: 'a = 1' })],
  ['E14 run', () => api.runCode(token, id, 1, python('a = 1'))],
  ['E15 submit', () => api.submitCode(token, id, 1, python('a = 1'))],
  ['E16 report', () => api.getRound(token, `${id}/report`)],
];
const withToken = (req, token) => (token ? req.set('Authorization', `Bearer ${token}`) : req);

describe('4.6: any protected endpoint without a token returns 401', () => {
  test('all 13 protected endpoints (E4 to E16)', async () => {
    const calls = protectedCalls(newId(), null);
    expect(calls).toHaveLength(13);
    for (const [name, call] of calls) {
      const res = await call();
      expect({ name, status: res.status, code: res.body.error && res.body.error.code }).toEqual({ name, status: 401, code: 'UNAUTHORIZED' });
    }
    expect(runner.calls).toHaveLength(0);
  });
});

describe("R1, 4.6: user B calling any round endpoint on user A's round gets 404, and nothing changes", () => {
  test.each(['READY', 'ACTIVE', 'FINISHED'])('all 9 round endpoints (E8 to E16) on a %s round', async (status) => {
    const a = await register();
    const b = await register();
    await markedProblem('arrays', 'easy');
    const round = (await api.createRound(a.token, { slots: [slot('arrays', 'easy')] })).body;
    if (status !== 'READY') await api.startRound(a.token, round.id);
    if (status === 'FINISHED') await api.finishRound(a.token, round.id);
    const before = await rawRounds();

    const calls = roundCalls(round.id, b.token);
    expect(calls).toHaveLength(9);
    for (const [name, call] of calls) {
      const res = await call();
      expect({ name, status: res.status, code: res.body.error.code }).toEqual({ name, status: 404, code: 'NOT_FOUND' });
      expect(JSON.stringify(res.body)).not.toContain(round.id);
    }
    expect(await rawRounds()).toEqual(before);
    expect(runner.calls).toHaveLength(0);
  });
});

describe('4.6, 3.5, R2, 6.8: across a whole round, no response or log line carries hidden or secret data', () => {
  test('every response of every endpoint, and every log line', async () => {
    const responses = [];
    const record = async (call) => {
      const res = await call;
      responses.push(res);
      return res;
    };

    // E2 to E5
    const a = await register();
    const loginRes = await record(request(app).post('/api/auth/login').send({ email: a.email, password: PASSWORD }));
    await record(request(app).post('/api/auth/login').send({ email: a.email, password: 'wrong-password-456' }));
    await record(request(app).get('/api/auth/me').set('Authorization', `Bearer ${a.token}`));
    await markedProblem('arrays', 'easy');
    await markedProblem('strings', 'medium');
    await record(request(app).get('/api/topics').set('Authorization', `Bearer ${a.token}`));

    // E6 to E9
    const spare = await record(api.createRound(a.token, { slots: [slot('arrays', 'easy')] }));
    const created = await record(api.createRound(a.token, { slots: [slot('arrays', 'easy'), slot('strings', 'medium')] }));
    const id = created.body.id;
    await record(api.listRounds(a.token));
    await record(api.getRound(a.token, id));
    await record(api.deleteRound(a.token, spare.body.id));

    // E10 to E15, with every kind of result
    await record(api.startRound(a.token, id));
    const answer = (input) => ok(input.replace('-IN-', '-OUT-'));
    const steps = [
      () => api.openQuestion(a.token, id, 1),
      () => api.saveCode(a.token, id, 1, { code: 'print("CODE-MARKER")' }),
      () => api.runCode(a.token, id, 1, python('print("CODE-MARKER")')),
      () => api.submitCode(a.token, id, 1, python('print("CODE-MARKER")')),
      () => api.openQuestion(a.token, id, 2),
      () => {
        runner.program((input) => crash(`Traceback (most recent call last):\nValueError: bad input ${input.trim()}\n`));
        return api.runCode(a.token, id, 2, python('print("CODE-MARKER")'));
      },
      () => {
        runner.program((input) => (input.startsWith('SAMPLE') ? answer(input) : crash(`ValueError: ${input.trim()}\n`)));
        return api.submitCode(a.token, id, 2, python('print("CODE-MARKER")'));
      },
      () => {
        runner.program((input) => (input.startsWith('SAMPLE') ? answer(input) : ok('wrong\n')));
        return api.submitCode(a.token, id, 2, python('print("CODE-MARKER")'));
      },
      () => {
        runner.compileError('SyntaxError: invalid syntax', 1);
        return api.submitCode(a.token, id, 2, python('print("CODE-MARKER"'));
      },
      () => {
        runner.respond(async () => {
          throw new RunnerUnavailableError('The fake runner failed');
        });
        return api.submitCode(a.token, id, 2, python('print("CODE-MARKER")'));
      },
    ];
    runner.program(answer);
    for (const [i, step] of steps.entries()) {
      clock.set(at(1 + i * 0.25));
      await record(step());
    }

    // E11 and E16
    clock.set(at(10));
    await record(api.finishRound(a.token, id));
    const report = await record(api.getRound(a.token, `${id}/report`));
    expect(report.status).toBe(200);
    expect(responses.map((res) => res.status)).toEqual([
      200, 401, 200, 200, 201, 201, 200, 200, 204, 200, 200, 204, 200, 200, 200, 200, 200, 200, 200, 503, 200, 200,
    ]);

    // No response contains hidden tests, password data or failedTestNumber, or any hidden input or output.
    for (const res of responses) {
      const text = JSON.stringify({ body: res.body, text: res.text, headers: res.headers });
      for (const forbidden of ['hiddenTests', 'passwordHash', 'failedTestNumber', 'HIDDEN-IN-MARKER', 'HIDDEN-OUT-MARKER', PASSWORD, 'wrong-password-456']) {
        expect(text).not.toContain(forbidden);
      }
    }

    // No log line contains a password, a token, student code or any test data.
    const logText = JSON.stringify(logs);
    for (const secret of [PASSWORD, 'wrong-password-456', a.token, loginRes.body.token, 'CODE-MARKER', 'SAMPLE-IN-MARKER', 'SAMPLE-OUT-MARKER', 'HIDDEN-IN-MARKER', 'HIDDEN-OUT-MARKER', 'EXPLANATION-MARKER', 'STATEMENT-MARKER', 'passwordHash']) {
      expect(logText).not.toContain(secret);
    }
    // The round events and the Submit verdicts were logged (with ids only).
    expect(logs.map((line) => line.msg)).toEqual(
      expect.arrayContaining(['round created', 'round started', 'round finished', 'submission graded', 'runner unavailable'])
    );
  });
});
