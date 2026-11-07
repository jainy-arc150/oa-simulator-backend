const topicService = require('../services/topicService');

async function list(req, res) {
  res.status(200).json({ topics: await topicService.listTopics() });
}

module.exports = { list };
