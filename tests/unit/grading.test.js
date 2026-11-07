const limits = require('../../src/config/limits');
const RunnerUnavailableError = require('../../src/errors/RunnerUnavailableError');
const { gradeRun, gradeSubmit, compileMessage, withFinalNewline } = require('../../src/services/gradingService');
const { ok, crash, timeout } = require('../helpers/fakeRunner');

const passed = (results) => ({ compile: { ok: true }, results });
const tests = (...outputs) => outputs.map((output, i) => ({ input: `${i}\n`, output }));

describe('5.2: comparing outputs', () => {
  test.each([
    ['the same text', '5\n', '5\n', true],
    ['trailing spaces', '5  \n', '5\n', true],
    ['a trailing tab', '5\t\n', '5\n', true],
    ['extra trailing blank lines', '5\n\n\n', '5\n', true],
    ['no final newline', '5', '5\n', true],
    ['CRLF line endings', '1 2\r\n3\r\n', '1 2\n3\n', true],
    ['old Mac CR line endings', '1 2\r3\r', '1 2\n3\n', true],
    ['a different number', '5\n', '6\n', false],
    ['a different case', 'yes\n', 'Yes\n', false],
    ['doubled inner spaces', '1  2\n', '1 2\n', false],
    ['a leading space', ' 5\n', '5\n', false],
    ['two lines instead of one', '1\n2\n', '1 2\n', false],
    ['nothing printed', '', '5\n', false],
    ['a debug print left in', 'debug\n5\n', '5\n', false],
    ['an empty line inside the output', '1\n\n2\n', '1\n2\n', false],
  ])('%s: passes = %s', (name, stdout, expected, shouldPass) => {
    const graded = gradeSubmit(tests(expected), passed([ok(stdout)]));
    expect(graded.verdict).toBe(shouldPass ? 'ACCEPTED' : 'WRONG_ANSWER');
  });

  test('the stored expected output is normalized again before comparing', () => {
    expect(gradeSubmit(tests('5  \r\n\r\n'), passed([ok('5')])).verdict).toBe('ACCEPTED');
  });

  test('an OK-looking output with a RUNTIME_ERROR status does not pass', () => {
    expect(gradeSubmit(tests('5\n'), passed([{ ...crash(), stdout: '5\n' }])).verdict).toBe('RUNTIME_ERROR');
  });
});

describe('5.2: verdict calculation (Submit)', () => {
  test('every test passes: ACCEPTED, all tests passed, runtimeMs is the slowest test', () => {
    const graded = gradeSubmit(tests('1\n', '2\n', '3\n'), passed([ok('1\n', 40), ok('2\n', 95), ok('3\n', 60)]));
    expect(graded).toEqual({ verdict: 'ACCEPTED', testsPassed: 3, totalTests: 3, runtimeMs: 95 });
  });

  test('a syntax error: COMPILATION_ERROR, the message with its line, 0 passed, no runtime', () => {
    const graded = gradeSubmit(tests('1\n', '2\n'), { compile: { ok: false, message: 'SyntaxError: invalid syntax', line: 3 }, results: [] });
    expect(graded).toEqual({
      verdict: 'COMPILATION_ERROR',
      errorMessage: 'Line 3: SyntaxError: invalid syntax',
      testsPassed: 0,
      totalTests: 2,
    });
  });

  test.each([
    ['RUNTIME_ERROR', crash()],
    ['TIME_LIMIT_EXCEEDED', timeout()],
    ['WRONG_ANSWER', ok('wrong\n')],
  ])('the first failing test decides the stored verdict: %s', (verdict, failure) => {
    const graded = gradeSubmit(tests('1\n', '2\n', '3\n'), passed([ok('1\n'), failure]));
    expect(graded).toMatchObject({ verdict, failedTestNumber: 2, testsPassed: 1, totalTests: 3 });
  });

  test('5.2: passes tests 1 and 2, then times out on test 3: TIME_LIMIT_EXCEEDED with testsPassed 2', () => {
    const graded = gradeSubmit(tests('1\n', '2\n', '3\n', '4\n', '5\n'), passed([ok('1\n'), ok('2\n'), timeout(2050)]));
    expect(graded).toEqual({ verdict: 'TIME_LIMIT_EXCEEDED', failedTestNumber: 3, testsPassed: 2, totalTests: 5, runtimeMs: 2050 });
  });

  test('5.2: failing a sample and also a hidden test stores the type of the sample failure', () => {
    // Test 1 is the sample (wrong output, so the runner goes on); test 2 is hidden and crashes.
    const graded = gradeSubmit(tests('1\n', '2\n', '3\n'), passed([ok('9\n'), crash()]));
    expect(graded).toMatchObject({ verdict: 'WRONG_ANSWER', failedTestNumber: 1, testsPassed: 0 });
  });

  test('a wrong answer does not stop the runner, so later passing tests still count as passed', () => {
    const graded = gradeSubmit(tests('1\n', '2\n', '3\n'), passed([ok('1\n'), ok('x\n'), ok('3\n')]));
    expect(graded).toMatchObject({ verdict: 'WRONG_ANSWER', failedTestNumber: 2, testsPassed: 2 });
  });

  test('a runner that returns fewer results than tests without a failure is a runner failure', () => {
    expect(() => gradeSubmit(tests('1\n', '2\n'), passed([ok('1\n')]))).toThrow(RunnerUnavailableError);
  });

  test('a runner that returns more results than tests is a runner failure', () => {
    expect(() => gradeSubmit(tests('1\n'), passed([ok('1\n'), ok('2\n')]))).toThrow(RunnerUnavailableError);
  });
});

describe('5.2: Run calculation', () => {
  const samples = [
    { input: '1 2\n', output: '3\n' },
    { input: '5 5\n', output: '10\n' },
  ];

  test('every sample is listed with input, expected, actual, passed, status and error', () => {
    const graded = gradeRun(samples, passed([ok('3\n'), { ...crash('Traceback ...\nValueError: bad\n'), stdout: 'partial' }]));
    expect(graded).toEqual({
      verdict: 'RUNTIME_ERROR',
      compilation: null,
      results: [
        { input: '1 2\n', expected: '3\n', actual: '3\n', passed: true, status: 'OK', error: null },
        { input: '5 5\n', expected: '10\n', actual: 'partial', passed: false, status: 'RUNTIME_ERROR', error: 'Traceback ...\nValueError: bad\n' },
      ],
      testsPassed: 1,
      totalTests: 2,
    });
  });

  test('every sample passing gives the RUN event verdict ACCEPTED', () => {
    expect(gradeRun(samples, passed([ok('3\n'), ok('10\n')]))).toMatchObject({ verdict: 'ACCEPTED', testsPassed: 2 });
  });

  test('stderr of an OK program is shown as error', () => {
    const graded = gradeRun(samples.slice(0, 1), passed([{ ...ok('3\n'), stderr: 'debug: n = 3\n' }]));
    expect(graded.results[0]).toMatchObject({ passed: true, error: 'debug: n = 3\n' });
  });

  test('a syntax error gives compilation with the message and line, and no results', () => {
    const graded = gradeRun(samples, { compile: { ok: false, message: "SyntaxError: expected ':'", line: 2 }, results: [] });
    expect(graded).toEqual({
      verdict: 'COMPILATION_ERROR',
      compilation: { message: "Line 2: SyntaxError: expected ':'" },
      results: [],
      testsPassed: 0,
      totalTests: 2,
    });
  });

  test('actual and error are cut at 10,000 characters with "(truncated)" added; exactly 10,000 is not cut', () => {
    const max = limits.RUN_OUTPUT_DISPLAY_MAX_CHARS;
    const long = 'x'.repeat(max + 1);
    const exact = 'y'.repeat(max);
    const graded = gradeRun(samples, passed([{ ...ok(long), stderr: long }, { ...ok(exact), stderr: exact }]));
    expect(graded.results[0].actual).toBe(`${'x'.repeat(max)}\n(truncated)`);
    expect(graded.results[0].error).toBe(`${'x'.repeat(max)}\n(truncated)`);
    expect(graded.results[1].actual).toBe(exact);
    expect(graded.results[1].error).toBe(exact);
  });

  test('a runner that skips samples on a Run is a runner failure', () => {
    expect(() => gradeRun(samples, passed([crash()]))).toThrow(RunnerUnavailableError);
  });
});

describe('5.2: other details', () => {
  test('a compile error without a line shows only the message', () => {
    expect(compileMessage({ message: 'ValueError: source code string cannot contain null bytes', line: null })).toBe(
      'ValueError: source code string cannot contain null bytes'
    );
    expect(compileMessage({ message: 'SyntaxError: invalid syntax', line: 7 })).toBe('Line 7: SyntaxError: invalid syntax');
  });

  test('every input ends with a newline before it is fed to stdin', () => {
    expect(withFinalNewline('1 2')).toBe('1 2\n');
    expect(withFinalNewline('1 2\n')).toBe('1 2\n');
    expect(withFinalNewline('')).toBe('\n');
  });
});
