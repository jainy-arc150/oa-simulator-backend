const roundService = require('../services/roundService');

// E6
async function create(req, res) {
  const round = await roundService.createRound(req.user._id, req.body);
  // Spec 6.5: the event is logged at info level with ids only.
  req.log.info({ roundId: round.id, userId: String(req.user._id) }, 'round created');
  res.status(201).json(round);
}

// E7
async function list(req, res) {
  res.status(200).json(await roundService.listRounds(req.user._id, req.query));
}

// E8
async function get(req, res) {
  res.status(200).json(await roundService.getRound(req.user._id, req.params.id));
}

// E9
async function remove(req, res) {
  await roundService.deleteRound(req.user._id, req.params.id);
  res.status(204).end();
}

module.exports = { create, list, get, remove };
