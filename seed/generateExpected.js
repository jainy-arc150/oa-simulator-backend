// Spec 7.5, step 2 of the seed pipeline: runs each valid problem's reference solution through
// runTests on every sample and hidden input, and writes the normalized outputs (spec 5.2) to
// seed/expected/<slug>.json. A reference that fails or times out stops the script.
// Run: npm run seed:generate
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const normalizeOutput = require('../src/utils/normalizeOutput');
const {
  DEFAULT_SEED_DIR,
  defaultExpectedDir,
  listSlugs,
  problemFile,
  solutionFile,
  checkProblem,
  runReference,
  referenceErrors,
  referenceFailed,
} = require('./validateProblems');

const expectedFile = (expectedDir, slug) => path.join(expectedDir, `${slug}.json`);

// Ties the outputs to the exact problem file and reference solution they came from, so outputs
// that are out of date are never imported.
function fingerprint(seedDir, slug) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(problemFile(seedDir, slug)))
    .update('\0')
    .update(fs.readFileSync(solutionFile(seedDir, slug)))
    .digest('hex');
}

async function generateAll({ seedDir = DEFAULT_SEED_DIR, expectedDir = defaultExpectedDir(seedDir) } = {}) {
  fs.mkdirSync(expectedDir, { recursive: true });
  const results = [];
  for (const slug of listSlugs(seedDir)) {
    const target = expectedFile(expectedDir, slug);
    const { data, errors } = checkProblem(seedDir, slug);
    if (errors.length > 0) {
      // An invalid problem keeps no outputs, so it can never be imported.
      fs.rmSync(target, { force: true });
      results.push({ slug, status: 'invalid', errors });
      continue;
    }

    // Taken before running, so an edit made during the run leaves the outputs out of date.
    const print = fingerprint(seedDir, slug);
    const run = await runReference(seedDir, data);
    const runErrors = referenceErrors(data, run);
    if (referenceFailed(run)) {
      fs.rmSync(target, { force: true });
      results.push({ slug, status: 'failed', errors: runErrors });
      return { results, stopped: true, ok: false };
    }
    if (runErrors.length > 0) {
      // It ran correctly but too slowly: a validation failure, not a reason to stop.
      fs.rmSync(target, { force: true });
      results.push({ slug, status: 'invalid', errors: runErrors });
      continue;
    }

    const outputs = run.outcome.results.map((result) => normalizeOutput(result.stdout));
    const sampleCount = data.samples.length;
    const expected = {
      slug,
      fingerprint: print,
      samples: outputs.slice(0, sampleCount),
      hiddenTests: outputs.slice(sampleCount),
    };
    fs.writeFileSync(target, `${JSON.stringify(expected)}\n`);
    results.push({ slug, status: 'generated', errors: [] });
  }
  return { results, stopped: false, ok: results.every((result) => result.status === 'generated') };
}

async function main() {
  const { results, stopped, ok } = await generateAll();
  for (const { slug, status, errors } of results) {
    if (status === 'generated') console.log(`ok       ${slug}`);
    errors.forEach((error) => console.log(`${status === 'failed' ? 'STOPPED' : 'SKIPPED'}  ${slug}: ${error}`));
  }
  const generated = results.filter((result) => result.status === 'generated').length;
  console.log(`${generated} problems have expected outputs${stopped ? '; stopped at the failing reference solution' : ''}`);
  process.exitCode = ok ? 0 : 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`generateExpected stopped: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { generateAll, fingerprint, expectedFile };
