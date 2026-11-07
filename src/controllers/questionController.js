const questionService = require('../services/questionService');

// E12
async function open(req, res) {
  const { id, index } = req.params;
  res.status(200).json(await questionService.openQuestion(req.user._id, id, index, req.log));
}

// E13
async function saveCode(req, res) {
  const { id, index } = req.params;
  await questionService.saveCode(req.user._id, id, index, req.body.code, req.log);
  res.status(204).end();
}

module.exports = { open, saveCode };
