const request = require('supertest');
const createApp = require('../../src/app');
const limits = require('../../src/config/limits');
const Problem = require('../../src/models/Problem');
const { useTestDb, problemData, createProblem } = require('../helpers/factories');
const { createLogCapture } = require('../helpers/logCapture');

useTestDb();

let app;
let logs;
beforeEach(() => {
  const capture = createLogCapture();
  logs = capture.lines;
  app = createApp({ logStream: capture.stream });
});

async function tokenFor(email = 'topics@example.com') {
  const res = await request(app).post('/api/auth/register').send({ name: 'Topic Student', email, password: 'correct horse battery' });
  return res.body.token;
}

const getTopics = (token) => {
  const req = request(app).get('/api/topics');
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};

describe('E5 GET /api/topics: authentication (spec 4.4, 4.6)', () => {
  test('4.6: without a token it returns 401 UNAUTHORIZED', async () => {
    const res = await getTopics();
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  test('with an invalid token it returns 401 UNAUTHORIZED', async () => {
    const res = await getTopics('not-a-real-token');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('E5 GET /api/topics: counts (spec 4.4)', () => {
  test('an empty bank returns { topics: [] }', async () => {
    const res = await getTopics(await tokenFor());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ topics: [] });
  });

  test('counts approved problems per topic and difficulty, in TOPICS order', async () => {
    await createProblem({ topic: 'math', difficulty: 'medium' });
    await createProblem({ topic: 'arrays', difficulty: 'easy' });
    await createProblem({ topic: 'arrays', difficulty: 'easy' });
    await createProblem({ topic: 'arrays', difficulty: 'hard' });
    await createProblem({ topic: 'sorting', difficulty: 'hard' });

    const res = await getTopics(await tokenFor());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      topics: [
        { topic: 'arrays', easy: 2, medium: 0, hard: 1 },
        { topic: 'sorting', easy: 0, medium: 0, hard: 1 },
        { topic: 'math', easy: 0, medium: 1, hard: 0 },
      ],
    });
    const order = res.body.topics.map((t) => limits.TOPICS.indexOf(t.topic));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test('draft problems are not counted, and a topic with only drafts is left out', async () => {
    await createProblem({ topic: 'strings', difficulty: 'easy', status: 'draft' });
    await createProblem({ topic: 'hashing', difficulty: 'easy' });
    await createProblem({ topic: 'hashing', difficulty: 'easy', status: 'draft' });

    const res = await getTopics(await tokenFor());
    expect(res.body).toEqual({ topics: [{ topic: 'hashing', easy: 1, medium: 0, hard: 0 }] });
  });

  test('a problem whose topic is no longer in TOPICS is not listed', async () => {
    // Saved straight to the collection, as if TOPICS had changed after it was seeded.
    await Problem.collection.insertOne(problemData({ topic: 'old-topic' }));
    await createProblem({ topic: 'math', difficulty: 'easy' });

    const res = await getTopics(await tokenFor());
    expect(res.body).toEqual({ topics: [{ topic: 'math', easy: 1, medium: 0, hard: 0 }] });
  });

  test('an unknown query field is ignored', async () => {
    await createProblem({ topic: 'math', difficulty: 'hard' });
    const token = await tokenFor();
    const res = await request(app).get('/api/topics?topic=math&status=draft').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ topics: [{ topic: 'math', easy: 0, medium: 0, hard: 1 }] });
  });
});

describe('E5 GET /api/topics: hidden tests never leave the server (R2)', () => {
  test('R2: the response and the log lines contain no hiddenTests field and no hidden data', async () => {
    const hiddenTests = Array.from({ length: 5 }, (_, i) => ({ input: `hidden-in-${i}\n`, output: `hidden-out-${i}` }));
    await createProblem({ topic: 'arrays', difficulty: 'easy', hiddenTests });

    const res = await getTopics(await tokenFor());
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('hiddenTests');
    expect(body).not.toContain('hidden-in');
    expect(body).not.toContain('hidden-out');
    expect(Object.keys(res.body.topics[0]).sort()).toEqual(['easy', 'hard', 'medium', 'topic']);

    const logText = JSON.stringify(logs);
    expect(logText).not.toContain('hidden-in');
    expect(logText).not.toContain('hidden-out');
  });
});
