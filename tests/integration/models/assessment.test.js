const Assessment = require('../../../src/models/Assessment');
const limits = require('../../../src/config/limits');
const {
  useTestDb,
  invalidPaths,
  createUser,
  createProblem,
  assessmentData,
  createAssessment,
} = require('../../helpers/factories');

useTestDb();

async function setup(problemCount = 1, problemOverrides = {}) {
  const user = await createUser();
  const problems = [];
  for (let i = 0; i < problemCount; i++) problems.push(await createProblem(problemOverrides));
  return { user, problems };
}

describe('Assessment model: fields and defaults (spec 3.3)', () => {
  test('a new round is READY, with slot counters at 0 and empty code', async () => {
    const { user, problems } = await setup(2);
    const round = await createAssessment(user, problems);
    expect(round.status).toBe('READY');
    expect(round.slots).toHaveLength(2);
    expect(round.slots[0]).toMatchObject({ index: 1, code: '', runCount: 0, submitCount: 0 });
    expect(round.slots[0].activeMinutes).toEqual([]);
    expect(round.slots[0].firstOpenedAt).toBeUndefined();
    expect(round.slots[0].solvedAt).toBeUndefined();
    expect(round.startedAt).toBeUndefined();
    expect(round.deadline).toBeUndefined();
    expect(round.createdAt).toBeInstanceOf(Date);
    expect(round.updatedAt).toBeInstanceOf(Date);
  });

  test('slots are embedded without their own _id', async () => {
    const { user, problems } = await setup();
    const round = await createAssessment(user, problems);
    expect(round.slots[0]._id).toBeUndefined();
  });

  test('user and durationMin are required', async () => {
    const paths = await invalidPaths(Assessment.create({ slots: [] }));
    expect(paths).toEqual(expect.arrayContaining(['user', 'durationMin']));
  });

  test('durationMin must be 5 to 180', async () => {
    const { user, problems } = await setup();
    expect(await invalidPaths(createAssessment(user, problems, { durationMin: 4 }))).toContain('durationMin');
    expect(await invalidPaths(createAssessment(user, problems, { durationMin: 181 }))).toContain('durationMin');
    await expect(createAssessment(user, problems, { durationMin: 5 })).resolves.toBeDefined();
    await expect(createAssessment(user, problems, { durationMin: 180 })).resolves.toBeDefined();
  });

  test('status must be READY, ACTIVE or FINISHED; finishReason MANUAL or EXPIRED', async () => {
    const { user, problems } = await setup();
    expect(await invalidPaths(createAssessment(user, problems, { status: 'PAUSED' }))).toContain('status');
    expect(await invalidPaths(createAssessment(user, problems, { finishedAt: new Date(), finishReason: 'QUIT' }))).toContain(
      'finishReason'
    );
  });

  test('finishedAt and finishReason must be set together', async () => {
    const { user, problems } = await setup();
    expect(await invalidPaths(createAssessment(user, problems, { finishedAt: new Date() }))).toContain('finishReason');
    expect(await invalidPaths(createAssessment(user, problems, { finishReason: 'MANUAL' }))).toContain('finishReason');
    await expect(
      createAssessment(user, problems, { status: 'FINISHED', finishedAt: new Date(), finishReason: 'EXPIRED' })
    ).resolves.toBeDefined();
  });
});

describe('Assessment model: slots (spec 3.3)', () => {
  test('a round needs 1 to 5 questions', async () => {
    const { user, problems } = await setup(6);
    expect(await invalidPaths(createAssessment(user, []))).toContain('slots');
    expect(await invalidPaths(createAssessment(user, problems))).toContain('slots');
    await expect(createAssessment(user, problems.slice(0, 5))).resolves.toBeDefined();
  });

  test('slot indexes must be 1, 2, 3, ... in order', async () => {
    const { user, problems } = await setup(2);
    const data = assessmentData(user, problems);
    data.slots[0].index = 2;
    data.slots[1].index = 1;
    expect(await invalidPaths(Assessment.create(data))).toContain('slots');
  });

  test('R7: the same problem cannot appear twice in one round', async () => {
    const { user, problems } = await setup(1);
    expect(await invalidPaths(createAssessment(user, [problems[0], problems[0]]))).toContain('slots');
  });

  test('a slot topic must be in TOPICS and its difficulty valid', async () => {
    const { user, problems } = await setup();
    const badTopic = assessmentData(user, problems);
    badTopic.slots[0].topic = 'cooking';
    expect(await invalidPaths(Assessment.create(badTopic))).toContain('slots.0.topic');
    const badDifficulty = assessmentData(user, problems);
    badDifficulty.slots[0].difficulty = 'extreme';
    expect(await invalidPaths(Assessment.create(badDifficulty))).toContain('slots.0.difficulty');
  });

  test('a slot whose problem has a different topic cannot be saved', async () => {
    const { user, problems } = await setup(1, { topic: 'math' });
    const data = assessmentData(user, problems);
    data.slots[0].topic = 'strings';
    expect(await invalidPaths(Assessment.create(data))).toContain('slots.0.problem');
    expect(await Assessment.countDocuments()).toBe(0);
  });

  test('a slot whose problem has a different difficulty cannot be saved', async () => {
    const { user, problems } = await setup(1, { difficulty: 'easy' });
    const data = assessmentData(user, problems);
    data.slots[0].difficulty = 'hard';
    expect(await invalidPaths(Assessment.create(data))).toContain('slots.0.problem');
    expect(await Assessment.countDocuments()).toBe(0);
  });

  test('a slot pointing at a problem that does not exist cannot be saved', async () => {
    const { user, problems } = await setup(1);
    const data = assessmentData(user, problems);
    data.slots[0].problem = '64b7f0f0f0f0f0f0f0f0f0f0';
    expect(await invalidPaths(Assessment.create(data))).toContain('slots.0.problem');
  });

  test('changing a slot to a mismatching problem later is also refused', async () => {
    const { user, problems } = await setup(1, { topic: 'math', difficulty: 'easy' });
    const other = await createProblem({ topic: 'strings', difficulty: 'hard' });
    const round = await createAssessment(user, problems);
    const loaded = await Assessment.findById(round._id);
    loaded.slots[0].problem = other._id;
    expect(await invalidPaths(loaded.save())).toContain('slots.0.problem');
  });

  test('R7: reading a round again returns the same problem in every slot, in order', async () => {
    const { user, problems } = await setup(3);
    const round = await createAssessment(user, problems);
    const first = await Assessment.findById(round._id);
    const second = await Assessment.findById(round._id);
    const ids = problems.map((p) => String(p._id));
    expect(first.slots.map((s) => String(s.problem))).toEqual(ids);
    expect(second.slots.map((s) => String(s.problem))).toEqual(ids);
  });

  test('autosaving code on an existing round works and keeps the problems', async () => {
    const { user, problems } = await setup(2);
    const round = await createAssessment(user, problems);
    const loaded = await Assessment.findById(round._id);
    loaded.slots[1].code = 'print(1)';
    loaded.slots[1].codeUpdatedAt = new Date();
    await loaded.save();
    const again = await Assessment.findById(round._id);
    expect(again.slots[1].code).toBe('print(1)');
    expect(again.slots.map((s) => String(s.problem))).toEqual(problems.map((p) => String(p._id)));
  });

  test('code can be exactly 51,200 characters but not one more', async () => {
    const { user, problems } = await setup();
    const ok = assessmentData(user, problems);
    ok.slots[0].code = 'x'.repeat(limits.MAX_CODE_CHARS);
    await expect(Assessment.create(ok)).resolves.toBeDefined();
    const tooLong = assessmentData(user, problems);
    tooLong.slots[0].code = 'x'.repeat(limits.MAX_CODE_CHARS + 1);
    expect(await invalidPaths(Assessment.create(tooLong))).toContain('slots.0.code');
  });

  test('activeMinutes must be whole numbers from 0 with no duplicates', async () => {
    const { user, problems } = await setup();
    for (const activeMinutes of [[1, 1], [-1], [1.5]]) {
      const data = assessmentData(user, problems);
      data.slots[0].activeMinutes = activeMinutes;
      expect(await invalidPaths(Assessment.create(data))).toContain('slots.0.activeMinutes');
    }
    const ok = assessmentData(user, problems);
    ok.slots[0].activeMinutes = [0, 1, 7];
    await expect(Assessment.create(ok)).resolves.toBeDefined();
  });
});

describe('Assessment model: one ACTIVE round per user (R13, spec 3.3)', () => {
  test('R13: a second ACTIVE round for the same user is refused by the database', async () => {
    const { user, problems } = await setup(2);
    await createAssessment(user, [problems[0]], { status: 'ACTIVE', startedAt: new Date(), deadline: new Date() });
    await expect(
      createAssessment(user, [problems[1]], { status: 'ACTIVE', startedAt: new Date(), deadline: new Date() })
    ).rejects.toMatchObject({ code: 11000, keyPattern: { user: 1 } });
    expect(await Assessment.countDocuments({ status: 'ACTIVE' })).toBe(1);
  });

  test('R13: two ACTIVE rounds created at the same moment end with only one', async () => {
    const { user, problems } = await setup(2);
    const results = await Promise.allSettled([
      createAssessment(user, [problems[0]], { status: 'ACTIVE' }),
      createAssessment(user, [problems[1]], { status: 'ACTIVE' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await Assessment.countDocuments({ status: 'ACTIVE' })).toBe(1);
  });

  test('R13: the same user may have one ACTIVE round next to READY and FINISHED rounds', async () => {
    const { user, problems } = await setup(4);
    await createAssessment(user, [problems[0]], { status: 'ACTIVE' });
    await createAssessment(user, [problems[1]], { status: 'READY' });
    await createAssessment(user, [problems[2]], { status: 'READY' });
    await createAssessment(user, [problems[3]], { status: 'FINISHED', finishedAt: new Date(), finishReason: 'MANUAL' });
    expect(await Assessment.countDocuments({ user: user._id })).toBe(4);
  });

  test('R13: different users may each have an ACTIVE round', async () => {
    const { user, problems } = await setup(2);
    const other = await createUser();
    await createAssessment(user, [problems[0]], { status: 'ACTIVE' });
    await expect(createAssessment(other, [problems[1]], { status: 'ACTIVE' })).resolves.toBeDefined();
  });

  test('R13: once the first round is FINISHED, the user may have a new ACTIVE round', async () => {
    const { user, problems } = await setup(2);
    const first = await createAssessment(user, [problems[0]], { status: 'ACTIVE' });
    first.status = 'FINISHED';
    first.finishedAt = new Date();
    first.finishReason = 'MANUAL';
    await first.save();
    await expect(createAssessment(user, [problems[1]], { status: 'ACTIVE' })).resolves.toBeDefined();
  });
});

describe('Assessment model: indexes (spec 3.3)', () => {
  test('has the user+createdAt, user+status and unique partial ACTIVE indexes', async () => {
    const indexes = await Assessment.collection.indexes();
    const keys = indexes.map((i) => JSON.stringify(i.key));
    expect(keys).toContain(JSON.stringify({ user: 1, createdAt: -1 }));
    expect(keys).toContain(JSON.stringify({ user: 1, status: 1 }));
    const active = indexes.find((i) => JSON.stringify(i.key) === JSON.stringify({ user: 1 }));
    expect(active).toMatchObject({ unique: true, partialFilterExpression: { status: 'ACTIVE' } });
  });
});
