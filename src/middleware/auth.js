const AppError = require('../errors/AppError');
const authService = require('../services/authService');
const asyncHandler = require('../utils/asyncHandler');

// Spec 6.1: the token travels only in the Authorization: Bearer header.
const auth = asyncHandler(async (req, res, next) => {
  const match = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!match) throw new AppError('UNAUTHORIZED', 401, 'Authentication required');

  req.user = await authService.authenticate(match[1]);
  next();
});

module.exports = auth;
