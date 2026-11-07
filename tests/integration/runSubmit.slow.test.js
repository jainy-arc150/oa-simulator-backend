const fs = require('fs');
const os = require('os');
const createApp = require('../../src/app');
const limits = require('../../src/config/limits');
const Submission = require('../../src/models/Submission');
const { TEMP_PREFIX } = require('../../src/runner');
const { useTestDb, createProblem } = require('../helpers/factories');
const { useFakeClock } = require('../helpers/fakeClock');
const { createLogCapture } = require('../helpers/logCapture');
const { START, registerStudent, roundApi, saveRound, activeFields } = require('../helpers/rounds');

// The real runner and real Python (spec 7.3 Phase 7: "with the real runner a correct and a wrong
// program behave the same"). Marked slow: it needs Python installed.

useTestDb();

let app;
let logs;
let clock;
beforeEach(() => {
  clock = useFakeClock(START);
  const capture = createLogCapture();
  logs = capture.lines;
  app = createApp({ logStream: capture.stream });
});
afterEach(() => clock.restore());

const { runCode, submitCode } = roundApi(() => app);
const SUBMIT_COOLDOWN_MS = limits.SUBMIT_COOLDOWN_SECONDS * 1000;

// The factory problem (print a + b): one sample and five hidden tests, with a short time limit.
async function setup() {
  const { token, id } = await registerStudent(app);
  const problem = await createProblem({ timeLimitMs: 600 });
  const round = await saveRound(id, [problem], activeFields());
  return { token, roundId: String(round._id) };
}

async function runAndSubmit(code) {
  const { token, roundId } = await setup();
  const run = await runCode(token, roundId, 1, { language: 'python', code });
  clock.advance(SUBMIT_COOLDOWN_MS);
  const submit = await submitCode(token, roundId, 1, { language: 'python', code });
  const [submission] = await Submission.find({ assessment: roundId }).lean();
  return { run, submit, submission };
}

// No response, stored text or log line may show where the server keeps its temp folders (5.2).
function expectNoServerPaths(...values) {
  const tmp = os.tmpdir();
  const paths = [tmp, fs.realpathSync(tmp), TEMP_PREFIX];
  const text = JSON.stringify([...values, logs]);
  for (const p of paths) expect(text).not.toContain(p);
}

describe('[slow] Run and Submit with real Python (spec 5.1, 5.2)', () => {
  test('a correct program: every sample passes on Run, and Submit is ACCEPTED', async () => {
    const { run, submit, submission } = await runAndSubmit('a, b = map(int, input().split())\nprint(a + b)\n');

    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({ compilation: null, testsPassed: 1, totalTests: 1 });
    expect(run.body.results[0]).toMatchObject({ input: '1 2\n', expected: '3\n', actual: '3\n', passed: true, status: 'OK', error: null });

    expect(submit.body).toMatchObject({ verdict: 'ACCEPTED', solved: true });
    expect(submission).toMatchObject({ verdict: 'ACCEPTED', testsPassed: 6, totalTests: 6 });
    expectNoServerPaths(run.body, submit.body, submission);
  });

  test('a wrong program: the failed sample is shown on Run, and Submit is NOT_ACCEPTED (stored WRONG_ANSWER)', async () => {
    const { run, submit, submission } = await runAndSubmit('a, b = map(int, input().split())\nprint(a * b)\n');

    expect(run.body.results[0]).toMatchObject({ expected: '3\n', actual: '2\n', passed: false, status: 'OK' });
    expect(submit.body).toMatchObject({ verdict: 'NOT_ACCEPTED', solved: false });
    expect(submission).toMatchObject({ verdict: 'WRONG_ANSWER', failedTestNumber: 1 });
  });

  test('a crashing program: Run shows the error text naming main.py; Submit is NOT_ACCEPTED with no error text stored', async () => {
    const { run, submit, submission } = await runAndSubmit('a, b = map(int, input().split())\nprint(a // 0)\n');

    expect(run.body.results[0]).toMatchObject({ passed: false, status: 'RUNTIME_ERROR' });
    expect(run.body.results[0].error).toContain('ZeroDivisionError');
    expect(run.body.results[0].error).toContain('main.py');
    expect(submit.body).toEqual(expect.objectContaining({ verdict: 'NOT_ACCEPTED' }));
    expect(submit.body.errorMessage).toBeUndefined();
    expect(submission).toMatchObject({ verdict: 'RUNTIME_ERROR', testsPassed: 0 });
    expect(submission.errorMessage).toBeUndefined();
    expectNoServerPaths(run.body, submit.body, submission);
  });

  test('an infinite loop: Run shows TIME_LIMIT_EXCEEDED; Submit is NOT_ACCEPTED and stops after one time limit', async () => {
    const started = Date.now();
    const { run, submit, submission } = await runAndSubmit('while True:\n    pass\n');

    expect(run.body.results[0]).toMatchObject({ passed: false, status: 'TIME_LIMIT_EXCEEDED' });
    expect(submit.body.verdict).toBe('NOT_ACCEPTED');
    expect(submission).toMatchObject({ verdict: 'TIME_LIMIT_EXCEEDED', testsPassed: 0, failedTestNumber: 1 });
    // One time limit for Run and one for Submit (stopOnError), not one per test.
    expect(Date.now() - started).toBeLessThan(6 * 600);
  });

  test('a syntax error: Run shows compilation with the line number; Submit returns COMPILATION_ERROR with it', async () => {
    const { run, submit, submission } = await runAndSubmit('a = 1\nif a\n    print(a)\n');

    expect(run.body).toMatchObject({ results: [], testsPassed: 0 });
    expect(run.body.compilation.message).toMatch(/^Line 2: SyntaxError: /);
    expect(submit.body.verdict).toBe('COMPILATION_ERROR');
    expect(submit.body.errorMessage).toBe(run.body.compilation.message);
    expect(submission).toMatchObject({ verdict: 'COMPILATION_ERROR', errorMessage: run.body.compilation.message, testsPassed: 0 });
    expectNoServerPaths(run.body, submit.body, submission);
  });
});
