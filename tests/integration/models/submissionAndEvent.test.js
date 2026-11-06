const mongoose = require('mongoose');
const Submission = require('../../../src/models/Submission');
const AttemptEvent = require('../../../src/models/AttemptEvent');
const { useTestDb, invalidPaths } = require('../../helpers/factories');

useTestDb();

const id = () => new mongoose.Types.ObjectId();

function submissionData(overrides = {}) {
  return {
    assessment: id(),
    user: id(),
    problem: id(),
    slotIndex: 1,
    verdict: 'ACCEPTED',
    testsPassed: 7,
    totalTests: 7,
    runtimeMs: 120,
    submittedAt: new Date(),
    ...overrides,
  };
}

function eventData(overrides = {}) {
  return { assessment: id(), user: id(), problem: id(), slotIndex: 1, type: 'RUN', at: new Date(), verdict: 'ACCEPTED', ...overrides };
}

describe('Submission model (spec 3.5)', () => {
  test('saves a graded submission with timestamps', async () => {
    const submission = await Submission.create(submissionData());
    expect(submission.createdAt).toBeInstanceOf(Date);
    expect(submission.verdict).toBe('ACCEPTED');
  });

  test('accepts exactly the five verdicts', async () => {
    for (const verdict of ['ACCEPTED', 'WRONG_ANSWER', 'COMPILATION_ERROR', 'RUNTIME_ERROR', 'TIME_LIMIT_EXCEEDED']) {
      const extra = verdict === 'COMPILATION_ERROR' ? { errorMessage: 'Line 3: SyntaxError: invalid syntax' } : {};
      await expect(Submission.create(submissionData({ verdict, ...extra }))).resolves.toBeDefined();
    }
    expect(await invalidPaths(Submission.create(submissionData({ verdict: 'NOT_ACCEPTED' })))).toContain('verdict');
  });

  test('errorMessage is only allowed for COMPILATION_ERROR (runtime errors can contain hidden input)', async () => {
    expect(await invalidPaths(Submission.create(submissionData({ verdict: 'RUNTIME_ERROR', errorMessage: 'ValueError: 17' })))).toContain(
      'errorMessage'
    );
    expect(await invalidPaths(Submission.create(submissionData({ verdict: 'WRONG_ANSWER', errorMessage: 'x' })))).toContain('errorMessage');
    const compile = await Submission.create(submissionData({ verdict: 'COMPILATION_ERROR', errorMessage: 'Line 3: SyntaxError' }));
    expect(compile.errorMessage).toBe('Line 3: SyntaxError');
  });

  test('does not store submitted code', async () => {
    const submission = await Submission.create(submissionData({ code: 'print(1)' }));
    expect(submission.code).toBeUndefined();
    expect(Submission.schema.path('code')).toBeUndefined();
  });

  test('requires assessment, user, problem, slotIndex, verdict, test counts and submittedAt', async () => {
    const paths = await invalidPaths(Submission.create({}));
    expect(paths).toEqual(
      expect.arrayContaining(['assessment', 'user', 'problem', 'slotIndex', 'verdict', 'testsPassed', 'totalTests', 'submittedAt'])
    );
  });

  test('failedTestNumber and runtimeMs are optional', async () => {
    await expect(
      Submission.create(submissionData({ verdict: 'WRONG_ANSWER', testsPassed: 2, failedTestNumber: 3 }))
    ).resolves.toBeDefined();
    const { runtimeMs, ...noRuntime } = submissionData({ verdict: 'COMPILATION_ERROR', errorMessage: 'm', testsPassed: 0 });
    await expect(Submission.create(noRuntime)).resolves.toBeDefined();
  });

  test('is stored in the "submissions" collection with the assessment, slotIndex, submittedAt index', async () => {
    expect(Submission.collection.name).toBe('submissions');
    const indexes = await Submission.collection.indexes();
    expect(indexes.some((i) => JSON.stringify(i.key) === JSON.stringify({ assessment: 1, slotIndex: 1, submittedAt: 1 }))).toBe(true);
  });
});

describe('AttemptEvent model (spec 3.6)', () => {
  test('saves a RUN event, with timestamps', async () => {
    const event = await AttemptEvent.create(eventData());
    expect(event.type).toBe('RUN');
    expect(event.createdAt).toBeInstanceOf(Date);
  });

  test('type is RUN or SUBMIT only; opening a question is not an event type (D15)', async () => {
    await expect(AttemptEvent.create(eventData({ type: 'SUBMIT', submission: id() }))).resolves.toBeDefined();
    expect(await invalidPaths(AttemptEvent.create(eventData({ type: 'OPEN' })))).toContain('type');
  });

  test('verdict uses the same values as submissions', async () => {
    for (const verdict of Submission.schema.path('verdict').enumValues) {
      await expect(AttemptEvent.create(eventData({ verdict }))).resolves.toBeDefined();
    }
    expect(await invalidPaths(AttemptEvent.create(eventData({ verdict: 'NOT_ACCEPTED' })))).toContain('verdict');
  });

  test('submission is only allowed on SUBMIT events', async () => {
    expect(await invalidPaths(AttemptEvent.create(eventData({ type: 'RUN', submission: id() })))).toContain('submission');
    const submit = await AttemptEvent.create(eventData({ type: 'SUBMIT', submission: id() }));
    expect(submit.submission).toBeDefined();
  });

  test('requires assessment, user, problem, slotIndex, type, at and verdict', async () => {
    const paths = await invalidPaths(AttemptEvent.create({}));
    expect(paths).toEqual(expect.arrayContaining(['assessment', 'user', 'problem', 'slotIndex', 'type', 'at', 'verdict']));
  });

  test('is stored in the "attemptEvents" collection with the assessment, slotIndex, at index', async () => {
    expect(AttemptEvent.collection.name).toBe('attemptEvents');
    const indexes = await AttemptEvent.collection.indexes();
    expect(indexes.some((i) => JSON.stringify(i.key) === JSON.stringify({ assessment: 1, slotIndex: 1, at: 1 }))).toBe(true);
  });
});
