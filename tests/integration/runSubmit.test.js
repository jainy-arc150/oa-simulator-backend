const createApp = require('../../src/app');
const limits = require('../../src/config/limits');
const RunnerUnavailableError = require('../../src/errors/RunnerUnavailableError');
const Assessment = require('../../src/models/Assessment');
const AttemptEvent = require('../../src/models/AttemptEvent');
const Submission = require('../../src/models/Submission');
const { useTestDb, createProblem } = require('../helpers/factories');
const { useFakeClock } = require('../helpers/fakeClock');
const { createLogCapture } = require('../helpers/logCapture');
const { useFakeRunner, programRunner, addTwo, ok, crash, timeout } = require('../helpers/fakeRunner');
const {
  START,
  at,
  DEADLINE,
  registerStudent,
  roundApi,
  saveRound,
  activeFields,
  finishedFields,
  savedRound,
  rawRounds,
  MARKERS,
  markedProblem,
} = require('../helpers/rounds');

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

const student = () => registerStudent(app);
const { getRound, finishRound, runCode, submitCode } = roundApi(() => app);

const CORRECT = 'a, b = map(int, input().split())\nprint(a + b)\n';
const python = (code = CORRECT) => ({ language: 'python', code });
const run = (token, id, index = 1, code) => runCode(token, id, index, python(code));
const submit = (token, id, index = 1, code) => submitCode(token, id, index, python(code));

const plus = (date, ms) => new Date(date.getTime() + ms);
const RUN_COOLDOWN_MS = limits.RUN_COOLDOWN_SECONDS * 1000;
const SUBMIT_COOLDOWN_MS = limits.SUBMIT_COOLDOWN_SECONDS * 1000;
const eventsOf = (roundId) => AttemptEvent.find({ assessment: roundId }).sort({ _id: 1 }).lean();
const submissionsOf = (roundId) => Submission.find({ assessment: roundId }).sort({ _id: 1 }).lean();

// A problem with two samples (print a + b) and the factory's five hidden tests ("i i" -> 2i).
const twoSampleProblem = (overrides = {}) =>
  createProblem({
    samples: [
      { input: '1 2\n', output: '3\n', explanation: '1 + 2 = 3' },
      { input: '5 5\n', output: '10\n', explanation: '5 + 5 = 10' },
    ],
    ...overrides,
  });

// An ACTIVE round (started at START, deadline at minute 30) for a new student.
async function activeRound(problems) {
  const { token, id } = await student();
  const round = await saveRound(id, problems || [await twoSampleProblem()], activeFields());
  return { token, userId: id, round, roundId: String(round._id) };
}

// ---------- E14 Run ----------

describe('E14 POST .../run: the run result (spec 4.4, 4.5, 5.2)', () => {
  test('a correct program: every sample passes, and the response is the run result of 4.5', async () => {
    const problem = await twoSampleProblem({ timeLimitMs: 1500 });
    const { token, userId, roundId } = await activeRound([problem]);

    clock.set(plus(at(1), 5000));
    const res = await run(token, roundId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      compilation: null,
      results: [
        { input: '1 2\n', expected: '3\n', actual: '3\n', passed: true, status: 'OK', error: null },
        { input: '5 5\n', expected: '10\n', actual: '10\n', passed: true, status: 'OK', error: null },
      ],
      testsPassed: 2,
      totalTests: 2,
      runsLeft: limits.MAX_RUNS_PER_QUESTION - 1,
      serverTime: plus(at(1), 5000).toISOString(),
    });

    // 5.1, D29: samples only, every sample runs, the problem's time limit.
    expect(runner.calls).toEqual([
      { language: 'python', code: CORRECT, inputs: ['1 2\n', '5 5\n'], timeLimitMs: 1500, stopOnError: false },
    ]);

    // 5.3: the gate recorded the attempt and saved the code (D22) and the active minute (5.5).
    const saved = await savedRound(roundId);
    expect(saved.lastRunAt).toEqual(plus(at(1), 5000));
    expect(saved.slots[0]).toMatchObject({ runCount: 1, submitCount: 0, code: CORRECT, codeUpdatedAt: plus(at(1), 5000), activeMinutes: [1] });

    // A RUN event; a Run never creates a submission and never marks the question solved (5.2).
    const events = await eventsOf(roundId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'RUN', slotIndex: 1, verdict: 'ACCEPTED', at: plus(at(1), 5000) });
    expect(String(events[0].user)).toBe(userId);
    expect(String(events[0].problem)).toBe(String(problem._id));
    expect(events[0].submission).toBeUndefined();
    expect(await Submission.countDocuments()).toBe(0);
    expect(saved.slots[0].solvedAt).toBeUndefined();
  });

  test('2.5: wrong output shows each sample with input, expected, actual and passed; the RUN event is WRONG_ANSWER', async () => {
    const { token, roundId } = await activeRound();
    runner.program((input, i) => (i === 0 ? ok('4\n') : addTwo(input)));

    const res = await run(token, roundId);
    expect(res.body.results.map(({ actual, passed }) => ({ actual, passed }))).toEqual([
      { actual: '4\n', passed: false },
      { actual: '10\n', passed: true },
    ]);
    expect(res.body.testsPassed).toBe(1);
    expect((await eventsOf(roundId))[0].verdict).toBe('WRONG_ANSWER');
  });

  test('2.5: a runtime error shows the full error text and the sample that failed; later samples still run (D29)', async () => {
    const { token, roundId } = await activeRound();
    const stderr = 'Traceback (most recent call last):\n  File "main.py", line 2, in <module>\nValueError: invalid literal for int() with base 10: \'5 5\'\n';
    runner.program((input, i) => (i === 0 ? crash(stderr) : addTwo(input)));

    const res = await run(token, roundId);
    expect(res.body.results[0]).toEqual({ input: '1 2\n', expected: '3\n', actual: '', passed: false, status: 'RUNTIME_ERROR', error: stderr });
    expect(res.body.results[1]).toMatchObject({ passed: true, status: 'OK' });
    expect((await eventsOf(roundId))[0].verdict).toBe('RUNTIME_ERROR');
  });

  test('2.5: a time limit shows TIME_LIMIT_EXCEEDED for the sample that timed out', async () => {
    const { token, roundId } = await activeRound();
    runner.program((input, i) => (i === 1 ? timeout() : addTwo(input)));

    const res = await run(token, roundId);
    expect(res.body.results[1]).toMatchObject({ input: '5 5\n', passed: false, status: 'TIME_LIMIT_EXCEEDED', error: null });
    expect((await eventsOf(roundId))[0].verdict).toBe('TIME_LIMIT_EXCEEDED');
  });

  test('2.5: a syntax error shows the message with the line number and no results; the Run is still counted', async () => {
    const { token, roundId } = await activeRound();
    runner.compileError("SyntaxError: expected ':'", 3);

    const res = await run(token, roundId, 1, 'if True\n  print(1)\n');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      compilation: { message: "Line 3: SyntaxError: expected ':'" },
      results: [],
      testsPassed: 0,
      totalTests: 2,
      runsLeft: limits.MAX_RUNS_PER_QUESTION - 1,
    });
    expect((await eventsOf(roundId))[0].verdict).toBe('COMPILATION_ERROR');
  });

  test('5.2: trailing spaces, blank lines and CRLF are ignored when comparing', async () => {
    const { token, roundId } = await activeRound();
    runner.program((input) => ok(`${addTwo(input).stdout.trim()}   \r\n\r\n\r\n`));

    const res = await run(token, roundId);
    expect(res.body.results.map((r) => r.passed)).toEqual([true, true]);
    expect(res.body.results[0].actual).toBe('3   \r\n\r\n\r\n');
  });

  test('5.2: an input without a final newline is given one before it reaches stdin', async () => {
    const problem = await createProblem({ samples: [{ input: '1 2', output: '3' }] });
    const { token, roundId } = await activeRound([problem]);

    const res = await run(token, roundId);
    expect(runner.calls[0].inputs).toEqual(['1 2\n']);
    expect(res.body.results[0]).toMatchObject({ input: '1 2', expected: '3', passed: true });
  });

  test('5.2: long output and long errors are cut at 10,000 characters with "(truncated)"', async () => {
    const { token, roundId } = await activeRound();
    const long = 'x'.repeat(limits.RUN_OUTPUT_DISPLAY_MAX_CHARS + 50);
    runner.program(() => ({ ...ok(long), stderr: long }));

    const res = await run(token, roundId);
    const cut = `${'x'.repeat(limits.RUN_OUTPUT_DISPLAY_MAX_CHARS)}\n(truncated)`;
    expect(res.body.results[0]).toMatchObject({ actual: cut, error: cut, passed: false });
  });
});

describe('E14 POST .../run: the attempt gate (spec 5.3)', () => {
  test('5.3, 4.6: a Run 2 seconds after another returns 429 COOLDOWN with retryAfterMs 1000; one after 3 seconds succeeds', async () => {
    const { token, roundId } = await activeRound();

    clock.set(at(1));
    expect((await run(token, roundId)).status).toBe(200);
    clock.advance(2000);
    const tooSoon = await run(token, roundId, 1, 'print("second")');
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.error).toMatchObject({ code: 'COOLDOWN', details: { retryAfterMs: RUN_COOLDOWN_MS - 2000 } });

    // The refused Run changed nothing: not the counter, not the cooldown, not the code.
    const saved = await savedRound(roundId);
    expect(saved.lastRunAt).toEqual(at(1));
    expect(saved.slots[0]).toMatchObject({ runCount: 1, code: CORRECT });
    expect(runner.calls).toHaveLength(1);

    clock.advance(1000);
    const later = await run(token, roundId);
    expect(later.status).toBe(200);
    expect(later.body.runsLeft).toBe(limits.MAX_RUNS_PER_QUESTION - 2);
  });

  test('5.3: two simultaneous Runs on one question: one succeeds, the other gets COOLDOWN, and runCount rises by exactly 1', async () => {
    const { token, roundId } = await activeRound();

    const responses = await Promise.all([run(token, roundId), run(token, roundId)]);
    expect(responses.map((res) => res.status).sort()).toEqual([200, 429]);
    expect(responses.find((res) => res.status === 429).body.error.code).toBe('COOLDOWN');
    expect((await savedRound(roundId)).slots[0].runCount).toBe(1);
    expect(runner.calls).toHaveLength(1);
    expect(await eventsOf(roundId)).toHaveLength(1);
  });

  test('D34: the cooldown is per round: a Run on another question within 3 seconds also waits', async () => {
    const { token, roundId } = await activeRound([await twoSampleProblem(), await twoSampleProblem()]);

    expect((await run(token, roundId, 1)).status).toBe(200);
    clock.advance(1000);
    const other = await run(token, roundId, 2);
    expect(other.status).toBe(429);
    expect(other.body.error.code).toBe('COOLDOWN');
  });

  test('5.3: the 31st Run on a question returns 429 ATTEMPT_LIMIT', async () => {
    const { token, roundId } = await activeRound();

    for (let i = 1; i <= limits.MAX_RUNS_PER_QUESTION; i++) {
      const res = await run(token, roundId, 1, `# run ${i}`);
      expect(res.status).toBe(200);
      expect(res.body.runsLeft).toBe(limits.MAX_RUNS_PER_QUESTION - i);
      clock.advance(RUN_COOLDOWN_MS);
    }
    const before = await savedRound(roundId);

    const res = await run(token, roundId, 1, '# one too many');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('ATTEMPT_LIMIT');
    expect(await savedRound(roundId)).toEqual(before);
    expect(runner.calls).toHaveLength(limits.MAX_RUNS_PER_QUESTION);
  });

  test('5.3: at the cap and inside the cooldown, the answer is ATTEMPT_LIMIT', async () => {
    const { token, roundId } = await activeRound();
    await Assessment.updateOne({ _id: roundId }, { $set: { 'slots.0.runCount': limits.MAX_RUNS_PER_QUESTION, lastRunAt: plus(START, -1000) } });

    clock.set(START);
    const res = await run(token, roundId);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('ATTEMPT_LIMIT');
  });

  test('D34: Run and Submit cooldowns are independent', async () => {
    const { token, roundId } = await activeRound();

    expect((await run(token, roundId)).status).toBe(200);
    expect((await submit(token, roundId)).status).toBe(200);
    clock.advance(RUN_COOLDOWN_MS);
    expect((await run(token, roundId)).status).toBe(200);
    expect((await submit(token, roundId)).body.error.code).toBe('COOLDOWN');
  });

  test('R10, 4.6, D35: a runner failure returns 503 and leaves runCount and lastRunAt as they were; the code stays', async () => {
    const { token, roundId } = await activeRound();

    clock.set(at(1));
    await run(token, roundId);
    clock.set(at(2));
    runner.fail();
    const res = await run(token, roundId, 1, 'print("new code")');
    expect(res.status).toBe(503);
    expect(res.body.error).toEqual({ code: 'RUNNER_UNAVAILABLE', message: 'Something went wrong, try again' });

    const saved = await savedRound(roundId);
    expect(saved.lastRunAt).toEqual(at(1));
    expect(saved.slots[0]).toMatchObject({ runCount: 1, code: 'print("new code")' });
    expect(await eventsOf(roundId)).toHaveLength(1);

    // 6.5: the failure is logged at error level with its cause.
    const failure = logs.find((line) => line.msg === 'runner unavailable');
    expect(failure).toMatchObject({ level: 50, roundId });
    expect(failure.err.message).toBe('The fake runner failed');

    // The attempt was given back, so the student can try again at once.
    runner.program(addTwo);
    expect((await run(token, roundId)).status).toBe(200);
  });

  test('R10: when the failed Run was the first one, lastRunAt is empty again', async () => {
    const { token, roundId } = await activeRound();
    runner.fail();

    expect((await run(token, roundId)).status).toBe(503);
    const saved = await savedRound(roundId);
    expect(saved.lastRunAt).toBeUndefined();
    expect(saved.slots[0].runCount).toBe(0);
  });

  test('R10, 5.3: giving an attempt back never touches a later attempt', async () => {
    const { token, roundId } = await activeRound();
    let first = true;
    runner.respond(async (args) => {
      if (first) {
        // While the first Run is still in the runner, a second Run after the cooldown succeeds.
        first = false;
        clock.advance(RUN_COOLDOWN_MS);
        expect((await run(token, roundId, 1, 'print("second")')).status).toBe(200);
        throw new RunnerUnavailableError('The fake runner failed');
      }
      return programRunner(addTwo)(args);
    });

    expect((await run(token, roundId, 1, 'print("first")')).status).toBe(503);
    const saved = await savedRound(roundId);
    expect(saved.lastRunAt).toEqual(plus(START, RUN_COOLDOWN_MS));
    expect(saved.slots[0].runCount).toBe(2);
  });

  test('R4, 5.3: a Run exactly at the deadline is rejected with ROUND_EXPIRED and nothing is counted', async () => {
    const { token, roundId } = await activeRound();

    clock.set(DEADLINE);
    const res = await run(token, roundId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ROUND_EXPIRED');
    expect((await savedRound(roundId)).slots[0].runCount).toBe(0);
    expect(runner.calls).toHaveLength(0);
  });

  test('R6: a Run on a READY or FINISHED round is rejected and the runner is not called', async () => {
    const { token, id } = await student();
    const problem = await twoSampleProblem();
    const ready = await saveRound(id, [problem]);
    const finished = await saveRound(id, [problem], finishedFields());

    clock.set(at(20));
    for (const round of [ready, finished]) {
      const res = await run(token, round._id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ROUND_NOT_ACTIVE');
    }
    expect(runner.calls).toHaveLength(0);
  });

  test('4.2: code over 51,200 characters returns 413 and nothing is counted', async () => {
    const { token, roundId } = await activeRound();

    const res = await run(token, roundId, 1, 'x'.repeat(limits.MAX_CODE_CHARS + 1));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('CODE_TOO_LARGE');
    expect((await savedRound(roundId)).slots[0]).toMatchObject({ runCount: 0, code: '' });
    expect(runner.calls).toHaveLength(0);
  });

  test.each([
    ['another language', { language: 'javascript', code: CORRECT }, 'body.language'],
    ['no language', { code: CORRECT }, 'body.language'],
    ['upper-case Python', { language: 'Python', code: CORRECT }, 'body.language'],
    ['no code', { language: 'python' }, 'body.code'],
    ['code as an object', { language: 'python', code: { $ne: '' } }, 'body.code'],
  ])('4.1, 6.2: %s returns 400 VALIDATION_ERROR and nothing is counted', async (name, body, field) => {
    const { token, roundId } = await activeRound();

    const res = await runCode(token, roundId, 1, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.field)).toContain(field);
    expect((await savedRound(roundId)).slots[0].runCount).toBe(0);
  });

  test("R1: user B gets 404 on user A's question, and nothing is counted", async () => {
    const { roundId } = await activeRound();
    const b = await student();
    const before = await rawRounds();

    const res = await run(b.token, roundId);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(await rawRounds()).toEqual(before);
  });

  test('4.3: an index outside the round returns 404', async () => {
    const { token, roundId } = await activeRound();
    expect((await run(token, roundId, 2)).status).toBe(404);
    expect((await run(token, roundId, 0)).status).toBe(404);
  });
});

// ---------- E15 Submit ----------

describe('E15 POST .../submit: verdicts and what is saved (spec 4.4, 4.5, 5.2, 5.3)', () => {
  test('a correct program: ACCEPTED; the submission, the SUBMIT event and solvedAt are saved', async () => {
    const problem = await createProblem({ timeLimitMs: 1200 });
    const { token, userId, roundId } = await activeRound([problem]);
    runner.program((input, i) => ({ ...addTwo(input), timeMs: 40 + i * 10 }));

    clock.set(plus(at(4), 3000));
    const res = await submit(token, roundId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      verdict: 'ACCEPTED',
      solved: true,
      submitsLeft: limits.MAX_SUBMITS_PER_QUESTION - 1,
      serverTime: plus(at(4), 3000).toISOString(),
    });

    // 5.1, D29: samples first, then hidden tests, stopping at the first error.
    expect(runner.calls).toEqual([
      {
        language: 'python',
        code: CORRECT,
        inputs: ['1 2\n', '0 0\n', '1 1\n', '2 2\n', '3 3\n', '4 4\n'],
        timeLimitMs: 1200,
        stopOnError: true,
      },
    ]);

    const [submission] = await submissionsOf(roundId);
    expect(submission).toMatchObject({
      slotIndex: 1,
      verdict: 'ACCEPTED',
      testsPassed: 6,
      totalTests: 6,
      runtimeMs: 90,
      submittedAt: plus(at(4), 3000),
    });
    expect(String(submission.user)).toBe(userId);
    expect(String(submission.problem)).toBe(String(problem._id));
    expect(submission.errorMessage).toBeUndefined();
    expect(submission.failedTestNumber).toBeUndefined();

    const [event] = await eventsOf(roundId);
    expect(event).toMatchObject({ type: 'SUBMIT', slotIndex: 1, verdict: 'ACCEPTED', at: plus(at(4), 3000) });
    expect(String(event.submission)).toBe(String(submission._id));

    const saved = await savedRound(roundId);
    expect(saved.lastSubmitAt).toEqual(plus(at(4), 3000));
    expect(saved.slots[0]).toMatchObject({ submitCount: 1, runCount: 0, code: CORRECT, solvedAt: plus(at(4), 3000), activeMinutes: [4] });

    // 6.5: the graded Submit is logged with ids, verdict, tests passed and runtime only.
    const line = logs.find((l) => l.msg === 'submission graded');
    expect(line).toMatchObject({
      level: 30,
      roundId,
      userId,
      slotIndex: 1,
      submissionId: String(submission._id),
      verdict: 'ACCEPTED',
      testsPassed: 6,
      totalTests: 6,
      runtimeMs: 90,
    });
    expect(line.failedTestNumber).toBeUndefined();
  });

  test('D27, D28, 4.6: a wrong answer on a hidden test returns only NOT_ACCEPTED; the stored verdict is WRONG_ANSWER', async () => {
    const { token, roundId } = await activeRound([await createProblem()]);
    runner.program((input, i) => (i === 3 ? ok('5\n') : addTwo(input)));

    const res = await submit(token, roundId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      verdict: 'NOT_ACCEPTED',
      solved: false,
      submitsLeft: limits.MAX_SUBMITS_PER_QUESTION - 1,
      serverTime: START.toISOString(),
    });
    const text = JSON.stringify(res.body);
    for (const hidden of ['failedTestNumber', 'testsPassed', 'hiddenTests', 'WRONG_ANSWER']) expect(text).not.toContain(hidden);

    const [submission] = await submissionsOf(roundId);
    expect(submission).toMatchObject({ verdict: 'WRONG_ANSWER', failedTestNumber: 4, testsPassed: 5, totalTests: 6 });
    expect((await eventsOf(roundId))[0].verdict).toBe('WRONG_ANSWER');
    expect((await savedRound(roundId)).slots[0].solvedAt).toBeUndefined();
  });

  test('2.5, R2: a runtime error on a hidden test is not explained, and its error text (with hidden input) is never returned, stored or logged', async () => {
    const problem = await markedProblem('math', 'easy');
    const { token, roundId } = await activeRound([problem]);
    runner.program((input) =>
      input.startsWith('SAMPLE')
        ? ok('SAMPLE-OUT-MARKER\n')
        : crash(`Traceback (most recent call last):\nValueError: invalid literal for int() with base 10: '${input.trim()}'\n`)
    );

    const res = await submit(token, roundId);
    expect(res.body).toEqual({ verdict: 'NOT_ACCEPTED', solved: false, submitsLeft: limits.MAX_SUBMITS_PER_QUESTION - 1, serverTime: START.toISOString() });

    const [submission] = await submissionsOf(roundId);
    expect(submission).toMatchObject({ verdict: 'RUNTIME_ERROR', failedTestNumber: 2, testsPassed: 1, totalTests: 1 + limits.HIDDEN_TESTS_MIN });
    expect(submission.errorMessage).toBeUndefined();
    // stopOnError: the runner stopped at the first crash.
    expect(runner.calls[0].stopOnError).toBe(true);

    for (const marker of MARKERS) {
      expect(JSON.stringify(res.body)).not.toContain(marker);
      expect(JSON.stringify(submission)).not.toContain(marker);
      expect(JSON.stringify(logs)).not.toContain(marker);
    }
  });

  test('2.5, 5.2: a program that passes tests 1 and 2 and then times out is NOT_ACCEPTED, stored as TIME_LIMIT_EXCEEDED with testsPassed 2', async () => {
    const { token, roundId } = await activeRound([await createProblem()]);
    runner.program((input, i) => (i === 2 ? timeout(2100) : addTwo(input)));

    const res = await submit(token, roundId);
    expect(res.body.verdict).toBe('NOT_ACCEPTED');
    expect((await submissionsOf(roundId))[0]).toMatchObject({
      verdict: 'TIME_LIMIT_EXCEEDED',
      testsPassed: 2,
      failedTestNumber: 3,
      totalTests: 6,
      runtimeMs: 2100,
    });
  });

  test('5.2: a solution that fails a sample and also a hidden test is stored with the type of the sample failure', async () => {
    const { token, roundId } = await activeRound([await createProblem()]);
    runner.program((input, i) => (i === 0 ? ok('wrong\n') : crash()));

    await submit(token, roundId);
    expect((await submissionsOf(roundId))[0]).toMatchObject({ verdict: 'WRONG_ANSWER', failedTestNumber: 1, testsPassed: 0 });
  });

  test('2.5, 5.2: a syntax error returns COMPILATION_ERROR with the message and line; no test runs', async () => {
    const { token, roundId } = await activeRound([await createProblem()]);
    runner.compileError('SyntaxError: invalid syntax', 2);

    const res = await submit(token, roundId, 1, 'x = 1\nprint(x +)\n');
    expect(res.body).toEqual({
      verdict: 'COMPILATION_ERROR',
      errorMessage: 'Line 2: SyntaxError: invalid syntax',
      solved: false,
      submitsLeft: limits.MAX_SUBMITS_PER_QUESTION - 1,
      serverTime: START.toISOString(),
    });
    const [submission] = await submissionsOf(roundId);
    expect(submission).toMatchObject({ verdict: 'COMPILATION_ERROR', errorMessage: 'Line 2: SyntaxError: invalid syntax', testsPassed: 0, totalTests: 6 });
    expect(submission.runtimeMs).toBeUndefined();
    expect(submission.failedTestNumber).toBeUndefined();
  });

  test('R8, D7: a Wrong Answer after an Accepted does not unsolve the question, and a later Accepted does not move solvedAt', async () => {
    const { token, roundId } = await activeRound([await createProblem()]);

    clock.set(at(2));
    expect((await submit(token, roundId)).body).toMatchObject({ verdict: 'ACCEPTED', solved: true });

    clock.advance(SUBMIT_COOLDOWN_MS);
    runner.program(() => ok('0\n'));
    expect((await submit(token, roundId)).body).toMatchObject({ verdict: 'NOT_ACCEPTED', solved: true });

    clock.advance(SUBMIT_COOLDOWN_MS);
    runner.program(addTwo);
    expect((await submit(token, roundId)).body).toMatchObject({ verdict: 'ACCEPTED', solved: true });

    expect((await savedRound(roundId)).slots[0].solvedAt).toEqual(at(2));
    expect((await submissionsOf(roundId)).map((s) => s.verdict)).toEqual(['ACCEPTED', 'WRONG_ANSWER', 'ACCEPTED']);
    expect((await getRound(token, roundId)).body.slots[0].solved).toBe(true);
  });

  test('R9, 5.3: a Submit that arrives before the deadline is graded in full even if grading ends after it', async () => {
    const { token, roundId } = await activeRound([await createProblem()]);
    const arrival = plus(DEADLINE, -1000);
    runner.respond(async (args) => {
      clock.set(plus(DEADLINE, 2 * 60000)); // grading takes past the deadline
      return programRunner(addTwo)(args);
    });

    clock.set(arrival);
    const res = await submit(token, roundId);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ verdict: 'ACCEPTED', solved: true, serverTime: arrival.toISOString() });

    const [submission] = await submissionsOf(roundId);
    expect(submission.submittedAt).toEqual(arrival);
    expect((await eventsOf(roundId))[0].at).toEqual(arrival);
    expect((await savedRound(roundId)).slots[0].solvedAt).toEqual(arrival);

    // The round then expires as usual, with finishedAt at the deadline (R12), and stays solved.
    const after = await getRound(token, roundId);
    expect(after.body).toMatchObject({ status: 'FINISHED', finishReason: 'EXPIRED', finishedAt: DEADLINE.toISOString() });
    expect(after.body.slots[0].solved).toBe(true);
  });

  test('4.6, R4: a Submit one second after the deadline returns 409 ROUND_EXPIRED; the round is FINISHED with finishedAt equal to the deadline', async () => {
    const { token, roundId } = await activeRound([await createProblem()]);

    clock.set(plus(DEADLINE, 1000));
    const res = await submit(token, roundId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ROUND_EXPIRED');
    expect(await savedRound(roundId)).toMatchObject({ status: 'FINISHED', finishReason: 'EXPIRED', finishedAt: DEADLINE });
    expect(runner.calls).toHaveLength(0);
    expect(await Submission.countDocuments()).toBe(0);
  });

  test('5.3: a Submit exactly at the deadline is rejected', async () => {
    const { token, roundId } = await activeRound([await createProblem()]);

    clock.set(DEADLINE);
    const res = await submit(token, roundId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ROUND_EXPIRED');
    expect((await savedRound(roundId)).slots[0].submitCount).toBe(0);
  });

  test('R6: a Submit on a manually finished round returns 409 ROUND_NOT_ACTIVE', async () => {
    const { token, roundId } = await activeRound([await createProblem()]);

    clock.set(at(3));
    await finishRound(token, roundId);
    const res = await submit(token, roundId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ROUND_NOT_ACTIVE');
    expect(runner.calls).toHaveLength(0);
  });
});

describe('E15 POST .../submit: the attempt gate (spec 5.3)', () => {
  test('5.3: a Submit 4 seconds after another returns 429 COOLDOWN with retryAfterMs 1000; one after 5 seconds succeeds', async () => {
    const { token, roundId } = await activeRound([await createProblem()]);

    expect((await submit(token, roundId)).status).toBe(200);
    clock.advance(4000);
    const tooSoon = await submit(token, roundId);
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.error).toMatchObject({ code: 'COOLDOWN', details: { retryAfterMs: SUBMIT_COOLDOWN_MS - 4000 } });
    clock.advance(1000);
    expect((await submit(token, roundId)).status).toBe(200);
    expect(await Submission.countDocuments()).toBe(2);
  });

  test('5.3: the 21st Submit on a question returns 429 ATTEMPT_LIMIT', async () => {
    const { token, roundId } = await activeRound([await createProblem()]);

    for (let i = 1; i <= limits.MAX_SUBMITS_PER_QUESTION; i++) {
      const res = await submit(token, roundId);
      expect(res.body.submitsLeft).toBe(limits.MAX_SUBMITS_PER_QUESTION - i);
      clock.advance(SUBMIT_COOLDOWN_MS);
    }
    const res = await submit(token, roundId);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('ATTEMPT_LIMIT');
    expect(await Submission.countDocuments()).toBe(limits.MAX_SUBMITS_PER_QUESTION);
  });

  test('R10, 3.5, 4.6: a runner failure returns 503; no submission or event is saved; submitCount and lastSubmitAt are unchanged; the code stays', async () => {
    const { token, roundId } = await activeRound([await createProblem()]);

    clock.set(at(1));
    await submit(token, roundId);
    clock.set(at(2));
    runner.fail();
    const res = await submit(token, roundId, 1, 'print("new code")');
    expect(res.status).toBe(503);
    expect(res.body.error).toEqual({ code: 'RUNNER_UNAVAILABLE', message: 'Something went wrong, try again' });

    const saved = await savedRound(roundId);
    expect(saved.lastSubmitAt).toEqual(at(1));
    expect(saved.slots[0]).toMatchObject({ submitCount: 1, code: 'print("new code")' });
    expect(await Submission.countDocuments()).toBe(1);
    expect(await eventsOf(roundId)).toHaveLength(1);
  });

  test("R1: user B gets 404 on user A's question; nothing is counted or saved", async () => {
    const { roundId } = await activeRound([await createProblem()]);
    const b = await student();
    const before = await rawRounds();

    const res = await submit(b.token, roundId);
    expect(res.status).toBe(404);
    expect(await rawRounds()).toEqual(before);
    expect(await Submission.countDocuments()).toBe(0);
  });

  test('4.2: code over 51,200 characters returns 413 and nothing is counted', async () => {
    const { token, roundId } = await activeRound([await createProblem()]);

    const res = await submit(token, roundId, 1, 'x'.repeat(limits.MAX_CODE_CHARS + 1));
    expect(res.status).toBe(413);
    expect((await savedRound(roundId)).slots[0].submitCount).toBe(0);
  });
});

describe('R2, 4.6: no response or log line carries hidden data', () => {
  test('Run and Submit responses never contain hiddenTests, hidden inputs or outputs, or failedTestNumber', async () => {
    const problem = await markedProblem('math', 'easy');
    const { token, roundId } = await activeRound([problem]);
    runner.program((input) => (input.startsWith('SAMPLE') ? ok('SAMPLE-OUT-MARKER\n') : ok('wrong\n')));

    const runRes = await run(token, roundId);
    clock.advance(SUBMIT_COOLDOWN_MS);
    const submitRes = await submit(token, roundId);

    for (const res of [runRes, submitRes]) {
      const text = JSON.stringify(res.body);
      for (const field of ['hiddenTests', 'failedTestNumber', 'HIDDEN-IN-MARKER', 'HIDDEN-OUT-MARKER']) expect(text).not.toContain(field);
    }
    // Run shows the sample (public) and never a hidden input; the runner never got hidden inputs on Run.
    expect(runner.calls[0].inputs).toEqual(['SAMPLE-IN-MARKER\n']);
    expect(JSON.stringify(logs)).not.toMatch(/HIDDEN-|SAMPLE-|CODE-MARKER/);
  });
});
