// Slow tests: these run reference solutions with real Python through runTests (spec 7.5).
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const createApp = require('../../src/app');
const limits = require('../../src/config/limits');
const Problem = require('../../src/models/Problem');
const { validateAll, listSlugs, DEFAULT_SEED_DIR } = require('../../seed/validateProblems');
const { generateAll, fingerprint } = require('../../seed/generateExpected');
const { seedAll } = require('../../seed/seedProblems');
const { useTestDb } = require('../helpers/factories');
const { createSeedFixture, validProblem, ADD_TWO_SOLUTION } = require('../helpers/seedFixture');
const { createLogCapture } = require('../helpers/logCapture');

const REAL_BANK_TIMEOUT_MS = 300000;

let fixture;
beforeEach(() => {
  fixture = createSeedFixture();
});
afterEach(() => fixture.cleanup());

function addProblem(slug, solution = ADD_TWO_SOLUTION, overrides = {}) {
  fixture.writeProblem(slug, validProblem(slug, overrides));
  fixture.writeSolution(slug, solution);
}
const validate = () => validateAll({ seedDir: fixture.dir });
const generate = () => generateAll({ seedDir: fixture.dir, expectedDir: fixture.expectedDir });
const readExpectedFile = (slug) => JSON.parse(fs.readFileSync(fixture.expectedPath(slug), 'utf8'));

describe('validateProblems: the reference solution (spec 7.5)', () => {
  test('a correct and fast reference passes', async () => {
    addProblem('add-two');
    const { results, ok } = await validate();
    expect(ok).toBe(true);
    expect(results).toEqual([{ slug: 'add-two', errors: [] }]);
  });

  test('7.5: a reference that is correct but takes half of timeLimitMs or more fails', async () => {
    const timeLimitMs = 1000;
    const budgetMs = timeLimitMs * limits.REFERENCE_TIME_FRACTION;
    addProblem('slow-one', `import time\ntime.sleep(${(budgetMs + 100) / 1000})\n${ADD_TWO_SOLUTION}`, { timeLimitMs });

    const { results, ok } = await validate();
    expect(ok).toBe(false);
    expect(results[0].errors[0]).toMatch(new RegExp(`^the reference solution took \\d+ ms on samples\\[0\\]; it must finish in under ${budgetMs} ms$`));
  });

  test('a reference that crashes fails, and the message has no test data or error text', async () => {
    addProblem('crash-one', 'raise ValueError(input())\n');
    const { results } = await validate();
    expect(results[0].errors).toEqual(['the reference solution gave RUNTIME_ERROR on samples[0]']);
  });

  test('a reference that runs out of time fails', async () => {
    addProblem('loop-one', 'while True:\n    pass\n', { timeLimitMs: 500 });
    const { results } = await validate();
    expect(results[0].errors).toEqual(['the reference solution gave TIME_LIMIT_EXCEEDED on samples[0]']);
  });

  test('a reference with a syntax error fails with its line number', async () => {
    addProblem('syntax-one', 'a = 1\nif a == 1\n    print(a)\n');
    const { results } = await validate();
    expect(results[0].errors).toEqual(['the reference solution has a syntax error on line 2']);
  });

  test('a reference that fails only on a hidden input names that input', async () => {
    addProblem('late-crash', 'a, b = map(int, input().split())\nassert a != 7\nprint(a + b)\n');
    const { results } = await validate();
    expect(results[0].errors).toEqual(['the reference solution gave RUNTIME_ERROR on hiddenInputs[2]']);
  });
});

describe('generateExpected (spec 7.5)', () => {
  test('7.5: writes every sample and hidden output, already normalized (5.2), with a fingerprint', async () => {
    addProblem('add-two', 'a, b = map(int, input().split())\nprint(a + b, end="  \\r\\n\\n\\n")\n');
    const { results, ok, stopped } = await generate();

    expect({ ok, stopped }).toEqual({ ok: true, stopped: false });
    expect(results).toEqual([{ slug: 'add-two', status: 'generated', errors: [] }]);
    expect(readExpectedFile('add-two')).toEqual({
      slug: 'add-two',
      fingerprint: fingerprint(fixture.dir, 'add-two'),
      samples: ['3'],
      hiddenTests: ['7', '11', '15', '19', '23'],
    });
  });

  test('7.5: a reference solution that fails or times out stops the script', async () => {
    addProblem('a-first');
    addProblem('b-crashes', 'raise SystemExit(1)\n');
    addProblem('c-never-reached');

    const { results, ok, stopped } = await generate();
    expect({ ok, stopped }).toEqual({ ok: false, stopped: true });
    expect(results.map((r) => [r.slug, r.status])).toEqual([['a-first', 'generated'], ['b-crashes', 'failed']]);
    expect(fs.existsSync(fixture.expectedPath('a-first'))).toBe(true);
    expect(fs.existsSync(fixture.expectedPath('b-crashes'))).toBe(false);
    expect(fs.existsSync(fixture.expectedPath('c-never-reached'))).toBe(false);
  });

  test('a problem that fails validation gets no outputs, its old outputs are removed, and the script goes on', async () => {
    addProblem('a-invalid');
    await generate();
    expect(fs.existsSync(fixture.expectedPath('a-invalid'))).toBe(true);

    addProblem('a-invalid', ADD_TWO_SOLUTION, { topic: 'trees' });
    addProblem('b-valid');
    const { results, stopped } = await generate();

    expect(stopped).toBe(false);
    expect(results.map((r) => [r.slug, r.status])).toEqual([['a-invalid', 'invalid'], ['b-valid', 'generated']]);
    expect(fs.existsSync(fixture.expectedPath('a-invalid'))).toBe(false);
  });

  test('7.5: a correct reference that is too slow gets no outputs, but does not stop the script', async () => {
    const timeLimitMs = 1000;
    const budgetMs = timeLimitMs * limits.REFERENCE_TIME_FRACTION;
    addProblem('a-slow', `import time\ntime.sleep(${(budgetMs + 100) / 1000})\n${ADD_TWO_SOLUTION}`, { timeLimitMs });
    addProblem('b-fast');

    const { results, stopped } = await generate();
    expect(stopped).toBe(false);
    expect(results.map((r) => [r.slug, r.status])).toEqual([['a-slow', 'invalid'], ['b-fast', 'generated']]);
    expect(fs.existsSync(fixture.expectedPath('a-slow'))).toBe(false);
  });
});

describe('The full pipeline on the real question bank (spec 7.3 Phase 4)', () => {
  useTestDb();

  test(
    'Phase 4: every problem passes validation and generation, seeding twice gives no duplicates, and E5 counts match',
    async () => {
      const slugs = listSlugs(DEFAULT_SEED_DIR);
      const expectedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-seed-expected-'));
      try {
        const validation = await validateAll();
        expect(validation.results.filter((r) => r.errors.length > 0)).toEqual([]);

        const generation = await generateAll({ expectedDir });
        expect(generation.results.filter((r) => r.status !== 'generated')).toEqual([]);
        expect(generation.results).toHaveLength(slugs.length);

        const first = await seedAll({ expectedDir });
        expect(first.results.map((r) => r.status)).toEqual(slugs.map(() => 'created'));
        const second = await seedAll({ expectedDir });
        expect(second.results.map((r) => r.status)).toEqual(slugs.map(() => 'updated'));

        expect(await Problem.countDocuments()).toBe(slugs.length);
        expect(await Problem.countDocuments({ status: 'approved' })).toBe(slugs.length);
        for (const problem of await Problem.find().select('+hiddenTests').lean()) {
          expect(problem.hiddenTests.length).toBeGreaterThanOrEqual(limits.HIDDEN_TESTS_MIN);
          expect(problem.hiddenTests.length).toBeLessThanOrEqual(limits.HIDDEN_TESTS_MAX);
          for (const test of [...problem.samples, ...problem.hiddenTests]) expect(typeof test.output).toBe('string');
        }

        // E5 must report exactly what is in the seed folder.
        const wanted = new Map();
        for (const slug of slugs) {
          const { topic, difficulty } = JSON.parse(fs.readFileSync(path.join(DEFAULT_SEED_DIR, 'problems', `${slug}.json`), 'utf8'));
          if (!wanted.has(topic)) wanted.set(topic, { topic, easy: 0, medium: 0, hard: 0 });
          wanted.get(topic)[difficulty] += 1;
        }
        const app = createApp({ logStream: createLogCapture().stream });
        const reg = await request(app)
          .post('/api/auth/register')
          .send({ name: 'Bank Check', email: 'bank@example.com', password: 'correct horse battery' });
        const res = await request(app).get('/api/topics').set('Authorization', `Bearer ${reg.body.token}`);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ topics: limits.TOPICS.filter((t) => wanted.has(t)).map((t) => wanted.get(t)) });
        expect(JSON.stringify(res.body)).not.toContain('hiddenTests');
      } finally {
        fs.rmSync(expectedDir, { recursive: true, force: true });
      }
    },
    REAL_BANK_TIMEOUT_MS
  );
});
