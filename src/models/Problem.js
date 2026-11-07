const mongoose = require('mongoose');
const clock = require('../clock');
const limits = require('../config/limits');

const DIFFICULTIES = Object.keys(limits.DIFFICULTY_TABLE);
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Test inputs and outputs may be empty strings, so only the type is checked, not the length.
function allowEmptyString(schema, ...paths) {
  paths.forEach((path) => {
    schema.path(path).checkRequired = (value) => typeof value === 'string';
  });
}

const sampleSchema = new mongoose.Schema(
  {
    input: { type: String, required: true },
    output: { type: String, required: true },
    explanation: { type: String },
  },
  { _id: false }
);
allowEmptyString(sampleSchema, 'input', 'output');

const hiddenTestSchema = new mongoose.Schema(
  {
    input: { type: String, required: true },
    output: { type: String, required: true },
  },
  { _id: false }
);
allowEmptyString(hiddenTestSchema, 'input', 'output');

const problemSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      match: [SLUG_PATTERN, 'slug may contain only lowercase letters, digits and single hyphens'],
    },
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: limits.TITLE_LENGTH_MIN,
      maxlength: limits.TITLE_LENGTH_MAX,
    },
    statement: { type: String, required: true },
    inputFormat: { type: String, required: true },
    outputFormat: { type: String, required: true },
    constraints: { type: String, required: true },
    topic: {
      type: String,
      required: true,
      validate: {
        validator: (value) => limits.TOPICS.includes(value),
        message: (props) => `${props.value} is not one of the allowed topics`,
      },
    },
    difficulty: { type: String, required: true, enum: DIFFICULTIES },
    timeLimitMs: {
      type: Number,
      required: true,
      default: limits.DEFAULT_TIME_LIMIT_MS,
      min: limits.TIME_LIMIT_MS_MIN,
      max: limits.TIME_LIMIT_MS_MAX,
    },
    samples: {
      type: [sampleSchema],
      validate: {
        validator: (value) => value.length >= limits.SAMPLES_MIN && value.length <= limits.SAMPLES_MAX,
        message: `a problem needs ${limits.SAMPLES_MIN} to ${limits.SAMPLES_MAX} samples`,
      },
    },
    // Never returned by a query unless the code asks with .select('+hiddenTests') (R2).
    hiddenTests: {
      type: [hiddenTestSchema],
      select: false,
      validate: {
        validator: function (value) {
          if (this.status !== 'approved') return true;
          return value.length >= limits.HIDDEN_TESTS_MIN && value.length <= limits.HIDDEN_TESTS_MAX;
        },
        message: `an approved problem needs ${limits.HIDDEN_TESTS_MIN} to ${limits.HIDDEN_TESTS_MAX} hidden tests`,
      },
    },
    status: { type: String, required: true, enum: ['draft', 'approved'], default: 'draft' },
  },
  { timestamps: { currentTime: () => clock.now() } }
);

problemSchema.index({ status: 1, topic: 1, difficulty: 1 });

module.exports = mongoose.model('Problem', problemSchema);
