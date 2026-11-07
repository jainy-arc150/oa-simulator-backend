const mongoose = require('mongoose');
const clock = require('../clock');

const submissionSchema = new mongoose.Schema(
  {
    assessment: { type: mongoose.Schema.Types.ObjectId, ref: 'Assessment', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    problem: { type: mongoose.Schema.Types.ObjectId, ref: 'Problem', required: true },
    slotIndex: { type: Number, required: true },
    verdict: {
      type: String,
      required: true,
      enum: ['ACCEPTED', 'WRONG_ANSWER', 'COMPILATION_ERROR', 'RUNTIME_ERROR', 'TIME_LIMIT_EXCEEDED'],
    },
    // Only for COMPILATION_ERROR: runtime errors can contain hidden input, so they are never stored.
    errorMessage: {
      type: String,
      validate: {
        validator: function (value) {
          return value === undefined || value === null || this.verdict === 'COMPILATION_ERROR';
        },
        message: 'errorMessage is only allowed for COMPILATION_ERROR',
      },
    },
    testsPassed: { type: Number, required: true },
    totalTests: { type: Number, required: true },
    // Used inside the report only; never returned by any endpoint (D11).
    failedTestNumber: { type: Number },
    runtimeMs: { type: Number },
    submittedAt: { type: Date, required: true },
  },
  { timestamps: { currentTime: () => clock.now() } }
);

submissionSchema.index({ assessment: 1, slotIndex: 1, submittedAt: 1 });

module.exports = mongoose.model('Submission', submissionSchema);
