const mongoose = require('mongoose');
const env = require('./env');
const User = require('../models/User');
const Problem = require('../models/Problem');
const Assessment = require('../models/Assessment');
const Submission = require('../models/Submission');
const AttemptEvent = require('../models/AttemptEvent');

async function connectDB() {
  await mongoose.connect(env.MONGODB_URI);
}

// Spec 6.7: wait until every model's indexes exist, in particular the unique partial
// ACTIVE-round index. Rejects if an index cannot be built.
async function waitForIndexes() {
  const models = [User, Problem, Assessment, Submission, AttemptEvent];
  await Promise.all(models.map((model) => model.init()));
}

async function disconnectDB() {
  await mongoose.disconnect();
}

module.exports = { connectDB, waitForIndexes, disconnectDB };
