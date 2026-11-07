const mongoose = require('mongoose');
const Assessment = require('../models/Assessment');

// Lazy expiry (R15, spec 4.3 step 3 and the 5.3 table). `round` is the round as it was read and
// `now` is the request's one clock value. If the round is ACTIVE and its deadline is at or before
// now, one conditional update marks it FINISHED (EXPIRED) with finishedAt equal to the deadline
// (R12). The deadline never changes once set (R3), so the deadline that was read is the one saved.
// If another request finished the round first, the update matches nothing, which is fine.
// Returns true when the round may have changed, so the caller reads it again.
async function expireIfDue(round, now) {
  if (round.status !== 'ACTIVE' || round.deadline > now) return false;
  await Assessment.updateOne(
    { _id: round._id, status: 'ACTIVE', deadline: mongoose.trusted({ $lte: now }) },
    { $set: { status: 'FINISHED', finishReason: 'EXPIRED', finishedAt: round.deadline } }
  );
  return true;
}

module.exports = { expireIfDue };
