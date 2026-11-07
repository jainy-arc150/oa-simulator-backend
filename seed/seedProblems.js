// Spec 7.5, step 3 of the seed pipeline: upserts each problem by slug into MongoDB with status
// approved. A problem that failed validation or generation is never imported, and problems are
// never deleted. Running it twice gives no duplicates.
// Run: npm run seed:import
const fs = require('fs');
const Problem = require('../src/models/Problem');
const { connectDB, waitForIndexes, disconnectDB } = require('../src/config/db');
const { DEFAULT_SEED_DIR, defaultExpectedDir, listSlugs, checkProblem, toDocument } = require('./validateProblems');
const { fingerprint, expectedFile } = require('./generateExpected');

const isTextList = (value, length) =>
  Array.isArray(value) && value.length === length && value.every((item) => typeof item === 'string');

// Returns the generated outputs, or the reason they cannot be used.
function readExpected(seedDir, expectedDir, slug, data) {
  let expected;
  try {
    expected = JSON.parse(fs.readFileSync(expectedFile(expectedDir, slug), 'utf8'));
  } catch (err) {
    return { reason: 'no expected outputs; run npm run seed:generate first' };
  }
  if (!expected || expected.fingerprint !== fingerprint(seedDir, slug)) {
    return { reason: 'the expected outputs are out of date; run npm run seed:generate again' };
  }
  if (!isTextList(expected.samples, data.samples.length) || !isTextList(expected.hiddenTests, data.hiddenInputs.length)) {
    return { reason: 'the expected outputs do not match the tests; run npm run seed:generate again' };
  }
  return { outputs: expected };
}

// Expects an open mongoose connection.
async function seedAll({ seedDir = DEFAULT_SEED_DIR, expectedDir = defaultExpectedDir(seedDir) } = {}) {
  const results = [];
  for (const slug of listSlugs(seedDir)) {
    const { data, errors } = checkProblem(seedDir, slug);
    if (errors.length > 0) {
      results.push({ slug, status: 'skipped', reasons: errors });
      continue;
    }
    const { outputs, reason } = readExpected(seedDir, expectedDir, slug, data);
    if (!outputs) {
      results.push({ slug, status: 'skipped', reasons: [reason] });
      continue;
    }

    // Upsert by slug through a full document save, so every model rule of spec 3.2 runs.
    let problem = await Problem.findOne({ slug }).select('+hiddenTests');
    const created = !problem;
    if (created) problem = new Problem();
    problem.set(toDocument(data, outputs));
    try {
      await problem.save();
    } catch (err) {
      if (err.name !== 'ValidationError') throw err;
      results.push({ slug, status: 'skipped', reasons: Object.values(err.errors).map((e) => e.message) });
      continue;
    }
    results.push({ slug, status: created ? 'created' : 'updated', reasons: [] });
  }
  return { results, ok: results.every((result) => result.status !== 'skipped') };
}

async function main() {
  await connectDB();
  try {
    await waitForIndexes();
    const { results, ok } = await seedAll();
    for (const { slug, status, reasons } of results) {
      if (status !== 'skipped') console.log(`${status.padEnd(8)} ${slug}`);
      reasons.forEach((reason) => console.log(`SKIPPED  ${slug}: ${reason}`));
    }
    const imported = results.filter((result) => result.status !== 'skipped').length;
    console.log(`${imported} of ${results.length} problems imported`);
    process.exitCode = ok ? 0 : 1;
  } finally {
    await disconnectDB();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`seedProblems stopped: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { seedAll, readExpected };
