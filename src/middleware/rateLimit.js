const rateLimit = require('express-rate-limit');
const AppError = require('../errors/AppError');
const limits = require('../config/limits');

// Spec 6.4: register and login, 10 requests per minute per IP, counted in memory.
// A new limiter has its own counters, so each app instance starts fresh.
function createAuthLimiter() {
  return rateLimit({
    windowMs: limits.RATE_LIMIT_WINDOW_MS,
    limit: limits.AUTH_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next) => next(new AppError('TOO_MANY_REQUESTS', 429, 'Too many requests, try again later')),
  });
}

module.exports = { createAuthLimiter };
