// All constants live here (spec 6.6). No number from these tables may be written anywhere else.

module.exports = {
  // D14: the topics of the question bank in seed/problems
  TOPICS: ['arrays', 'strings', 'hashing', 'sorting', 'math'],

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

  // Section 3: field limits of the data model
  TITLE_LENGTH_MIN: 3,
  TITLE_LENGTH_MAX: 100,
  NAME_LENGTH_MIN: 2,
  NAME_LENGTH_MAX: 50,
  TIME_LIMIT_MS_MIN: 500,
  TIME_LIMIT_MS_MAX: 10000,
  SAMPLES_MIN: 1,
  SAMPLES_MAX: 3,
  HIDDEN_TESTS_MIN: 5,
  HIDDEN_TESTS_MAX: 10,

  // Sections 3.4, 6.2: user input limits
  PASSWORD_BYTES_MIN: 8,
  PASSWORD_BYTES_MAX: 72,
  EMAIL_LENGTH_MAX: 254,

  // Section 6.4: rate limiting for register and login
  RATE_LIMIT_WINDOW_MS: 60000,
  AUTH_RATE_LIMIT_MAX: 10,

  // Section 5.1: how long the syntax check helper may run before the runner counts as failed
  COMPILE_CHECK_TIMEOUT_MS: 5000,

  // Section 7.5: the reference solution must finish in under this fraction of timeLimitMs on every input
  REFERENCE_TIME_FRACTION: 0.5,

  // Sections 4.4 (E10), 5.5: deadline = startedAt + durationMin; minute number = floor((now - startedAt) / 1 minute)
  MS_PER_MINUTE: 60000,
  // Section 5.3: cooldowns are written in seconds and compared in milliseconds
  MS_PER_SECOND: 1000,

  // Section 5.2: in a Run response, each sample's actual and error are cut at this many characters
  RUN_OUTPUT_DISPLAY_MAX_CHARS: 10000,

  // Sections 4.4 (E7), 6.2: listing rounds
  LIST_PAGE_DEFAULT: 1,
  LIST_LIMIT_DEFAULT: 20,
  LIST_LIMIT_MAX: 50,

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
  // SLOWEST fires when the slowest question's activeMin / expectedMin is at least this
  SLOWEST_RATIO_AT_LEAST: 1.0,
  // Runtimes in report text are shown in seconds with at most this many decimals
  REPORT_SECONDS_DECIMALS: 2,

  // Section 5.5: insight rule priorities (higher comes first)
  INSIGHT_PRIORITY: {
    TRIAGE: 100,
    TOO_SLOW: 90,
    EDGE_CASES: 85,
    SAMPLE_FAIL: 84,
    CRASH: 83,
    SYNTAX: 82,
    NOT_SUBMITTED: 81,
    RISKY_RUNTIME: 80,
    MANY_FAILED_SUBMITS: 70,
    PANIC_SUBMITS: 60,
    BLIND_SUBMITS: 55,
    SLOW_START: 40,
    SLOWEST: 35,
    TOO_EASY: 30,
  },
};
