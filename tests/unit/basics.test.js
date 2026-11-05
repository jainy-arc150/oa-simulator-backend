const AppError = require('../../src/errors/AppError');
const clock = require('../../src/clock');
const limits = require('../../src/config/limits');

describe('AppError (spec 6.3)', () => {
  test('carries code, status, message and optional details', () => {
    const error = new AppError('COOLDOWN', 429, 'Too soon', { retryAfterMs: 1000 });
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ code: 'COOLDOWN', status: 429, message: 'Too soon', details: { retryAfterMs: 1000 } });
    expect(new AppError('NOT_FOUND', 404, 'x').details).toBeUndefined();
  });
});

describe('clock (spec 6.7, D52)', () => {
  test('now() returns the current time as a Date', () => {
    const before = Date.now();
    const value = clock.now();
    expect(value).toBeInstanceOf(Date);
    expect(value.getTime()).toBeGreaterThanOrEqual(before);
  });

  test('can be replaced by a test', () => {
    const fixed = new Date('2030-01-01T00:00:00Z');
    const spy = jest.spyOn(clock, 'now').mockReturnValue(fixed);
    expect(clock.now()).toBe(fixed);
    spy.mockRestore();
  });
});

describe('config/limits.js holds the numbers from spec 1.6 and 5.5', () => {
  test('section 1.6 limits and difficulty table', () => {
    expect(limits).toMatchObject({
      QUESTIONS_PER_ROUND_MIN: 1,
      QUESTIONS_PER_ROUND_MAX: 5,
      ROUND_DURATION_MIN: 5,
      ROUND_DURATION_MAX: 180,
      RUN_COOLDOWN_SECONDS: 3,
      SUBMIT_COOLDOWN_SECONDS: 5,
      MAX_RUNS_PER_QUESTION: 30,
      MAX_SUBMITS_PER_QUESTION: 20,
      MAX_CODE_CHARS: 51200,
      DEFAULT_TIME_LIMIT_MS: 2000,
      MAX_READY_ROUNDS_PER_USER: 20,
      DIFFICULTY_TABLE: { easy: 12, medium: 20, hard: 30 },
    });
  });

  test('section 5.5 report settings', () => {
    expect(limits).toMatchObject({
      RISKY_RUNTIME_RATIO: 0.8,
      MANY_FAILED_SUBMITS: 3,
      LATE_SUBMIT_WINDOW_MINUTES: 5,
      LATE_SUBMIT_COUNT: 3,
      BLIND_SUBMITS: 2,
      SLOW_START_RATIO: 0.5,
      TIME_LEFT_EXCELLENT_ABOVE: 0.25,
      STRUGGLE_FAILED_SUBMITS_ABOVE: 3,
      STRUGGLE_TIME_LEFT_BELOW: 0.1,
      TRIAGE_UNDER_ATTEMPTED_BELOW: 0.5,
      MAX_INSIGHTS_AFTER_HEADLINE: 3,
      FASTER_ROUND_FACTOR: 0.85,
    });
  });

  test('TOPICS is a non-empty list', () => {
    expect(Array.isArray(limits.TOPICS)).toBe(true);
    expect(limits.TOPICS.length).toBeGreaterThan(0);
  });
});
