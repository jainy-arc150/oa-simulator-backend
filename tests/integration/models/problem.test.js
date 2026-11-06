const Problem = require('../../../src/models/Problem');
const limits = require('../../../src/config/limits');
const { useTestDb, invalidPaths, problemData, createProblem } = require('../../helpers/factories');

useTestDb();

const tests = (count) => Array.from({ length: count }, (_, i) => ({ input: `${i}\n`, output: `${i}\n` }));

describe('Problem model: hidden tests never leave a query (R2, spec 3.2)', () => {
  test('R2: find, findOne, findById and lean never return hiddenTests', async () => {
    const created = await createProblem();
    expect((await Problem.find())[0].hiddenTests).toBeUndefined();
    expect((await Problem.findOne()).hiddenTests).toBeUndefined();
    expect((await Problem.findById(created._id)).hiddenTests).toBeUndefined();
    expect((await Problem.findOne().lean()).hiddenTests).toBeUndefined();
    expect((await Problem.find().select('title topic'))[0].hiddenTests).toBeUndefined();
    expect(JSON.stringify(await Problem.findOne())).not.toContain('hiddenTests');
  });

  test('R2: hiddenTests is returned only when asked with .select("+hiddenTests")', async () => {
    await createProblem();
    const problem = await Problem.findOne().select('+hiddenTests');
    expect(problem.hiddenTests).toHaveLength(5);
    expect(problem.hiddenTests[0]).toMatchObject({ input: '0 0\n', output: '0\n' });
  });

  test('a problem loaded without hiddenTests can still be saved', async () => {
    const created = await createProblem();
    const loaded = await Problem.findById(created._id);
    loaded.title = 'A new title';
    await loaded.save();
    const again = await Problem.findById(created._id).select('+hiddenTests');
    expect(again.title).toBe('A new title');
    expect(again.hiddenTests).toHaveLength(5);
  });
});

describe('Problem model: validation (spec 3.2)', () => {
  test('an approved problem with 4 hidden tests is rejected', async () => {
    expect(await invalidPaths(Problem.create(problemData({ hiddenTests: tests(4) })))).toContain('hiddenTests');
  });

  test('an approved problem with 11 hidden tests, or none, is rejected', async () => {
    expect(await invalidPaths(Problem.create(problemData({ hiddenTests: tests(11) })))).toContain('hiddenTests');
    expect(await invalidPaths(Problem.create(problemData({ hiddenTests: [] })))).toContain('hiddenTests');
  });

  test('an approved problem with 5 or 10 hidden tests is accepted', async () => {
    await expect(Problem.create(problemData({ hiddenTests: tests(5) }))).resolves.toBeDefined();
    await expect(Problem.create(problemData({ hiddenTests: tests(10) }))).resolves.toBeDefined();
  });

  test('a draft problem may have fewer than 5 hidden tests, or none', async () => {
    await expect(Problem.create(problemData({ status: 'draft', hiddenTests: tests(2) }))).resolves.toBeDefined();
    await expect(Problem.create(problemData({ status: 'draft', hiddenTests: [] }))).resolves.toBeDefined();
  });

  test('a topic that is not in TOPICS is rejected', async () => {
    expect(await invalidPaths(Problem.create(problemData({ topic: 'underwater-basket-weaving' })))).toContain('topic');
  });

  test('every topic in TOPICS is accepted, and a topic added to TOPICS needs no other change', async () => {
    for (const topic of limits.TOPICS) {
      await expect(Problem.create(problemData({ topic }))).resolves.toBeDefined();
    }
    limits.TOPICS.push('brand-new-topic');
    try {
      await expect(Problem.create(problemData({ topic: 'brand-new-topic' }))).resolves.toBeDefined();
    } finally {
      limits.TOPICS.pop();
    }
  });

  test('slug allows lowercase letters, digits and single hyphens only', async () => {
    await expect(Problem.create(problemData({ slug: 'add-two-numbers' }))).resolves.toBeDefined();
    await expect(Problem.create(problemData({ slug: 'sum2' }))).resolves.toBeDefined();
    for (const slug of ['Add-Two', 'add two', '-add', 'add-', 'add--two', 'add_two', '']) {
      expect(await invalidPaths(Problem.create(problemData({ slug })))).toContain('slug');
    }
  });

  test('slug is unique', async () => {
    await createProblem({ slug: 'same-slug' });
    await expect(createProblem({ slug: 'same-slug' })).rejects.toMatchObject({ code: 11000 });
  });

  test('title must be 3 to 100 characters', async () => {
    expect(await invalidPaths(Problem.create(problemData({ title: 'ab' })))).toContain('title');
    expect(await invalidPaths(Problem.create(problemData({ title: 'a'.repeat(101) })))).toContain('title');
    await expect(Problem.create(problemData({ title: 'abc' }))).resolves.toBeDefined();
    await expect(Problem.create(problemData({ title: 'a'.repeat(100) }))).resolves.toBeDefined();
  });

  test('timeLimitMs defaults to 2000 and must be 500 to 10000', async () => {
    const data = problemData();
    expect((await Problem.create(data)).timeLimitMs).toBe(2000);
    expect(await invalidPaths(Problem.create(problemData({ timeLimitMs: 499 })))).toContain('timeLimitMs');
    expect(await invalidPaths(Problem.create(problemData({ timeLimitMs: 10001 })))).toContain('timeLimitMs');
    await expect(Problem.create(problemData({ timeLimitMs: 500 }))).resolves.toBeDefined();
    await expect(Problem.create(problemData({ timeLimitMs: 10000 }))).resolves.toBeDefined();
  });

  test('samples must be 1 to 3 items', async () => {
    const sample = { input: '1\n', output: '1\n' };
    expect(await invalidPaths(Problem.create(problemData({ samples: [] })))).toContain('samples');
    expect(await invalidPaths(Problem.create(problemData({ samples: [sample, sample, sample, sample] })))).toContain('samples');
    await expect(Problem.create(problemData({ samples: [sample, sample, sample] }))).resolves.toBeDefined();
  });

  test('a sample or hidden test may have an empty input or output string', async () => {
    const empty = { input: '', output: '' };
    await expect(Problem.create(problemData({ samples: [empty], hiddenTests: tests(4).concat(empty) }))).resolves.toBeDefined();
  });

  test('difficulty must be easy, medium or hard (lowercase)', async () => {
    for (const difficulty of ['easy', 'medium', 'hard']) {
      await expect(Problem.create(problemData({ difficulty }))).resolves.toBeDefined();
    }
    expect(await invalidPaths(Problem.create(problemData({ difficulty: 'Easy' })))).toContain('difficulty');
  });

  test('status defaults to draft and only draft or approved is allowed', async () => {
    const { status, ...rest } = problemData();
    expect((await Problem.create(rest)).status).toBe('draft');
    expect(await invalidPaths(Problem.create(problemData({ status: 'published' })))).toContain('status');
  });

  test('statement, formats and constraints are required', async () => {
    const { statement, inputFormat, outputFormat, constraints, ...rest } = problemData();
    const paths = await invalidPaths(Problem.create(rest));
    expect(paths).toEqual(expect.arrayContaining(['statement', 'inputFormat', 'outputFormat', 'constraints']));
  });
});

describe('Problem model: indexes (spec 3.2)', () => {
  test('has a unique index on slug and a compound index on status, topic, difficulty', async () => {
    const indexes = await Problem.collection.indexes();
    expect(indexes.some((i) => i.key.slug === 1 && i.unique)).toBe(true);
    expect(indexes.some((i) => JSON.stringify(i.key) === JSON.stringify({ status: 1, topic: 1, difficulty: 1 }))).toBe(true);
  });
});
