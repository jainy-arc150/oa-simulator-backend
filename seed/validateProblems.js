// Spec 7.5, step 1 of the seed pipeline: checks every problem in seed/problems and prints each failure.
// Run: npm run seed:validate
const fs = require('fs');
const path = require('path');
const limits = require('../src/config/limits');
const Problem = require('../src/models/Problem');
const { runTests } = require('../src/runner');

const DEFAULT_SEED_DIR = __dirname;
const TEXT_FIELDS = ['slug', 'title', 'statement', 'inputFormat', 'outputFormat', 'constraints', 'topic', 'difficulty'];
const REQUIRED_FIELDS = [...TEXT_FIELDS, 'timeLimitMs', 'samples', 'hiddenInputs'];

const problemFile = (seedDir, slug) => path.join(seedDir, 'problems', `${slug}.json`);
const solutionFile = (seedDir, slug) => path.join(seedDir, 'solutions', `${slug}.py`);
const defaultExpectedDir = (seedDir) => path.join(seedDir, 'expected');

// Every problem is one file seed/problems/<slug>.json, so the slug is the file name.
function listSlugs(seedDir) {
  return fs
    .readdirSync(path.join(seedDir, 'problems'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
}

// Samples first, then hidden inputs: the order the tests run in (spec 5.2).
function testInputs(data) {
  return [
    ...data.samples.map((sample, i) => ({ label: `samples[${i}]`, input: sample.input })),
    ...data.hiddenInputs.map((input, i) => ({ label: `hiddenInputs[${i}]`, input })),
  ];
}

// The document seedProblems saves. `outputs` holds the generated outputs; validation passes empty ones.
function toDocument(data, outputs) {
  return {
    slug: data.slug,
    title: data.title,
    statement: data.statement,
    inputFormat: data.inputFormat,
    outputFormat: data.outputFormat,
    constraints: data.constraints,
    topic: data.topic,
    difficulty: data.difficulty,
    timeLimitMs: data.timeLimitMs,
    samples: data.samples.map((sample, i) => ({ input: sample.input, output: outputs.samples[i], explanation: sample.explanation })),
    hiddenTests: data.hiddenInputs.map((input, i) => ({ input, output: outputs.hiddenTests[i] })),
    status: 'approved',
  };
}

function checkSamples(samples, errors) {
  samples.forEach((sample, i) => {
    if (!sample || typeof sample !== 'object' || Array.isArray(sample)) {
      errors.push(`samples[${i}] must be an object with input and explanation`);
      return;
    }
    if (typeof sample.input !== 'string') errors.push(`samples[${i}].input must be a string`);
    else if (!sample.input.endsWith('\n')) errors.push(`samples[${i}].input does not end with a newline`);
    if (typeof sample.explanation !== 'string' || sample.explanation.trim() === '') {
      errors.push(`samples[${i}].explanation is missing`);
    }
    if (sample.output !== undefined) errors.push(`samples[${i}] has an output; outputs are generated, never written by hand`);
  });
}

function checkHiddenInputs(hiddenInputs, errors) {
  hiddenInputs.forEach((input, i) => {
    if (typeof input !== 'string') errors.push(`hiddenInputs[${i}] must be a string`);
    else if (!input.endsWith('\n')) errors.push(`hiddenInputs[${i}] does not end with a newline`);
  });
}

function checkDuplicates(data, errors) {
  const firstSeen = new Map();
  for (const { label, input } of testInputs(data)) {
    if (typeof input !== 'string') continue;
    if (firstSeen.has(input)) errors.push(`${label} has the same input as ${firstSeen.get(input)}`);
    else firstSeen.set(input, label);
  }
}

// The field rules of spec 3.2 come from the Problem model itself, so they are written in one place.
function checkModelRules(data, reported, errors) {
  const empty = { samples: data.samples.map(() => ''), hiddenTests: data.hiddenInputs.map(() => '') };
  const invalid = new Problem(toDocument(data, empty)).validateSync();
  if (!invalid) return;
  for (const [field, error] of Object.entries(invalid.errors)) {
    const name = field.split('.')[0] === 'hiddenTests' ? 'hiddenInputs' : field.split('.')[0];
    if (!reported.has(name)) errors.push(`${name}: ${error.message.replace('hidden tests', 'hidden inputs')}`);
  }
}

// Every rule that can be checked without running code. Returns { slug, data, errors }.
function checkProblem(seedDir, slug) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(problemFile(seedDir, slug), 'utf8'));
  } catch (err) {
    return { slug, data: null, errors: ['the file is not valid JSON'] };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { slug, data: null, errors: ['the file must hold one JSON object'] };
  }

  const errors = [];
  const reported = new Set();
  const fail = (field, message) => {
    reported.add(field);
    errors.push(message);
  };

  for (const field of REQUIRED_FIELDS) {
    if (data[field] === undefined) fail(field, `${field} is missing`);
  }
  for (const field of TEXT_FIELDS) {
    if (data[field] !== undefined && (typeof data[field] !== 'string' || data[field].trim() === '')) {
      fail(field, `${field} must be a non-empty string`);
    }
  }
  if (data.timeLimitMs !== undefined && !Number.isInteger(data.timeLimitMs)) fail('timeLimitMs', 'timeLimitMs must be a whole number');
  if (typeof data.slug === 'string' && data.slug !== slug) fail('slug', `slug "${data.slug}" does not match the file name`);
  for (const field of ['samples', 'hiddenInputs']) {
    if (data[field] !== undefined && !Array.isArray(data[field])) fail(field, `${field} must be a list`);
  }
  if (!fs.existsSync(solutionFile(seedDir, slug))) errors.push(`the reference solution solutions/${slug}.py is missing`);

  if (Array.isArray(data.samples) && Array.isArray(data.hiddenInputs)) {
    const before = errors.length;
    checkSamples(data.samples, errors);
    checkHiddenInputs(data.hiddenInputs, errors);
    if (errors.length === before) {
      checkDuplicates(data, errors);
      checkModelRules(data, reported, errors);
    }
  }
  return { slug, data, errors };
}

// Runs the reference solution once on every input, samples first, stopping at the first failure.
async function runReference(seedDir, data) {
  const tests = testInputs(data);
  const outcome = await runTests({
    language: 'python',
    code: fs.readFileSync(solutionFile(seedDir, data.slug), 'utf8'),
    inputs: tests.map((test) => test.input),
    timeLimitMs: data.timeLimitMs,
    stopOnError: true,
  });
  return { outcome, labels: tests.map((test) => test.label) };
}

// Spec 7.5: the reference must run correctly and finish in under half of timeLimitMs on every input.
// Only the status and time are reported, never the program's output or error text (test data).
function referenceErrors(data, { outcome, labels }) {
  if (!outcome.compile.ok) return [`the reference solution has a syntax error on line ${outcome.compile.line}`];
  const budgetMs = data.timeLimitMs * limits.REFERENCE_TIME_FRACTION;
  const errors = [];
  outcome.results.forEach((result, i) => {
    if (result.status !== 'OK') {
      errors.push(`the reference solution gave ${result.status} on ${labels[i]}`);
    } else if (result.timeMs >= budgetMs) {
      errors.push(`the reference solution took ${result.timeMs} ms on ${labels[i]}; it must finish in under ${budgetMs} ms`);
    }
  });
  return errors;
}

// A reference that did not produce an output for every input (crash, time limit, syntax error).
const referenceFailed = ({ outcome, labels }) =>
  !outcome.compile.ok || outcome.results.length < labels.length || outcome.results.some((r) => r.status !== 'OK');

async function validateAll({ seedDir = DEFAULT_SEED_DIR, runReference: shouldRun = true } = {}) {
  const results = [];
  for (const slug of listSlugs(seedDir)) {
    const { data, errors } = checkProblem(seedDir, slug);
    if (errors.length === 0 && shouldRun) errors.push(...referenceErrors(data, await runReference(seedDir, data)));
    results.push({ slug, errors });
  }
  return { results, ok: results.every((result) => result.errors.length === 0) };
}

async function main() {
  const { results, ok } = await validateAll();
  for (const { slug, errors } of results) {
    if (errors.length === 0) console.log(`ok    ${slug}`);
    errors.forEach((error) => console.log(`FAIL  ${slug}: ${error}`));
  }
  const passed = results.filter((result) => result.errors.length === 0).length;
  console.log(`${passed} of ${results.length} problems passed validation`);
  process.exitCode = ok ? 0 : 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`validateProblems stopped: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_SEED_DIR,
  listSlugs,
  problemFile,
  solutionFile,
  defaultExpectedDir,
  toDocument,
  checkProblem,
  runReference,
  referenceErrors,
  referenceFailed,
  validateAll,
};
