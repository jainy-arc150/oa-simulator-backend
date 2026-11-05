const path = require('path');
const os = require('os');
const net = require('net');
const { spawn } = require('child_process');
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

  async function startServerAndWait() {
    const port = await freePort();
    const run = runServer({ ...GOOD, MONGODB_URI: mongo.getUri(), PORT: String(port) });
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

  test.each(['SIGTERM', 'SIGINT'])('%s stops the server cleanly with exit code 0 and it stops listening', async (signal) => {
    const { run, port } = await startServerAndWait();
    run.child.kill(signal);
    const { code } = await run.exited;
    expect(code).toBe(0);
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  });
});
