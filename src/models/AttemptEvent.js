const mongoose = require('mongoose');
const clock = require('../clock');
const Submission = require('./Submission');

const attemptEventSchema = new mongoose.Schema(
  {
    assessment: { type: mongoose.Schema.Types.ObjectId, ref: 'Assessment', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    problem: { type: mongoose.Schema.Types.ObjectId, ref: 'Problem', required: true },
    slotIndex: { type: Number, required: true },
    type: { type: String, required: true, enum: ['RUN', 'SUBMIT'] },
    at: { type: Date, required: true },
    // Same values as in submissions; for a RUN, ACCEPTED means every sample passed.
    verdict: { type: String, required: true, enum: Submission.schema.path('verdict').enumValues },
    submission: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Submission',
      validate: {
        validator: function (value) {
          return value === undefined || value === null || this.type === 'SUBMIT';
        },
        message: 'submission is only allowed on SUBMIT events',
      },
    },
  },
  { timestamps: { currentTime: () => clock.now() }, collection: 'attemptEvents' }
);

attemptEventSchema.index({ assessment: 1, slotIndex: 1, at: 1 });

module.exports = mongoose.model('AttemptEvent', attemptEventSchema);
