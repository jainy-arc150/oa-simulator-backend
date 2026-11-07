const createApp = require('../../src/app');
const limits = require('../../src/config/limits');
const Assessment = require('../../src/models/Assessment');
const AttemptEvent = require('../../src/models/AttemptEvent');
const Problem = require('../../src/models/Problem');
const Submission = require('../../src/models/Submission');
const { buildReport } = require('../../src/services/reportService');
const { useTestDb } = require('../helpers/factories');
const { useFakeClock } = require('../helpers/fakeClock');
const { createLogCapture } = require('../helpers/logCapture');
const { useFakeRunner, programRunner, ok } = require('../helpers/fakeRunner');
const {
  START,
  at,
  DEADLINE,
  registerStudent,
  roundApi,
  slot,
  newId,
  saveRound,
  activeFields,
  savedRound,
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
const api = roundApi(() => app);
const getReport = (token, id) => api.getRound(token, `${id}/report`);
const python = (code) => ({ language: 'python', code });

// For marked problems: the right answer to every test is its input with IN replaced by OUT.
const markedAnswer = (input) => ok(input.replace('-IN-', '-OUT-'));

// A whole round through the API: two marked questions, Q1 solved, Q2 failed on a hidden test, then Finish.
async function playRound() {
  const { token, id: userId } = await student();
  await markedProblem('arrays', 'easy');
  await markedProblem('arrays', 'easy');
  const created = await api.createRound(token, { slots: [slot('arrays', 'easy'), slot('arrays', 'easy')], durationMin: 40 });
  const roundId = created.body.id;

  await api.startRound(token, roundId);
  clock.set(at(1));
  await api.openQuestion(token, roundId, 1);
  await api.saveCode(token, roundId, 1, { code: 'print("CODE-MARKER")' });
  clock.set(at(2));
  runner.program(markedAnswer);
  await api.runCode(token, roundId, 1, python('print("CODE-MARKER")'));
  clock.set(at(3));
  await api.submitCode(token, roundId, 1, python('print("CODE-MARKER")'));

  clock.set(at(5));
  await api.openQuestion(token, roundId, 2);
  runner.program((input) => (input.startsWith('HIDDEN-IN-MARKER-2') ? ok('wrong\n') : markedAnswer(input)));
  clock.set(at(7));
  await api.runCode(token, roundId, 2, python('print("CODE-MARKER")'));
  clock.set(at(8));
  await api.submitCode(token, roundId, 2, python('print("CODE-MARKER")'));

  clock.set(at(12));
  await api.finishRound(token, roundId);
  return { token, userId, roundId };
}

describe('E16 GET /api/assessments/:id/report (spec 4.4, 5.5)', () => {
  test('returns the report of a finished round, built by buildReport from the saved data', async () => {
    const { token, roundId } = await playRound();

    const res = await getReport(token, roundId);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      roundId,
      durationMin: 40,
      startedAt: START.toISOString(),
      finishedAt: at(12).toISOString(),
      finishReason: 'MANUAL',
      grade: 'PARTIAL',
      summary: { solved: 1, total: 2, timeUsedSec: 720, timeAllottedSec: 2400, timeLeftSec: 1680 },
      headline: { rule: 'EDGE_CASES', question: 2 },
    });
    expect(res.body.questions.map((q) => [q.index, q.result, q.activeMin, q.runCount, q.submitCount, q.failedSubmits, q.failureReason])).toEqual([
      [1, 'SOLVED', 3, 1, 1, 0, null],
      [2, 'NOT_SOLVED', 2, 1, 1, 1, 'WRONG_ON_HIDDEN'],
    ]);
    expect(res.body.questions[0]).toMatchObject({ firstRunAfterMin: 1, runtimeMs: 30, timeLimitMs: limits.DEFAULT_TIME_LIMIT_MS });
    expect(res.body.timeMap).toEqual({
      totalMinutes: 40,
      questions: [
        { index: 1, activeMinutes: [1, 2, 3] },
        { index: 2, activeMinutes: [7, 8] },
      ],
    });
  });

  test('the response is exactly buildReport of the saved data, and reading it again gives the same body', async () => {
    const { token, roundId } = await playRound();
    const round = await Assessment.findById(roundId).lean();
    const problems = await Problem.find({}).lean();
    const submissions = await Submission.find({ assessment: roundId }).lean();
    const events = await AttemptEvent.find({ assessment: roundId }).lean();

    const first = await getReport(token, roundId);
    clock.advance(60 * 60000);
    const second = await getReport(token, roundId);
    expect(first.body).toEqual(JSON.parse(JSON.stringify(buildReport(round, problems, submissions, events))));
    expect(second.body).toEqual(first.body);
  });

  test('R16, R2, 5.5: the report holds no code, problem text, test data, test numbers, error text or raw verdicts', async () => {
    const { token, roundId } = await playRound();

    const res = await getReport(token, roundId);
    const text = JSON.stringify(res.body);
    for (const marker of MARKERS) expect(text).not.toContain(marker);
    for (const field of ['failedTestNumber', 'hiddenTests', '"statement"', '"samples"', '"code"', 'WRONG_ANSWER', 'errorMessage']) {
      expect(text).not.toContain(field);
    }
    expect(JSON.stringify(logs)).not.toMatch(new RegExp(MARKERS.join('|')));
  });

  test('4.6: the report of an ACTIVE round returns 409 ROUND_NOT_FINISHED; so does a READY round', async () => {
    const { token } = await student();
    await markedProblem('arrays', 'easy');
    const created = await api.createRound(token, { slots: [slot('arrays', 'easy')] });

    const ready = await getReport(token, created.body.id);
    expect(ready.status).toBe(409);
    expect(ready.body.error.code).toBe('ROUND_NOT_FINISHED');

    await api.startRound(token, created.body.id);
    clock.set(at(5));
    const active = await getReport(token, created.body.id);
    expect(active.status).toBe(409);
    expect(active.body.error.code).toBe('ROUND_NOT_FINISHED');
  });

  test('R15, R12: a round past its deadline expires on the report request; time used equals the allotted time', async () => {
    const { token, id } = await student();
    const problem = await markedProblem('arrays', 'easy');
    const round = await saveRound(id, [problem], activeFields());

    clock.set(at(500));
    const res = await getReport(token, round._id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      finishReason: 'EXPIRED',
      finishedAt: DEADLINE.toISOString(),
      summary: { timeUsedSec: 30 * 60, timeAllottedSec: 30 * 60, timeLeftSec: 0 },
      grade: 'NEEDS_WORK',
      headline: { rule: null, text: 'Time ran out with 1 question(s) unsolved.' },
    });
    expect(await savedRound(round._id)).toMatchObject({ status: 'FINISHED', finishedAt: DEADLINE });
  });

  test("R1: user B gets 404 on user A's report", async () => {
    const { roundId } = await playRound();
    const b = await student();

    const res = await getReport(b.token, roundId);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  test('4.6: without a token 401; an invalid or unknown round id 404', async () => {
    const { token } = await student();
    expect((await getReport(null, newId())).status).toBe(401);
    for (const badId of ['abc', 'aaaaaaaaaaaa', newId()]) {
      const res = await getReport(token, badId);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });
});

describe('5.5 active minutes (recorded by autosave, Run and Submit)', () => {
  test('an autosave, a Run and a Submit in the same minute add one entry; opening a question adds none', async () => {
    const { token, id } = await student();
    const problem = await markedProblem('arrays', 'easy');
    const round = await saveRound(id, [problem], activeFields());
    runner.respond(programRunner(markedAnswer));

    clock.set(at(4));
    await api.openQuestion(token, round._id, 1);
    expect((await savedRound(round._id)).slots[0].activeMinutes).toEqual([]);

    await api.saveCode(token, round._id, 1, { code: 'a = 1' });
    clock.set(at(4.2));
    await api.runCode(token, round._id, 1, python('a = 2'));
    clock.set(at(4.4));
    await api.submitCode(token, round._id, 1, python('a = 3'));
    expect((await savedRound(round._id)).slots[0].activeMinutes).toEqual([4]);

    clock.set(at(6));
    await api.openQuestion(token, round._id, 1);
    await api.saveCode(token, round._id, 1, { code: 'a = 4' });
    expect((await savedRound(round._id)).slots[0].activeMinutes).toEqual([4, 6]);

    clock.set(at(7));
    await api.finishRound(token, round._id);
    const report = await getReport(token, round._id);
    expect(report.body.questions[0].activeMin).toBe(2);
    expect(report.body.timeMap.questions).toEqual([{ index: 1, activeMinutes: [4, 6] }]);
  });
});
