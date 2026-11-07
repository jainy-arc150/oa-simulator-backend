const express = require('express');
const topicController = require('../controllers/topicController');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const { listTopicsQuery } = require('../schemas/topics');

const router = express.Router();

// E5 GET /api/topics
router.get('/', auth, validate({ query: listTopicsQuery }), asyncHandler(topicController.list));

module.exports = router;
