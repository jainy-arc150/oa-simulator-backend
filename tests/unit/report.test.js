const mongoose = require('mongoose');
const clock = require('../../src/clock');
const limits = require('../../src/config/limits');
const { buildReport } = require('../../src/services/reportService');

afterEach(() => jest.restoreAllMocks());

const START = new Date('2030-01-01T00:00:00.000Z');
// A time `minutes` after the round started (fractions allowed: 10.5 is 10 minutes 30 seconds).
const at = (minutes) => new Date(START.getTime() + Math.round(minutes * 60000));
const TABLE = limits.DIFFICULTY_TABLE;

// Builds the saved data of one FINISHED round, the way the endpoints would have left it.
function scenario({ questions, durationMin = 60, finishedAt = 30, finishReason = 'MANUAL' }) {
  let nextId = 0;
  const id = () => `id-${String(++nextId).padStart(4, '0')}`;
  const round = {
    _id: 'round-1',
    status: 'FINISHED',
    durationMin,
    startedAt: START,
    finishedAt: at(finishedAt),
    finishReason,
    slots: questions.map((q, i) => ({
      index: i + 1,
      topic: q.topic || 'arrays',
      difficulty: q.difficulty || 'easy',
      problem: `problem-${i + 1}`,
      code: 'print("CODE-MARKER")',
      runCount: 0,
      submitCount: 0,
      activeMinutes: [],
    })),
  };
  const problems = questions.map((q, i) => ({
    _id: `problem-${i + 1}`,
    timeLimitMs: q.timeLimitMs || 2000,
    samples: Array.from({ length: q.samples || 1 }, (_, k) => ({ input: `SAMPLE-IN-${k}\n`, output: `SAMPLE-OUT-${k}\n` })),
  }));
  const submissions = [];
  const events = [];
  const slot = (n) => round.slots[n - 1];

  const s = {
    round,
    problems,
    submissions,
    events,
    open(n, minute = 0) {
      slot(n).firstOpenedAt = at(minute);
      return s;
    },
    // `minutes` is a count (minutes 0, 1, 2, ...) or the list itself.
    active(n, minutes) {
      slot(n).activeMinutes = Array.isArray(minutes) ? minutes : Array.from({ length: minutes }, (_, m) => m);
      return s;
    },
    run(n, minute) {
      slot(n).runCount += 1;
      events.push({ _id: id(), slotIndex: n, type: 'RUN', at: at(minute), verdict: 'ACCEPTED' });
      return s;
    },
    submit(n, minute, verdict = 'ACCEPTED', { failedTestNumber, runtimeMs = 100 } = {}) {
      slot(n).submitCount += 1;
      const submission = { _id: id(), slotIndex: n, verdict, failedTestNumber, runtimeMs, submittedAt: at(minute), testsPassed: 0, totalTests: 6 };
      if (verdict === 'COMPILATION_ERROR') submission.errorMessage = 'Line 1: SyntaxError: ERROR-TEXT-MARKER';
      submissions.push(submission);
      events.push({ _id: id(), slotIndex: n, type: 'SUBMIT', at: at(minute), verdict, submission: submission._id });
      if (verdict === 'ACCEPTED' && !slot(n).solvedAt) slot(n).solvedAt = at(minute);
      return s;
    },
    // Open, run once and submit an Accepted, all early in the round.
    solve(n, minute = 2, options) {
      return s.open(n, minute - 2).run(n, minute - 1).submit(n, minute, 'ACCEPTED', options);
    },
    build() {
      return buildReport(round, problems, submissions, events);
    },
  };
  return s;
}

const rulesOf = (report) => [report.headline, ...report.insights].map((i) => i.rule);
const question = (report, n) => report.questions[n - 1];

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

// ---------- purity ----------

describe('buildReport is a pure function (5.5)', () => {
  const busyRound = () =>
    scenario({ questions: [{ difficulty: 'easy' }, { difficulty: 'medium', samples: 2 }, { difficulty: 'hard' }], durationMin: 62, finishedAt: 62, finishReason: 'EXPIRED' })
      .solve(1, 4, { runtimeMs: 1700 })
      .open(2, 5)
      .active(2, 25)
      .submit(2, 20, 'WRONG_ANSWER', { failedTestNumber: 4 })
      .submit(2, 30, 'RUNTIME_ERROR', { failedTestNumber: 2 })
      .run(2, 31)
      .submit(2, 59, 'WRONG_ANSWER', { failedTestNumber: 2 });

  test('the same input always gives the same output', () => {
    const s = busyRound();
    expect(s.build()).toEqual(s.build());
  });

  test('the order of the inputs does not matter', () => {
    const s = busyRound();
    const expected = s.build();
    const reversed = buildReport(
      { ...s.round, slots: [...s.round.slots].reverse() },
      [...s.problems].reverse(),
      [...s.submissions].reverse(),
      [...s.events].reverse()
    );
    expect(reversed).toEqual(expected);
  });

  test('it never changes its input', () => {
    const s = busyRound();
    const frozen = deepFreeze([s.round, s.problems, s.submissions, s.events]);
    expect(() => buildReport(...frozen)).not.toThrow();
  });

  test('it makes no database call and does not read the clock', () => {
    const exec = jest.spyOn(mongoose.Query.prototype, 'exec');
    const aggregate = jest.spyOn(mongoose.Aggregate.prototype, 'exec');
    const now = jest.spyOn(clock, 'now');
    busyRound().build();
    expect(exec).not.toHaveBeenCalled();
    expect(aggregate).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });

  test('the report has exactly the fields of 5.5', () => {
    const report = busyRound().build();
    expect(Object.keys(report).sort()).toEqual(
      ['durationMin', 'finishReason', 'finishedAt', 'grade', 'headline', 'insights', 'nextRound', 'questions', 'roundId', 'startedAt', 'summary', 'timeMap'].sort()
    );
    expect(Object.keys(report.summary).sort()).toEqual(['solved', 'timeAllottedSec', 'timeLeftSec', 'timeUsedSec', 'total']);
    expect(Object.keys(report.headline).sort()).toEqual(['question', 'rule', 'text', 'values']);
    expect(Object.keys(report.questions[0]).sort()).toEqual(
      [
        'activeMin',
        'difficulty',
        'expectedMin',
        'failedSubmits',
        'failureReason',
        'firstRunAfterMin',
        'flags',
        'index',
        'result',
        'runCount',
        'runtimeMs',
        'submitCount',
        'timeLimitMs',
        'topic',
      ].sort()
    );
    expect(Object.keys(report.nextRound).sort()).toEqual(['durationMin', 'reason', 'slots']);
    expect(report).toMatchObject({
      roundId: 'round-1',
      durationMin: 62,
      startedAt: START.toISOString(),
      finishedAt: at(62).toISOString(),
      finishReason: 'EXPIRED',
    });
  });

  test('5.5, D40: no field contains failedTestNumber, code, test data, error text or a raw stored verdict', () => {
    const report = scenario({ questions: [{}, { samples: 2 }, {}, {}] })
      .open(1)
      .run(1, 1)
      .submit(1, 2, 'TIME_LIMIT_EXCEEDED', { failedTestNumber: 3 })
      .open(2)
      .run(2, 1)
      .submit(2, 3, 'WRONG_ANSWER', { failedTestNumber: 5 })
      .open(3)
      .run(3, 1)
      .submit(3, 4, 'RUNTIME_ERROR', { failedTestNumber: 1 })
      .open(4)
      .submit(4, 5, 'COMPILATION_ERROR')
      .build();

    const text = JSON.stringify(report);
    for (const forbidden of [
      'failedTestNumber',
      'lastFailedTestNumber',
      'lastVerdict',
      'runtimeRatio',
      'blindSubmits',
      'CODE-MARKER',
      'SAMPLE-IN',
      'SAMPLE-OUT',
      'ERROR-TEXT-MARKER',
      'errorMessage',
      'WRONG_ANSWER',
      'RUNTIME_ERROR',
      'TIME_LIMIT_EXCEEDED',
      'COMPILATION_ERROR',
      '"ACCEPTED"',
      'problem-',
    ]) {
      expect(text).not.toContain(forbidden);
    }
    expect(report.questions.map((q) => q.failureReason)).toEqual(['TOO_SLOW', 'WRONG_ON_HIDDEN', 'CRASH', 'SYNTAX_ERROR']);
  });
});

// ---------- the acceptance examples of 5.5 ----------

describe('5.5 acceptance examples', () => {
  test('three questions solved first try with over 25% time left and fast runtimes: EXCELLENT, headline TOO_EASY, next round one level harder', () => {
    const report = scenario({
      questions: [
        { topic: 'arrays', difficulty: 'easy' },
        { topic: 'strings', difficulty: 'medium' },
        { topic: 'math', difficulty: 'hard' },
      ],
      durationMin: 62,
      finishedAt: 29.5,
    })
      .solve(1, 4, { runtimeMs: 120 })
      .active(1, 4)
      .solve(2, 12, { runtimeMs: 300 })
      .active(2, 8)
      .solve(3, 28, { runtimeMs: 900 })
      .active(3, 15)
      .build();

    expect(report.grade).toBe('EXCELLENT');
    expect(report.summary).toEqual({ solved: 3, total: 3, timeUsedSec: 1770, timeAllottedSec: 3720, timeLeftSec: 1950 });
    expect(report.headline).toEqual({
      rule: 'TOO_EASY',
      question: null,
      values: { left: 32 },
      text: 'You solved everything on the first try with 32 minutes to spare. This level is not challenging you.',
    });
    expect(report.insights).toEqual([]);
    expect(report.nextRound).toEqual({
      reason: 'You solved this level with time to spare.',
      slots: [
        { topic: 'arrays', difficulty: 'medium' },
        { topic: 'strings', difficulty: 'hard' },
        { topic: 'math', difficulty: 'hard' },
      ],
      durationMin: TABLE.medium + TABLE.hard + TABLE.hard,
    });
  });

  test('all solved with 4 failed submits in total: SOLVED_WITH_STRUGGLE', () => {
    const report = scenario({ questions: [{}, {}] })
      .open(1)
      .run(1, 1)
      .submit(1, 2, 'WRONG_ANSWER', { failedTestNumber: 2 })
      .run(1, 3)
      .submit(1, 4, 'RUNTIME_ERROR', { failedTestNumber: 3 })
      .run(1, 5)
      .submit(1, 6)
      .open(2, 7)
      .run(2, 8)
      .submit(2, 9, 'WRONG_ANSWER', { failedTestNumber: 2 })
      .run(2, 10)
      .submit(2, 11, 'TIME_LIMIT_EXCEEDED', { failedTestNumber: 4 })
      .run(2, 12)
      .submit(2, 13)
      .build();

    expect(report.grade).toBe('SOLVED_WITH_STRUGGLE');
    expect(report.questions.map((q) => q.failedSubmits)).toEqual([2, 2]);
    // No rule fires, so the fallback headline is used, and the struggle was not because of time.
    expect(report.headline).toEqual({ rule: null, question: null, values: { total: 2 }, text: 'All 2 solved within the time.' });
    expect(report.nextRound.reason).toBe('Repeat the round and aim to beat your result.');
  });

  test('one solved, Q2 unsolved with a Time Limit Exceeded after 31 minutes, Q3 never opened: PARTIAL, headline TRIAGE', () => {
    const report = scenario({
      questions: [
        { topic: 'arrays', difficulty: 'easy' },
        { topic: 'sorting', difficulty: 'hard' },
        { topic: 'math', difficulty: 'medium' },
      ],
      durationMin: 62,
      finishedAt: 62,
      finishReason: 'EXPIRED',
    })
      .solve(1, 8)
      .active(1, 6)
      .open(2, 9)
      .active(2, Array.from({ length: 31 }, (_, m) => m + 9))
      .run(2, 15)
      .submit(2, 40, 'TIME_LIMIT_EXCEEDED', { failedTestNumber: 4 })
      .build();

    expect(report.grade).toBe('PARTIAL');
    expect(report.headline).toEqual({
      rule: 'TRIAGE',
      question: 2,
      values: { minutes: 31, other: 'Q3 was never opened', expected: 30, possible: 2, total: 3 },
      text: 'You spent 31 minutes on Q2 without solving it, while Q3 was never opened. Moving on after about 30 minutes could have meant 2 of 3 solved.',
    });
    expect(question(report, 2).failureReason).toBe('TOO_SLOW');
    expect(question(report, 3).result).toBe('NOT_OPENED');
    // TRIAGE belongs to no question, so Q2 keeps its own insight too.
    expect(report.insights.map((i) => [i.rule, i.question])).toEqual([['TOO_SLOW', 2]]);
    expect(report.nextRound).toEqual({
      reason: 'Practise choosing the order: skim all questions and start with the easiest.',
      slots: [
        { topic: 'arrays', difficulty: 'easy' },
        { topic: 'sorting', difficulty: 'hard' },
        { topic: 'math', difficulty: 'medium' },
      ],
      durationMin: 62,
    });
  });

  test('a round with no submissions: NEEDS_WORK with the fallback headline', () => {
    const report = scenario({ questions: [{}, {}, {}] }).open(1, 1).active(1, 3).build();

    expect(report.grade).toBe('NEEDS_WORK');
    expect(report.headline).toEqual({ rule: null, question: null, values: { unsolved: 3 }, text: 'Time ran out with 3 question(s) unsolved.' });
    expect(report.insights).toEqual([]);
    expect(report.nextRound).toEqual({
      reason: 'Repeat the round and aim to beat your result.',
      slots: [
        { topic: 'arrays', difficulty: 'easy' },
        { topic: 'arrays', difficulty: 'easy' },
        { topic: 'arrays', difficulty: 'easy' },
      ],
      durationMin: 60,
    });
  });

  test('D44: at most 3 insights plus the headline, and at most one per question', () => {
    // Five unsolved questions, each with several rules firing, plus panic submits at the end.
    const s = scenario({ questions: [{}, {}, {}, {}, {}], durationMin: 60, finishedAt: 60 });
    for (let n = 1; n <= 5; n++) {
      s.open(n, 0).active(n, 2).run(n, 8).submit(n, 9, 'RUNTIME_ERROR', { failedTestNumber: 1 });
      s.submit(n, 10, 'RUNTIME_ERROR', { failedTestNumber: 1 }).submit(n, 56 + n * 0.5, 'WRONG_ANSWER', { failedTestNumber: 1 });
    }
    const report = s.build();

    expect(report.insights.length).toBeLessThanOrEqual(limits.MAX_INSIGHTS_AFTER_HEADLINE);
    expect(report.insights).toHaveLength(3);
    const perQuestion = [report.headline, ...report.insights].filter((i) => !['TRIAGE', 'PANIC_SUBMITS', 'TOO_EASY'].includes(i.rule));
    const numbers = perQuestion.map((i) => i.question);
    expect(new Set(numbers).size).toBe(numbers.length);
    // Every question still carries its flags.
    for (const q of report.questions) expect(q.flags).toEqual(['MANY_FAILED_SUBMITS', 'BLIND_SUBMITS', 'SLOW_START']);
  });

  test.each([
    ['test 2 of 2 samples', 2, 'WRONG_ON_SAMPLE', 'SAMPLE_FAIL'],
    ['test 5 of 7 (2 samples, 5 hidden)', 5, 'WRONG_ON_HIDDEN', 'EDGE_CASES'],
  ])('a WRONG_ANSWER on %s gives %s', (name, failedTestNumber, reason, rule) => {
    const report = scenario({ questions: [{ samples: 2 }] })
      .open(1)
      .run(1, 1)
      .submit(1, 2, 'WRONG_ANSWER', { failedTestNumber })
      .build();
    expect(question(report, 1).failureReason).toBe(reason);
    expect(report.headline.rule).toBe(rule);
  });
});

// ---------- metrics ----------

describe('5.5 metrics per question', () => {
  test('result is SOLVED, NOT_SOLVED or NOT_OPENED', () => {
    const report = scenario({ questions: [{}, {}, {}] }).solve(1).open(2, 3).build();
    expect(report.questions.map((q) => q.result)).toEqual(['SOLVED', 'NOT_SOLVED', 'NOT_OPENED']);
  });

  test('activeMin is the number of active minutes, and expectedMin comes from the difficulty table', () => {
    const report = scenario({ questions: [{ difficulty: 'easy' }, { difficulty: 'medium' }, { difficulty: 'hard' }] })
      .open(1)
      .active(1, [0, 1, 4, 9])
      .build();
    expect(report.questions.map((q) => [q.activeMin, q.expectedMin])).toEqual([
      [4, TABLE.easy],
      [0, TABLE.medium],
      [0, TABLE.hard],
    ]);
  });

  test('firstRunAfterMin is the first Run minus firstOpenedAt in whole minutes, rounded down; empty without a Run', () => {
    const report = scenario({ questions: [{}, {}, {}] })
      .open(1, 2)
      .run(1, 2 + 4.99)
      .run(1, 20)
      .open(2, 3)
      .run(3, 1)
      .build();
    expect(report.questions.map((q) => q.firstRunAfterMin)).toEqual([4, null, null]);
  });

  test('failedSubmits counts failed submits made before solvedAt, or all of them when unsolved', () => {
    const report = scenario({ questions: [{}, {}] })
      .open(1)
      .run(1, 1)
      .submit(1, 2, 'WRONG_ANSWER', { failedTestNumber: 1 })
      .submit(1, 3, 'COMPILATION_ERROR')
      .submit(1, 4)
      .submit(1, 5, 'WRONG_ANSWER', { failedTestNumber: 1 })
      .open(2)
      .run(2, 1)
      .submit(2, 2, 'RUNTIME_ERROR', { failedTestNumber: 1 })
      .submit(2, 3, 'RUNTIME_ERROR', { failedTestNumber: 1 })
      .build();
    expect(report.questions.map((q) => q.failedSubmits)).toEqual([2, 2]);
    // R8: a Wrong Answer after the Accepted leaves the question solved, with no failure reason.
    expect(question(report, 1)).toMatchObject({ result: 'SOLVED', failureReason: null });
  });

  test('runtimeMs is that of the first Accepted, with the problem limit; both are empty when unsolved', () => {
    const report = scenario({ questions: [{ timeLimitMs: 1500 }, {}] })
      .open(1)
      .run(1, 1)
      .submit(1, 2, 'ACCEPTED', { runtimeMs: 400 })
      .submit(1, 3, 'ACCEPTED', { runtimeMs: 90 })
      .open(2)
      .build();
    expect(report.questions.map((q) => [q.runtimeMs, q.timeLimitMs])).toEqual([
      [400, 1500],
      [null, null],
    ]);
  });

  test('runCount and submitCount come from the slot', () => {
    const report = scenario({ questions: [{}] }).open(1).run(1, 1).run(1, 2).submit(1, 3, 'WRONG_ANSWER', { failedTestNumber: 1 }).build();
    expect(question(report, 1)).toMatchObject({ runCount: 2, submitCount: 1 });
  });

  test.each([
    ['TIME_LIMIT_EXCEEDED', 'TOO_SLOW'],
    ['RUNTIME_ERROR', 'CRASH'],
    ['COMPILATION_ERROR', 'SYNTAX_ERROR'],
  ])('failureReason: a last submission of %s gives %s', (verdict, reason) => {
    const report = scenario({ questions: [{}] })
      .open(1)
      .run(1, 1)
      .submit(1, 2, 'WRONG_ANSWER', { failedTestNumber: 1 })
      .submit(1, 3, verdict, { failedTestNumber: 1 })
      .build();
    expect(question(report, 1).failureReason).toBe(reason);
  });

  test('failureReason: runs but no submission is NOT_SUBMITTED; nothing at all is empty', () => {
    const report = scenario({ questions: [{}, {}] }).open(1).run(1, 1).open(2).build();
    expect(report.questions.map((q) => q.failureReason)).toEqual(['NOT_SUBMITTED', null]);
  });
});

describe('5.5 metrics for the round', () => {
  test('time used is finishedAt - startedAt in whole seconds; time left never goes below 0', () => {
    const early = scenario({ questions: [{}], durationMin: 30, finishedAt: 10.5 + 0.9 / 60 }).build();
    expect(early.summary).toMatchObject({ timeUsedSec: 630, timeAllottedSec: 1800, timeLeftSec: 1170 });

    const expired = scenario({ questions: [{}], durationMin: 30, finishedAt: 30, finishReason: 'EXPIRED' }).build();
    expect(expired.summary).toMatchObject({ timeUsedSec: 1800, timeLeftSec: 0 });

    const late = scenario({ questions: [{}], durationMin: 30, finishedAt: 31 }).build();
    expect(late.summary.timeLeftSec).toBe(0);
  });

  test('lateFailedSubmits counts failed submits in the last 5 minutes before finishedAt (PANIC_SUBMITS at 3)', () => {
    const window = limits.LATE_SUBMIT_WINDOW_MINUTES;
    const build = (firstAt) =>
      scenario({ questions: [{}, {}, {}], durationMin: 60, finishedAt: 40 })
        .open(1)
        .run(1, 1)
        .submit(1, firstAt, 'WRONG_ANSWER', { failedTestNumber: 1 })
        .open(2)
        .run(2, 1)
        .submit(2, 38, 'RUNTIME_ERROR', { failedTestNumber: 1 })
        .open(3)
        .run(3, 1)
        .submit(3, 39.9, 'WRONG_ANSWER', { failedTestNumber: 1 })
        .build();

    const atEdge = build(40 - window);
    const panic = atEdge.insights.concat(atEdge.headline).find((i) => i.rule === 'PANIC_SUBMITS');
    expect(panic).toEqual({
      rule: 'PANIC_SUBMITS',
      question: null,
      values: { count: 3 },
      text: `3 failed submits came in the last ${window} minutes. That looks like guessing under pressure. Stop, re-read the problem and test one idea at a time.`,
    });

    const justBefore = build(40 - window - 1 / 60);
    expect(rulesOf(justBefore)).not.toContain('PANIC_SUBMITS');
  });
});

// ---------- grade ----------

describe('5.5 grade', () => {
  const allSolved = (options = {}) => {
    const s = scenario({ questions: [{}, {}], durationMin: 60, finishedAt: options.finishedAt || 20 });
    s.solve(1, 3, { runtimeMs: options.runtimeMs || 100 }).solve(2, 6);
    for (let i = 0; i < (options.failed || 0); i++) s.run(2, 7 + i).submit(2, 7.5 + i, 'WRONG_ANSWER', { failedTestNumber: 1 });
    return s;
  };

  test('NEEDS_WORK when nothing is solved, PARTIAL when some are', () => {
    expect(scenario({ questions: [{}, {}] }).open(1).build().grade).toBe('NEEDS_WORK');
    expect(scenario({ questions: [{}, {}] }).solve(1).build().grade).toBe('PARTIAL');
  });

  test('EXCELLENT needs no failed submit, over 25% time left and safe runtimes; otherwise STRONG', () => {
    expect(allSolved().build().grade).toBe('EXCELLENT');
    // Failed submits made after solving do not count, so one before solving is needed.
    const oneFailed = scenario({ questions: [{}], durationMin: 60, finishedAt: 20 })
      .open(1)
      .run(1, 1)
      .submit(1, 2, 'WRONG_ANSWER', { failedTestNumber: 1 })
      .submit(1, 3)
      .build();
    expect(oneFailed.grade).toBe('STRONG');
    // Exactly 25% left is not above 25%.
    expect(allSolved({ finishedAt: 45 }).build().grade).toBe('STRONG');
    // A runtime of 0.8 of the limit is risky.
    expect(allSolved({ runtimeMs: 1600 }).build().grade).toBe('STRONG');
    expect(allSolved({ runtimeMs: 1599 }).build().grade).toBe('EXCELLENT');
  });

  test('SOLVED_WITH_STRUGGLE: more than 3 failed submits, or under 10% time left', () => {
    const fourFailed = scenario({ questions: [{}], durationMin: 60, finishedAt: 20 }).open(1);
    for (let i = 0; i < 4; i++) fourFailed.run(1, 1 + i).submit(1, 1.5 + i, 'WRONG_ANSWER', { failedTestNumber: 1 });
    expect(fourFailed.submit(1, 10).build().grade).toBe('SOLVED_WITH_STRUGGLE');

    const threeFailed = scenario({ questions: [{}], durationMin: 60, finishedAt: 20 }).open(1);
    for (let i = 0; i < 3; i++) threeFailed.run(1, 1 + i).submit(1, 1.5 + i, 'WRONG_ANSWER', { failedTestNumber: 1 });
    expect(threeFailed.submit(1, 10).build().grade).toBe('STRONG');

    expect(allSolved({ finishedAt: 54.5 }).build().grade).toBe('SOLVED_WITH_STRUGGLE');
    expect(allSolved({ finishedAt: 54 }).build().grade).toBe('STRONG');
  });
});

// ---------- insight rules and templates ----------

describe('5.5 insight rules and templates', () => {
  // One unsolved question whose last submission failed in a given way, after a Run.
  test.each([
    ['TIME_LIMIT_EXCEEDED', 1, 'TOO_SLOW', 'Q1 ran out of time on at least one test. Your logic may be right, but the algorithm needs to be faster. Check the constraints to see what complexity you need.'],
    ['WRONG_ANSWER', 3, 'EDGE_CASES', 'Q1 passed the samples but gave wrong answers on some hidden tests. Think about edge cases: empty or minimum input, maximum values, duplicates and negative numbers.'],
    ['WRONG_ANSWER', 1, 'SAMPLE_FAIL', 'Q1 still failed a sample test. Re-read the statement and trace the sample by hand against your code.'],
    ['RUNTIME_ERROR', 2, 'CRASH', 'Q1 crashed on some input. Check index bounds, empty input, type conversions and division by zero.'],
    ['COMPILATION_ERROR', undefined, 'SYNTAX', 'Q1 ended with a syntax error. Run your code before you submit so errors show up early.'],
  ])('a last submission of %s (test %s) fires %s', (verdict, failedTestNumber, rule, text) => {
    const report = scenario({ questions: [{}] }).open(1).run(1, 1).submit(1, 2, verdict, { failedTestNumber }).build();
    expect(report.headline).toEqual({ rule, question: 1, values: {}, text });
  });

  test('NOT_SUBMITTED: ran but never submitted', () => {
    const report = scenario({ questions: [{}] }).open(1).run(1, 1).build();
    expect(report.headline).toEqual({
      rule: 'NOT_SUBMITTED',
      question: 1,
      values: {},
      text: 'On Q1 you ran your code but never submitted it. Only a submission counts.',
    });
  });

  test('RISKY_RUNTIME: a solved question at 0.8 of its limit or more, with seconds shown to two decimals at most', () => {
    const report = scenario({ questions: [{ timeLimitMs: 2000 }, { timeLimitMs: 1500 }, {}] })
      .solve(1, 2, { runtimeMs: 1700 })
      .solve(2, 4, { runtimeMs: 1234 })
      .solve(3, 6, { runtimeMs: 1599 })
      .build();
    const risky = [report.headline, ...report.insights].filter((i) => i.rule === 'RISKY_RUNTIME');
    expect(risky).toEqual([
      {
        rule: 'RISKY_RUNTIME',
        question: 1,
        values: { runtime: 1.7, limit: 2 },
        text: 'Q1 passed, but its slowest test used 1.7 s of a 2 s limit. A bigger test could time out, so look for a faster approach.',
      },
      {
        rule: 'RISKY_RUNTIME',
        question: 2,
        values: { runtime: 1.23, limit: 1.5 },
        text: 'Q2 passed, but its slowest test used 1.23 s of a 1.5 s limit. A bigger test could time out, so look for a faster approach.',
      },
    ]);
    expect(report.questions.map((q) => q.flags)).toEqual([['RISKY_RUNTIME'], ['RISKY_RUNTIME'], []]);
  });

  test('RISKY_RUNTIME fires at exactly 0.8 of the limit', () => {
    const report = scenario({ questions: [{ timeLimitMs: 2000 }] })
      .solve(1, 2, { runtimeMs: 2000 * limits.RISKY_RUNTIME_RATIO })
      .build();
    expect(report.headline).toMatchObject({ rule: 'RISKY_RUNTIME', values: { runtime: 1.6, limit: 2 } });
  });

  test('MANY_FAILED_SUBMITS: 3 failed submits or more on a question', () => {
    const build = (count) => {
      const s = scenario({ questions: [{}] }).open(1);
      for (let i = 0; i < count; i++) s.run(1, 1 + i).submit(1, 1.5 + i, 'WRONG_ANSWER', { failedTestNumber: 1 });
      return s.submit(1, 10).build();
    };
    expect(build(3).headline).toEqual({
      rule: 'MANY_FAILED_SUBMITS',
      question: 1,
      values: { count: 3 },
      text: 'Q1 took 3 failed submits. In a real OA, wrong submissions can cost minutes or points. Run the samples and test edge cases before you submit.',
    });
    expect(rulesOf(build(2))).not.toContain('MANY_FAILED_SUBMITS');
  });

  test('BLIND_SUBMITS: submits with no Run since the previous submit (or since opening), 2 or more', () => {
    const report = scenario({ questions: [{}, {}] })
      .open(1, 0)
      .submit(1, 1, 'WRONG_ANSWER', { failedTestNumber: 1 })
      .submit(1, 2, 'WRONG_ANSWER', { failedTestNumber: 1 })
      .run(1, 3)
      .submit(1, 4)
      // On Q2 a Run before opening does not count, so the first submit is blind; then a Run, then one more.
      .run(2, 4)
      .open(2, 5)
      .submit(2, 6, 'WRONG_ANSWER', { failedTestNumber: 1 })
      .run(2, 7)
      .submit(2, 8)
      .build();
    const blind = [report.headline, ...report.insights].find((i) => i.rule === 'BLIND_SUBMITS');
    expect(blind).toEqual({
      rule: 'BLIND_SUBMITS',
      question: 1,
      values: { count: 2 },
      text: 'On Q1 you submitted 2 times without running your code in between. Running first costs nothing and catches most mistakes.',
    });
    expect(report.questions.map((q) => q.flags.includes('BLIND_SUBMITS'))).toEqual([true, false]);
  });

  test('SLOW_START: the first Run came more than half the expected time after opening', () => {
    const half = TABLE.easy * limits.SLOW_START_RATIO;
    const report = scenario({ questions: [{}, {}] })
      .open(1, 0)
      .run(1, half + 1)
      .submit(1, half + 2)
      .open(2, 0)
      .run(2, half)
      .submit(2, half + 3)
      .build();
    const slow = [report.headline, ...report.insights].filter((i) => i.rule === 'SLOW_START');
    expect(slow).toEqual([
      {
        rule: 'SLOW_START',
        question: 1,
        values: { minutes: half + 1 },
        text: `On Q1 you waited ${half + 1} minutes before your first run. Writing a rough solution earlier gives you something to improve.`,
      },
    ]);
  });

  test('SLOWEST: when all are solved, the question with the highest activeMin / expectedMin, if at least 1.0', () => {
    const build = (q2Minutes) =>
      scenario({ questions: [{ difficulty: 'easy' }, { difficulty: 'medium' }], durationMin: 60, finishedAt: 50 })
        .solve(1, 3)
        .active(1, 12)
        .solve(2, 6)
        .active(2, q2Minutes)
        .build();
    expect(build(25).headline).toEqual({
      rule: 'SLOWEST',
      question: 2,
      values: { minutes: 25, expected: 20 },
      text: 'Q2 took 25 minutes against an expected 20. It was your bottleneck.',
    });
    // Q1 at exactly 1.0 and Q2 at exactly 1.0: the lower number wins.
    expect(build(20).headline).toMatchObject({ rule: 'SLOWEST', question: 1 });
    expect(rulesOf(scenario({ questions: [{}] }).solve(1).active(1, 11).build())).not.toContain('SLOWEST');
  });

  test('TRIAGE: B is the under-attempted question when none is unopened', () => {
    const report = scenario({ questions: [{ difficulty: 'easy' }, { difficulty: 'easy' }, { difficulty: 'medium' }], durationMin: 60, finishedAt: 60 })
      .solve(1, 3)
      .open(2, 4)
      .active(2, 14)
      .open(3, 40)
      .active(3, 4)
      .build();
    expect(report.headline).toEqual({
      rule: 'TRIAGE',
      question: 2,
      values: { minutes: 14, other: 'Q3 got only 4 minutes', expected: 12, possible: 2, total: 3 },
      text: 'You spent 14 minutes on Q2 without solving it, while Q3 got only 4 minutes. Moving on after about 12 minutes could have meant 2 of 3 solved.',
    });
  });

  test('TRIAGE picks the question with the most time as A, and does not fire without a B', () => {
    const report = scenario({ questions: [{}, {}, {}] })
      .open(1)
      .active(1, 13)
      .open(2)
      .active(2, 15)
      .build();
    expect(report.headline).toMatchObject({ rule: 'TRIAGE', question: 2, values: { other: 'Q3 was never opened', possible: 1 } });

    // An unopened question is B even when an opened one has as few minutes and a lower number.
    const unopenedFirst = scenario({ questions: [{}, {}, {}] }).open(1).active(1, 13).open(2).build();
    expect(unopenedFirst.headline).toMatchObject({ rule: 'TRIAGE', question: 1, values: { other: 'Q3 was never opened' } });

    const noB = scenario({ questions: [{}, {}] }).open(1).active(1, 13).open(2).active(2, 6).build();
    expect(rulesOf(noB)).not.toContain('TRIAGE');
  });
});

// ---------- choosing what to show ----------

describe('5.5 choosing what to show', () => {
  test('sorted by priority; ties go to the lower question number', () => {
    const report = scenario({ questions: [{}, {}, {}] })
      .open(3)
      .run(3, 1)
      .submit(3, 2, 'RUNTIME_ERROR', { failedTestNumber: 1 })
      .open(1)
      .run(1, 1)
      .submit(1, 3, 'RUNTIME_ERROR', { failedTestNumber: 1 })
      .open(2)
      .run(2, 1)
      .submit(2, 4, 'TIME_LIMIT_EXCEEDED', { failedTestNumber: 1 })
      .build();
    expect([report.headline, ...report.insights].map((i) => [i.rule, i.question])).toEqual([
      ['TOO_SLOW', 2],
      ['CRASH', 1],
      ['CRASH', 3],
    ]);
  });

  test('one insight per question, the highest priority; the others still show as flags', () => {
    const s = scenario({ questions: [{}] }).open(1, 0);
    for (let i = 0; i < 3; i++) s.submit(1, 10 + i, 'RUNTIME_ERROR', { failedTestNumber: 1 });
    s.run(1, 9);
    const report = s.build();
    expect(report.headline.rule).toBe('CRASH');
    expect(report.insights).toEqual([]);
    expect(question(report, 1).flags).toEqual(['MANY_FAILED_SUBMITS', 'BLIND_SUBMITS', 'SLOW_START']);
  });
});

// ---------- next round ----------

describe('5.5 next round', () => {
  test('a failure headline: one slot for each unsolved question, with the sum of the difficulty table', () => {
    const report = scenario({
      questions: [
        { topic: 'arrays', difficulty: 'easy' },
        { topic: 'strings', difficulty: 'hard' },
        { topic: 'math', difficulty: 'medium' },
      ],
    })
      .solve(1)
      .open(2)
      .run(2, 5)
      .submit(2, 6, 'RUNTIME_ERROR', { failedTestNumber: 1 })
      .build();
    expect(report.headline.rule).toBe('CRASH');
    expect(report.nextRound).toEqual({
      reason: 'Practise the topics that cost you this round.',
      slots: [
        { topic: 'strings', difficulty: 'hard' },
        { topic: 'math', difficulty: 'medium' },
      ],
      durationMin: TABLE.hard + TABLE.medium,
    });
  });

  test('a habit headline (here BLIND_SUBMITS): the same slots and duration', () => {
    const report = scenario({ questions: [{}], durationMin: 45 })
      .open(1, 0)
      .submit(1, 1, 'WRONG_ANSWER', { failedTestNumber: 1 })
      .submit(1, 2)
      .build();
    expect(report.headline.rule).toBe('BLIND_SUBMITS');
    expect(report.nextRound).toEqual({
      reason: 'Same round again, aiming for first-try solutions with a safe runtime.',
      slots: [{ topic: 'arrays', difficulty: 'easy' }],
      durationMin: 45,
    });
  });

  test('SLOWEST headline: the same slots at 85% of the duration, to the nearest minute', () => {
    const report = scenario({ questions: [{}], durationMin: 62, finishedAt: 50 }).solve(1).active(1, 13).build();
    expect(report.headline.rule).toBe('SLOWEST');
    expect(report.nextRound).toEqual({
      reason: 'Same questions in less time to build speed.',
      slots: [{ topic: 'arrays', difficulty: 'easy' }],
      durationMin: Math.round(62 * limits.FASTER_ROUND_FACTOR),
    });
  });

  test('SOLVED_WITH_STRUGGLE because of time: faster too, and never below 5 minutes', () => {
    const report = scenario({ questions: [{}], durationMin: limits.ROUND_DURATION_MIN, finishedAt: 4.9 }).solve(1, 4).build();
    expect(report.grade).toBe('SOLVED_WITH_STRUGGLE');
    expect(report.nextRound).toMatchObject({ reason: 'Same questions in less time to build speed.', durationMin: limits.ROUND_DURATION_MIN });
  });

  test('TOO_EASY when all are hard: one more hard question with the last topic; never more than 5', () => {
    const build = (count) => {
      const s = scenario({ questions: Array.from({ length: count }, (_, i) => ({ topic: `topic-${i}`, difficulty: 'hard' })), durationMin: 180, finishedAt: 20 });
      for (let n = 1; n <= count; n++) s.solve(n, 2 + n);
      return s.build();
    };
    const two = build(2);
    expect(two.headline.rule).toBe('TOO_EASY');
    expect(two.nextRound).toEqual({
      reason: 'You solved this level with time to spare.',
      slots: [
        { topic: 'topic-0', difficulty: 'hard' },
        { topic: 'topic-1', difficulty: 'hard' },
        { topic: 'topic-1', difficulty: 'hard' },
      ],
      durationMin: 3 * TABLE.hard,
    });
    const five = build(limits.QUESTIONS_PER_ROUND_MAX);
    expect(five.nextRound.slots).toHaveLength(limits.QUESTIONS_PER_ROUND_MAX);
    expect(five.nextRound.durationMin).toBe(limits.QUESTIONS_PER_ROUND_MAX * TABLE.hard);
  });

  test('one level harder keeps hard questions hard when not all are hard', () => {
    const report = scenario({ questions: [{ difficulty: 'hard' }, { difficulty: 'easy' }], durationMin: 60, finishedAt: 20 }).solve(1, 3).solve(2, 6).build();
    expect(report.nextRound.slots.map((s) => s.difficulty)).toEqual(['hard', 'medium']);
  });
});

describe('5.5 timeMap', () => {
  test('totalMinutes is the allotted duration, with each question\'s active minutes in order', () => {
    const report = scenario({ questions: [{}, {}], durationMin: 45 }).open(1).active(1, [7, 2, 3]).build();
    expect(report.timeMap).toEqual({
      totalMinutes: 45,
      questions: [
        { index: 1, activeMinutes: [2, 3, 7] },
        { index: 2, activeMinutes: [] },
      ],
    });
  });
});
