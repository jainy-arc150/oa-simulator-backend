const roundService = require('../services/roundService');
const roundStateService = require('../services/roundStateService');

// Services log the round events of spec 6.5 (created, started, finished) with this request's
// logger, so each line carries the request id. They never see req or res.

// E6
async function create(req, res) {
  res.status(201).json(await roundService.createRound(req.user._id, req.body, req.log));
}

// E7
async function list(req, res) {
  res.status(200).json(await roundService.listRounds(req.user._id, req.query, req.log));
}

// E8
async function get(req, res) {
  res.status(200).json(await roundService.getRound(req.user._id, req.params.id, req.log));
}

// E9
async function remove(req, res) {
  await roundService.deleteRound(req.user._id, req.params.id);
  res.status(204).end();
}

// E10
async function start(req, res) {
  res.status(200).json(await roundStateService.startRound(req.user._id, req.params.id, req.log));
}

// E11
async function finish(req, res) {
  res.status(200).json(await roundStateService.finishRound(req.user._id, req.params.id, req.log));
}

module.exports = { create, list, get, remove, start, finish };
