const createApp = require('../../src/app');
const limits = require('../../src/config/limits');
const Assessment = require('../../src/models/Assessment');
const roundStateService = require('../../src/services/roundStateService');
const { useTestDb, createProblem, assessmentData } = require('../helpers/factories');
const { useFakeClock } = require('../helpers/fakeClock');
const { createLogCapture } = require('../helpers/logCapture');
const {
  START,
  at,
  DEADLINE,
  registerStudent,
  roundApi,
  slot,
  newId,
  pool,
  saveRound,
  activeFields,
  finishedFields,
  savedRound,
  rawRounds,
  fakeLog,
  MARKERS,
  HIDDEN_MARKERS,
  markedProblem,
} = require('../helpers/rounds');

useTestDb();

let app;
let logs;
let clock;
let problems;
beforeEach(async () => {
  clock = useFakeClock(START);
  const capture = createLogCapture();
  logs = capture.lines;
  app = createApp({ logStream: capture.stream });
  problems = await pool('math', 'easy', 3);
});
afterEach(() => {
  clock.restore();
  jest.restoreAllMocks();
});

const student = () => registerStudent(app);
const { createRound, getRound, listRounds, startRound, finishRound, openQuestion, saveCode } = roundApi(() => app);

const plus = (date, ms) => new Date(date.getTime() + ms);
const eventLines = (msg) => logs.filter((line) => line.msg === msg);
const QUESTION_KEYS = ['code', 'constraints', 'difficulty', 'index', 'inputFormat', 'outputFormat', 'samples', 'serverTime', 'statement', 'title', 'topic'];

// A READY round built through E6 (math/easy questions; the pool has 3).
async function readyRound(token, { count = 2, durationMin = 30 } = {}) {
  const res = await createRound(token, { slots: Array(count).fill(slot('math', 'easy')), durationMin });
  expect(res.status).toBe(201);
  return res.body;
}

// A round built through E6 and started through E10 at the current clock time.
async function startedRound(token, options) {
  const round = await readyRound(token, options);
  const res = await startRound(token, round.id);
  expect(res.status).toBe(200);
  return res.body;
}

// ---------- E10 ----------

describe('E10 POST /api/assessments/:id/start (spec 4.4, 5.3)', () => {
  test('starts a READY round: 200 with the summary; startedAt is now and deadline is startedAt + durationMin (R3)', async () => {
    const { token, id: userId } = await student();
    const round = await readyRound(token, { durationMin: 45 });

    clock.set(at(2));
    const res = await startRound(token, round.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ...round,
      status: 'ACTIVE',
      startedAt: at(2).toISOString(),
      deadline: at(47).toISOString(),
      serverTime: at(2).toISOString(),
    });
    expect(await savedRound(round.id)).toMatchObject({ status: 'ACTIVE', startedAt: at(2), deadline: at(47) });

    const started = eventLines('round started');
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ level: 30, roundId: round.id, userId });
  });

  test('R3: the request body and the client clock have no effect on the times', async () => {
    const { token } = await student();
    const round = await readyRound(token, { durationMin: 30 });

    clock.set(at(1));
    const res = await startRound(token, round.id)
      .set('Date', new Date('2001-01-01T00:00:00.000Z').toUTCString())
      .send({ startedAt: '2001-01-01T00:00:00.000Z', deadline: '2099-01-01T00:00:00.000Z', durationMin: 180 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ durationMin: 30, startedAt: at(1).toISOString(), deadline: at(31).toISOString() });
  });

  test('R5, 4.6: starting the same round twice returns 409 ROUND_NOT_READY and the deadline does not move', async () => {
    const { token } = await student();
    const round = await readyRound(token);

    clock.set(at(1));
    expect((await startRound(token, round.id)).status).toBe(200);
    clock.advance(10000);
    const again = await startRound(token, round.id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ROUND_NOT_READY');
    expect(await savedRound(round.id)).toMatchObject({ startedAt: at(1), deadline: at(31) });
  });

  test('R5, 5.3: two simultaneous Start calls produce one deadline', async () => {
    const { token } = await student();
    const round = await readyRound(token);

    const responses = await Promise.all([startRound(token, round.id), startRound(token, round.id)]);
    const ok = responses.filter((res) => res.status === 200);
    const refused = responses.filter((res) => res.status === 409);
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0].body.error.code).toBe('ROUND_NOT_READY');
    expect((await savedRound(round.id)).deadline.toISOString()).toBe(ok[0].body.deadline);
    expect(eventLines('round started')).toHaveLength(1);
  });

  test('R13, 4.6: starting a second round while one is ACTIVE returns 409 ACTIVE_ROUND_EXISTS', async () => {
    const { token } = await student();
    const first = await readyRound(token);
    const second = await readyRound(token);

    expect((await startRound(token, first.id)).status).toBe(200);
    const res = await startRound(token, second.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ACTIVE_ROUND_EXISTS');

    const saved = await savedRound(second.id);
    expect(saved.status).toBe('READY');
    expect(saved.startedAt).toBeUndefined();
    expect(saved.deadline).toBeUndefined();
  });

  test('R13: two simultaneous Starts of two different rounds leave exactly one ACTIVE round', async () => {
    const { token, id } = await student();
    const first = await readyRound(token);
    const second = await readyRound(token);

    const responses = await Promise.all([startRound(token, first.id), startRound(token, second.id)]);
    expect(responses.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(responses.find((res) => res.status === 409).body.error.code).toBe('ACTIVE_ROUND_EXISTS');
    expect(await Assessment.countDocuments({ user: id, status: 'ACTIVE' })).toBe(1);
  });

  test('R13, R15: an expired-but-unmarked round does not block the next Start', async () => {
    const { token, id: userId } = await student();
    const first = await startedRound(token);
    const second = await readyRound(token);

    clock.set(at(31));
    const res = await startRound(token, second.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ACTIVE', startedAt: at(31).toISOString() });
    expect(await savedRound(first.id)).toMatchObject({ status: 'FINISHED', finishReason: 'EXPIRED', finishedAt: DEADLINE });
    expect(eventLines('round finished')).toEqual([
      expect.objectContaining({ roundId: first.id, userId, finishReason: 'EXPIRED' }),
    ]);
  });

  test('R13, 5.3: at exactly the deadline of the ACTIVE round the next Start is allowed; one millisecond before it is not', async () => {
    const { token } = await student();
    await startedRound(token);
    const second = await readyRound(token);

    clock.set(plus(DEADLINE, -1));
    expect((await startRound(token, second.id)).body.error.code).toBe('ACTIVE_ROUND_EXISTS');
    clock.set(DEADLINE);
    expect((await startRound(token, second.id)).status).toBe(200);
  });

  test.each([
    ['MANUAL', at(10)],
    ['EXPIRED', DEADLINE],
  ])('R6: Start on a FINISHED (%s) round returns 409 ROUND_NOT_READY and changes nothing', async (finishReason, finishedAt) => {
    const { token, id } = await student();
    const round = await saveRound(id, problems, { ...finishedFields(), finishReason, finishedAt });
    const before = await rawRounds();

    clock.set(at(60));
    const res = await startRound(token, round._id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ROUND_NOT_READY');
    expect(await rawRounds()).toEqual(before);
  });

  test("R1: user B gets 404 on Start of user A's round, and the round stays READY", async () => {
    const a = await student();
    const b = await student();
    const round = await readyRound(a.token);

    const res = await startRound(b.token, round.id);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect((await savedRound(round.id)).status).toBe('READY');
  });

  test('an invalid or unknown round id returns 404', async () => {
    const { token } = await student();
    for (const badId of ['abc', 'aaaaaaaaaaaa', newId()]) {
      const res = await startRound(token, badId);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });
});

// ---------- E11 ----------

describe('E11 POST /api/assessments/:id/finish (spec 4.4, 5.3)', () => {
  test('finishes an ACTIVE round: 200 with the summary, FINISHED, MANUAL, finishedAt is now', async () => {
    const { token, id: userId } = await student();
    const round = await startedRound(token);

    clock.set(at(12));
    const res = await finishRound(token, round.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ...round,
      status: 'FINISHED',
      finishedAt: at(12).toISOString(),
      finishReason: 'MANUAL',
      serverTime: at(12).toISOString(),
    });
    expect(await savedRound(round.id)).toMatchObject({ status: 'FINISHED', finishReason: 'MANUAL', finishedAt: at(12), deadline: DEADLINE });
    expect(eventLines('round finished')).toEqual([
      expect.objectContaining({ level: 30, roundId: round.id, userId, finishReason: 'MANUAL' }),
    ]);
  });

  test('4.6, D25: finishing twice returns 200 both times with the same result', async () => {
    const { token } = await student();
    const round = await startedRound(token);

    clock.set(at(12));
    const first = await finishRound(token, round.id);
    clock.advance(5000);
    const second = await finishRound(token, round.id);
    expect(second.status).toBe(200);
    expect({ ...second.body, serverTime: first.body.serverTime }).toEqual(first.body);
    expect((await savedRound(round.id)).finishedAt).toEqual(at(12));
    expect(eventLines('round finished')).toHaveLength(1);
  });

  test('5.3: two simultaneous Finish calls end with one FINISHED round and two 200 responses', async () => {
    const { token } = await student();
    const round = await startedRound(token);

    clock.set(at(12));
    const responses = await Promise.all([finishRound(token, round.id), finishRound(token, round.id)]);
    expect(responses.map((res) => res.status)).toEqual([200, 200]);
    expect(responses[0].body).toEqual(responses[1].body);
    expect(responses[0].body).toMatchObject({ status: 'FINISHED', finishReason: 'MANUAL', finishedAt: at(12).toISOString() });
    expect(eventLines('round finished')).toHaveLength(1);
  });

  test('4.6: Finish on a READY round returns 409 ROUND_NOT_ACTIVE and the round stays READY', async () => {
    const { token } = await student();
    const round = await readyRound(token);

    const res = await finishRound(token, round.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ROUND_NOT_ACTIVE');
    expect((await savedRound(round.id)).status).toBe('READY');
  });

  test('R15, R12: Finish after the deadline returns the round FINISHED (EXPIRED) with finishedAt equal to the deadline', async () => {
    const { token, id: userId } = await student();
    const round = await startedRound(token);

    clock.set(at(45));
    const res = await finishRound(token, round.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'FINISHED', finishReason: 'EXPIRED', finishedAt: DEADLINE.toISOString() });
    expect(eventLines('round finished')).toEqual([
      expect.objectContaining({ roundId: round.id, userId, finishReason: 'EXPIRED' }),
    ]);
  });

  test('5.3: Finish exactly at the deadline gives EXPIRED; one millisecond before it gives MANUAL', async () => {
    const a = await student();
    const b = await student();
    const roundA = await startedRound(a.token);
    const roundB = await startedRound(b.token);

    clock.set(DEADLINE);
    expect((await finishRound(a.token, roundA.id)).body).toMatchObject({ finishReason: 'EXPIRED', finishedAt: DEADLINE.toISOString() });
    clock.set(plus(DEADLINE, -1));
    expect((await finishRound(b.token, roundB.id)).body).toMatchObject({
      finishReason: 'MANUAL',
      finishedAt: plus(DEADLINE, -1).toISOString(),
    });
  });

  test("R1: user B gets 404 on Finish of user A's round, and the round stays ACTIVE", async () => {
    const a = await student();
    const b = await student();
    const round = await startedRound(a.token);

    const res = await finishRound(b.token, round.id);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect((await savedRound(round.id)).status).toBe('ACTIVE');
  });
});

// ---------- E12 ----------

describe('E12 POST /api/assessments/:id/questions/:index/open (spec 4.4, 4.5, 5.3)', () => {
  test('returns the question of 4.5 and sets firstOpenedAt on that question only', async () => {
    const { token, id } = await student();
    const words = await createProblem({
      topic: 'strings',
      difficulty: 'medium',
      title: 'Mirror Words',
      statement: 'Print the word reversed.',
      inputFormat: 'One line: a word.',
      outputFormat: 'One line: the word reversed.',
      constraints: '1 <= length <= 10',
      samples: [
        { input: 'abc\n', output: 'cba\n', explanation: 'Reversed.' },
        { input: 'x\n', output: 'x\n', explanation: 'One letter stays the same.' },
      ],
    });
    const round = await saveRound(id, [problems[0], words], activeFields());

    clock.set(at(3));
    const res = await openQuestion(token, round._id, 2);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      index: 2,
      title: 'Mirror Words',
      topic: 'strings',
      difficulty: 'medium',
      statement: 'Print the word reversed.',
      inputFormat: 'One line: a word.',
      outputFormat: 'One line: the word reversed.',
      constraints: '1 <= length <= 10',
      samples: [
        { input: 'abc\n', output: 'cba\n', explanation: 'Reversed.' },
        { input: 'x\n', output: 'x\n', explanation: 'One letter stays the same.' },
      ],
      code: '',
      serverTime: at(3).toISOString(),
    });

    const saved = await savedRound(round._id);
    expect(saved.slots[1].firstOpenedAt).toEqual(at(3));
    expect(saved.slots[0].firstOpenedAt).toBeUndefined();
    // 5.5: opening a question does not add an active minute.
    expect(saved.slots[1].activeMinutes).toEqual([]);
  });

  test('5.3: opening again keeps the first firstOpenedAt and still returns the question', async () => {
    const { token, id } = await student();
    const round = await saveRound(id, problems.slice(0, 2), activeFields());

    clock.set(at(3));
    await openQuestion(token, round._id, 1);
    clock.set(at(9));
    const again = await openQuestion(token, round._id, 1);
    expect(again.status).toBe(200);
    expect(again.body.serverTime).toBe(at(9).toISOString());
    expect((await savedRound(round._id)).slots[0].firstOpenedAt).toEqual(at(3));
  });

  test('2.6: after a refresh, opening returns the saved code, and the round keeps its deadline and questions', async () => {
    const { token } = await student();
    const round = await startedRound(token);

    clock.set(at(4));
    expect((await saveCode(token, round.id, 2, { code: 'print(input()[::-1])' })).status).toBe(204);

    clock.set(at(6));
    const opened = await openQuestion(token, round.id, 2);
    expect(opened.body.code).toBe('print(input()[::-1])');
    expect((await openQuestion(token, round.id, 1)).body.code).toBe('');

    const refreshed = await getRound(token, round.id);
    expect(refreshed.body).toMatchObject({ deadline: round.deadline, startedAt: round.startedAt });
    expect(refreshed.body.slots.map(({ index, topic, difficulty }) => ({ index, topic, difficulty }))).toEqual(
      round.slots.map(({ index, topic, difficulty }) => ({ index, topic, difficulty }))
    );
  });

  test('a sample without an explanation is returned with explanation null', async () => {
    const { token, id } = await student();
    const plain = await createProblem({ samples: [{ input: '1 2\n', output: '3\n' }] });
    const round = await saveRound(id, [plain], activeFields());

    const res = await openQuestion(token, round._id, 1);
    expect(res.body.samples).toEqual([{ input: '1 2\n', output: '3\n', explanation: null }]);
  });

  test('R2, 4.6: the question has no hidden tests or status, and the logs hold no problem data or code', async () => {
    const { token, id } = await student();
    const problem = await markedProblem('arrays', 'hard');
    const data = assessmentData({ _id: id }, [problem], activeFields());
    data.slots[0].code = 'print("CODE-MARKER")';
    const round = await Assessment.create(data);

    const res = await openQuestion(token, round._id, 1);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(QUESTION_KEYS);
    const text = JSON.stringify(res.body);
    for (const marker of HIDDEN_MARKERS) expect(text).not.toContain(marker);
    expect(text).not.toContain('"hiddenTests"');
    expect(text).not.toContain('"status"');
    expect(text).not.toContain(String(problem._id));

    const logText = JSON.stringify(logs);
    for (const marker of MARKERS) expect(logText).not.toContain(marker);
  });

  test('4.6, D20: E12 on a READY round returns 409 ROUND_NOT_ACTIVE with no statement, and firstOpenedAt stays empty', async () => {
    const { token, id } = await student();
    const round = await saveRound(id, [await markedProblem('arrays', 'easy')]);

    const res = await openQuestion(token, round._id, 1);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ROUND_NOT_ACTIVE');
    for (const marker of MARKERS) expect(JSON.stringify(res.body)).not.toContain(marker);
    expect((await savedRound(round._id)).slots[0].firstOpenedAt).toBeUndefined();
  });

  test('R6, R16: E12 on a FINISHED round returns 409 ROUND_NOT_ACTIVE and no code', async () => {
    const { token, id } = await student();
    const data = assessmentData({ _id: id }, [await markedProblem('arrays', 'easy')], finishedFields());
    data.slots[0].code = 'print("CODE-MARKER")';
    const round = await Assessment.create(data);

    clock.set(at(20));
    const res = await openQuestion(token, round._id, 1);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ROUND_NOT_ACTIVE');
    for (const marker of MARKERS) expect(JSON.stringify(res.body)).not.toContain(marker);
  });

  test('R4, R15, R12: E12 after the deadline returns 409 ROUND_EXPIRED and the round is FINISHED with finishedAt equal to the deadline', async () => {
    const { token, id } = await student();
    const round = await saveRound(id, problems.slice(0, 1), activeFields());

    clock.set(plus(DEADLINE, 1000));
    const res = await openQuestion(token, round._id, 1);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ROUND_EXPIRED');

    const saved = await savedRound(round._id);
    expect(saved).toMatchObject({ status: 'FINISHED', finishReason: 'EXPIRED', finishedAt: DEADLINE });
    expect(saved.slots[0].firstOpenedAt).toBeUndefined();
  });

  test('5.3: E12 exactly at the deadline is rejected with ROUND_EXPIRED', async () => {
    const { token, id } = await student();
    const round = await saveRound(id, problems.slice(0, 1), activeFields());

    clock.set(DEADLINE);
    const res = await openQuestion(token, round._id, 1);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ROUND_EXPIRED');
  });

  test('4.3 step 5, 6.2: an index outside 1 to the number of questions returns 404', async () => {
    const { token, id } = await student();
    const round = await saveRound(id, problems.slice(0, 2), activeFields());

    for (const index of ['0', '3', '99999999999999999999', 'abc', '1.5', '-1', '01', '1e0', '+1']) {
      const res = await openQuestion(token, round._id, index);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    expect((await savedRound(round._id)).slots.every((s) => !s.firstOpenedAt)).toBe(true);
  });

  test('4.3: the status check (step 4) comes before the index check (step 5)', async () => {
    const { token, id } = await student();
    const round = await saveRound(id, problems.slice(0, 2));

    const res = await openQuestion(token, round._id, 9);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ROUND_NOT_ACTIVE');
  });

  test("R1: user B gets 404 on user A's question, and firstOpenedAt stays empty", async () => {
    const a = await student();
    const b = await student();
    const round = await saveRound(a.id, problems.slice(0, 1), activeFields());

    const res = await openQuestion(b.token, round._id, 1);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect((await savedRound(round._id)).slots[0].firstOpenedAt).toBeUndefined();
  });
});

// ---------- E13 ----------

describe('E13 PUT /api/assessments/:id/questions/:index/code (spec 4.4, 5.3, 5.5)', () => {
  test('saves the code and codeUpdatedAt: 204 with no body; the other questions are untouched', async () => {
    const { token, id } = await student();
    const round = await saveRound(id, problems.slice(0, 2), activeFields());

    clock.set(plus(at(3), 15000));
    const res = await saveCode(token, round._id, 2, { code: 'print(sum(map(int, input().split())))' });
    expect(res.status).toBe(204);
    expect(res.text).toBe('');

    const saved = await savedRound(round._id);
    expect(saved.slots[1]).toMatchObject({ code: 'print(sum(map(int, input().split())))', codeUpdatedAt: plus(at(3), 15000) });
    expect(saved.slots[0]).toMatchObject({ code: '', activeMinutes: [] });
    expect(saved.slots[0].codeUpdatedAt).toBeUndefined();
    expect(saved).toMatchObject({ status: 'ACTIVE', deadline: DEADLINE });
  });

  test('5.5: the current minute, counted from Start, is added to activeMinutes once', async () => {
    const { token, id } = await student();
    const round = await saveRound(id, problems.slice(0, 2), activeFields());
    const minutes = async () => (await savedRound(round._id)).slots.map((s) => s.activeMinutes);

    for (const [time, expected] of [
      [plus(START, 10000), [[0], []]],
      [plus(START, 59999), [[0], []]],
      [plus(at(2), 1000), [[0, 2], []]],
      [plus(at(2), 30000), [[0, 2], []]],
      [plus(at(29), 59999), [[0, 2, 29], []]],
    ]) {
      clock.set(time);
      expect((await saveCode(token, round._id, 1, { code: `# ${time.toISOString()}` })).status).toBe(204);
      expect(await minutes()).toEqual(expected);
    }
  });

  test('5.5: minutes are counted from startedAt, not from the start of a clock minute', async () => {
    const { token, id } = await student();
    const startedAt = plus(START, 30000);
    const round = await saveRound(id, problems.slice(0, 1), { ...activeFields(), startedAt, deadline: plus(startedAt, 30 * 60000) });

    clock.set(plus(startedAt, 59999));
    await saveCode(token, round._id, 1, { code: 'a = 1' });
    clock.set(plus(startedAt, 60000));
    await saveCode(token, round._id, 1, { code: 'a = 2' });
    expect((await savedRound(round._id)).slots[0].activeMinutes).toEqual([0, 1]);
  });

  test('R4, 5.3: autosave after the deadline is rejected and the saved code does not change', async () => {
    const { token, id } = await student();
    const round = await saveRound(id, problems.slice(0, 1), activeFields());

    clock.set(at(29));
    await saveCode(token, round._id, 1, { code: 'version = 1' });
    const before = (await savedRound(round._id)).slots[0];

    clock.set(plus(DEADLINE, 1000));
    const res = await saveCode(token, round._id, 1, { code: 'version = 2' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ROUND_EXPIRED');

    const saved = await savedRound(round._id);
    expect(saved.slots[0]).toEqual(before);
    expect(saved).toMatchObject({ status: 'FINISHED', finishReason: 'EXPIRED', finishedAt: DEADLINE });
  });

  test('5.3: autosave exactly at the deadline is rejected; one millisecond before it is saved', async () => {
    const a = await student();
    const b = await student();
    const roundA = await saveRound(a.id, problems.slice(0, 1), activeFields());
    const roundB = await saveRound(b.id, problems.slice(0, 1), activeFields());

    clock.set(DEADLINE);
    const late = await saveCode(a.token, roundA._id, 1, { code: 'late = True' });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('ROUND_EXPIRED');
    expect((await savedRound(roundA._id)).slots[0].code).toBe('');

    clock.set(plus(DEADLINE, -1));
    expect((await saveCode(b.token, roundB._id, 1, { code: 'just_in_time = True' })).status).toBe(204);
    expect((await savedRound(roundB._id)).slots[0].code).toBe('just_in_time = True');
  });

  test('R6: autosave on a manually FINISHED round returns 409 ROUND_NOT_ACTIVE and the code does not change', async () => {
    const { token } = await student();
    const round = await startedRound(token);

    clock.set(at(5));
    await saveCode(token, round.id, 1, { code: 'kept = True' });
    await finishRound(token, round.id);

    const res = await saveCode(token, round.id, 1, { code: 'changed = True' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ROUND_NOT_ACTIVE');
    expect((await savedRound(round.id)).slots[0].code).toBe('kept = True');
  });

  test('autosave on a READY round returns 409 ROUND_NOT_ACTIVE', async () => {
    const { token } = await student();
    const round = await readyRound(token);

    const res = await saveCode(token, round.id, 1, { code: 'early = True' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ROUND_NOT_ACTIVE');
    expect((await savedRound(round.id)).slots[0].code).toBe('');
  });

  test('4.2: code over 51,200 characters returns 413 CODE_TOO_LARGE and changes nothing; exactly 51,200 is saved', async () => {
    const { token, id } = await student();
    const round = await saveRound(id, problems.slice(0, 1), activeFields());

    clock.set(at(1));
    const tooLong = await saveCode(token, round._id, 1, { code: 'x'.repeat(limits.MAX_CODE_CHARS + 1) });
    expect(tooLong.status).toBe(413);
    expect(tooLong.body.error.code).toBe('CODE_TOO_LARGE');
    expect((await savedRound(round._id)).slots[0]).toMatchObject({ code: '', activeMinutes: [] });

    const largest = await saveCode(token, round._id, 1, { code: 'x'.repeat(limits.MAX_CODE_CHARS) });
    expect(largest.status).toBe(204);
    expect((await savedRound(round._id)).slots[0].code).toHaveLength(limits.MAX_CODE_CHARS);
  });

  test('4.4: on a round that is not ACTIVE the guard error comes before the size check', async () => {
    const { token } = await student();
    const round = await readyRound(token);

    const res = await saveCode(token, round.id, 1, { code: 'x'.repeat(limits.MAX_CODE_CHARS + 1) });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ROUND_NOT_ACTIVE');
  });

  test('4.2: a request body over 512 KB returns 413 CODE_TOO_LARGE', async () => {
    const { token, id } = await student();
    const round = await saveRound(id, problems.slice(0, 1), activeFields());

    const res = await saveCode(token, round._id, 1, { code: 'x'.repeat(600 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('CODE_TOO_LARGE');
    expect((await savedRound(round._id)).slots[0].code).toBe('');
  });

  test.each([
    ['code missing', {}],
    ['code as a number', { code: 5 }],
    ['code as null', { code: null }],
    ['code as an array', { code: ['print(1)'] }],
    ['code as an object (injection)', { code: { $set: { status: 'READY' } } }],
  ])('6.2: %s returns 400 VALIDATION_ERROR and nothing changes', async (name, body) => {
    const { token, id } = await student();
    const round = await saveRound(id, problems.slice(0, 1), activeFields());
    const before = await rawRounds();

    const res = await saveCode(token, round._id, 1, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.field)).toContain('body.code');
    expect(await rawRounds()).toEqual(before);
  });

  test('empty code is saved, replacing earlier code', async () => {
    const { token, id } = await student();
    const round = await saveRound(id, problems.slice(0, 1), activeFields());

    await saveCode(token, round._id, 1, { code: 'print(1)' });
    expect((await saveCode(token, round._id, 1, { code: '' })).status).toBe(204);
    expect((await savedRound(round._id)).slots[0].code).toBe('');
  });

  test("R1: user B gets 404, and user A's code does not change", async () => {
    const a = await student();
    const b = await student();
    const round = await saveRound(a.id, problems.slice(0, 1), activeFields());
    const before = await rawRounds();

    const res = await saveCode(b.token, round._id, 1, { code: 'stolen = True' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(await rawRounds()).toEqual(before);
  });

  test('an index outside the round returns 404 and nothing changes', async () => {
    const { token, id } = await student();
    const round = await saveRound(id, problems.slice(0, 2), activeFields());
    const before = await rawRounds();

    for (const index of ['0', '3', 'x']) {
      expect((await saveCode(token, round._id, index, { code: 'a = 1' })).status).toBe(404);
    }
    expect(await rawRounds()).toEqual(before);
  });

  test('5.3: if the round finishes between the guard and the update, the guard errors apply and nothing is saved', async () => {
    const { token, id } = await student();
    const round = await saveRound(id, problems.slice(0, 1), activeFields());

    // The guard sees the round while it is still ACTIVE; a Finish in another tab lands before the update.
    const stale = await roundStateService.guardQuestion(id, String(round._id), 1, at(5), fakeLog());
    await Assessment.updateOne({ _id: round._id }, { $set: { status: 'FINISHED', finishReason: 'MANUAL', finishedAt: at(4) } });
    jest.spyOn(roundStateService, 'guardQuestion').mockResolvedValueOnce(stale);

    clock.set(at(5));
    const res = await saveCode(token, round._id, 1, { code: 'too_late = True' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ROUND_NOT_ACTIVE');
    expect((await savedRound(round._id)).slots[0]).toMatchObject({ code: '', activeMinutes: [] });
  });

  test('6.5: the saved code never appears in the logs', async () => {
    const { token, id } = await student();
    const round = await saveRound(id, problems.slice(0, 1), activeFields());

    await saveCode(token, round._id, 1, { code: 'print("CODE-MARKER")' });
    await saveCode(token, round._id, 1, { code: 'x'.repeat(limits.MAX_CODE_CHARS + 1) + 'CODE-MARKER' });
    expect(JSON.stringify(logs)).not.toContain('CODE-MARKER');
  });
});

// ---------- the round guard ----------

describe('The round guard (spec 4.3)', () => {
  test('4.6, step 1: E10 to E13 without a token return 401', async () => {
    const { token } = await student();
    const round = await readyRound(token);
    const noToken = roundApi(() => app);

    for (const res of [
      await noToken.startRound(null, round.id),
      await noToken.finishRound(null, round.id),
      await noToken.openQuestion(null, round.id, 1),
      await noToken.saveCode(null, round.id, 1, { code: 'a = 1' }),
    ]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    }
    expect((await savedRound(round.id)).status).toBe('READY');
  });

  test('step 1 before step 2: a bad token on an unknown round returns 401, not 404', async () => {
    const res = await openQuestion('not-a-real-token', newId(), 1);
    expect(res.status).toBe(401);
  });

  test("step 2 before step 4: another user's FINISHED round returns 404, not 409", async () => {
    const a = await student();
    const b = await student();
    const round = await saveRound(a.id, problems.slice(0, 1), finishedFields());

    clock.set(at(20));
    expect((await openQuestion(b.token, round._id, 1)).status).toBe(404);
    expect((await saveCode(b.token, round._id, 1, { code: 'a = 1' })).status).toBe(404);
  });

  test('step 4: a round finished by expiry gives ROUND_EXPIRED; a round finished by the student gives ROUND_NOT_ACTIVE', async () => {
    const { token, id } = await student();
    const expired = await saveRound(id, problems.slice(0, 1), { ...finishedFields(), finishReason: 'EXPIRED', finishedAt: DEADLINE });
    const manual = await saveRound(id, problems.slice(0, 1), finishedFields());

    clock.set(at(40));
    expect((await openQuestion(token, expired._id, 1)).body.error.code).toBe('ROUND_EXPIRED');
    expect((await openQuestion(token, manual._id, 1)).body.error.code).toBe('ROUND_NOT_ACTIVE');
  });

  test('6.2: an invalid round id with a bad body returns 404, not 400', async () => {
    const { token } = await student();
    const res = await saveCode(token, 'abc', 1, { code: 5 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ---------- logging ----------

describe('6.5: round events are logged at info level with ids only', () => {
  test('lazy expiry logs "round finished" (EXPIRED) once, even when two requests notice it together', async () => {
    const { token, id } = await student();
    const round = await saveRound(id, problems.slice(0, 1), activeFields());

    clock.set(at(40));
    const responses = await Promise.all([getRound(token, round._id), getRound(token, round._id)]);
    expect(responses.map((res) => res.body.status)).toEqual(['FINISHED', 'FINISHED']);
    expect(eventLines('round finished')).toEqual([
      expect.objectContaining({ level: 30, roundId: String(round._id), userId: id, finishReason: 'EXPIRED' }),
    ]);
  });

  test('E7 logs the expiry it causes', async () => {
    const { token, id } = await student();
    const round = await saveRound(id, problems.slice(0, 1), activeFields());

    clock.set(at(40));
    await listRounds(token);
    expect(eventLines('round finished')).toEqual([
      expect.objectContaining({ roundId: String(round._id), userId: id, finishReason: 'EXPIRED' }),
    ]);
  });

  test('a whole round leaves created, started and finished lines that hold only ids, and no problem data or code', async () => {
    const { token, id: userId } = await student();
    await markedProblem('arrays', 'hard');
    const created = await createRound(token, { slots: [slot('arrays', 'hard')] });
    const roundId = created.body.id;

    clock.set(at(1));
    await startRound(token, roundId);
    await openQuestion(token, roundId, 1);
    await saveCode(token, roundId, 1, { code: 'print("CODE-MARKER")' });
    clock.set(at(2));
    await finishRound(token, roundId);

    const events = logs.filter((line) => ['round created', 'round started', 'round finished'].includes(line.msg));
    expect(events.map((line) => line.msg)).toEqual(['round created', 'round started', 'round finished']);
    // Besides pino's own fields, each line carries the request context that pino-http adds to
    // req.log (the request id and method, and the route).
    const context = ['level', 'time', 'pid', 'hostname', 'msg', 'req', 'route'];
    for (const line of events) {
      expect(line).toMatchObject({ level: 30, roundId, userId });
      expect(Object.keys(line.req).sort()).toEqual(['id', 'method']);
      const fields = Object.keys(line).filter((key) => !context.includes(key));
      expect(fields.sort()).toEqual(line.msg === 'round finished' ? ['finishReason', 'roundId', 'userId'] : ['roundId', 'userId']);
    }
    expect(JSON.stringify(logs)).not.toMatch(new RegExp(MARKERS.join('|')));
  });
});
