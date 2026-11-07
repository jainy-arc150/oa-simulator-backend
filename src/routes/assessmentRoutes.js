const express = require('express');
const assessmentController = require('../controllers/assessmentController');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const { noInput, createRoundBody, listRoundsQuery, roundParams } = require('../schemas/assessments');

const router = express.Router();

// E6 POST /api/assessments
router.post('/', auth, validate({ body: createRoundBody, query: noInput }), asyncHandler(assessmentController.create));
// E7 GET /api/assessments
router.get('/', auth, validate({ query: listRoundsQuery }), asyncHandler(assessmentController.list));
// E8 GET /api/assessments/:id
router.get('/:id', auth, validate({ params: roundParams, query: noInput }), asyncHandler(assessmentController.get));
// E9 DELETE /api/assessments/:id
router.delete(
  '/:id',
  auth,
  validate({ params: roundParams, body: noInput, query: noInput }),
  asyncHandler(assessmentController.remove)
);

module.exports = router;
