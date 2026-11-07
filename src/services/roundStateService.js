const mongoose = require('mongoose');
const limits = require('../config/limits');
const clock = require('../clock');
const AppError = require('../errors/AppError');
const Assessment = require('../models/Assessment');

// Code is read only where an endpoint returns it (E12); everywhere else it is left out (R16).
const WITHOUT_CODE = '-slots.code';

const notFound = () => new AppError('NOT_FOUND', 404, 'Round not found');
const isoOrNull = (date) => (date ? date.toISOString() : null);
const ids = (round) => ({ roundId: String(round._id), userId: String(round.user) });

// The round summary of section 4.5 (E6, E8, E10, E11). It holds no problem id, statement,
// sample or code (D20, R16).
function roundSummary(round, now) {
  return {
    id: String(round._id),
    status: round.status,
    durationMin: round.durationMin,
    createdAt: isoOrNull(round.createdAt),
    startedAt: isoOrNull(round.startedAt),
    deadline: isoOrNull(round.deadline),
    finishedAt: isoOrNull(round.finishedAt),
    finishReason: round.finishReason || null,
    serverTime: now.toISOString(),
    slots: round.slots.map((slot) => ({
      index: slot.index,
      topic: slot.topic,
      difficulty: slot.difficulty,
      opened: Boolean(slot.firstOpenedAt),
      solved: Boolean(slot.solvedAt),
      runCount: slot.runCount,
      submitCount: slot.submitCount,
    })),
  };
}

// Lazy expiry (R15, spec 4.3 step 3 and the 5.3 table). `round` is the round as it was read and
// `now` is the request's one clock value. If the round is ACTIVE and its deadline is at or before
// now, one conditional update marks it FINISHED (EXPIRED) with finishedAt equal to the deadline
// (R12). The deadline never changes once set (R3), so the deadline that was read is the one saved.
// If another request finished the round first, the update matches nothing, which is fine; only
// the request whose update changed the round logs it (spec 6.5).
// Returns true when the round may have changed, so the caller reads it again.
async function expireIfDue(round, now, log) {
  if (round.status !== 'ACTIVE' || round.deadline > now) return false;
  const { modifiedCount } = await Assessment.updateOne(
    { _id: round._id, status: 'ACTIVE', deadline: mongoose.trusted({ $lte: now }) },
    { $set: { status: 'FINISHED', finishReason: 'EXPIRED', finishedAt: round.deadline } }
  );
  if (modifiedCount === 1) log.info({ ...ids(round), finishReason: 'EXPIRED' }, 'round finished');
  return true;
}

// Finishes the user's ACTIVE round if its deadline has passed (E7, and E10 before starting: R13).
// A user has at most one ACTIVE round.
async function expireUsersActiveRound(userId, now, log) {
  const active = await Assessment.findOne({ user: userId, status: 'ACTIVE' }).select('user status deadline').lean();
  if (active) await expireIfDue(active, now, log);
}

// Round guard steps 2 and 3 (spec 4.3); step 1 is the auth middleware. Returns the round after
// lazy expiry, or throws 404 when it does not exist or is another user's (R1).
async function loadRound(userId, roundId, now, log, select = WITHOUT_CODE) {
  const find = () => Assessment.findOne({ _id: roundId, user: userId }).select(select).lean();
  let round = await find();
  if (!round) throw notFound();
  if (await expireIfDue(round, now, log)) round = await find();
  return round;
}

// Round guard step 4: the round must be ACTIVE. After step 3, an ACTIVE round's deadline is later than now.
function requireActive(round) {
  if (round.status === 'ACTIVE') return;
  if (round.finishReason === 'EXPIRED') {
    throw new AppError('ROUND_EXPIRED', 409, 'The round has ended because its time ran out');
  }
  if (round.status === 'READY') throw new AppError('ROUND_NOT_ACTIVE', 409, 'The round has not been started');
  throw new AppError('ROUND_NOT_ACTIVE', 409, 'The round is finished');
}

// The full round guard (spec 4.3 steps 2 to 5), used by E12 to E15. `index` is a whole number from
// 1 (checked by the params schema); step 5 checks it against the number of questions.
async function guardQuestion(userId, roundId, index, now, log, select = WITHOUT_CODE) {
  const round = await loadRound(userId, roundId, now, log, select);
  requireActive(round);
  const slot = round.slots.find((s) => s.index === index);
  if (!slot) throw new AppError('NOT_FOUND', 404, 'Question not found');
  return { round, slot };
}

// E10 (spec 4.4, 5.3). Start is not safe to repeat (D25): a second Start gets 409.
async function startRound(userId, roundId, log) {
  const now = clock.now();
  const round = await Assessment.findOne({ _id: roundId, user: userId }).select('durationMin').lean();
  if (!round) throw notFound();

  // R13: an expired round that was never marked must not block this Start.
  await expireUsersActiveRound(userId, now, log);

  // One conditional update (R5). durationMin never changes, so the value read above is the one used.
  // The unique partial index refuses a second ACTIVE round for the user, even when two Starts race (R13).
  let started;
  try {
    started = await Assessment.findOneAndUpdate(
      { _id: roundId, user: userId, status: 'READY' },
      {
        $set: {
          status: 'ACTIVE',
          startedAt: now,
          deadline: new Date(now.getTime() + round.durationMin * limits.MS_PER_MINUTE),
        },
      },
      { new: true }
    )
      .select(WITHOUT_CODE)
      .lean();
  } catch (err) {
    if (err.code === 11000 && err.keyPattern && err.keyPattern.user) {
      throw new AppError('ACTIVE_ROUND_EXISTS', 409, 'You already have an active round. Finish it before starting another.');
    }
    throw err;
  }

  if (!started) {
    if (!(await Assessment.exists({ _id: roundId, user: userId }))) throw notFound();
    throw new AppError('ROUND_NOT_READY', 409, 'This round has already been started');
  }
  log.info(ids(started), 'round started');
  return roundSummary(started, now);
}

// E11 (spec 4.4, 5.3). Safe to repeat (D25): a FINISHED round is returned as it is.
async function finishRound(userId, roundId, log) {
  const now = clock.now();
  let round = await loadRound(userId, roundId, now, log);

  if (round.status === 'ACTIVE') {
    const finished = await Assessment.findOneAndUpdate(
      { _id: roundId, user: userId, status: 'ACTIVE', deadline: mongoose.trusted({ $gt: now }) },
      { $set: { status: 'FINISHED', finishReason: 'MANUAL', finishedAt: now } },
      { new: true }
    )
      .select(WITHOUT_CODE)
      .lean();
    if (finished) {
      log.info({ ...ids(finished), finishReason: 'MANUAL' }, 'round finished');
      return roundSummary(finished, now);
    }
    // Another request finished it first: read it once more and return it as it is.
    round = await Assessment.findOne({ _id: roundId, user: userId }).select(WITHOUT_CODE).lean();
    if (!round) throw notFound();
  }

  if (round.status === 'READY') throw new AppError('ROUND_NOT_ACTIVE', 409, 'The round has not been started');
  return roundSummary(round, now);
}

module.exports = {
  roundSummary,
  expireIfDue,
  expireUsersActiveRound,
  loadRound,
  guardQuestion,
  startRound,
  finishRound,
};
