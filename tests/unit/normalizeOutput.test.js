const normalizeOutput = require('../../src/utils/normalizeOutput');

// Spec 5.2: both sides are normalized the same way, then compared exactly.
const same = (actual, expected) => normalizeOutput(actual) === normalizeOutput(expected);

describe('normalizeOutput (spec 5.2)', () => {
  test('5.2: trailing spaces and extra trailing blank lines pass', () => {
    expect(same('5', '5')).toBe(true);
    expect(same(' 5  ', ' 5')).toBe(true);
    expect(same('5\n\n\n', '5')).toBe(true);
    expect(same('1 2 \t\n3\t\n\n', '1 2\n3')).toBe(true);
  });

  test('5.2: leading spaces, wrong case and doubled inner spaces fail', () => {
    expect(same('  5 ', '5')).toBe(false);
    expect(same('yes', 'Yes')).toBe(false);
    expect(same('1  2', '1 2')).toBe(false);
  });

  test('5.2: a different number, split lines, nothing printed and extra output fail', () => {
    expect(same('5', '6')).toBe(false);
    expect(same('1\n2', '1 2')).toBe(false);
    expect(same('', '5')).toBe(false);
    expect(same('debug\n5', '5')).toBe(false);
  });

  test('5.2: CRLF output equals the same text with LF, and old Mac CR does too', () => {
    expect(same('1 2\r\n3\r\n', '1 2\n3\n')).toBe(true);
    expect(same('1 2\r3\r', '1 2\n3')).toBe(true);
  });

  test('returns the canonical form: LF line ends, no trailing spaces, no trailing blank lines', () => {
    expect(normalizeOutput('a \r\nb\t\r\n\r\n\n')).toBe('a\nb');
    expect(normalizeOutput('5\n')).toBe('5');
    expect(normalizeOutput('')).toBe('');
    expect(normalizeOutput('\n\n')).toBe('');
  });

  test('blank lines and spaces inside the output are kept', () => {
    expect(normalizeOutput('a\n\nb\n')).toBe('a\n\nb');
    expect(normalizeOutput('  a\n')).toBe('  a');
  });
});
