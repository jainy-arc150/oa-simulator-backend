const mongoose = require('mongoose');
const limits = require('../config/limits');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: limits.NAME_LENGTH_MIN,
      maxlength: limits.NAME_LENGTH_MAX,
    },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    passwordHash: { type: String, required: true, select: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
