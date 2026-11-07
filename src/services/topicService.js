const limits = require('../config/limits');
const Problem = require('../models/Problem');

const DIFFICULTIES = Object.keys(limits.DIFFICULTY_TABLE);

// E5 (spec 4.4): counts approved problems per topic and difficulty. Topics with no approved problem
// are left out. Only topics in TOPICS are listed, in the order of TOPICS. The query returns counts
// only, so no problem field (and never hiddenTests) is read.
async function listTopics() {
  const groups = await Problem.aggregate([
    { $match: { status: 'approved', topic: { $in: limits.TOPICS } } },
    { $group: { _id: { topic: '$topic', difficulty: '$difficulty' }, count: { $sum: 1 } } },
  ]);

  const counts = new Map();
  for (const { _id, count } of groups) {
    if (!counts.has(_id.topic)) counts.set(_id.topic, Object.fromEntries(DIFFICULTIES.map((d) => [d, 0])));
    counts.get(_id.topic)[_id.difficulty] = count;
  }

  return limits.TOPICS.filter((topic) => counts.has(topic)).map((topic) => ({ topic, ...counts.get(topic) }));
}

module.exports = { listTopics };
