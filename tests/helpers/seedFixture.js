const fs = require('fs');
const os = require('os');
const path = require('path');

// A throwaway seed folder (problems/, solutions/, expected/) in the temp directory, so the seed
// scripts can be tested without touching the real question bank.
function createSeedFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-seed-test-'));
  fs.mkdirSync(path.join(dir, 'problems'));
  fs.mkdirSync(path.join(dir, 'solutions'));
  const expectedDir = path.join(dir, 'expected');

  return {
    dir,
    expectedDir,
    writeProblem(slug, data) {
      fs.writeFileSync(path.join(dir, 'problems', `${slug}.json`), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    },
    writeSolution(slug, code) {
      fs.writeFileSync(path.join(dir, 'solutions', `${slug}.py`), code);
    },
    removeSolution(slug) {
      fs.rmSync(path.join(dir, 'solutions', `${slug}.py`));
    },
    expectedPath(slug) {
      return path.join(expectedDir, `${slug}.json`);
    },
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// A small valid problem: print a + b.
function validProblem(slug, overrides = {}) {
  return {
    slug,
    title: 'Add Two Numbers',
    statement: 'Read two integers and print their sum.',
    inputFormat: 'Line 1: two integers `a` and `b`, separated by a single space.',
    outputFormat: 'One integer: `a + b`.',
    constraints: '1 ≤ a, b ≤ 100',
    topic: 'math',
    difficulty: 'easy',
    timeLimitMs: 2000,
    samples: [{ input: '1 2\n', explanation: '1 + 2 = 3. Answer: 3.' }],
    hiddenInputs: ['3 4\n', '5 6\n', '7 8\n', '9 10\n', '11 12\n'],
    ...overrides,
  };
}

const ADD_TWO_SOLUTION = 'a, b = map(int, input().split())\nprint(a + b)\n';

module.exports = { createSeedFixture, validProblem, ADD_TWO_SOLUTION };
