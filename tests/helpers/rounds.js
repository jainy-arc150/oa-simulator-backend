const mongoose = require('mongoose');
const request = require('supertest');
const limits = require('../../src/config/limits');
const Assessment = require('../../src/models/Assessment');
const { createProblem, assessmentData } = require('./factories');

// Shared helpers for the round tests (E6 to E13).

const START = new Date('2030-01-01T00:00:00.000Z');
const MINUTE = 60 * 1000;
const at = (minutes) => new Date(START.getTime() + minutes * MINUTE);
const DEADLINE = at(30);

let studentCounter = 0;
async function registerStudent(app) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Round Student', email: `round${++studentCounter}@example.com`, password: 'correct horse battery' });
  return { token: res.body.token, id: res.body.user.id };
}

// Request helpers for the round endpoints. `getApp` returns the current app, which tests rebuild
// before each test.
function roundApi(getApp) {
  const call = (method, url, token) => {
    const req = request(getApp())[method](url);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };
  return {
    createRound: (token, body) => call('post', '/api/assessments', token).send(body),
    listRounds: (token, query = '') => call('get', `/api/assessments${query}`, token),
    getRound: (token, id) => call('get', `/api/assessments/${id}`, token),
    deleteRound: (token, id) => call('delete', `/api/assessments/${id}`, token),
    startRound: (token, id) => call('post', `/api/assessments/${id}/start`, token),
    finishRound: (token, id) => call('post', `/api/assessments/${id}/finish`, token),
    openQuestion: (token, id, index) => call('post', `/api/assessments/${id}/questions/${index}/open`, token),
    saveCode: (token, id, index, body) => call('put', `/api/assessments/${id}/questions/${index}/code`, token).send(body),
  };
}

const slot = (topic, difficulty) => ({ topic, difficulty });
const newId = () => new mongoose.Types.ObjectId().toString();

async function pool(topic, difficulty, count, overrides = {}) {
  const problems = [];
  for (let i = 0; i < count; i++) problems.push(await createProblem({ topic, difficulty, ...overrides }));
  return problems;
}

// A round saved straight to the database for the user id, one slot per problem.
const saveRound = (userId, problems, overrides) => Assessment.create(assessmentData({ _id: userId }, problems, overrides));
const activeFields = () => ({ status: 'ACTIVE', durationMin: 30, startedAt: START, deadline: DEADLINE });
const finishedFields = () => ({ ...activeFields(), status: 'FINISHED', finishedAt: at(10), finishReason: 'MANUAL' });
const fieldsFor = { READY: () => ({}), ACTIVE: activeFields, FINISHED: finishedFields };

const savedRound = (id) => Assessment.findById(id).lean();
const rawRounds = () => Assessment.collection.find({}).sort({ _id: 1 }).toArray();

// A logger for calling services directly.
const fakeLog = () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() });

// Every piece of problem data and code carries a marker, so a leak shows up in a text search.
const MARKERS = [
  'TITLE-MARKER',
  'STATEMENT-MARKER',
  'FORMAT-MARKER',
  'CONSTRAINT-MARKER',
  'SAMPLE-IN-MARKER',
  'SAMPLE-OUT-MARKER',
  'EXPLANATION-MARKER',
  'HIDDEN-IN-MARKER',
  'HIDDEN-OUT-MARKER',
  'CODE-MARKER',
];
const HIDDEN_MARKERS = ['HIDDEN-IN-MARKER', 'HIDDEN-OUT-MARKER'];

function markedProblem(topic, difficulty) {
  return createProblem({
    topic,
    difficulty,
    title: 'TITLE-MARKER problem',
    statement: 'STATEMENT-MARKER',
    inputFormat: 'FORMAT-MARKER input',
    outputFormat: 'FORMAT-MARKER output',
    constraints: 'CONSTRAINT-MARKER',
    samples: [{ input: 'SAMPLE-IN-MARKER\n', output: 'SAMPLE-OUT-MARKER\n', explanation: 'EXPLANATION-MARKER' }],
    hiddenTests: Array.from({ length: limits.HIDDEN_TESTS_MIN }, (_, i) => ({
      input: `HIDDEN-IN-MARKER-${i}\n`,
      output: `HIDDEN-OUT-MARKER-${i}\n`,
    })),
  });
}

function expectNoProblemData(value, problems) {
  const text = JSON.stringify(value);
  for (const marker of MARKERS) expect(text).not.toContain(marker);
  for (const problem of problems) expect(text).not.toContain(String(problem._id));
  for (const field of ['hiddenTests', 'statement', 'samples', 'code', 'problem', 'title', 'inputFormat', 'constraints']) {
    expect(text).not.toContain(`"${field}"`);
  }
}

const SUMMARY_KEYS = ['createdAt', 'deadline', 'durationMin', 'finishReason', 'finishedAt', 'id', 'serverTime', 'slots', 'startedAt', 'status'];
const SLOT_KEYS = ['difficulty', 'index', 'opened', 'runCount', 'solved', 'submitCount', 'topic'];

module.exports = {
  START,
  MINUTE,
  at,
  DEADLINE,
  registerStudent,
  roundApi,
  slot,
  newId,
  pool,
  saveRound,
  activeFields,
  finishedFields,
  fieldsFor,
  savedRound,
  rawRounds,
  fakeLog,
  MARKERS,
  HIDDEN_MARKERS,
  markedProblem,
  expectNoProblemData,
  SUMMARY_KEYS,
  SLOT_KEYS,
};
