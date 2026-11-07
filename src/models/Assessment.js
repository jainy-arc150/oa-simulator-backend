const mongoose = require('mongoose');
const clock = require('../clock');
const limits = require('../config/limits');
const Problem = require('./Problem');

const DIFFICULTIES = Object.keys(limits.DIFFICULTY_TABLE);

const slotSchema = new mongoose.Schema(
  {
    index: { type: Number, required: true, min: 1, validate: { validator: Number.isInteger, message: 'index must be a whole number' } },
    topic: {
      type: String,
      required: true,
      validate: {
        validator: (value) => limits.TOPICS.includes(value),
        message: (props) => `${props.value} is not one of the allowed topics`,
      },
    },
    difficulty: { type: String, required: true, enum: DIFFICULTIES },
    problem: { type: mongoose.Schema.Types.ObjectId, ref: 'Problem', required: true },
    firstOpenedAt: { type: Date },
    code: { type: String, default: '', maxlength: limits.MAX_CODE_CHARS },
    codeUpdatedAt: { type: Date },
    runCount: { type: Number, default: 0, min: 0 },
    submitCount: { type: Number, default: 0, min: 0 },
    activeMinutes: {
      type: [Number],
      default: [],
      validate: {
        validator: (value) => value.every((m) => Number.isInteger(m) && m >= 0) && new Set(value).size === value.length,
        message: 'activeMinutes must be whole numbers from 0 with no duplicates',
      },
    },
    solvedAt: { type: Date },
  },
  { _id: false }
);

const assessmentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, required: true, enum: ['READY', 'ACTIVE', 'FINISHED'], default: 'READY' },
    durationMin: { type: Number, required: true, min: limits.ROUND_DURATION_MIN, max: limits.ROUND_DURATION_MAX },
    slots: {
      type: [slotSchema],
      validate: [
        {
          validator: (slots) =>
            slots.length >= limits.QUESTIONS_PER_ROUND_MIN && slots.length <= limits.QUESTIONS_PER_ROUND_MAX,
          message: `a round needs ${limits.QUESTIONS_PER_ROUND_MIN} to ${limits.QUESTIONS_PER_ROUND_MAX} questions`,
        },
        {
          validator: (slots) => slots.every((slot, position) => slot.index === position + 1),
          message: 'slot indexes must be 1, 2, 3, ... in order',
        },
        {
          validator: (slots) => new Set(slots.map((slot) => String(slot.problem))).size === slots.length,
          message: 'a problem cannot appear twice in one round',
        },
      ],
    },
    startedAt: { type: Date },
    deadline: { type: Date },
    finishedAt: { type: Date },
    finishReason: { type: String, enum: ['MANUAL', 'EXPIRED'] },
    lastRunAt: { type: Date },
    lastSubmitAt: { type: Date },
  },
  { timestamps: { currentTime: () => clock.now() } }
);

assessmentSchema.index({ user: 1, createdAt: -1 });
assessmentSchema.index({ user: 1, status: 1 });
// The database itself refuses a second ACTIVE round for one user (R13).
assessmentSchema.index(
  { user: 1 },
  { name: 'one_active_round_per_user', unique: true, partialFilterExpression: { status: 'ACTIVE' } }
);

// finishReason is set together with finishedAt.
assessmentSchema.pre('validate', function () {
  if (Boolean(this.finishedAt) !== Boolean(this.finishReason)) {
    this.invalidate('finishReason', 'finishedAt and finishReason must be set together');
  }
});

// A slot's problem must exist and have the same topic and difficulty as the slot (R7).
assessmentSchema.pre('validate', async function () {
  const changed =
    this.isNew || this.slots.some((s) => s.isModified('problem') || s.isModified('topic') || s.isModified('difficulty'));
  if (!changed) return;

  const ids = this.slots.map((slot) => slot.problem).filter(Boolean);
  const problems = await Problem.find({ _id: mongoose.trusted({ $in: ids }) }).select('topic difficulty').lean();
  const byId = new Map(problems.map((p) => [String(p._id), p]));

  this.slots.forEach((slot, position) => {
    if (!slot.problem) return;
    const problem = byId.get(String(slot.problem));
    if (!problem) {
      this.invalidate(`slots.${position}.problem`, 'problem does not exist');
    } else if (problem.topic !== slot.topic || problem.difficulty !== slot.difficulty) {
      this.invalidate(`slots.${position}.problem`, 'problem topic and difficulty must match the slot');
    }
  });
});

module.exports = mongoose.model('Assessment', assessmentSchema);
