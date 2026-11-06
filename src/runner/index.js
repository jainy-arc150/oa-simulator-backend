const { spawn } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { performance } = require('perf_hooks');
const env = require('../config/env');
const limits = require('../config/limits');
const RunnerUnavailableError = require('../errors/RunnerUnavailableError');
const { createQueue } = require('./queue');

// The only code that touches Python (spec 5.1). A later Judge0 adapter must return the same shape.

const TEMP_PREFIX = 'oa-run-';
const SOURCE_NAME = 'main.py';
const COMPILE_CHECK_SCRIPT = path.join(__dirname, 'compile_check.py');
const OUTPUT_LIMIT_MESSAGE = 'Output limit exceeded';

// Nothing from the backend's own environment (secrets, .env values) reaches student code.
const childEnv = { LANG: 'C.UTF-8' };
if (process.env.PATH) childEnv.PATH = process.env.PATH;

const queue = createQueue({ concurrency: env.RUNNER_CONCURRENCY, maxWaiting: env.RUNNER_QUEUE_MAX });
const activeChildren = new Set();
const inFlight = new Set();
let shuttingDown = false;

function killGroup(child) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (err) {
    // The group is already gone.
  }
}

// Keeps at most `limit` bytes and remembers whether more arrived.
function createCollector(limit) {
  const chunks = [];
  let size = 0;
  let exceeded = false;
  return {
    push(chunk) {
      const room = limit - size;
      if (chunk.length > room) {
        if (room > 0) chunks.push(chunk.subarray(0, room));
        size = limit;
        exceeded = true;
      } else {
        chunks.push(chunk);
        size += chunk.length;
      }
    },
    get exceeded() {
      return exceeded;
    },
    toString() {
      return Buffer.concat(chunks).toString('utf8');
    },
  };
}

// Runs Python once. Resolves with how the process ended; rejects if Python could not be started.
function runProcess({ args, cwd, input, timeoutMs, stdoutLimit, stderrLimit }) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const stdout = createCollector(stdoutLimit);
    const stderr = createCollector(stderrLimit);
    let timer;
    let settled = false;
    let exited = false;
    let exitCode = null;
    let timedOut = false;
    let outputExceeded = false;

    let child;
    try {
      child = spawn(env.PYTHON_BIN, args, {
        cwd,
        env: childEnv,
        detached: true, // its own process group, so the whole group can be killed
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      reject(new RunnerUnavailableError(`Could not start ${env.PYTHON_BIN}`, err));
      return;
    }
    activeChildren.add(child);

    function settle(callback) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeChildren.delete(child);
      callback();
    }

    child.on('error', (err) => settle(() => reject(new RunnerUnavailableError(`Could not run ${env.PYTHON_BIN}`, err))));

    child.stdout.on('data', (chunk) => {
      stdout.push(chunk);
      if (stdout.exceeded && !outputExceeded) {
        outputExceeded = true;
        killGroup(child);
      }
    });
    child.stderr.on('data', (chunk) => stderr.push(chunk));

    // A program that never reads its input closes the pipe early; that is not an error.
    child.stdin.on('error', () => {});
    child.stdin.end(input);

    child.on('exit', (code) => {
      exited = true;
      exitCode = code;
      killGroup(child); // nothing the program started may outlive it
    });

    child.on('close', () => {
      settle(() =>
        resolve({
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          exitCode,
          timedOut,
          outputExceeded,
          timeMs: Math.round(performance.now() - startedAt),
        })
      );
    });

    timer = setTimeout(() => {
      if (!exited) timedOut = true;
      killGroup(child);
      child.stdout.destroy();
      child.stderr.destroy();
    }, timeoutMs);
  });
}

// Python error messages mention the temp file. The student only ever sees `main.py` (spec 5.2).
function scrub(text, dirs) {
  let result = text;
  // Longest first: on macOS /var/x is inside /private/var/x, so the short form must not go first.
  for (const dir of [...dirs].sort((a, b) => b.length - a.length)) {
    result = result.split(path.join(dir, SOURCE_NAME)).join(SOURCE_NAME);
    result = result.split(dir).join(SOURCE_NAME);
  }
  return result;
}

async function checkSyntax(dir, dirs) {
  const raw = await runProcess({
    args: ['-I', '-B', COMPILE_CHECK_SCRIPT, path.join(dir, SOURCE_NAME)],
    cwd: dir,
    timeoutMs: limits.COMPILE_CHECK_TIMEOUT_MS,
    stdoutLimit: env.RUNNER_STDOUT_LIMIT_BYTES,
    stderrLimit: env.RUNNER_STDERR_LIMIT_BYTES,
  });
  if (raw.timedOut || raw.outputExceeded || raw.exitCode !== 0) {
    throw new RunnerUnavailableError('The syntax check could not run');
  }

  let parsed;
  try {
    parsed = JSON.parse(raw.stdout);
  } catch (err) {
    throw new RunnerUnavailableError('The syntax check gave an unreadable answer', err);
  }
  if (parsed.ok === true) return { ok: true };
  return {
    ok: false,
    message: scrub(String(parsed.message), dirs),
    line: Number.isInteger(parsed.line) ? parsed.line : null,
  };
}

async function runOne(dir, dirs, input, timeLimitMs) {
  const raw = await runProcess({
    args: ['-I', '-u', '-B', SOURCE_NAME],
    cwd: dir,
    input,
    timeoutMs: timeLimitMs,
    stdoutLimit: env.RUNNER_STDOUT_LIMIT_BYTES,
    stderrLimit: env.RUNNER_STDERR_LIMIT_BYTES,
  });
  if (shuttingDown) throw new RunnerUnavailableError('The runner is shutting down');

  if (raw.timedOut) {
    return { status: 'TIME_LIMIT_EXCEEDED', stdout: raw.stdout, stderr: scrub(raw.stderr, dirs), exitCode: null, timeMs: raw.timeMs };
  }
  if (raw.outputExceeded) {
    return { status: 'RUNTIME_ERROR', stdout: raw.stdout, stderr: OUTPUT_LIMIT_MESSAGE, exitCode: null, timeMs: raw.timeMs };
  }
  return {
    status: raw.exitCode === 0 ? 'OK' : 'RUNTIME_ERROR',
    stdout: raw.stdout,
    stderr: scrub(raw.stderr, dirs),
    exitCode: raw.exitCode,
    timeMs: raw.timeMs,
  };
}

async function execute({ code, inputs, timeLimitMs, stopOnError }) {
  let dir;
  let outcome;
  let failure;
  try {
    if (shuttingDown) throw new RunnerUnavailableError('The runner is shutting down');
    dir = await fs.mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX));
    await fs.writeFile(path.join(dir, SOURCE_NAME), code, 'utf8');
    const dirs = [...new Set([dir, await fs.realpath(dir)])];

    const compile = await checkSyntax(dir, dirs);
    if (!compile.ok) {
      outcome = { compile, results: [] };
    } else {
      const results = [];
      for (const input of inputs) {
        const result = await runOne(dir, dirs, input, timeLimitMs);
        results.push(result);
        if (stopOnError && result.status !== 'OK') break;
      }
      outcome = { compile, results };
    }
  } catch (err) {
    failure = err instanceof RunnerUnavailableError ? err : new RunnerUnavailableError('The runner failed', err);
  } finally {
    if (dir) {
      try {
        await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 });
      } catch (err) {
        failure = failure || new RunnerUnavailableError('Could not delete the temp folder', err);
      }
    }
  }
  if (failure) throw failure;
  return outcome;
}

// runTests(spec 5.1): runs the student's program on each input and reports what happened.
// It never decides right or wrong and never sees expected outputs.
async function runTests({ language, code, inputs, timeLimitMs, stopOnError }) {
  if (language !== 'python') throw new Error(`Unsupported language: ${language}`);

  const job = queue.run(() => execute({ code, inputs, timeLimitMs, stopOnError }));
  inFlight.add(job);
  try {
    return await job;
  } finally {
    inFlight.delete(job);
  }
}

// Spec 6.7: kill every running Python process, delete their temp folders, refuse new work.
async function shutdown() {
  shuttingDown = true;
  queue.rejectWaiting(new RunnerUnavailableError('The runner is shutting down'));
  activeChildren.forEach(killGroup);
  await Promise.allSettled([...inFlight]);
}

module.exports = { runTests, shutdown, TEMP_PREFIX };
