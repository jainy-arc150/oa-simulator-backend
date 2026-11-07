const mongoose = require('mongoose');
const limits = require('../config/limits');
const clock = require('../clock');
const AppError = require('../errors/AppError');
const RunnerUnavailableError = require('../errors/RunnerUnavailableError');
const Assessment = require('../models/Assessment');
const AttemptEvent = require('../models/AttemptEvent');
const Problem = require('../models/Problem');
const Submission = require('../models/Submission');
const runner = require('../runner');
const normalizeOutput = require('../utils/normalizeOutput');
const attemptService = require('./attemptService');
const questionService = require('./questionService');
const roundStateService = require('./roundStateService');

// ---------- pure functions (spec 5.2) ----------

// Every input fed to stdin ends with a newline (5.2).
const withFinalNewline = (input) => (input.endsWith('\n') ? input : `${input}\n`);

// A compile error is shown as "Line {line}: {message}", or only the message if no line is known.
const compileMessage = ({ message, line }) => (Number.isInteger(line) ? `Line ${line}: ${message}` : message);

// A test passes when its status is OK and its normalized output equals the normalized expected one.
const passes = (result, expected) => result.status === 'OK' && normalizeOutput(result.stdout) === normalizeOutput(expected);

// In a Run response, actual and error are cut at a fixed length, with "(truncated)" added (5.2).
function forDisplay(text) {
  if (text.length <= limits.RUN_OUTPUT_DISPLAY_MAX_CHARS) return text;
  return `${text.slice(0, limits.RUN_OUTPUT_DISPLAY_MAX_CHARS)}\n(truncated)`;
}

// The verdict calculation of 5.2 for tests in their fixed order (samples first, then hidden).
// `expectedOutputs` has one entry per test; `runResult` is what runTests returned.
// A result that does not fit the tests (more results than tests, or fewer without a failing one)
// can only come from a broken runner, so it counts as a runner failure (R10).
function gradeTests(expectedOutputs, runResult) {
  const totalTests = expectedOutputs.length;
  if (!runResult.compile.ok) {
    return { verdict: 'COMPILATION_ERROR', errorMessage: compileMessage(runResult.compile), testsPassed: 0, totalTests };
  }

  const { results } = runResult;
  if (results.length > totalTests) throw new RunnerUnavailableError('The runner returned more results than tests');

  let testsPassed = 0;
  let failed = null;
  results.forEach((result, i) => {
    if (passes(result, expectedOutputs[i])) testsPassed += 1;
    else if (!failed) failed = { number: i + 1, verdict: result.status === 'OK' ? 'WRONG_ANSWER' : result.status };
  });
  if (!failed && results.length < totalTests) throw new RunnerUnavailableError('The runner skipped tests without a failure');

  const graded = { verdict: failed ? failed.verdict : 'ACCEPTED', testsPassed, totalTests };
  if (failed) graded.failedTestNumber = failed.number;
  if (results.length > 0) graded.runtimeMs = Math.max(...results.map((result) => result.timeMs));
  return graded;
}

// Submit (5.2): the stored fields of the submission. Tests skipped by stopOnError count as not passed.
function gradeSubmit(tests, runResult) {
  return gradeTests(
    tests.map((test) => test.output),
    runResult
  );
}

// Run (5.2): every sample is listed. `verdict` is for the RUN event: ACCEPTED when every sample
// passed, otherwise the type of the first failing sample, or COMPILATION_ERROR.
function gradeRun(samples, runResult) {
  const { verdict, errorMessage, testsPassed, totalTests } = gradeTests(
    samples.map((sample) => sample.output),
    runResult
  );
  if (verdict === 'COMPILATION_ERROR') {
    return { verdict, compilation: { message: errorMessage }, results: [], testsPassed, totalTests };
  }
  if (runResult.results.length !== samples.length) throw new RunnerUnavailableError('The runner skipped samples');

  const results = samples.map((sample, i) => {
    const result = runResult.results[i];
    return {
      input: sample.input,
      expected: sample.output,
      actual: forDisplay(result.stdout),
      passed: passes(result, sample.output),
      status: result.status,
      error: result.stderr ? forDisplay(result.stderr) : null,
    };
  });
  return { verdict, compilation: null, results, testsPassed, totalTests };
}

// D27: ACCEPTED and COMPILATION_ERROR are returned as they are; every other verdict is NOT_ACCEPTED.
const publicVerdict = (verdict) => (verdict === 'ACCEPTED' || verdict === 'COMPILATION_ERROR' ? verdict : 'NOT_ACCEPTED');

// ---------- Run and Submit (spec 4.4, 5.3) ----------

const runnerUnavailable = () => new AppError('RUNNER_UNAVAILABLE', 503, 'Something went wrong, try again');
const slotIn = (round, index) => round.slots.find((slot) => slot.index === index);

// Calls runTests and grades the result. If the runner fails, the attempt is given back (R10),
// the cause is logged, and 503 is returned. Nothing is saved for a failed runner.
async function runAndGrade(kind, { request, previous, grade, log }) {
  try {
    return grade(await runner.runTests(request.runTests));
  } catch (err) {
    if (!(err instanceof RunnerUnavailableError)) throw err;
    await attemptService.giveBack(kind, { roundId: request.roundId, index: request.index, now: request.now, previous });
    log.error({ err, roundId: String(request.roundId), userId: String(request.userId) }, 'runner unavailable');
    throw runnerUnavailable();
  }
}

// E14: samples only. Never creates a submission and never marks the question solved.
async function runQuestion(userId, roundId, index, { language, code }, log) {
  const now = clock.now();
  const { round, slot } = await roundStateService.guardQuestion(userId, roundId, index, now, log);
  questionService.checkCodeSize(code);
  const previous = await attemptService.takeAttempt('run', { userId, roundId, index, code, now, startedAt: round.startedAt, log });

  const problem = await Problem.findById(slot.problem).select('samples timeLimitMs').lean();
  const request = {
    userId,
    roundId,
    index,
    now,
    runTests: {
      language,
      code,
      inputs: problem.samples.map((sample) => withFinalNewline(sample.input)),
      timeLimitMs: problem.timeLimitMs,
      stopOnError: false, // every sample shows a result (D29)
    },
  };
  const graded = await runAndGrade('run', { request, previous, grade: (result) => gradeRun(problem.samples, result), log });

  await AttemptEvent.create({
    assessment: round._id,
    user: userId,
    problem: slot.problem,
    slotIndex: index,
    type: 'RUN',
    at: now,
    verdict: graded.verdict,
  });

  return {
    compilation: graded.compilation,
    results: graded.results,
    testsPassed: graded.testsPassed,
    totalTests: graded.totalTests,
    runsLeft: limits.MAX_RUNS_PER_QUESTION - (slotIn(previous, index).runCount + 1),
    serverTime: now.toISOString(),
  };
}

// First solve (5.3): sets solvedAt only if it is still empty, so it stays the first Accepted (R8).
// It does not require ACTIVE: a Submit that passed the gate before the deadline is graded in full (R9).
async function markSolved(roundId, index, submittedAt) {
  await Assessment.updateOne(
    { _id: roundId, slots: mongoose.trusted({ $elemMatch: { index, solvedAt: null } }) },
    { $set: { 'slots.$.solvedAt': submittedAt } }
  );
}

// E15: samples plus hidden tests, judged by when the request arrived (R9). The order of work is 5.3's.
async function submitQuestion(userId, roundId, index, { language, code }, log) {
  const now = clock.now(); // arrival time: used by the gate and saved as submittedAt, at and solvedAt
  const { round, slot } = await roundStateService.guardQuestion(userId, roundId, index, now, log);
  questionService.checkCodeSize(code);
  const previous = await attemptService.takeAttempt('submit', { userId, roundId, index, code, now, startedAt: round.startedAt, log });

  // Only the Submit handler reads hidden tests (3.2).
  const problem = await Problem.findById(slot.problem).select('samples timeLimitMs +hiddenTests').lean();
  const tests = [...problem.samples, ...problem.hiddenTests];
  const request = {
    userId,
    roundId,
    index,
    now,
    runTests: {
      language,
      code,
      inputs: tests.map((test) => withFinalNewline(test.input)),
      timeLimitMs: problem.timeLimitMs,
      stopOnError: true, // one infinite loop costs one time limit (D29)
    },
  };
  const graded = await runAndGrade('submit', { request, previous, grade: (result) => gradeSubmit(tests, result), log });

  const submission = await Submission.create({
    assessment: round._id,
    user: userId,
    problem: slot.problem,
    slotIndex: index,
    ...graded,
    submittedAt: now,
  });
  await AttemptEvent.create({
    assessment: round._id,
    user: userId,
    problem: slot.problem,
    slotIndex: index,
    type: 'SUBMIT',
    at: now,
    verdict: graded.verdict,
    submission: submission._id,
  });
  if (graded.verdict === 'ACCEPTED') await markSolved(roundId, index, now);

  // Spec 6.5: ids, the stored verdict, tests passed and runtime. Never failedTestNumber or any text.
  log.info(
    {
      roundId: String(round._id),
      userId: String(userId),
      slotIndex: index,
      submissionId: String(submission._id),
      verdict: graded.verdict,
      testsPassed: graded.testsPassed,
      totalTests: graded.totalTests,
      runtimeMs: graded.runtimeMs,
    },
    'submission graded'
  );

  // Whether the question is now solved: by this submission, or by an earlier Accepted (D7, R8).
  let solved = graded.verdict === 'ACCEPTED';
  if (!solved) {
    const current = await Assessment.findById(roundId).select('slots.index slots.solvedAt').lean();
    solved = Boolean(slotIn(current, index).solvedAt);
  }

  const response = { verdict: publicVerdict(graded.verdict) };
  if (graded.verdict === 'COMPILATION_ERROR') response.errorMessage = graded.errorMessage;
  response.solved = solved;
  response.submitsLeft = limits.MAX_SUBMITS_PER_QUESTION - (slotIn(previous, index).submitCount + 1);
  response.serverTime = now.toISOString();
  return response;
}

module.exports = { gradeRun, gradeSubmit, compileMessage, withFinalNewline, runQuestion, submitQuestion };
