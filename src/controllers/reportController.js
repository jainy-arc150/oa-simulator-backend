const reportService = require('../services/reportService');

// E16
async function get(req, res) {
  res.status(200).json(await reportService.getReport(req.user._id, req.params.id, req.log));
}

module.exports = { get };
