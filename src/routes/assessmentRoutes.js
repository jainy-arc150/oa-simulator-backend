const express = require('express');
const assessmentController = require('../controllers/assessmentController');
const questionController = require('../controllers/questionController');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const {
  noInput,
  createRoundBody,
  listRoundsQuery,
  roundParams,
  questionParams,
  saveCodeBody,
  attemptBody,
} = require('../schemas/assessments');

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
// E10 POST /api/assessments/:id/start
router.post(
  '/:id/start',
  auth,
  validate({ params: roundParams, body: noInput, query: noInput }),
  asyncHandler(assessmentController.start)
);
// E11 POST /api/assessments/:id/finish
router.post(
  '/:id/finish',
  auth,
  validate({ params: roundParams, body: noInput, query: noInput }),
  asyncHandler(assessmentController.finish)
);
// E12 POST /api/assessments/:id/questions/:index/open
router.post(
  '/:id/questions/:index/open',
  auth,
  validate({ params: questionParams, body: noInput, query: noInput }),
  asyncHandler(questionController.open)
);
// E13 PUT /api/assessments/:id/questions/:index/code
router.put(
  '/:id/questions/:index/code',
  auth,
  validate({ params: questionParams, body: saveCodeBody, query: noInput }),
  asyncHandler(questionController.saveCode)
);
// E14 POST /api/assessments/:id/questions/:index/run
router.post(
  '/:id/questions/:index/run',
  auth,
  validate({ params: questionParams, body: attemptBody, query: noInput }),
  asyncHandler(questionController.run)
);
// E15 POST /api/assessments/:id/questions/:index/submit
router.post(
  '/:id/questions/:index/submit',
  auth,
  validate({ params: questionParams, body: attemptBody, query: noInput }),
  asyncHandler(questionController.submit)
);

module.exports = router;
