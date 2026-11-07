const mongoose = require('mongoose');
const limits = require('../config/limits');
const AppError = require('../errors/AppError');
const Assessment = require('../models/Assessment');
const roundStateService = require('./roundStateService');

// The two kinds of attempt (spec 5.3). Their cooldowns and caps are independent (D34).
const KINDS = {
  run: {
    timeField: 'lastRunAt',
    countField: 'runCount',
    cap: limits.MAX_RUNS_PER_QUESTION,
    cooldownMs: limits.RUN_COOLDOWN_SECONDS * limits.MS_PER_SECOND,
    limitMessage: `You have used all ${limits.MAX_RUNS_PER_QUESTION} Runs for this question`,
    cooldownMessage: 'Wait a moment before running again',
  },
  submit: {
    timeField: 'lastSubmitAt',
    countField: 'submitCount',
    cap: limits.MAX_SUBMITS_PER_QUESTION,
    cooldownMs: limits.SUBMIT_COOLDOWN_SECONDS * limits.MS_PER_SECOND,
    limitMessage: `You have used all ${limits.MAX_SUBMITS_PER_QUESTION} Submits for this question`,
    cooldownMessage: 'Wait a moment before submitting again',
  },
};

// The attempt gate (spec 5.3): one conditional update that checks the round, the deadline, the
// counter cap and the cooldown, and records the attempt, so two simultaneous requests can never
// both pass (D33). It also saves the code (D22) and adds the current minute to activeMinutes (5.5).
// Returns the round as it was before the change (the previous round).
async function takeAttempt(kind, { userId, roundId, index, code, now, startedAt, log }) {
  const k = KINDS[kind];
  const minute = Math.floor((now.getTime() - startedAt.getTime()) / limits.MS_PER_MINUTE);

  const previous = await Assessment.findOneAndUpdate(
    {
      _id: roundId,
      user: userId,
      status: 'ACTIVE',
      deadline: mongoose.trusted({ $gt: now }),
      slots: mongoose.trusted({ $elemMatch: { index, [k.countField]: { $lt: k.cap } } }),
      $or: [
        { [k.timeField]: null },
        { [k.timeField]: mongoose.trusted({ $lte: new Date(now.getTime() - k.cooldownMs) }) },
      ],
    },
    {
      $set: { [k.timeField]: now, 'slots.$.code': code, 'slots.$.codeUpdatedAt': now },
      $inc: { [`slots.$.${k.countField}`]: 1 },
      $addToSet: { 'slots.$.activeMinutes': minute },
    },
    { new: false }
  )
    .select('-slots.code')
    .lean();
  if (previous) return previous;

  // Nothing matched: read the round once to find out why, in the order of 5.3.
  // 1. The guard errors (404, lazy expiry, ROUND_EXPIRED or ROUND_NOT_ACTIVE).
  const { round, slot } = await roundStateService.guardQuestion(userId, roundId, index, now, log);
  // 2. The counter is at its cap.
  if (slot[k.countField] >= k.cap) throw new AppError('ATTEMPT_LIMIT', 429, k.limitMessage);
  // 3. Otherwise the cooldown has not passed.
  const last = round[k.timeField];
  const retryAfterMs = last ? Math.max(last.getTime() + k.cooldownMs - now.getTime(), 0) : 0;
  throw new AppError('COOLDOWN', 429, k.cooldownMessage, { retryAfterMs });
}

// Giving the attempt back (R10, D35): when the runner failed, a second conditional update undoes
// the counter and the cooldown time. It matches only while the cooldown time is still this
// request's `now`, so a later attempt is never touched. The saved code and active minute stay.
async function giveBack(kind, { roundId, index, now, previous }) {
  const k = KINDS[kind];
  const restore = previous[k.timeField]
    ? { $set: { [k.timeField]: previous[k.timeField] } }
    : { $unset: { [k.timeField]: '' } };
  await Assessment.updateOne(
    { _id: roundId, [k.timeField]: now, 'slots.index': index },
    { ...restore, $inc: { [`slots.$.${k.countField}`]: -1 } }
  );
}

module.exports = { takeAttempt, giveBack };
