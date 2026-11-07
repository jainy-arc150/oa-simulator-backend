const runner = require('../../src/runner');
const RunnerUnavailableError = require('../../src/errors/RunnerUnavailableError');

// Replaces runTests with scripted results in the shape of spec 5.1, so grading is tested without
// Python (7.6). The test file restores it with jest.restoreAllMocks() after each test.

// One test's result, as runTests reports it.
const ok = (stdout, timeMs = 30) => ({ status: 'OK', stdout, stderr: '', exitCode: 0, timeMs });
const crash = (stderr = 'Traceback (most recent call last):\n  File "main.py", line 1, in <module>\nZeroDivisionError: division by zero\n', timeMs = 30) => ({
  status: 'RUNTIME_ERROR',
  stdout: '',
  stderr,
  exitCode: 1,
  timeMs,
});
const timeout = (timeMs = 2040) => ({ status: 'TIME_LIMIT_EXCEEDED', stdout: '', stderr: '', exitCode: null, timeMs });

// The program of the factory problem: read "a b", print a + b.
function addTwo(input) {
  const [a, b] = input.trim().split(/\s+/).map(Number);
  return ok(`${a + b}\n`);
}

// A runTests that runs `program(input, position)` on each input in order, like the real runner:
// it stops after the first status that is not OK when stopOnError is true.
function programRunner(program) {
  return async ({ inputs, stopOnError }) => {
    const results = [];
    for (let i = 0; i < inputs.length; i++) {
      const result = await program(inputs[i], i);
      results.push(result);
      if (stopOnError && result.status !== 'OK') break;
    }
    return { compile: { ok: true }, results };
  };
}

function useFakeRunner() {
  const calls = [];
  let handler = programRunner(addTwo);
  jest.spyOn(runner, 'runTests').mockImplementation(async (args) => {
    calls.push(args);
    return handler(args);
  });

  return {
    // Every runTests call, with its arguments.
    calls,
    // Each test's result comes from program(input, position).
    program(program) {
      handler = programRunner(program);
    },
    // Full control: fn(args) returns a whole runTests result, or throws.
    respond(fn) {
      handler = fn;
    },
    // A syntax error: no test runs.
    compileError(message, line) {
      handler = async () => ({ compile: { ok: false, message, line }, results: [] });
    },
    // The runner itself fails (R10).
    fail() {
      handler = async () => {
        throw new RunnerUnavailableError('The fake runner failed');
      };
    },
  };
}

module.exports = { useFakeRunner, programRunner, addTwo, ok, crash, timeout };
