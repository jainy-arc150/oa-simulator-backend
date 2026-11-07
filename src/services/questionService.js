const mongoose = require('mongoose');
const limits = require('../config/limits');
const clock = require('../clock');
const AppError = require('../errors/AppError');
const Assessment = require('../models/Assessment');
const Problem = require('../models/Problem');
const roundStateService = require('./roundStateService');

// The public problem fields of the question response (4.5). hiddenTests is never selected (R2).
const PUBLIC_PROBLEM_FIELDS = 'title statement inputFormat outputFormat constraints samples';

// The match shared by every update of an open question (5.3): the user's round, ACTIVE, and a
// deadline later than now. A request arriving exactly at the deadline matches nothing.
const activeRoundMatch = (userId, roundId, now) => ({
  _id: roundId,
  user: userId,
  status: 'ACTIVE',
  deadline: mongoose.trusted({ $gt: now }),
});

// The question response of section 4.5.
function questionResponse(slot, problem, now) {
  return {
    index: slot.index,
    title: problem.title,
    topic: slot.topic,
    difficulty: slot.difficulty,
    statement: problem.statement,
    inputFormat: problem.inputFormat,
    outputFormat: problem.outputFormat,
    constraints: problem.constraints,
    samples: problem.samples.map(({ input, output, explanation }) => ({ input, output, explanation: explanation ?? null })),
    code: slot.code || '',
    serverTime: now.toISOString(),
  };
}

// E12 (spec 4.4, 5.3): full round guard, then firstOpenedAt is set only if it is still empty.
// Opening does not add an active minute (5.5).
async function openQuestion(userId, roundId, index, log) {
  const now = clock.now();
  // The round is read with its code, because the response returns the saved code (2.6).
  const { slot } = await roundStateService.guardQuestion(userId, roundId, index, now, log, '');

  // If nothing matches, firstOpenedAt was already set: nothing is wrong, the question is returned.
  await Assessment.updateOne(
    { ...activeRoundMatch(userId, roundId, now), slots: mongoose.trusted({ $elemMatch: { index, firstOpenedAt: null } }) },
    { $set: { 'slots.$.firstOpenedAt': now } }
  );

  const problem = await Problem.findById(slot.problem).select(PUBLIC_PROBLEM_FIELDS).lean();
  return questionResponse(slot, problem, now);
}

// E13 (spec 4.4, 5.3, 5.5): full round guard, the code-size check, then one conditional update
// that saves the code and adds the current minute to activeMinutes.
async function saveCode(userId, roundId, index, code, log) {
  const now = clock.now();
  const { round } = await roundStateService.guardQuestion(userId, roundId, index, now, log);

  if (code.length > limits.MAX_CODE_CHARS) {
    throw new AppError('CODE_TOO_LARGE', 413, `Code can be at most ${limits.MAX_CODE_CHARS} characters`);
  }

  // Minute 0 is the first minute of the round (5.5). $addToSet keeps the list free of duplicates.
  const minute = Math.floor((now.getTime() - round.startedAt.getTime()) / limits.MS_PER_MINUTE);
  const { matchedCount } = await Assessment.updateOne(
    { ...activeRoundMatch(userId, roundId, now), 'slots.index': index },
    {
      $set: { 'slots.$.code': code, 'slots.$.codeUpdatedAt': now },
      $addToSet: { 'slots.$.activeMinutes': minute },
    }
  );

  // Nothing matched: the round changed after the guard read it (for example a Finish in another
  // tab). Apply the guard errors.
  if (matchedCount === 0) {
    await roundStateService.guardQuestion(userId, roundId, index, now, log);
    throw new AppError('ROUND_NOT_ACTIVE', 409, 'The round is finished');
  }
}

module.exports = { openQuestion, saveCode };
