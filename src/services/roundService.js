const limits = require('../config/limits');
const clock = require('../clock');
const AppError = require('../errors/AppError');
const Assessment = require('../models/Assessment');
const Problem = require('../models/Problem');
const shuffle = require('../utils/shuffle');
const roundStateService = require('./roundStateService');

// The summary never needs the saved code, so it is never read (R16).
const WITHOUT_CODE = '-slots.code';

const notFound = () => new AppError('NOT_FOUND', 404, 'Round not found');
const isoOrNull = (date) => (date ? date.toISOString() : null);

// The round summary of section 4.5. It holds no problem id, statement, sample or code (D20, R16).
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

// Section 5.4 step 3: slots grouped by (topic, difficulty), in order of first appearance.
// Each group keeps the 1-based numbers of its slots in slot order.
function groupSlots(slots) {
  const groups = new Map();
  slots.forEach((slot, position) => {
    const key = JSON.stringify([slot.topic, slot.difficulty]);
    if (!groups.has(key)) groups.set(key, { topic: slot.topic, difficulty: slot.difficulty, slots: [] });
    groups.get(key).slots.push(position + 1);
  });
  return [...groups.values()];
}

// E6 (spec 4.4, 5.4). `slots` and `durationMin` were already validated (step 1, section 6.2).
async function createRound(userId, { slots, durationMin }) {
  // Step 1: a plain count, not an atomic check (allowed exception to D33, see 5.4).
  const readyCount = await Assessment.countDocuments({ user: userId, status: 'READY' });
  if (readyCount >= limits.MAX_READY_ROUNDS_PER_USER) {
    throw new AppError(
      'READY_LIMIT_REACHED',
      409,
      `You already have ${limits.MAX_READY_ROUNDS_PER_USER} rounds that have not been started. Start or delete one first.`
    );
  }

  // Step 2: the duration.
  const duration = durationMin ?? slots.reduce((sum, slot) => sum + limits.DIFFICULTY_TABLE[slot.difficulty], 0);

  // Steps 3 and 4: fetch the approved pool of every group, and stop before saving anything if a
  // group is short. Fetching the ids gives the count too.
  const groups = groupSlots(slots);
  const pools = await Promise.all(
    groups.map(({ topic, difficulty }) => Problem.find({ status: 'approved', topic, difficulty }).select('_id').lean())
  );
  const short = groups
    .map((group, i) => ({
      slots: group.slots,
      topic: group.topic,
      difficulty: group.difficulty,
      requested: group.slots.length,
      available: pools[i].length,
    }))
    .filter((group) => group.available < group.requested);
  if (short.length > 0) {
    throw new AppError('NOT_ENOUGH_PROBLEMS', 422, 'There are not enough problems for some questions', short);
  }

  // Steps 5 and 6: a Fisher-Yates shuffle of each pool (never $sample, D39), the first k picked,
  // assigned to the group's slots in slot order. Different groups never share a problem (R7).
  const problemBySlot = new Map();
  groups.forEach((group, i) => {
    const picked = shuffle(pools[i]).slice(0, group.slots.length);
    group.slots.forEach((slotNumber, j) => problemBySlot.set(slotNumber, picked[j]._id));
  });

  // Step 7: saved as READY with every counter at 0; slots keep the requested order (D37).
  const round = await Assessment.create({
    user: userId,
    durationMin: duration,
    slots: slots.map((slot, position) => ({
      index: position + 1,
      topic: slot.topic,
      difficulty: slot.difficulty,
      problem: problemBySlot.get(position + 1),
    })),
  });
  return roundSummary(round, clock.now());
}

// E7 (spec 4.4): lazy expiry on the user's ACTIVE round first, then the user's rounds, newest first.
async function listRounds(userId, { status, page, limit }) {
  const now = clock.now();
  const active = await Assessment.findOne({ user: userId, status: 'ACTIVE' }).select('status deadline').lean();
  if (active) await roundStateService.expireIfDue(active, now);

  const filter = { user: userId };
  if (status) filter.status = status;
  const [rounds, total] = await Promise.all([
    Assessment.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('status durationMin createdAt startedAt finishedAt finishReason slots.solvedAt')
      .lean(),
    Assessment.countDocuments(filter),
  ]);

  const items = rounds.map((round) => ({
    id: String(round._id),
    status: round.status,
    durationMin: round.durationMin,
    questionCount: round.slots.length,
    solvedCount: round.slots.filter((slot) => slot.solvedAt).length,
    createdAt: isoOrNull(round.createdAt),
    startedAt: isoOrNull(round.startedAt),
    finishedAt: isoOrNull(round.finishedAt),
    finishReason: round.finishReason || null,
  }));
  return { items, page, limit, total };
}

// E8 (spec 4.4): guard steps 2 and 3 (step 1 is the auth middleware), then the round summary.
async function getRound(userId, roundId) {
  const now = clock.now();
  const findRound = () => Assessment.findOne({ _id: roundId, user: userId }).select(WITHOUT_CODE).lean();

  let round = await findRound();
  if (!round) throw notFound();
  if (await roundStateService.expireIfDue(round, now)) round = await findRound();
  return roundSummary(round, now);
}

// E9 (spec 4.4): one conditional delete that matches only the user's READY round.
async function deleteRound(userId, roundId) {
  const { deletedCount } = await Assessment.deleteOne({ _id: roundId, user: userId, status: 'READY' });
  if (deletedCount === 1) return;

  if (!(await Assessment.exists({ _id: roundId, user: userId }))) throw notFound();
  throw new AppError('ROUND_NOT_READY', 409, 'Only a round that has not been started can be deleted');
}

module.exports = { roundSummary, createRound, listRounds, getRound, deleteRound };
