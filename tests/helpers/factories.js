const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { waitForIndexes } = require('../../src/config/db');
const User = require('../../src/models/User');
const Problem = require('../../src/models/Problem');
const Assessment = require('../../src/models/Assessment');

// Starts an in-memory MongoDB for one test file, builds the indexes like the server does,
// and empties every collection after each test.
function useTestDb() {
  let mongo;
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri('oa-test'));
    await waitForIndexes();
  }, 120000);
  afterEach(async () => {
    await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });
}

let counter = 0;
const next = () => ++counter;

function userData(overrides = {}) {
  return { name: 'Test Student', email: `student${next()}@example.com`, passwordHash: 'not-a-real-hash', ...overrides };
}

function problemData(overrides = {}) {
  const n = next();
  return {
    slug: `problem-${n}`,
    title: `Problem ${n}`,
    statement: 'Read two numbers and print their sum.',
    inputFormat: 'One line: a b',
    outputFormat: 'One number',
    constraints: '1 <= a, b <= 100',
    topic: 'math',
    difficulty: 'easy',
    samples: [{ input: '1 2\n', output: '3\n', explanation: '1 + 2' }],
    hiddenTests: Array.from({ length: 5 }, (_, i) => ({ input: `${i} ${i}\n`, output: `${i * 2}\n` })),
    status: 'approved',
    ...overrides,
  };
}

const createUser = (overrides) => User.create(userData(overrides));
const createProblem = (overrides) => Problem.create(problemData(overrides));

// A round with one slot per given problem, in order. Slot topic/difficulty are taken from the problem.
function assessmentData(user, problems, overrides = {}) {
  return {
    user: user._id,
    durationMin: 30,
    slots: problems.map((problem, position) => ({
      index: position + 1,
      topic: problem.topic,
      difficulty: problem.difficulty,
      problem: problem._id,
    })),
    ...overrides,
  };
}

const createAssessment = (user, problems, overrides) => Assessment.create(assessmentData(user, problems, overrides));

// Resolves to the list of paths that failed validation, or fails the test if the promise did not
// reject with a ValidationError.
async function invalidPaths(promise) {
  try {
    await promise;
  } catch (error) {
    if (error.name !== 'ValidationError') throw error;
    return Object.keys(error.errors);
  }
  throw new Error('expected a ValidationError, but the operation succeeded');
}

module.exports = { useTestDb, invalidPaths, userData, problemData, createUser, createProblem, assessmentData, createAssessment };
