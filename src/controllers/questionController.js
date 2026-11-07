const gradingService = require('../services/gradingService');
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

// E14
async function run(req, res) {
  const { id, index } = req.params;
  res.status(200).json(await gradingService.runQuestion(req.user._id, id, index, req.body, req.log));
}

// E15
async function submit(req, res) {
  const { id, index } = req.params;
  res.status(200).json(await gradingService.submitQuestion(req.user._id, id, index, req.body, req.log));
}

module.exports = { open, saveCode, run, submit };
