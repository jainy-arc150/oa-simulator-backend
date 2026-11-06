const path = require('path');
const os = require('os');
const net = require('net');
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const SERVER_FILE = path.resolve(__dirname, '../../src/server.js');

// Runs the real server.js in its own process with only the given settings.
function runServer(settings) {
  const child = spawn(process.execPath, [SERVER_FILE], {
    env: { PATH: process.env.PATH, ...settings },
    cwd: os.tmpdir(),
  });
  const run = { child, output: '', exit: null };
  child.stdout.on('data', (chunk) => (run.output += chunk));
  child.stderr.on('data', (chunk) => (run.output += chunk));
  run.exited = new Promise((resolve) =>
    child.on('exit', (code, signal) => {
      run.exit = { code, signal };
      resolve(run.exit);
    })
  );
  return run;
}

function waitFor(condition, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (condition()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('timed out waiting'));
      }
    }, 50);
  });
}

function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer().listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const GOOD = { JWT_SECRET: 'a-valid-secret-that-is-at-least-32-chars' };

describe('server startup (spec 6.7)', () => {
  test('a missing setting stops the server with a non-zero code and a clear message', async () => {
    const run = runServer({ JWT_SECRET: GOOD.JWT_SECRET });
    const { code } = await run.exited;
    expect(code).toBe(1);
    expect(run.output).toContain('MONGODB_URI');
  });

  test('an unreachable database stops the server with a non-zero code and an error log', async () => {
    const run = runServer({ ...GOOD, MONGODB_URI: 'mongodb://127.0.0.1:1/x?serverSelectionTimeoutMS=500', PORT: String(await freePort()) });
    const { code } = await run.exited;
    expect(code).toBe(1);
    const failure = run.output.split('\n').filter(Boolean).map((line) => JSON.parse(line)).find((line) => line.msg === 'startup failed');
    expect(failure.level).toBe(50);
  });
});

describe('server running against a real MongoDB (spec 6.7)', () => {
  let mongo;
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
  }, 120000);
  afterAll(async () => {
    await mongo.stop();
  });

  async function startServerAndWait(uri = mongo.getUri()) {
    const port = await freePort();
    const run = runServer({ ...GOOD, MONGODB_URI: uri, PORT: String(port) });
    await waitFor(() => run.output.includes('server listening') || run.exit);
    return { run, port };
  }

  test('E1 answers over real HTTP and responses carry X-Request-Id', async () => {
    const { run, port } = await startServerAndWait();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'ok' });
      expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);

      const missing = await fetch(`http://127.0.0.1:${port}/nope`);
      expect(missing.status).toBe(404);
      expect(missing.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      run.child.kill('SIGKILL');
      await run.exited;
    }
  });

  test('all model indexes, including the unique partial ACTIVE-round index, exist once the server is listening', async () => {
    const uri = mongo.getUri('indexes-ready');
    const { run } = await startServerAndWait(uri);
    const connection = await mongoose.createConnection(uri).asPromise();
    try {
      const keys = async (name) => (await connection.collection(name).indexes()).map((i) => JSON.stringify(i.key));
      const assessments = await connection.collection('assessments').indexes();
      const active = assessments.find((i) => i.name === 'one_active_round_per_user');
      expect(active).toMatchObject({ unique: true, partialFilterExpression: { status: 'ACTIVE' } });
      expect(await keys('users')).toContain(JSON.stringify({ email: 1 }));
      expect(await keys('problems')).toContain(JSON.stringify({ slug: 1 }));
      expect(await keys('submissions')).toContain(JSON.stringify({ assessment: 1, slotIndex: 1, submittedAt: 1 }));
      expect(await keys('attemptEvents')).toContain(JSON.stringify({ assessment: 1, slotIndex: 1, at: 1 }));
    } finally {
      await connection.close();
      run.child.kill('SIGKILL');
      await run.exited;
    }
  });

  test('if an index cannot be built the server exits non-zero and never starts listening', async () => {
    const uri = mongo.getUri('index-conflict');
    const connection = await mongoose.createConnection(uri).asPromise();
    await connection.collection('assessments').createIndex({ user: 1 }, { name: 'one_active_round_per_user', unique: true });
    await connection.close();

    const { run } = await startServerAndWait(uri);
    const { code } = await run.exited;
    expect(code).toBe(1);
    expect(run.output).toContain('startup failed');
    expect(run.output).not.toContain('server listening');
  });

  test.each(['SIGTERM', 'SIGINT'])('%s stops the server cleanly with exit code 0 and it stops listening', async (signal) => {
    const { run, port } = await startServerAndWait();
    run.child.kill(signal);
    const { code } = await run.exited;
    expect(code).toBe(0);
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  });
});
