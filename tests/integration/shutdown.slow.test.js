const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { TEMP_PREFIX } = require('../../src/runner');

// Spec 6.7, 6.8: "On SIGTERM no Python process or temp folder is left behind." The real server
// runs in its own process; SIGTERM arrives while a student's infinite loop is running.

const SERVER_FILE = path.resolve(__dirname, '../../src/server.js');
const SECRET = 'a-valid-secret-that-is-at-least-32-chars';
const TIME_LIMIT_MS = 3000;

let mongo;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
}, 120000);
afterAll(async () => {
  await mongo.stop();
});

function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer().listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitFor(condition, timeoutMs = 15000) {
  const started = Date.now();
  while (!(await condition())) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// The PIDs of the child processes of `pid` (the runner starts Python as a child of the server).
function childPids(pid) {
  try {
    return execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' }).split('\n').filter(Boolean).map(Number);
  } catch (err) {
    return []; // pgrep exits 1 when there are none
  }
}
const isRunning = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return false;
  }
};
const tempFolders = () => new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(TEMP_PREFIX)));

test('[slow] 6.8: SIGTERM during a running Run lets it finish, then leaves no Python process and no temp folder', async () => {
  const uri = mongo.getUri('shutdown');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;

  // One approved problem, written straight to the database.
  const connection = await mongoose.createConnection(uri).asPromise();
  await connection.collection('problems').insertOne({
    slug: 'add-two',
    title: 'Add Two',
    statement: 'Print a + b.',
    inputFormat: 'a b',
    outputFormat: 'a + b',
    constraints: '1 <= a, b <= 9',
    topic: 'math',
    difficulty: 'easy',
    timeLimitMs: TIME_LIMIT_MS,
    samples: [{ input: '1 2\n', output: '3\n' }],
    hiddenTests: Array.from({ length: 5 }, (_, i) => ({ input: `${i} ${i}\n`, output: `${2 * i}\n` })),
    status: 'approved',
  });
  await connection.close();

  const server = spawn(process.execPath, [SERVER_FILE], {
    env: { PATH: process.env.PATH, MONGODB_URI: uri, JWT_SECRET: SECRET, PORT: String(port) },
    cwd: os.tmpdir(),
  });
  let output = '';
  server.stdout.on('data', (chunk) => (output += chunk));
  server.stderr.on('data', (chunk) => (output += chunk));
  const exited = new Promise((resolve) => server.on('exit', (code) => resolve(code)));
  await waitFor(() => output.includes('server listening'));

  const call = (method, url, token, body) =>
    fetch(`${base}${url}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });

  const { token } = await (await call('POST', '/api/auth/register', null, { name: 'Shut Down', email: 'shut@example.com', password: 'shutdown-password' })).json();
  const round = await (await call('POST', '/api/assessments', token, { slots: [{ topic: 'math', difficulty: 'easy' }] })).json();
  await call('POST', `/api/assessments/${round.id}/start`, token);

  const before = tempFolders();
  const running = call('POST', `/api/assessments/${round.id}/questions/1/run`, token, { language: 'python', code: 'while True:\n    pass\n' });

  // Wait until Python is running, then send SIGTERM.
  let pythonPids = [];
  await waitFor(() => {
    pythonPids = childPids(server.pid);
    return pythonPids.length > 0;
  });
  const sentAt = Date.now();
  server.kill('SIGTERM');

  // New requests are refused at once, while the running one is allowed to finish.
  await waitFor(async () => {
    try {
      await fetch(`${base}/health`);
      return false;
    } catch (err) {
      return true;
    }
  });
  const response = await running;
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.results[0].status).toBe('TIME_LIMIT_EXCEEDED');

  expect(await exited).toBe(0);
  expect(Date.now() - sentAt).toBeLessThan(TIME_LIMIT_MS + 5000);
  expect(output).toContain('shutting down');

  // Nothing is left behind.
  for (const pid of pythonPids) expect(isRunning(pid)).toBe(false);
  const leftOver = [...tempFolders()].filter((name) => !before.has(name));
  expect(leftOver).toEqual([]);
}, 60000);
