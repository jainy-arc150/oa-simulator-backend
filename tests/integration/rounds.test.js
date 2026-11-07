const mongoose = require('mongoose');
const request = require('supertest');
const createApp = require('../../src/app');
const limits = require('../../src/config/limits');
const Assessment = require('../../src/models/Assessment');
const Problem = require('../../src/models/Problem');
const roundService = require('../../src/services/roundService');
const roundStateService = require('../../src/services/roundStateService');
const { useTestDb, createProblem, assessmentData } = require('../helpers/factories');
const { useFakeClock } = require('../helpers/fakeClock');
const { createLogCapture } = require('../helpers/logCapture');

useTestDb();

const START = new Date('2030-01-01T00:00:00.000Z');
const MINUTE = 60 * 1000;
const at = (minutes) => new Date(START.getTime() + minutes * MINUTE);
const DEADLINE = at(30);

let app;
let logs;
let clock;
beforeEach(() => {
  clock = useFakeClock(START);
  const capture = createLogCapture();
  logs = capture.lines;
  app = createApp({ logStream: capture.stream });
});
afterEach(() => {
  clock.restore();
  jest.restoreAllMocks();
});

// ---------- helpers ----------

let studentCounter = 0;
async function student() {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Round Student', email: `round${++studentCounter}@example.com`, password: 'correct horse battery' });
  return { token: res.body.token, id: res.body.user.id };
}

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const createRound = (token, body) => request(app).post('/api/assessments').set(bearer(token)).send(body);
const listRounds = (token, query = '') => request(app).get(`/api/assessments${query}`).set(bearer(token));
const getRound = (token, id) => request(app).get(`/api/assessments/${id}`).set(bearer(token));
const deleteRound = (token, id) => request(app).delete(`/api/assessments/${id}`).set(bearer(token));

const slot = (topic, difficulty) => ({ topic, difficulty });
const newId = () => new mongoose.Types.ObjectId().toString();

async function pool(topic, difficulty, count, overrides = {}) {
  const problems = [];
  for (let i = 0; i < count; i++) problems.push(await createProblem({ topic, difficulty, ...overrides }));
  return problems;
}

// A round saved straight to the database for the user id, one slot per problem.
const saveRound = (userId, problems, overrides) => Assessment.create(assessmentData({ _id: userId }, problems, overrides));
const activeFields = () => ({ status: 'ACTIVE', durationMin: 30, startedAt: START, deadline: DEADLINE });
const finishedFields = () => ({ ...activeFields(), status: 'FINISHED', finishedAt: at(10), finishReason: 'MANUAL' });
const fieldsFor = { READY: () => ({}), ACTIVE: activeFields, FINISHED: finishedFields };

const savedRound = (id) => Assessment.findById(id).lean();
const rawRounds = () => Assessment.collection.find({}).sort({ _id: 1 }).toArray();

// Every piece of problem data and code carries a marker, so a leak shows up in a text search.
const MARKERS = [
  'TITLE-MARKER',
  'STATEMENT-MARKER',
  'FORMAT-MARKER',
  'CONSTRAINT-MARKER',
  'SAMPLE-IN-MARKER',
  'SAMPLE-OUT-MARKER',
  'EXPLANATION-MARKER',
  'HIDDEN-IN-MARKER',
  'HIDDEN-OUT-MARKER',
  'CODE-MARKER',
];

function markedProblem(topic, difficulty) {
  return createProblem({
    topic,
    difficulty,
    title: 'TITLE-MARKER problem',
    statement: 'STATEMENT-MARKER',
    inputFormat: 'FORMAT-MARKER input',
    outputFormat: 'FORMAT-MARKER output',
    constraints: 'CONSTRAINT-MARKER',
    samples: [{ input: 'SAMPLE-IN-MARKER\n', output: 'SAMPLE-OUT-MARKER\n', explanation: 'EXPLANATION-MARKER' }],
    hiddenTests: Array.from({ length: limits.HIDDEN_TESTS_MIN }, (_, i) => ({
      input: `HIDDEN-IN-MARKER-${i}\n`,
      output: `HIDDEN-OUT-MARKER-${i}\n`,
    })),
  });
}

function expectNoProblemData(value, problems) {
  const text = JSON.stringify(value);
  for (const marker of MARKERS) expect(text).not.toContain(marker);
  for (const problem of problems) expect(text).not.toContain(String(problem._id));
  for (const field of ['hiddenTests', 'statement', 'samples', 'code', 'problem', 'title', 'inputFormat', 'constraints']) {
    expect(text).not.toContain(`"${field}"`);
  }
}

const SUMMARY_KEYS = ['createdAt', 'deadline', 'durationMin', 'finishReason', 'finishedAt', 'id', 'serverTime', 'slots', 'startedAt', 'status'];
const SLOT_KEYS = ['difficulty', 'index', 'opened', 'runCount', 'solved', 'submitCount', 'topic'];

// ---------- authentication ----------

describe('E6 to E9: authentication (spec 4.6)', () => {
  test('4.6: every round endpoint without a token returns 401 UNAUTHORIZED', async () => {
    const id = newId();
    const responses = [
      await request(app).post('/api/assessments').send({ slots: [slot('math', 'easy')] }),
      await request(app).get('/api/assessments'),
      await request(app).get(`/api/assessments/${id}`),
      await request(app).delete(`/api/assessments/${id}`),
    ];
    for (const res of responses) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    }
  });

  test('an invalid token returns 401 before the round id is looked at', async () => {
    const res = await getRound('not-a-real-token', 'not-an-id');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});

// ---------- E6 ----------

describe('E6 POST /api/assessments: building a round (spec 4.4, 5.4)', () => {
  test('creates a READY round and returns 201 with the round summary of 4.5', async () => {
    const { token, id: userId } = await student();
    const [mathEasy] = await pool('math', 'easy', 1);
    const [arraysHard] = await pool('arrays', 'hard', 1);

    const res = await createRound(token, { slots: [slot('math', 'easy'), slot('arrays', 'hard')], durationMin: 45 });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      status: 'READY',
      durationMin: 45,
      createdAt: START.toISOString(),
      startedAt: null,
      deadline: null,
      finishedAt: null,
      finishReason: null,
      serverTime: START.toISOString(),
      slots: [
        { index: 1, topic: 'math', difficulty: 'easy', opened: false, solved: false, runCount: 0, submitCount: 0 },
        { index: 2, topic: 'arrays', difficulty: 'hard', opened: false, solved: false, runCount: 0, submitCount: 0 },
      ],
    });

    const saved = await savedRound(res.body.id);
    expect(String(saved.user)).toBe(userId);
    expect(saved.status).toBe('READY');
    expect(saved.slots.map((s) => String(s.problem))).toEqual([String(mathEasy._id), String(arraysHard._id)]);
    for (const s of saved.slots) {
      expect(s).toMatchObject({ code: '', runCount: 0, submitCount: 0, activeMinutes: [] });
      expect(s.firstOpenedAt).toBeUndefined();
      expect(s.solvedAt).toBeUndefined();
    }
  });

  test('5.4 step 2: without durationMin the duration is the sum of the difficulty table', async () => {
    const { token } = await student();
    await pool('math', 'easy', 2);
    await pool('strings', 'medium', 1);
    await pool('sorting', 'hard', 1);
    const table = limits.DIFFICULTY_TABLE;

    const res = await createRound(token, {
      slots: [slot('math', 'easy'), slot('strings', 'medium'), slot('sorting', 'hard'), slot('math', 'easy')],
    });
    expect(res.status).toBe(201);
    expect(res.body.durationMin).toBe(table.easy + table.medium + table.hard + table.easy);
    expect((await savedRound(res.body.id)).durationMin).toBe(res.body.durationMin);
  });

  test('5.4: three slots of the same topic and difficulty give three different problems', async () => {
    const { token } = await student();
    const problems = await pool('strings', 'medium', 3);

    const res = await createRound(token, { slots: Array(3).fill(slot('strings', 'medium')) });
    expect(res.status).toBe(201);

    const picked = (await savedRound(res.body.id)).slots.map((s) => String(s.problem));
    expect(new Set(picked).size).toBe(3);
    expect(new Set(picked)).toEqual(new Set(problems.map((p) => String(p._id))));
  });

  test('R7: with a larger pool the problems of one round are still all different', async () => {
    const { token } = await student();
    await pool('hashing', 'easy', 8);
    const res = await createRound(token, { slots: Array(limits.QUESTIONS_PER_ROUND_MAX).fill(slot('hashing', 'easy')) });
    expect(res.status).toBe(201);
    const picked = (await savedRound(res.body.id)).slots.map((s) => String(s.problem));
    expect(new Set(picked).size).toBe(limits.QUESTIONS_PER_ROUND_MAX);
  });

  test('5.4: 3 slots of a group with only 2 approved problems returns 422 and saves nothing', async () => {
    const { token } = await student();
    await pool('hashing', 'hard', 2);

    const res = await createRound(token, { slots: Array(3).fill(slot('hashing', 'hard')) });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NOT_ENOUGH_PROBLEMS');
    expect(res.body.error.details).toEqual([
      { slots: [1, 2, 3], topic: 'hashing', difficulty: 'hard', requested: 3, available: 2 },
    ]);
    expect(await Assessment.countDocuments()).toBe(0);
  });

  test('5.4: two short groups in one request are both listed in details; a group with enough is not', async () => {
    const { token } = await student();
    await pool('math', 'easy', 1);
    await pool('arrays', 'medium', 3);

    const res = await createRound(token, {
      slots: [slot('math', 'easy'), slot('arrays', 'medium'), slot('math', 'easy'), slot('strings', 'easy'), slot('arrays', 'medium')],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NOT_ENOUGH_PROBLEMS');
    expect(res.body.error.details).toEqual([
      { slots: [1, 3], topic: 'math', difficulty: 'easy', requested: 2, available: 1 },
      { slots: [4], topic: 'strings', difficulty: 'easy', requested: 1, available: 0 },
    ]);
    expect(await Assessment.countDocuments()).toBe(0);
  });

  test('5.4: a draft problem is never picked', async () => {
    const { token } = await student();
    const [approved] = await pool('sorting', 'easy', 1);
    await pool('sorting', 'easy', 4, { status: 'draft' });

    for (let i = 0; i < 5; i++) {
      const res = await createRound(token, { slots: [slot('sorting', 'easy')] });
      expect(res.status).toBe(201);
      expect(String((await savedRound(res.body.id)).slots[0].problem)).toBe(String(approved._id));
    }

    // The drafts are not counted as available either.
    const res = await createRound(token, { slots: [slot('sorting', 'easy'), slot('sorting', 'easy')] });
    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual([{ slots: [1, 2], topic: 'sorting', difficulty: 'easy', requested: 2, available: 1 }]);
  });

  test('5.4, D37: the returned slots keep the requested order', async () => {
    const { token } = await student();
    await pool('math', 'hard', 1);
    await pool('arrays', 'easy', 2);
    await pool('strings', 'medium', 1);
    const requested = [slot('math', 'hard'), slot('arrays', 'easy'), slot('strings', 'medium'), slot('arrays', 'easy')];

    const res = await createRound(token, { slots: requested });
    expect(res.status).toBe(201);
    expect(res.body.slots.map(({ index, topic, difficulty }) => ({ index, topic, difficulty }))).toEqual(
      requested.map((s, position) => ({ index: position + 1, ...s }))
    );

    // Each saved slot points at a problem of its own topic and difficulty.
    const saved = await savedRound(res.body.id);
    const problems = await Problem.find({ _id: mongoose.trusted({ $in: saved.slots.map((s) => s.problem) }) }).lean();
    const byId = new Map(problems.map((p) => [String(p._id), p]));
    saved.slots.forEach((s, position) => {
      expect(s.index).toBe(position + 1);
      expect(byId.get(String(s.problem))).toMatchObject(requested[position]);
    });
  });

  test('5.4: creating a round does not change any other round', async () => {
    const a = await student();
    const b = await student();
    await pool('math', 'easy', 3);
    await createRound(a.token, { slots: [slot('math', 'easy')] });
    await createRound(b.token, { slots: [slot('math', 'easy'), slot('math', 'easy')] });
    const before = await rawRounds();

    clock.advance(MINUTE);
    const res = await createRound(a.token, { slots: Array(3).fill(slot('math', 'easy')) });
    expect(res.status).toBe(201);

    const after = await rawRounds();
    expect(after).toHaveLength(3);
    expect(after.slice(0, 2)).toEqual(before);
  });

  test('D39: problems are picked at random, so every problem of a group can be picked, and $sample is not used', async () => {
    const problems = await pool('math', 'medium', 3);
    const aggregate = jest.spyOn(Problem, 'aggregate');
    const userId = newId();
    const picked = new Set();

    // The chance that one of the three is never picked in 45 rounds is about 3 * (2/3)^45, below 1 in 10 million.
    for (let i = 0; i < 45; i++) {
      const summary = await roundService.createRound(userId, { slots: [slot('math', 'medium')] });
      picked.add(String((await savedRound(summary.id)).slots[0].problem));
      await Assessment.deleteOne({ _id: summary.id });
    }
    expect(picked).toEqual(new Set(problems.map((p) => String(p._id))));
    expect(aggregate).not.toHaveBeenCalled();
  });

  test('R14: with 20 READY rounds the 21st create returns 409 READY_LIMIT_REACHED with a clear message', async () => {
    const { token, id } = await student();
    const problems = await pool('math', 'easy', 1);
    for (let i = 0; i < limits.MAX_READY_ROUNDS_PER_USER; i++) await saveRound(id, problems);

    const res = await createRound(token, { slots: [slot('math', 'easy')] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('READY_LIMIT_REACHED');
    expect(res.body.error.message).toContain(String(limits.MAX_READY_ROUNDS_PER_USER));
    expect(await Assessment.countDocuments({ user: id })).toBe(limits.MAX_READY_ROUNDS_PER_USER);
  });

  test("R14: only the user's own READY rounds count toward the limit", async () => {
    const { token, id } = await student();
    const problems = await pool('math', 'easy', 1);
    for (let i = 0; i < limits.MAX_READY_ROUNDS_PER_USER - 1; i++) await saveRound(id, problems);
    await saveRound(id, problems, activeFields());
    await saveRound(id, problems, finishedFields());
    const otherUser = newId();
    for (let i = 0; i < limits.MAX_READY_ROUNDS_PER_USER; i++) await saveRound(otherUser, problems);

    const allowed = await createRound(token, { slots: [slot('math', 'easy')] });
    expect(allowed.status).toBe(201);
    const refused = await createRound(token, { slots: [slot('math', 'easy')] });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('READY_LIMIT_REACHED');
  });

  test('5.4 step 1: the READY limit is checked before the problem pool', async () => {
    const { token, id } = await student();
    const problems = await pool('math', 'easy', 1);
    for (let i = 0; i < limits.MAX_READY_ROUNDS_PER_USER; i++) await saveRound(id, problems);

    const res = await createRound(token, { slots: [slot('strings', 'hard')] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('READY_LIMIT_REACHED');
  });

  test('R14: deleting a READY round frees a place under the limit', async () => {
    const { token, id } = await student();
    const problems = await pool('math', 'easy', 1);
    const rounds = [];
    for (let i = 0; i < limits.MAX_READY_ROUNDS_PER_USER; i++) rounds.push(await saveRound(id, problems));

    expect((await deleteRound(token, rounds[0]._id)).status).toBe(204);
    expect((await createRound(token, { slots: [slot('math', 'easy')] })).status).toBe(201);
  });

  test('the limits are inclusive: 1 and 5 questions, 5 and 180 minutes', async () => {
    const { token } = await student();
    await pool('math', 'easy', limits.QUESTIONS_PER_ROUND_MAX);

    const smallest = await createRound(token, {
      slots: Array(limits.QUESTIONS_PER_ROUND_MIN).fill(slot('math', 'easy')),
      durationMin: limits.ROUND_DURATION_MIN,
    });
    expect(smallest.status).toBe(201);
    expect(smallest.body.durationMin).toBe(limits.ROUND_DURATION_MIN);

    const largest = await createRound(token, {
      slots: Array(limits.QUESTIONS_PER_ROUND_MAX).fill(slot('math', 'easy')),
      durationMin: limits.ROUND_DURATION_MAX,
    });
    expect(largest.status).toBe(201);
    expect(largest.body.slots).toHaveLength(limits.QUESTIONS_PER_ROUND_MAX);
    expect(largest.body.durationMin).toBe(limits.ROUND_DURATION_MAX);
  });

  const tooMany = Array(limits.QUESTIONS_PER_ROUND_MAX + 1).fill(slot('math', 'easy'));
  test.each([
    ['slots missing', {}, 'body.slots'],
    ['no slots', { slots: [] }, 'body.slots'],
    ['more than 5 slots', { slots: tooMany }, 'body.slots'],
    ['slots not an array', { slots: 'math' }, 'body.slots'],
    ['a topic not in TOPICS', { slots: [slot('graphs', 'easy')] }, 'body.slots.0.topic'],
    ['a topic sent as an object (injection)', { slots: [{ topic: { $ne: null }, difficulty: 'easy' }] }, 'body.slots.0.topic'],
    ['a missing topic', { slots: [{ difficulty: 'easy' }] }, 'body.slots.0.topic'],
    ['an upper-case difficulty', { slots: [slot('math', 'EASY')] }, 'body.slots.0.difficulty'],
    ['an unknown difficulty in slot 2', { slots: [slot('math', 'easy'), slot('math', 'expert')] }, 'body.slots.1.difficulty'],
    ['durationMin below 5', { slots: [slot('math', 'easy')], durationMin: limits.ROUND_DURATION_MIN - 1 }, 'body.durationMin'],
    ['durationMin above 180', { slots: [slot('math', 'easy')], durationMin: limits.ROUND_DURATION_MAX + 1 }, 'body.durationMin'],
    ['durationMin not whole', { slots: [slot('math', 'easy')], durationMin: 30.5 }, 'body.durationMin'],
    ['durationMin as a string', { slots: [slot('math', 'easy')], durationMin: '30' }, 'body.durationMin'],
    ['durationMin null', { slots: [slot('math', 'easy')], durationMin: null }, 'body.durationMin'],
  ])('6.2: %s returns 400 VALIDATION_ERROR naming the field, and saves nothing', async (name, body, field) => {
    const { token } = await student();
    await pool('math', 'easy', limits.QUESTIONS_PER_ROUND_MAX + 1);

    const res = await createRound(token, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.field)).toContain(field);
    expect(await Assessment.countDocuments()).toBe(0);
  });

  test('6.2: unknown fields are removed, so the client cannot choose the owner, status, problems or counters', async () => {
    const a = await student();
    const b = await student();
    const [mathEasy] = await pool('math', 'easy', 1);
    const [other] = await pool('arrays', 'easy', 1);

    const res = await createRound(a.token, {
      slots: [{ topic: 'math', difficulty: 'easy', problem: String(other._id), runCount: 5, code: 'print(1)' }],
      user: b.id,
      status: 'ACTIVE',
      startedAt: START.toISOString(),
      deadline: DEADLINE.toISOString(),
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'READY', startedAt: null, deadline: null });

    const saved = await savedRound(res.body.id);
    expect(String(saved.user)).toBe(a.id);
    expect(saved.status).toBe('READY');
    expect(saved.startedAt).toBeUndefined();
    expect(String(saved.slots[0].problem)).toBe(String(mathEasy._id));
    expect(saved.slots[0]).toMatchObject({ runCount: 0, code: '' });
  });

  test('R2, 6.5: no problem data in the response or the logs; "round created" is logged with ids only', async () => {
    const { token, id: userId } = await student();
    const problem = await markedProblem('math', 'easy');

    const res = await createRound(token, { slots: [slot('math', 'easy')] });
    expect(res.status).toBe(201);
    expectNoProblemData(res.body, [problem]);
    expect(Object.keys(res.body).sort()).toEqual(SUMMARY_KEYS);
    expect(Object.keys(res.body.slots[0]).sort()).toEqual(SLOT_KEYS);

    for (const marker of MARKERS) expect(JSON.stringify(logs)).not.toContain(marker);
    const created = logs.filter((line) => line.msg === 'round created');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ level: 30, roundId: res.body.id, userId });
    expect(JSON.stringify(created[0])).not.toContain('slots');
  });
});

// ---------- E7 ----------

describe('E7 GET /api/assessments: listing rounds (spec 4.4)', () => {
  test("lists only the user's rounds, newest first, with the item fields of 4.4", async () => {
    const a = await student();
    const b = await student();
    const problems = await pool('math', 'easy', 3);

    const older = await saveRound(a.id, problems.slice(0, 2));
    clock.advance(MINUTE);
    const finishedData = assessmentData({ _id: a.id }, problems, { ...finishedFields(), durationMin: 40 });
    finishedData.slots[0].firstOpenedAt = at(1);
    finishedData.slots[0].solvedAt = at(5);
    finishedData.slots[1].firstOpenedAt = at(2);
    const newer = await Assessment.create(finishedData);
    clock.advance(MINUTE);
    await saveRound(b.id, problems);

    const res = await listRounds(a.token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        {
          id: String(newer._id),
          status: 'FINISHED',
          durationMin: 40,
          questionCount: 3,
          solvedCount: 1,
          createdAt: at(1).toISOString(),
          startedAt: START.toISOString(),
          finishedAt: at(10).toISOString(),
          finishReason: 'MANUAL',
        },
        {
          id: String(older._id),
          status: 'READY',
          durationMin: 30,
          questionCount: 2,
          solvedCount: 0,
          createdAt: START.toISOString(),
          startedAt: null,
          finishedAt: null,
          finishReason: null,
        },
      ],
      page: limits.LIST_PAGE_DEFAULT,
      limit: limits.LIST_LIMIT_DEFAULT,
      total: 2,
    });
  });

  test('a user with no rounds gets an empty list', async () => {
    const { token } = await student();
    const res = await listRounds(token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], page: limits.LIST_PAGE_DEFAULT, limit: limits.LIST_LIMIT_DEFAULT, total: 0 });
  });

  test('status filters the list, and total counts only the matching rounds', async () => {
    const { token, id } = await student();
    const problems = await pool('math', 'easy', 1);
    await saveRound(id, problems);
    await saveRound(id, problems);
    await saveRound(id, problems, finishedFields());

    const ready = await listRounds(token, '?status=READY');
    expect(ready.body.total).toBe(2);
    expect(ready.body.items.map((item) => item.status)).toEqual(['READY', 'READY']);

    const finished = await listRounds(token, '?status=FINISHED');
    expect(finished.body.total).toBe(1);
    expect(finished.body.items[0].status).toBe('FINISHED');

    const active = await listRounds(token, '?status=ACTIVE');
    expect(active.body).toMatchObject({ items: [], total: 0 });
  });

  test('page and limit split the list; the defaults are page 1 and limit 20', async () => {
    const { token, id } = await student();
    const problems = await pool('math', 'easy', 1);
    const ids = [];
    for (let i = 0; i < 25; i++) {
      ids.push(String((await saveRound(id, problems, finishedFields()))._id));
      clock.advance(1000);
    }
    const newestFirst = [...ids].reverse();
    const pageIds = (res) => res.body.items.map((item) => item.id);

    const first = await listRounds(token);
    expect(first.body).toMatchObject({ page: 1, limit: limits.LIST_LIMIT_DEFAULT, total: 25 });
    expect(pageIds(first)).toEqual(newestFirst.slice(0, limits.LIST_LIMIT_DEFAULT));

    const second = await listRounds(token, '?page=2');
    expect(second.body).toMatchObject({ page: 2, limit: limits.LIST_LIMIT_DEFAULT, total: 25 });
    expect(pageIds(second)).toEqual(newestFirst.slice(limits.LIST_LIMIT_DEFAULT));

    const third = await listRounds(token, '?page=3&limit=10');
    expect(third.body).toMatchObject({ page: 3, limit: 10, total: 25 });
    expect(pageIds(third)).toEqual(newestFirst.slice(20, 25));

    const beyond = await listRounds(token, '?page=4&limit=10');
    expect(beyond.body).toEqual({ items: [], page: 4, limit: 10, total: 25 });

    const all = await listRounds(token, `?limit=${limits.LIST_LIMIT_MAX}`);
    expect(pageIds(all)).toEqual(newestFirst);
  });

  test('rounds created at the same moment still come out in a fixed order, newest first', async () => {
    const { token, id } = await student();
    const problems = await pool('math', 'easy', 1);
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push(String((await saveRound(id, problems))._id));

    const res = await listRounds(token);
    expect(res.body.items.map((item) => item.id)).toEqual([...ids].reverse());
  });

  test('a very large page returns an empty list, not an error', async () => {
    const { token, id } = await student();
    await saveRound(id, await pool('math', 'easy', 1));
    const res = await listRounds(token, `?page=${Number.MAX_SAFE_INTEGER}&limit=${limits.LIST_LIMIT_MAX}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ items: [], total: 1 });
  });

  test('an unknown query field is ignored', async () => {
    const { token } = await student();
    const res = await listRounds(token, '?user=someone-else&sort=old');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], page: limits.LIST_PAGE_DEFAULT, limit: limits.LIST_LIMIT_DEFAULT, total: 0 });
  });

  test.each([
    ['status=ready', 'query.status'],
    ['status=DONE', 'query.status'],
    ['status[$ne]=READY', 'query.status'],
    ['page=0', 'query.page'],
    ['page=-1', 'query.page'],
    ['page=1.5', 'query.page'],
    ['page=abc', 'query.page'],
    ['page=1e1', 'query.page'],
    ['page=', 'query.page'],
    ['page=1&page=2', 'query.page'],
    ['limit=0', 'query.limit'],
    [`limit=${limits.LIST_LIMIT_MAX + 1}`, 'query.limit'],
    ['limit=20.0', 'query.limit'],
  ])('6.2: ?%s returns 400 VALIDATION_ERROR naming %s', async (query, field) => {
    const { token } = await student();
    const res = await listRounds(token, `?${query}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.field)).toContain(field);
  });

  test('R15, R12: an ACTIVE round past its deadline is listed as FINISHED (EXPIRED) with finishedAt equal to the deadline', async () => {
    const { token, id } = await student();
    const round = await saveRound(id, await pool('math', 'easy', 1), activeFields());

    clock.set(at(45));
    const res = await listRounds(token);
    expect(res.body.items).toEqual([
      expect.objectContaining({ id: String(round._id), status: 'FINISHED', finishReason: 'EXPIRED', finishedAt: DEADLINE.toISOString() }),
    ]);

    const saved = await savedRound(round._id);
    expect(saved).toMatchObject({ status: 'FINISHED', finishReason: 'EXPIRED', finishedAt: DEADLINE, deadline: DEADLINE });

    // The status filter sees the round as it is after expiry.
    expect((await listRounds(token, '?status=ACTIVE')).body.total).toBe(0);
    expect((await listRounds(token, '?status=FINISHED')).body.total).toBe(1);
  });

  test('R15: an ACTIVE round before its deadline stays ACTIVE', async () => {
    const { token, id } = await student();
    await saveRound(id, await pool('math', 'easy', 1), activeFields());

    clock.set(new Date(DEADLINE.getTime() - 1));
    const res = await listRounds(token);
    expect(res.body.items[0]).toMatchObject({ status: 'ACTIVE', finishedAt: null, finishReason: null });
  });

  test('5.3: at exactly the deadline the round has expired', async () => {
    const { token, id } = await student();
    await saveRound(id, await pool('math', 'easy', 1), activeFields());

    clock.set(DEADLINE);
    const res = await listRounds(token);
    expect(res.body.items[0]).toMatchObject({ status: 'FINISHED', finishReason: 'EXPIRED', finishedAt: DEADLINE.toISOString() });
  });

  test("R1: lazy expiry in E7 never touches another user's round", async () => {
    const a = await student();
    const b = await student();
    const problems = await pool('math', 'easy', 1);
    const others = await saveRound(b.id, problems, activeFields());

    clock.set(at(45));
    await listRounds(a.token);
    expect((await savedRound(others._id)).status).toBe('ACTIVE');
  });
});

// ---------- E8 ----------

describe('E8 GET /api/assessments/:id (spec 4.4, 4.5)', () => {
  test("returns the summary of the user's round, with serverTime from the server clock", async () => {
    const { token } = await student();
    await pool('math', 'easy', 2);
    const created = await createRound(token, { slots: [slot('math', 'easy'), slot('math', 'easy')], durationMin: 25 });

    clock.advance(5000);
    const res = await getRound(token, created.body.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...created.body, serverTime: new Date(START.getTime() + 5000).toISOString() });
  });

  test('the slot flags and counters come from the saved round', async () => {
    const { token, id } = await student();
    const problems = await pool('math', 'easy', 3);
    const data = assessmentData({ _id: id }, problems, activeFields());
    Object.assign(data.slots[0], { firstOpenedAt: at(1), runCount: 4, submitCount: 2 });
    Object.assign(data.slots[1], { firstOpenedAt: at(2), solvedAt: at(6), submitCount: 1 });
    const round = await Assessment.create(data);

    clock.set(at(7));
    const res = await getRound(token, round._id);
    expect(res.body).toMatchObject({
      status: 'ACTIVE',
      startedAt: START.toISOString(),
      deadline: DEADLINE.toISOString(),
      finishedAt: null,
      serverTime: at(7).toISOString(),
    });
    expect(res.body.slots).toEqual([
      { index: 1, topic: 'math', difficulty: 'easy', opened: true, solved: false, runCount: 4, submitCount: 2 },
      { index: 2, topic: 'math', difficulty: 'easy', opened: true, solved: true, runCount: 0, submitCount: 1 },
      { index: 3, topic: 'math', difficulty: 'easy', opened: false, solved: false, runCount: 0, submitCount: 0 },
    ]);
  });

  test("R1: user B gets 404 NOT_FOUND on user A's round", async () => {
    const a = await student();
    const b = await student();
    const round = await saveRound(a.id, await pool('math', 'easy', 1));

    const res = await getRound(b.token, round._id);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(res.body)).not.toContain(String(round._id));
  });

  test.each([
    ['not an id', 'abc'],
    ['digits', '123'],
    ['12 characters', 'aaaaaaaaaaaa'],
    ['24 non-hex characters', 'zzzzzzzzzzzzzzzzzzzzzzzz'],
    ['an id with extra text', `${'a'.repeat(24)}x`],
  ])('6.2, 6.8: an invalid round id (%s) returns 404, not 400', async (name, badId) => {
    const { token } = await student();
    const res = await getRound(token, badId);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  test('an unknown round id returns 404', async () => {
    const { token } = await student();
    const res = await getRound(token, newId());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  test.each(['READY', 'ACTIVE', 'FINISHED'])(
    'R16, D20, 4.6: E8 on a %s round returns no statement, samples, code, hidden tests or problem ids',
    async (status) => {
      const { token, id } = await student();
      const problems = [await markedProblem('math', 'easy'), await markedProblem('arrays', 'hard')];
      const data = assessmentData({ _id: id }, problems, fieldsFor[status]());
      data.slots.forEach((s) => {
        s.code = 'print("CODE-MARKER")';
      });
      const round = await Assessment.create(data);

      clock.set(at(5));
      const res = await getRound(token, round._id);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(status);
      expectNoProblemData(res.body, problems);
      expect(Object.keys(res.body).sort()).toEqual(SUMMARY_KEYS);
      res.body.slots.forEach((s) => expect(Object.keys(s).sort()).toEqual(SLOT_KEYS));
      for (const marker of MARKERS) expect(JSON.stringify(logs)).not.toContain(marker);
    }
  );

  test('R7: reading a round again returns the same questions, and reading never changes the round', async () => {
    const { token } = await student();
    await pool('sorting', 'medium', 5);
    const created = await createRound(token, { slots: Array(3).fill(slot('sorting', 'medium')) });
    const before = await rawRounds();

    const first = await getRound(token, created.body.id);
    const second = await getRound(token, created.body.id);
    expect(second.body).toEqual(first.body);
    expect(await rawRounds()).toEqual(before);
  });

  test('R15, R12: an ACTIVE round read after its deadline becomes FINISHED (EXPIRED) with finishedAt equal to the deadline', async () => {
    const { token, id } = await student();
    const round = await saveRound(id, await pool('math', 'easy', 1), activeFields());

    // The student closed the browser; the server notices hours later.
    clock.set(at(180));
    const res = await getRound(token, round._id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'FINISHED',
      finishReason: 'EXPIRED',
      startedAt: START.toISOString(),
      deadline: DEADLINE.toISOString(),
      finishedAt: DEADLINE.toISOString(),
      serverTime: at(180).toISOString(),
    });
    // R12: time used never exceeds the allotted duration.
    const used = new Date(res.body.finishedAt) - new Date(res.body.startedAt);
    expect(used).toBeLessThanOrEqual(res.body.durationMin * MINUTE);

    const saved = await savedRound(round._id);
    expect(saved).toMatchObject({ status: 'FINISHED', finishReason: 'EXPIRED', finishedAt: DEADLINE, deadline: DEADLINE });

    // Reading again later changes nothing.
    clock.set(at(500));
    const again = await getRound(token, round._id);
    expect(again.body.finishedAt).toBe(DEADLINE.toISOString());
  });

  test('R15, R3: before the deadline the round stays ACTIVE and the deadline does not move', async () => {
    const { token, id } = await student();
    const round = await saveRound(id, await pool('math', 'easy', 1), activeFields());
    const before = await rawRounds();

    clock.set(new Date(DEADLINE.getTime() - 1000));
    const res = await getRound(token, round._id);
    expect(res.body).toMatchObject({ status: 'ACTIVE', deadline: DEADLINE.toISOString(), finishedAt: null });
    expect(await rawRounds()).toEqual(before);
  });

  test('5.3: a read at exactly the deadline expires the round', async () => {
    const { token, id } = await student();
    const round = await saveRound(id, await pool('math', 'easy', 1), activeFields());

    clock.set(DEADLINE);
    const res = await getRound(token, round._id);
    expect(res.body).toMatchObject({ status: 'FINISHED', finishReason: 'EXPIRED', finishedAt: DEADLINE.toISOString() });
  });
});

// ---------- lazy expiry ----------

describe('Lazy expiry is one conditional update (spec 5.3)', () => {
  test('if another request finished the round after it was read, expiry changes nothing', async () => {
    const problems = await pool('math', 'easy', 1);
    const round = await saveRound(newId(), problems, activeFields());
    const stale = await savedRound(round._id);

    await Assessment.updateOne(
      { _id: round._id },
      { $set: { status: 'FINISHED', finishReason: 'MANUAL', finishedAt: at(10) } }
    );
    await roundStateService.expireIfDue(stale, at(40));

    expect(await savedRound(round._id)).toMatchObject({ status: 'FINISHED', finishReason: 'MANUAL', finishedAt: at(10) });
  });

  test('READY and FINISHED rounds and ACTIVE rounds before their deadline are not touched', async () => {
    const problems = await pool('math', 'easy', 1);
    const userId = newId();
    const rounds = [
      await saveRound(userId, problems),
      await saveRound(userId, problems, finishedFields()),
      await saveRound(newId(), problems, activeFields()),
    ];
    const before = await rawRounds();

    for (const round of rounds) {
      expect(await roundStateService.expireIfDue(await savedRound(round._id), new Date(DEADLINE.getTime() - 1))).toBe(false);
    }
    expect(await rawRounds()).toEqual(before);
  });
});

// ---------- E9 ----------

describe('E9 DELETE /api/assessments/:id (spec 4.4)', () => {
  test("deletes the user's READY round: 204 with no body, and the round is gone", async () => {
    const { token } = await student();
    await pool('math', 'easy', 1);
    const created = await createRound(token, { slots: [slot('math', 'easy')] });

    const res = await deleteRound(token, created.body.id);
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(await savedRound(created.body.id)).toBeNull();

    expect((await getRound(token, created.body.id)).status).toBe(404);
    const again = await deleteRound(token, created.body.id);
    expect(again.status).toBe(404);
    expect(again.body.error.code).toBe('NOT_FOUND');
  });

  test.each(['ACTIVE', 'FINISHED'])('a %s round cannot be deleted: 409 ROUND_NOT_READY and the round stays', async (status) => {
    const { token, id } = await student();
    const round = await saveRound(id, await pool('math', 'easy', 1), fieldsFor[status]());
    const before = await rawRounds();

    clock.set(at(5));
    const res = await deleteRound(token, round._id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ROUND_NOT_READY');
    expect(await rawRounds()).toEqual(before);
  });

  test("R1: user B gets 404 on user A's READY round, and the round stays", async () => {
    const a = await student();
    const b = await student();
    const round = await saveRound(a.id, await pool('math', 'easy', 1));

    const res = await deleteRound(b.token, round._id);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(await savedRound(round._id)).not.toBeNull();
  });

  test("deleting one round leaves the user's other rounds alone", async () => {
    const { token, id } = await student();
    const problems = await pool('math', 'easy', 1);
    const keep = await saveRound(id, problems);
    const remove = await saveRound(id, problems);
    const before = (await rawRounds()).filter((r) => String(r._id) === String(keep._id));

    expect((await deleteRound(token, remove._id)).status).toBe(204);
    expect(await rawRounds()).toEqual(before);
  });

  test('an invalid or unknown round id returns 404', async () => {
    const { token } = await student();
    for (const badId of ['abc', 'aaaaaaaaaaaa', newId()]) {
      const res = await deleteRound(token, badId);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });
});
