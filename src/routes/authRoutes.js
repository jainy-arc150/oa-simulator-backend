const express = require('express');
const authController = require('../controllers/authController');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const { registerSchema, loginSchema } = require('../schemas/auth');

// One limiter is shared by register and login (spec 6.4), so it is passed in.
function createAuthRoutes(authLimiter) {
  const router = express.Router();

  router.post('/register', authLimiter, validate({ body: registerSchema }), asyncHandler(authController.register));
  router.post('/login', authLimiter, validate({ body: loginSchema }), asyncHandler(authController.login));
  router.get('/me', auth, authController.me);

  return router;
}

module.exports = createAuthRoutes;
