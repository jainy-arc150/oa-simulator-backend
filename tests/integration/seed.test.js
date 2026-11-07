// Seed pipeline tests that need no Python (spec 7.5). The tests that run reference solutions are
// in seed.slow.test.js.
const fs = require('fs');
const Problem = require('../../src/models/Problem');
const { checkProblem, validateAll, listSlugs, DEFAULT_SEED_DIR } = require('../../seed/validateProblems');
const { fingerprint } = require('../../seed/generateExpected');
const { seedAll } = require('../../seed/seedProblems');
const { useTestDb } = require('../helpers/factories');
const { createSeedFixture, validProblem, ADD_TWO_SOLUTION } = require('../helpers/seedFixture');

const PHASE_4_MIN_PROBLEMS = 15;
const REQUIRED_FIELDS = ['slug', 'title', 'statement', 'inputFormat', 'outputFormat', 'constraints', 'topic', 'difficulty', 'timeLimitMs', 'samples', 'hiddenInputs'];

let fixture;
beforeEach(() => {
  fixture = createSeedFixture();
});
afterEach(() => fixture.cleanup());

// Writes a problem (valid unless overridden) with its solution and returns its validation errors.
function errorsFor(data, slug = 'add-two') {
  fixture.writeProblem(slug, data);
  fixture.writeSolution(slug, ADD_TWO_SOLUTION);
  return checkProblem(fixture.dir, slug).errors;
}
const hidden = (count) => Array.from({ length: count }, (_, i) => `${i + 1} ${i + 1}\n`);
const sample = (input) => ({ input, explanation: 'Answer: something.' });

describe('validateProblems: rules of spec 7.5', () => {
  test('a valid problem has no errors', () => {
    expect(errorsFor(validProblem('add-two'))).toEqual([]);
  });

  test('7.5: every required field must be present', () => {
    for (const field of REQUIRED_FIELDS) {
      const data = validProblem('add-two');
      delete data[field];
      expect(errorsFor(data)).toContain(`${field} is missing`);
    }
  });

  test('7.5: topic must be in TOPICS', () => {
    const errors = errorsFor(validProblem('add-two', { topic: 'trees' }));
    expect(errors).toEqual([expect.stringMatching(/^topic: trees is not one of the allowed topics/)]);
  });

  test('7.5: there must be 1 to 3 samples', () => {
    expect(errorsFor(validProblem('add-two', { samples: [] }))).toEqual([expect.stringMatching(/^samples: a problem needs 1 to 3 samples/)]);
    const four = ['1 1\n', '2 2\n', '3 3\n', '4 4\n'].map(sample);
    expect(errorsFor(validProblem('add-two', { samples: four }))).toEqual([expect.stringMatching(/^samples: /)]);
    expect(errorsFor(validProblem('add-two', { samples: four.slice(0, 3) }))).toEqual([]);
  });

  test('7.5: there must be 5 to 10 hidden inputs', () => {
    expect(errorsFor(validProblem('add-two', { hiddenInputs: hidden(4) }))).toEqual([
      'hiddenInputs: an approved problem needs 5 to 10 hidden inputs',
    ]);
    expect(errorsFor(validProblem('add-two', { hiddenInputs: hidden(11) }))).toEqual([
      'hiddenInputs: an approved problem needs 5 to 10 hidden inputs',
    ]);
    expect(errorsFor(validProblem('add-two', { hiddenInputs: hidden(5) }))).toEqual([]);
    expect(errorsFor(validProblem('add-two', { hiddenInputs: hidden(10) }))).toEqual([]);
  });

  test('7.5: every input must end with a newline', () => {
    expect(errorsFor(validProblem('add-two', { samples: [sample('1 2')] }))).toEqual(['samples[0].input does not end with a newline']);
    const inputs = hidden(5);
    inputs[3] = '4 4';
    expect(errorsFor(validProblem('add-two', { hiddenInputs: inputs }))).toEqual(['hiddenInputs[3] does not end with a newline']);
  });

  test('7.5: no two tests may have the same input', () => {
    const inputs = hidden(5);
    inputs[4] = inputs[1];
    expect(errorsFor(validProblem('add-two', { hiddenInputs: inputs }))).toEqual(['hiddenInputs[4] has the same input as hiddenInputs[1]']);
    const withSample = hidden(5);
    withSample[2] = '1 2\n';
    expect(errorsFor(validProblem('add-two', { hiddenInputs: withSample }))).toEqual(['hiddenInputs[2] has the same input as samples[0]']);
  });

  test('7.5: samples have an explanation and no output written by hand', () => {
    expect(errorsFor(validProblem('add-two', { samples: [{ input: '1 2\n', explanation: 'x', output: '3' }] }))).toEqual([
      'samples[0] has an output; outputs are generated, never written by hand',
    ]);
    expect(errorsFor(validProblem('add-two', { samples: [{ input: '1 2\n' }] }))).toEqual(['samples[0].explanation is missing']);
  });

  test('7.5: the reference solution must exist', () => {
    fixture.writeProblem('add-two', validProblem('add-two'));
    expect(checkProblem(fixture.dir, 'add-two').errors).toEqual(['the reference solution solutions/add-two.py is missing']);
  });

  test('3.2: slug, title, difficulty and timeLimitMs rules are checked', () => {
    expect(errorsFor(validProblem('other-name'))).toEqual(['slug "other-name" does not match the file name']);
    expect(errorsFor(validProblem('Add-Two'), 'Add-Two')).toEqual([expect.stringMatching(/^slug: /)]);
    expect(errorsFor(validProblem('add-two', { title: 'ab' }))).toEqual([expect.stringMatching(/^title: /)]);
    expect(errorsFor(validProblem('add-two', { difficulty: 'Easy' }))).toEqual([expect.stringMatching(/^difficulty: /)]);
    expect(errorsFor(validProblem('add-two', { timeLimitMs: 499 }))).toEqual([expect.stringMatching(/^timeLimitMs: /)]);
    expect(errorsFor(validProblem('add-two', { timeLimitMs: 10001 }))).toEqual([expect.stringMatching(/^timeLimitMs: /)]);
    expect(errorsFor(validProblem('add-two', { timeLimitMs: 1500.5 }))).toEqual(['timeLimitMs must be a whole number']);
    expect(errorsFor(validProblem('add-two', { title: 42 }))).toEqual(['title must be a non-empty string']);
  });

  test('a file that is not valid JSON is reported', () => {
    expect(errorsFor('{ "slug": ')).toEqual(['the file is not valid JSON']);
  });

  test('validateAll checks every problem and fails if any one fails', async () => {
    fixture.writeProblem('good-one', validProblem('good-one'));
    fixture.writeSolution('good-one', ADD_TWO_SOLUTION);
    fixture.writeProblem('bad-one', validProblem('bad-one', { topic: 'trees' }));
    fixture.writeSolution('bad-one', ADD_TWO_SOLUTION);

    const { results, ok } = await validateAll({ seedDir: fixture.dir, runReference: false });
    expect(ok).toBe(false);
    expect(results.map((r) => [r.slug, r.errors.length > 0])).toEqual([['bad-one', true], ['good-one', false]]);
  });
});

describe('The real question bank (spec 5.2, 7.3 Phase 4, 7.5)', () => {
  const slugs = listSlugs(DEFAULT_SEED_DIR);

  test(`Phase 4: there are at least ${PHASE_4_MIN_PROBLEMS} problems`, () => {
    expect(slugs.length).toBeGreaterThanOrEqual(PHASE_4_MIN_PROBLEMS);
  });

  test('7.5: every problem passes every rule that does not need Python', () => {
    for (const slug of slugs) {
      expect({ slug, errors: checkProblem(DEFAULT_SEED_DIR, slug).errors }).toEqual({ slug, errors: [] });
    }
  });

  test('5.2: every problem in the seed data states its input format and output format', () => {
    for (const slug of slugs) {
      const { data } = checkProblem(DEFAULT_SEED_DIR, slug);
      expect(data.inputFormat.trim().length).toBeGreaterThan(0);
      expect(data.outputFormat.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('seedProblems (spec 7.5)', () => {
  useTestDb();

  const OUTPUTS = { samples: ['3'], hiddenTests: ['7', '11', '15', '19', '23'] };
  function writeExpected(slug, outputs = OUTPUTS, print = fingerprint(fixture.dir, slug)) {
    fs.mkdirSync(fixture.expectedDir, { recursive: true });
    fs.writeFileSync(fixture.expectedPath(slug), JSON.stringify({ slug, fingerprint: print, ...outputs }));
  }
  function addProblem(slug, overrides) {
    fixture.writeProblem(slug, validProblem(slug, overrides));
    fixture.writeSolution(slug, ADD_TWO_SOLUTION);
  }
  const seed = () => seedAll({ seedDir: fixture.dir, expectedDir: fixture.expectedDir });

  test('imports a problem with status approved, its samples with outputs, and its hidden tests', async () => {
    addProblem('add-two');
    writeExpected('add-two');

    const { results, ok } = await seed();
    expect(ok).toBe(true);
    expect(results).toEqual([{ slug: 'add-two', status: 'created', reasons: [] }]);

    const stored = await Problem.findOne({ slug: 'add-two' }).select('+hiddenTests').lean();
    expect(stored).toMatchObject({
      title: 'Add Two Numbers',
      topic: 'math',
      difficulty: 'easy',
      timeLimitMs: 2000,
      status: 'approved',
      samples: [{ input: '1 2\n', output: '3', explanation: '1 + 2 = 3. Answer: 3.' }],
    });
    expect(stored.hiddenTests).toEqual([
      { input: '3 4\n', output: '7' },
      { input: '5 6\n', output: '11' },
      { input: '7 8\n', output: '15' },
      { input: '9 10\n', output: '19' },
      { input: '11 12\n', output: '23' },
    ]);
  });

  test('Phase 4: running it twice gives no duplicates and updates the same document', async () => {
    addProblem('add-two');
    writeExpected('add-two');
    await seed();
    const first = await Problem.findOne({ slug: 'add-two' });

    addProblem('add-two', { title: 'Add Two Numbers Again' });
    writeExpected('add-two');
    const { results } = await seed();

    expect(results).toEqual([{ slug: 'add-two', status: 'updated', reasons: [] }]);
    expect(await Problem.countDocuments()).toBe(1);
    const second = await Problem.findOne({ slug: 'add-two' });
    expect(String(second._id)).toBe(String(first._id));
    expect(second.title).toBe('Add Two Numbers Again');
  });

  test('7.5: a problem that failed validation is never imported, even with expected outputs', async () => {
    addProblem('add-two', { topic: 'trees' });
    writeExpected('add-two');

    const { results, ok } = await seed();
    expect(ok).toBe(false);
    expect(results[0]).toMatchObject({ slug: 'add-two', status: 'skipped' });
    expect(await Problem.countDocuments()).toBe(0);
  });

  test('7.5: a problem with no generated outputs is never imported', async () => {
    addProblem('add-two');
    const { results } = await seed();
    expect(results).toEqual([{ slug: 'add-two', status: 'skipped', reasons: ['no expected outputs; run npm run seed:generate first'] }]);
    expect(await Problem.countDocuments()).toBe(0);
  });

  test('7.5: outputs generated before the problem or its solution changed are not imported', async () => {
    addProblem('add-two');
    writeExpected('add-two');
    fixture.writeSolution('add-two', `${ADD_TWO_SOLUTION}# changed\n`);

    const { results } = await seed();
    expect(results[0].reasons).toEqual(['the expected outputs are out of date; run npm run seed:generate again']);
    expect(await Problem.countDocuments()).toBe(0);
  });

  test('outputs that do not match the number of tests are not imported', async () => {
    addProblem('add-two');
    writeExpected('add-two', { samples: ['3'], hiddenTests: ['7'] });
    const { results } = await seed();
    expect(results[0].status).toBe('skipped');
    expect(await Problem.countDocuments()).toBe(0);
  });

  test('the other problems are still imported when one is skipped', async () => {
    addProblem('good-one');
    writeExpected('good-one');
    addProblem('no-outputs');

    const { results } = await seed();
    expect(results.map((r) => [r.slug, r.status])).toEqual([['good-one', 'created'], ['no-outputs', 'skipped']]);
    expect(await Problem.countDocuments({ status: 'approved' })).toBe(1);
  });

  test('a problem that is no longer in the folder is not deleted', async () => {
    addProblem('add-two');
    writeExpected('add-two');
    await seed();
    fs.rmSync(`${fixture.dir}/problems/add-two.json`);

    await seed();
    expect(await Problem.countDocuments({ slug: 'add-two' })).toBe(1);
  });
});
