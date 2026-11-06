// Slow tests: these run real Python (spec 7.3, Phase 3). Python 3.9 or newer must be installed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { runTests, TEMP_PREFIX } = require('../../src/runner');
const RunnerUnavailableError = require('../../src/errors/RunnerUnavailableError');

const RUNNER_PATH = path.resolve(__dirname, '../../src/runner');
const run = (code, inputs = [''], options = {}) =>
  runTests({ language: 'python', code, inputs, timeLimitMs: 2000, stopOnError: false, ...options });

const tempFolders = () => fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(TEMP_PREFIX));
const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};
const waitUntilDead = async (pid, timeoutMs = 3000) => {
  const started = Date.now();
  while (isAlive(pid) && Date.now() - started < timeoutMs) await new Promise((r) => setTimeout(r, 50));
  return !isAlive(pid);
};

// Runs a script in a separate process, so runner settings (read from the environment when the
// runner loads) can differ per test.
function runInChild(body, settings = {}) {
  const script = `const runner = require(${JSON.stringify(RUNNER_PATH)});
    (async () => { ${body} })().catch((e) => { console.log(JSON.stringify({ crashed: String(e) })); process.exit(1); });`;
  const result = spawnSync(process.execPath, ['-e', script], {
    env: { PATH: process.env.PATH, MONGODB_URI: 'mongodb://127.0.0.1:27017/x', JWT_SECRET: process.env.JWT_SECRET, ...settings },
    encoding: 'utf8',
    timeout: 60000,
  });
  return { status: result.status, output: result.stdout.trim() ? JSON.parse(result.stdout.trim().split('\n').pop()) : null, stderr: result.stderr };
}

let foldersBefore;
beforeEach(() => {
  foldersBefore = tempFolders();
});
afterEach(() => {
  // 5.1: no temp folder remains after any call
  expect(tempFolders().filter((name) => !foldersBefore.includes(name))).toEqual([]);
});

describe('[slow] runTests: normal runs (spec 5.1)', () => {
  test('a correct program returns OK with the right stdout, for each input in order', async () => {
    const { compile, results } = await run('a, b = map(int, input().split())\nprint(a + b)\n', ['1 2\n', '10 20\n', '-5 5\n']);
    expect(compile).toEqual({ ok: true });
    expect(results.map((r) => r.status)).toEqual(['OK', 'OK', 'OK']);
    expect(results.map((r) => r.stdout)).toEqual(['3\n', '30\n', '0\n']);
    expect(results[0]).toMatchObject({ stderr: '', exitCode: 0 });
    expect(typeof results[0].timeMs).toBe('number');
  });

  test('each test runs in its own fresh process', async () => {
    const { results } = await run("import os\nprint(os.path.exists('marker'))\nopen('marker', 'w').close()\n", ['', '']);
    // The folder is shared between tests of one call, so the file written by the first test is
    // visible to the second; but every test is a new process.
    expect(results.map((r) => r.stdout)).toEqual(['False\n', 'True\n']);
  });

  test('the code is written unchanged, so line numbers and line endings are preserved', async () => {
    const code = "print(len(open('main.py', 'rb').read()))\r\n# ünïcode\r\n";
    const { results } = await run(code);
    expect(results[0].stdout.trim()).toBe(String(Buffer.byteLength(code)));
  });

  test('a program that never reads its input still works, even with a large input', async () => {
    const { results } = await run('print("done")\n', ['x'.repeat(2 * 1024 * 1024) + '\n']);
    expect(results[0]).toMatchObject({ status: 'OK', stdout: 'done\n' });
  });

  test('the program runs isolated (-I), without bytecode (-B), in its own process group, with a minimal environment', async () => {
    const code = [
      'import os, sys, json',
      'print(json.dumps({"isolated": sys.flags.isolated, "nobytecode": sys.flags.dont_write_bytecode,',
      '  "ownGroup": os.getpgrp() == os.getpid(), "env": sorted(os.environ)}))',
    ].join('\n');
    const { results } = await run(code);
    const info = JSON.parse(results[0].stdout);
    expect(info).toMatchObject({ isolated: 1, nobytecode: 1, ownGroup: true });
    expect(info.env).not.toContain('JWT_SECRET');
    expect(info.env).not.toContain('MONGODB_URI');
    expect(info.env.every((name) => ['PATH', 'LANG', 'LC_CTYPE', '__CF_USER_TEXT_ENCODING'].includes(name))).toBe(true);
  });

  test('a language other than python throws a plain Error, not RunnerUnavailableError', async () => {
    const attempt = runTests({ language: 'javascript', code: '1', inputs: [''], timeLimitMs: 2000, stopOnError: false });
    await expect(attempt).rejects.toThrow('Unsupported language');
    await expect(attempt).rejects.not.toBeInstanceOf(RunnerUnavailableError);
  });
});

describe('[slow] runTests: syntax errors (spec 5.1, 5.2)', () => {
  test('a missing colon returns compile.ok = false with the right line, and no test runs', async () => {
    const { compile, results } = await run('x = 1\nif x == 1\n    print(x)\n', ['', '']);
    expect(compile).toMatchObject({ ok: false, line: 2 });
    expect(compile.message).toMatch(/^SyntaxError: /);
    expect(results).toEqual([]);
  });

  test('line numbers match the student editor, with blank lines and comments before the error', async () => {
    const { compile } = await run('# comment\n\n\nprint("a"\nprint("b")\n');
    expect(compile.ok).toBe(false);
    expect(compile.line).toBeGreaterThanOrEqual(4);
    expect(compile.line).toBeLessThanOrEqual(5);
  });

  test('an indentation error is reported as a compile error', async () => {
    const { compile } = await run('def f():\nprint(1)\n');
    expect(compile).toMatchObject({ ok: false, line: 2 });
    expect(compile.message).toMatch(/^IndentationError: /);
  });

  test('the program is not run when the syntax is wrong', async () => {
    const marker = path.join(os.tmpdir(), `oa-marker-${process.pid}-${Date.now()}`);
    const { compile } = await run(`open(${JSON.stringify(marker)}, 'w').close()\nx = (\n`);
    expect(compile.ok).toBe(false);
    expect(fs.existsSync(marker)).toBe(false);
  });

  test('the compile message never contains the temp folder path', async () => {
    const { compile } = await run('def f(:\n  pass\n');
    expect(compile.ok).toBe(false);
    expect(compile.message).not.toContain(os.tmpdir());
    expect(compile.message).not.toContain(TEMP_PREFIX);
  });

  test('code Python cannot compile for other reasons (a null byte) is a compile error too', async () => {
    const { compile, results } = await run('print(1)\u0000\n');
    expect(compile.ok).toBe(false);
    expect(typeof compile.message).toBe('string');
    expect(results).toEqual([]);
  });
});

describe('[slow] runTests: runtime errors (spec 5.1)', () => {
  test('dividing by zero returns RUNTIME_ERROR with the error on stderr, showing main.py and not the temp path', async () => {
    const { results } = await run('print(1 / 0)\n');
    expect(results[0]).toMatchObject({ status: 'RUNTIME_ERROR', exitCode: 1, stdout: '' });
    expect(results[0].stderr).toContain('ZeroDivisionError');
    expect(results[0].stderr).toContain('File "main.py", line 1');
    expect(results[0].stderr).not.toContain(os.tmpdir());
    expect(results[0].stderr).not.toContain(fs.realpathSync(os.tmpdir()));
    expect(results[0].stderr).not.toContain(TEMP_PREFIX);
  });

  test('input() when no input exists returns RUNTIME_ERROR (EOFError)', async () => {
    const { results } = await run('print(input())\n', ['']);
    expect(results[0].status).toBe('RUNTIME_ERROR');
    expect(results[0].stderr).toContain('EOFError');
  });

  test('a non-zero exit code is a RUNTIME_ERROR and keeps the exit code', async () => {
    const { results } = await run('import sys\nprint("partial")\nsys.exit(3)\n');
    expect(results[0]).toMatchObject({ status: 'RUNTIME_ERROR', exitCode: 3, stdout: 'partial\n' });
  });

  test('a program killed by an outside signal is a RUNTIME_ERROR with exitCode null', async () => {
    const { results } = await run('import os, signal\nos.kill(os.getpid(), signal.SIGKILL)\n');
    expect(results[0]).toMatchObject({ status: 'RUNTIME_ERROR', exitCode: null });
  });

  test('stderr is capped at 8 KB', async () => {
    const { results } = await run('import sys\nsys.stderr.write("e" * 100000)\nsys.exit(1)\n');
    expect(results[0].status).toBe('RUNTIME_ERROR');
    expect(Buffer.byteLength(results[0].stderr)).toBe(8192);
  });
});

describe('[slow] runTests: time limit (spec 5.1)', () => {
  test('while True: pass returns TIME_LIMIT_EXCEEDED in about the limit, and no Python process is left', async () => {
    const started = Date.now();
    const { results } = await run('import os\nprint(os.getpid(), flush=True)\nwhile True:\n    pass\n', [''], { timeLimitMs: 500 });
    const elapsed = Date.now() - started;

    expect(results[0]).toMatchObject({ status: 'TIME_LIMIT_EXCEEDED', exitCode: null });
    expect(elapsed).toBeGreaterThanOrEqual(500);
    expect(elapsed).toBeLessThan(2500);
    expect(await waitUntilDead(Number(results[0].stdout.trim()))).toBe(true);
  });

  test('a process the program started is killed too (same process group)', async () => {
    const code = [
      'import os, subprocess, sys',
      'child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])',
      'print(os.getpid(), child.pid, flush=True)',
      'while True:',
      '    pass',
    ].join('\n');
    const { results } = await run(code, [''], { timeLimitMs: 500 });
    const [parent, child] = results[0].stdout.trim().split(' ').map(Number);
    expect(results[0].status).toBe('TIME_LIMIT_EXCEEDED');
    expect(await waitUntilDead(parent)).toBe(true);
    expect(await waitUntilDead(child)).toBe(true);
  });

  test('a program that exits normally cannot leave a background process behind', async () => {
    const code = [
      'import subprocess, sys',
      'child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])',
      'print(child.pid, flush=True)',
    ].join('\n');
    const { results } = await run(code, [''], { timeLimitMs: 5000 });
    expect(results[0].status).toBe('OK');
    expect(await waitUntilDead(Number(results[0].stdout.trim()))).toBe(true);
  });

  test('a program that sleeps past the limit is cut off by the wall clock', async () => {
    const { results } = await run('import time\ntime.sleep(30)\n', [''], { timeLimitMs: 500 });
    expect(results[0].status).toBe('TIME_LIMIT_EXCEEDED');
    expect(results[0].timeMs).toBeLessThan(2500);
  });

  test('the next test still runs after one times out when stopOnError is false', async () => {
    const code = 'n = int(input())\nif n == 1:\n    while True:\n        pass\nprint(n)\n';
    const { results } = await run(code, ['1\n', '2\n'], { timeLimitMs: 500 });
    expect(results.map((r) => r.status)).toEqual(['TIME_LIMIT_EXCEEDED', 'OK']);
  });
});

describe('[slow] runTests: output limits (spec 5.1)', () => {
  test('a program printing 10 MB returns RUNTIME_ERROR with an output-limit message, and stdout is capped at 64 KB', async () => {
    const started = Date.now();
    const { results } = await run('import sys\nsys.stdout.write("x" * 10_000_000)\n');
    expect(results[0].status).toBe('RUNTIME_ERROR');
    expect(results[0].stderr).toMatch(/output limit exceeded/i);
    expect(Buffer.byteLength(results[0].stdout)).toBeLessThanOrEqual(65536);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  test('a program that prints forever is stopped as an output-limit RUNTIME_ERROR, not a timeout', async () => {
    const { results } = await run('while True:\n    print("x" * 1000)\n', [''], { timeLimitMs: 10000 });
    expect(results[0].status).toBe('RUNTIME_ERROR');
    expect(results[0].stderr).toMatch(/output limit exceeded/i);
    expect(results[0].timeMs).toBeLessThan(5000);
  });

  test('exactly 64 KB of output is fine; one byte more is an error', async () => {
    const exact = await run('import sys\nsys.stdout.write("x" * 65536)\n');
    expect(exact.results[0].status).toBe('OK');
    expect(Buffer.byteLength(exact.results[0].stdout)).toBe(65536);
    const over = await run('import sys\nsys.stdout.write("x" * 65537)\n');
    expect(over.results[0].status).toBe('RUNTIME_ERROR');
  });
});

describe('[slow] runTests: stopOnError (spec 5.1, D29)', () => {
  const code = 'n = int(input())\nprint(10 // n)\n';
  const inputs = ['1\n', '0\n', '2\n'];

  test('true: the remaining inputs are skipped after the first test that is not OK', async () => {
    const { results } = await run(code, inputs, { stopOnError: true });
    expect(results.map((r) => r.status)).toEqual(['OK', 'RUNTIME_ERROR']);
  });

  test('false: every input is run', async () => {
    const { results } = await run(code, inputs, { stopOnError: false });
    expect(results.map((r) => r.status)).toEqual(['OK', 'RUNTIME_ERROR', 'OK']);
  });

  test('true with all tests passing runs all of them', async () => {
    const { results } = await run(code, ['1\n', '2\n'], { stopOnError: true });
    expect(results.map((r) => r.status)).toEqual(['OK', 'OK']);
  });
});

describe('[slow] runTests: the runner itself fails (spec 5.1)', () => {
  test('with Python unavailable it throws RunnerUnavailableError instead of returning a result', () => {
    const { output } = runInChild(
      `try { await runner.runTests({ language: 'python', code: 'print(1)', inputs: [''], timeLimitMs: 2000, stopOnError: false });
             console.log(JSON.stringify({ returned: true })); }
       catch (e) { console.log(JSON.stringify({ name: e.name, isRunnerError: e.constructor.name })); }`,
      { PYTHON_BIN: '/no/such/python3' }
    );
    expect(output).toEqual({ name: 'RunnerUnavailableError', isRunnerError: 'RunnerUnavailableError' });
  });

  test('a Python that cannot run the syntax check throws RunnerUnavailableError', () => {
    const { output } = runInChild(
      `try { await runner.runTests({ language: 'python', code: 'print(1)', inputs: [''], timeLimitMs: 2000, stopOnError: false });
             console.log(JSON.stringify({ returned: true })); }
       catch (e) { console.log(JSON.stringify({ name: e.name })); }`,
      { PYTHON_BIN: process.execPath }
    );
    expect(output).toEqual({ name: 'RunnerUnavailableError' });
  });

  test('a syntax check that hangs is cut off after the timeout and throws RunnerUnavailableError', () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-fake-python-'));
    const fakePython = path.join(folder, 'python3');
    fs.writeFileSync(fakePython, '#!/bin/sh\nsleep 30\n', { mode: 0o755 });
    try {
      const started = Date.now();
      const { output } = runInChild(
        `try { await runner.runTests({ language: 'python', code: 'print(1)', inputs: [''], timeLimitMs: 2000, stopOnError: false });
               console.log(JSON.stringify({ returned: true })); }
         catch (e) { console.log(JSON.stringify({ name: e.name })); }`,
        { PYTHON_BIN: fakePython }
      );
      expect(output).toEqual({ name: 'RunnerUnavailableError' });
      expect(Date.now() - started).toBeLessThan(15000);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  }, 30000);
});

describe('[slow] runTests: concurrency and queue (spec 5.1)', () => {
  const sleeper = 'import time\nprint(time.time(), flush=True)\ntime.sleep(0.5)\nprint(time.time())\n';

  test('at most 2 runTests calls run at the same time; the others wait', () => {
    const { output } = runInChild(
      `const code = ${JSON.stringify(sleeper)};
       const jobs = Array.from({ length: 5 }, () => runner.runTests({ language: 'python', code, inputs: [''], timeLimitMs: 5000, stopOnError: false }));
       const all = await Promise.all(jobs);
       const spans = all.map((r) => r.results[0].stdout.trim().split('\\n').map(Number));
       let maxAtOnce = 0;
       for (const [start] of spans) maxAtOnce = Math.max(maxAtOnce, spans.filter(([s, e]) => s <= start && start < e).length);
       console.log(JSON.stringify({ maxAtOnce, statuses: all.map((r) => r.results[0].status) }));`,
      { RUNNER_CONCURRENCY: '2' }
    );
    expect(output.statuses).toEqual(['OK', 'OK', 'OK', 'OK', 'OK']);
    expect(output.maxAtOnce).toBeLessThanOrEqual(2);
    expect(output.maxAtOnce).toBeGreaterThanOrEqual(2);
  });

  test('when the queue is full the call throws RunnerUnavailableError', () => {
    const { output } = runInChild(
      `const code = ${JSON.stringify(sleeper)};
       const outcomes = await Promise.all(Array.from({ length: 6 }, () =>
         runner.runTests({ language: 'python', code, inputs: [''], timeLimitMs: 5000, stopOnError: false }).then(() => 'ok', (e) => e.name)));
       console.log(JSON.stringify({ outcomes }));`,
      { RUNNER_CONCURRENCY: '1', RUNNER_QUEUE_MAX: '2' }
    );
    expect(output.outcomes.filter((o) => o === 'ok')).toHaveLength(3);
    expect(output.outcomes.filter((o) => o === 'RunnerUnavailableError')).toHaveLength(3);
  });
});

describe('[slow] runner.shutdown (spec 6.7, 6.8)', () => {
  test('kills a running program, deletes its temp folder, and refuses new work', async () => {
    let runner;
    jest.isolateModules(() => {
      runner = require('../../src/runner');
    });
    const pidFile = path.join(os.tmpdir(), `oa-pid-${process.pid}-${Date.now()}`);
    const code = `import os\nopen(${JSON.stringify(pidFile)}, 'w').write(str(os.getpid()))\nwhile True:\n    pass\n`;

    const running = runner.runTests({ language: 'python', code, inputs: [''], timeLimitMs: 30000, stopOnError: false });
    const outcome = running.then(() => 'finished', (err) => err);
    while (!fs.existsSync(pidFile) || fs.readFileSync(pidFile, 'utf8') === '') await new Promise((r) => setTimeout(r, 50));
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    expect(isAlive(pid)).toBe(true);
    expect(tempFolders().length).toBeGreaterThan(foldersBefore.length);

    await runner.shutdown();

    expect(await outcome).toBeInstanceOf(Error);
    expect((await outcome).name).toBe('RunnerUnavailableError');
    expect(await waitUntilDead(pid)).toBe(true);
    expect(tempFolders().filter((name) => !foldersBefore.includes(name))).toEqual([]);
    await expect(runner.runTests({ language: 'python', code: 'print(1)', inputs: [''], timeLimitMs: 2000, stopOnError: false })).rejects.toThrow(
      'shutting down'
    );
    fs.rmSync(pidFile, { force: true });
  });
});
