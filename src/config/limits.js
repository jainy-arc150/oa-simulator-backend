// All constants live here (spec 6.6). No number from these tables may be written anywhere else.

module.exports = {
  // Placeholder until the question bank is decided (D14)
  TOPICS: ['arrays', 'strings', 'math', 'trees', 'graphs'],

  // Section 1.6: default duration per difficulty, in minutes
  DIFFICULTY_TABLE: { easy: 12, medium: 20, hard: 30 },

  // Section 1.6: limits
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

  // Section 4.1: maximum request body
  MAX_REQUEST_BODY: '512kb',

  // Section 5.5: report settings (thresholds)
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
};
