const Submission = require('../../../src/models/Submission');
const AttemptEvent = require('../../../src/models/AttemptEvent');
const Assessment = require('../../../src/models/Assessment');
const { useTestDb, createUser, createProblem, createAssessment } = require('../../helpers/factories');
const { useFakeClock } = require('../../helpers/fakeClock');

useTestDb();

let clock;
beforeEach(() => {
  clock = useFakeClock(new Date('2031-03-04T05:06:07.000Z'));
});
afterEach(() => clock.restore());

describe('createdAt and updatedAt come from now() (spec 6.7)', () => {
  test('all five models stamp new documents with the fake clock time', async () => {
    const user = await createUser();
    const problem = await createProblem();
    const round = await createAssessment(user, [problem]);
    const submission = await Submission.create({
      assessment: round._id,
      user: user._id,
      problem: problem._id,
      slotIndex: 1,
      verdict: 'ACCEPTED',
      testsPassed: 6,
      totalTests: 6,
      runtimeMs: 10,
      submittedAt: new Date('2031-03-04T05:06:07.000Z'),
    });
    const event = await AttemptEvent.create({
      assessment: round._id,
      user: user._id,
      problem: problem._id,
      slotIndex: 1,
      type: 'RUN',
      at: new Date('2031-03-04T05:06:07.000Z'),
      verdict: 'ACCEPTED',
    });

    for (const doc of [user, problem, round, submission, event]) {
      expect(doc.createdAt.toISOString()).toBe('2031-03-04T05:06:07.000Z');
      expect(doc.updatedAt.toISOString()).toBe('2031-03-04T05:06:07.000Z');
    }
  });

  test('an update sets updatedAt from the fake clock and keeps createdAt', async () => {
    const user = await createUser();
    const round = await createAssessment(user, [await createProblem()]);

    clock.advance(60000);
    await Assessment.updateOne({ _id: round._id }, { $set: { 'slots.0.runCount': 1 } });
    const saved = await Assessment.findById(round._id).lean();
    expect(saved.createdAt.toISOString()).toBe('2031-03-04T05:06:07.000Z');
    expect(saved.updatedAt.toISOString()).toBe('2031-03-04T05:07:07.000Z');
  });
});
