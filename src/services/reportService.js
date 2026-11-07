const mongoose = require('mongoose');
const limits = require('../config/limits');
const clock = require('../clock');
const AppError = require('../errors/AppError');
const AttemptEvent = require('../models/AttemptEvent');
const Problem = require('../models/Problem');
const Submission = require('../models/Submission');
const roundStateService = require('./roundStateService');

// ===================== buildReport: a pure function of saved data (spec 5.5) =====================
// No database, network, clock or randomness inside. Every sentence is a fixed template filled with
// numbers (D41). The report never contains code, problem text, test data, test numbers, error text
// or the raw stored verdicts.

const SECONDS_PER_MINUTE = limits.MS_PER_MINUTE / limits.MS_PER_SECOND;
const DIFFICULTIES = Object.keys(limits.DIFFICULTY_TABLE); // easy, medium, hard: one level harder each step
const HARDEST = DIFFICULTIES[DIFFICULTIES.length - 1];

const iso = (date) => (date ? new Date(date).toISOString() : null);
const time = (date) => new Date(date).getTime();
const seconds = (ms) => Number((ms / limits.MS_PER_SECOND).toFixed(limits.REPORT_SECONDS_DECIMALS));

// Sorting by time, then by id, makes the result independent of the order the inputs arrive in.
const byTime = (field) => (a, b) => time(a[field]) - time(b[field]) || String(a._id).localeCompare(String(b._id));

// ---------- templates (5.5) ----------

const TEMPLATES = {
  TRIAGE: (n, v) =>
    `You spent ${v.minutes} minutes on Q${n} without solving it, while ${v.other}. Moving on after about ${v.expected} minutes could have meant ${v.possible} of ${v.total} solved.`,
  TOO_SLOW: (n) =>
    `Q${n} ran out of time on at least one test. Your logic may be right, but the algorithm needs to be faster. Check the constraints to see what complexity you need.`,
  EDGE_CASES: (n) =>
    `Q${n} passed the samples but gave wrong answers on some hidden tests. Think about edge cases: empty or minimum input, maximum values, duplicates and negative numbers.`,
  SAMPLE_FAIL: (n) => `Q${n} still failed a sample test. Re-read the statement and trace the sample by hand against your code.`,
  CRASH: (n) => `Q${n} crashed on some input. Check index bounds, empty input, type conversions and division by zero.`,
  SYNTAX: (n) => `Q${n} ended with a syntax error. Run your code before you submit so errors show up early.`,
  NOT_SUBMITTED: (n) => `On Q${n} you ran your code but never submitted it. Only a submission counts.`,
  RISKY_RUNTIME: (n, v) =>
    `Q${n} passed, but its slowest test used ${v.runtime} s of a ${v.limit} s limit. A bigger test could time out, so look for a faster approach.`,
  MANY_FAILED_SUBMITS: (n, v) =>
    `Q${n} took ${v.count} failed submits. In a real OA, wrong submissions can cost minutes or points. Run the samples and test edge cases before you submit.`,
  PANIC_SUBMITS: (n, v) =>
    `${v.count} failed submits came in the last ${limits.LATE_SUBMIT_WINDOW_MINUTES} minutes. That looks like guessing under pressure. Stop, re-read the problem and test one idea at a time.`,
  BLIND_SUBMITS: (n, v) =>
    `On Q${n} you submitted ${v.count} times without running your code in between. Running first costs nothing and catches most mistakes.`,
  SLOW_START: (n, v) =>
    `On Q${n} you waited ${v.minutes} minutes before your first run. Writing a rough solution earlier gives you something to improve.`,
  SLOWEST: (n, v) => `Q${n} took ${v.minutes} minutes against an expected ${v.expected}. It was your bottleneck.`,
  TOO_EASY: (n, v) => `You solved everything on the first try with ${v.left} minutes to spare. This level is not challenging you.`,
};

// failureReason -> the insight rule it fires.
const FAILURE_RULES = {
  TOO_SLOW: 'TOO_SLOW',
  WRONG_ON_HIDDEN: 'EDGE_CASES',
  WRONG_ON_SAMPLE: 'SAMPLE_FAIL',
  CRASH: 'CRASH',
  SYNTAX_ERROR: 'SYNTAX',
  NOT_SUBMITTED: 'NOT_SUBMITTED',
};

// Insights that belong to no question: always kept (step 3 of "Choosing what to show").
const NO_QUESTION_RULES = new Set(['TRIAGE', 'PANIC_SUBMITS', 'TOO_EASY']);
// The rules that become a question's flags, in this order.
const FLAG_RULES = ['RISKY_RUNTIME', 'MANY_FAILED_SUBMITS', 'BLIND_SUBMITS', 'SLOW_START'];

const NEXT_ROUND_REASONS = {
  TRIAGE: 'Practise choosing the order: skim all questions and start with the easiest.',
  FAILURES: 'Practise the topics that cost you this round.',
  HABITS: 'Same round again, aiming for first-try solutions with a safe runtime.',
  FASTER: 'Same questions in less time to build speed.',
  HARDER: 'You solved this level with time to spare.',
  REPEAT: 'Repeat the round and aim to beat your result.',
};
const HABIT_RULES = new Set(['RISKY_RUNTIME', 'MANY_FAILED_SUBMITS', 'BLIND_SUBMITS', 'PANIC_SUBMITS', 'SLOW_START']);

// ---------- metrics ----------

// failureReason (5.5) for a question that is not SOLVED: the kind of failure only.
function failureReasonOf(result, lastSubmission, sampleCount, runCount) {
  if (result === 'SOLVED') return null;
  if (lastSubmission) {
    switch (lastSubmission.verdict) {
      case 'TIME_LIMIT_EXCEEDED':
        return 'TOO_SLOW';
      case 'WRONG_ANSWER':
        return (lastSubmission.failedTestNumber || 0) > sampleCount ? 'WRONG_ON_HIDDEN' : 'WRONG_ON_SAMPLE';
      case 'RUNTIME_ERROR':
        return 'CRASH';
      case 'COMPILATION_ERROR':
        return 'SYNTAX_ERROR';
      default:
        return null;
    }
  }
  return runCount > 0 ? 'NOT_SUBMITTED' : null;
}

// SUBMIT events with no RUN on the question since the previous SUBMIT (or since firstOpenedAt).
function countBlindSubmits(events, firstOpenedAt) {
  let blind = 0;
  let ranSinceLastSubmit = false;
  for (const event of events) {
    if (event.type === 'RUN' && (!firstOpenedAt || time(event.at) >= time(firstOpenedAt))) ranSinceLastSubmit = true;
    if (event.type === 'SUBMIT') {
      if (!ranSinceLastSubmit) blind += 1;
      ranSinceLastSubmit = false;
    }
  }
  return blind;
}

function questionMetrics(slot, problem, submissions, events) {
  const expectedMin = limits.DIFFICULTY_TABLE[slot.difficulty];
  const result = slot.solvedAt ? 'SOLVED' : slot.firstOpenedAt ? 'NOT_SOLVED' : 'NOT_OPENED';

  const firstRun = events.find((event) => event.type === 'RUN');
  const firstRunAfterMin =
    firstRun && slot.firstOpenedAt
      ? Math.max(Math.floor((time(firstRun.at) - time(slot.firstOpenedAt)) / limits.MS_PER_MINUTE), 0)
      : null;

  const failedSubmits = submissions.filter(
    (s) => s.verdict !== 'ACCEPTED' && (!slot.solvedAt || time(s.submittedAt) < time(slot.solvedAt))
  ).length;

  const firstAccepted = submissions.find((s) => s.verdict === 'ACCEPTED');
  const solved = result === 'SOLVED';
  const runtimeMs = solved && firstAccepted && Number.isFinite(firstAccepted.runtimeMs) ? firstAccepted.runtimeMs : null;
  const timeLimitMs = solved && problem ? problem.timeLimitMs : null;

  return {
    index: slot.index,
    topic: slot.topic,
    difficulty: slot.difficulty,
    result,
    activeMin: (slot.activeMinutes || []).length,
    expectedMin,
    firstRunAfterMin,
    runCount: slot.runCount || 0,
    submitCount: slot.submitCount || 0,
    failedSubmits,
    runtimeMs,
    timeLimitMs,
    failureReason: failureReasonOf(
      result,
      submissions[submissions.length - 1],
      problem ? problem.samples.length : 0,
      slot.runCount || 0
    ),
    // Used inside the report only; never returned.
    runtimeRatio: runtimeMs !== null && timeLimitMs ? runtimeMs / timeLimitMs : null,
    blindSubmits: countBlindSubmits(events, slot.firstOpenedAt),
  };
}

function gradeOf({ solved, total, totalFailedSubmits, timeLeftRatio }, questions) {
  if (solved === 0) return 'NEEDS_WORK';
  if (solved < total) return 'PARTIAL';
  if (totalFailedSubmits > limits.STRUGGLE_FAILED_SUBMITS_ABOVE || timeLeftRatio < limits.STRUGGLE_TIME_LEFT_BELOW) {
    return 'SOLVED_WITH_STRUGGLE';
  }
  const safeRuntimes = questions.every((q) => q.runtimeRatio === null || q.runtimeRatio < limits.RISKY_RUNTIME_RATIO);
  if (totalFailedSubmits === 0 && timeLeftRatio > limits.TIME_LEFT_EXCELLENT_ABOVE && safeRuntimes) return 'EXCELLENT';
  return 'STRONG';
}

// ---------- insights ----------

const insight = (rule, question, values) => ({ rule, question, values, text: TEMPLATES[rule](question, values) });

// TRIAGE: A is the unsolved question with the most activeMin that reached its expectedMin (ties: the
// lower number). B is the lowest-numbered NOT_OPENED other question, otherwise the under-attempted
// one with the least activeMin. It fires at most once.
function triageInsight(questions, round) {
  const candidates = questions
    .filter((q) => q.result !== 'SOLVED' && q.activeMin >= q.expectedMin)
    .sort((a, b) => b.activeMin - a.activeMin || a.index - b.index);

  for (const a of candidates) {
    const others = questions.filter((q) => q.index !== a.index);
    const b =
      others.find((q) => q.result === 'NOT_OPENED') ||
      others
        .filter((q) => q.result !== 'SOLVED' && q.activeMin < limits.TRIAGE_UNDER_ATTEMPTED_BELOW * q.expectedMin)
        .sort((x, y) => x.activeMin - y.activeMin || x.index - y.index)[0];
    if (!b) continue;

    const other = b.result === 'NOT_OPENED' ? `Q${b.index} was never opened` : `Q${b.index} got only ${b.activeMin} minutes`;
    return insight('TRIAGE', a.index, {
      minutes: a.activeMin,
      other,
      expected: a.expectedMin,
      possible: Math.min(round.solved + 1, round.total),
      total: round.total,
    });
  }
  return null;
}

function firedInsights(questions, round) {
  const fired = [];
  const triage = triageInsight(questions, round);
  if (triage) fired.push(triage);

  for (const q of questions) {
    if (q.failureReason && FAILURE_RULES[q.failureReason]) fired.push(insight(FAILURE_RULES[q.failureReason], q.index, {}));
    if (q.result === 'SOLVED' && q.runtimeRatio !== null && q.runtimeRatio >= limits.RISKY_RUNTIME_RATIO) {
      fired.push(insight('RISKY_RUNTIME', q.index, { runtime: seconds(q.runtimeMs), limit: seconds(q.timeLimitMs) }));
    }
    if (q.failedSubmits >= limits.MANY_FAILED_SUBMITS) fired.push(insight('MANY_FAILED_SUBMITS', q.index, { count: q.failedSubmits }));
    if (q.blindSubmits >= limits.BLIND_SUBMITS) fired.push(insight('BLIND_SUBMITS', q.index, { count: q.blindSubmits }));
    if (q.firstRunAfterMin !== null && q.firstRunAfterMin > limits.SLOW_START_RATIO * q.expectedMin) {
      fired.push(insight('SLOW_START', q.index, { minutes: q.firstRunAfterMin }));
    }
  }

  if (round.lateFailedSubmits >= limits.LATE_SUBMIT_COUNT) {
    fired.push(insight('PANIC_SUBMITS', null, { count: round.lateFailedSubmits }));
  }

  const allSolved = round.solved === round.total;
  if (allSolved) {
    const slowest = [...questions].sort((a, b) => b.activeMin / b.expectedMin - a.activeMin / a.expectedMin || a.index - b.index)[0];
    if (slowest && slowest.activeMin / slowest.expectedMin >= limits.SLOWEST_RATIO_AT_LEAST) {
      fired.push(insight('SLOWEST', slowest.index, { minutes: slowest.activeMin, expected: slowest.expectedMin }));
    }
    if (round.totalFailedSubmits === 0 && round.timeLeftRatio > limits.TIME_LEFT_EXCELLENT_ABOVE) {
      fired.push(insight('TOO_EASY', null, { left: Math.floor(round.timeLeftSec / SECONDS_PER_MINUTE) }));
    }
  }
  return fired;
}

// "Choosing what to show": sort by priority (ties: the lower question number), keep one insight per
// question (no-question insights always), then a headline and at most three more.
function chooseInsights(fired, round) {
  const sorted = [...fired].sort(
    (a, b) => limits.INSIGHT_PRIORITY[b.rule] - limits.INSIGHT_PRIORITY[a.rule] || (a.question || 0) - (b.question || 0)
  );
  const kept = [];
  const questionsUsed = new Set();
  for (const item of sorted) {
    if (!NO_QUESTION_RULES.has(item.rule)) {
      if (questionsUsed.has(item.question)) continue;
      questionsUsed.add(item.question);
    }
    kept.push(item);
  }

  const headline = kept[0] || fallbackHeadline(round);
  return { headline, insights: kept.slice(1, 1 + limits.MAX_INSIGHTS_AFTER_HEADLINE) };
}

function fallbackHeadline({ solved, total }) {
  if (solved === total) return { rule: null, question: null, values: { total }, text: `All ${total} solved within the time.` };
  const unsolved = total - solved;
  return { rule: null, question: null, values: { unsolved }, text: `Time ran out with ${unsolved} question(s) unsolved.` };
}

// ---------- next round ----------

const durationFor = (slots) => slots.reduce((sum, slot) => sum + limits.DIFFICULTY_TABLE[slot.difficulty], 0);
const oneLevelHarder = (difficulty) => DIFFICULTIES[Math.min(DIFFICULTIES.indexOf(difficulty) + 1, DIFFICULTIES.length - 1)];

// `slots` are the round's slots in question order.
function nextRoundOf(headlineRule, grade, roundMetrics, durationMin, slots, questions) {
  const sameSlots = slots.map(({ topic, difficulty }) => ({ topic, difficulty }));
  const same = (reason) => ({ reason, slots: sameSlots, durationMin });
  const struggleByTime = grade === 'SOLVED_WITH_STRUGGLE' && roundMetrics.timeLeftRatio < limits.STRUGGLE_TIME_LEFT_BELOW;

  if (headlineRule === 'TRIAGE') return same(NEXT_ROUND_REASONS.TRIAGE);

  if (Object.values(FAILURE_RULES).includes(headlineRule)) {
    const unsolved = questions.filter((q) => q.result !== 'SOLVED').map(({ topic, difficulty }) => ({ topic, difficulty }));
    return { reason: NEXT_ROUND_REASONS.FAILURES, slots: unsolved, durationMin: durationFor(unsolved) };
  }

  if (HABIT_RULES.has(headlineRule)) return same(NEXT_ROUND_REASONS.HABITS);

  if (headlineRule === 'SLOWEST' || struggleByTime) {
    const faster = Math.max(Math.round(durationMin * limits.FASTER_ROUND_FACTOR), limits.ROUND_DURATION_MIN);
    return { reason: NEXT_ROUND_REASONS.FASTER, slots: sameSlots, durationMin: faster };
  }

  if (headlineRule === 'TOO_EASY' || grade === 'EXCELLENT') {
    let harder;
    if (sameSlots.every((slot) => slot.difficulty === HARDEST)) {
      harder = [...sameSlots];
      if (harder.length < limits.QUESTIONS_PER_ROUND_MAX) harder.push({ topic: harder[harder.length - 1].topic, difficulty: HARDEST });
    } else {
      harder = sameSlots.map(({ topic, difficulty }) => ({ topic, difficulty: oneLevelHarder(difficulty) }));
    }
    return { reason: NEXT_ROUND_REASONS.HARDER, slots: harder, durationMin: durationFor(harder) };
  }

  return same(NEXT_ROUND_REASONS.REPEAT);
}

// ---------- the report ----------

// `round`: the FINISHED round (slots as saved); `problems`: the round's problems (timeLimitMs and
// samples); `submissions` and `events`: everything saved for the round.
function buildReport(round, problems, submissions, events) {
  const problemsById = new Map(problems.map((problem) => [String(problem._id), problem]));
  const sortedSubmissions = [...submissions].sort(byTime('submittedAt'));
  const sortedEvents = [...events].sort(byTime('at'));
  const slots = [...round.slots].sort((a, b) => a.index - b.index);

  const questions = slots.map((slot) =>
    questionMetrics(
      slot,
      problemsById.get(String(slot.problem)),
      sortedSubmissions.filter((s) => s.slotIndex === slot.index),
      sortedEvents.filter((e) => e.slotIndex === slot.index)
    )
  );

  const timeAllottedSec = round.durationMin * SECONDS_PER_MINUTE;
  const timeUsedSec = Math.floor((time(round.finishedAt) - time(round.startedAt)) / limits.MS_PER_SECOND);
  const timeLeftSec = Math.max(timeAllottedSec - timeUsedSec, 0);
  const lateFrom = time(round.finishedAt) - limits.LATE_SUBMIT_WINDOW_MINUTES * limits.MS_PER_MINUTE;
  const metrics = {
    solved: questions.filter((q) => q.result === 'SOLVED').length,
    total: questions.length,
    timeUsedSec,
    timeAllottedSec,
    timeLeftSec,
    timeLeftRatio: timeLeftSec / timeAllottedSec,
    totalFailedSubmits: questions.reduce((sum, q) => sum + q.failedSubmits, 0),
    lateFailedSubmits: sortedSubmissions.filter((s) => s.verdict !== 'ACCEPTED' && time(s.submittedAt) >= lateFrom).length,
  };

  const grade = gradeOf(metrics, questions);
  const fired = firedInsights(questions, metrics);
  const { headline, insights } = chooseInsights(fired, metrics);

  return {
    roundId: String(round._id),
    durationMin: round.durationMin,
    startedAt: iso(round.startedAt),
    finishedAt: iso(round.finishedAt),
    finishReason: round.finishReason || null,
    grade,
    summary: {
      solved: metrics.solved,
      total: metrics.total,
      timeUsedSec: metrics.timeUsedSec,
      timeAllottedSec: metrics.timeAllottedSec,
      timeLeftSec: metrics.timeLeftSec,
    },
    headline,
    insights,
    questions: questions.map((q) => ({
      index: q.index,
      topic: q.topic,
      difficulty: q.difficulty,
      result: q.result,
      activeMin: q.activeMin,
      expectedMin: q.expectedMin,
      firstRunAfterMin: q.firstRunAfterMin,
      runCount: q.runCount,
      submitCount: q.submitCount,
      failedSubmits: q.failedSubmits,
      runtimeMs: q.runtimeMs,
      timeLimitMs: q.timeLimitMs,
      failureReason: q.failureReason,
      flags: FLAG_RULES.filter((rule) => fired.some((item) => item.rule === rule && item.question === q.index)),
    })),
    timeMap: {
      totalMinutes: round.durationMin,
      questions: slots.map((slot) => ({ index: slot.index, activeMinutes: [...(slot.activeMinutes || [])].sort((a, b) => a - b) })),
    },
    nextRound: nextRoundOf(headline.rule, grade, metrics, round.durationMin, slots, questions),
  };
}

// ===================== E16 (spec 4.4) =====================

// Guard steps 1 to 3, then the round must be FINISHED. Loads the saved data and builds the report.
async function getReport(userId, roundId, log) {
  const now = clock.now();
  const round = await roundStateService.loadRound(userId, roundId, now, log);
  if (round.status !== 'FINISHED') {
    throw new AppError('ROUND_NOT_FINISHED', 409, 'The report is available once the round is finished');
  }

  const [problems, submissions, events] = await Promise.all([
    Problem.find({ _id: mongoose.trusted({ $in: round.slots.map((slot) => slot.problem) }) })
      .select('timeLimitMs samples')
      .lean(),
    Submission.find({ assessment: round._id }).lean(),
    AttemptEvent.find({ assessment: round._id }).lean(),
  ]);
  return buildReport(round, problems, submissions, events);
}

module.exports = { buildReport, getReport };
