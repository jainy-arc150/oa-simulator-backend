const rateLimit = require('express-rate-limit');
const AppError = require('../errors/AppError');
const limits = require('../config/limits');
const authService = require('../services/authService');

// Spec 6.4: general limits that protect the server, counted in memory. A new limiter has its own
// counters, so each app instance starts fresh. Going over the limit returns 429 TOO_MANY_REQUESTS
// with a Retry-After header.
const tooManyRequests = (req, res, next) => next(new AppError('TOO_MANY_REQUESTS', 429, 'Too many requests, try again later'));

// Register and login: 10 requests per minute per IP address.
function createAuthLimiter() {
  return rateLimit({
    windowMs: limits.RATE_LIMIT_WINDOW_MS,
    limit: limits.AUTH_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    handler: tooManyRequests,
  });
}

// The paths, under /api, that have their own limiter above.
const AUTH_LIMITED_PATHS = new Set(['/auth/register', '/auth/login']);
const normalizedPath = (path) => path.toLowerCase().replace(/\/+$/, '');

// Every other /api endpoint: 200 requests per minute per user id, or per IP address when the
// request has no valid token. Only the token's signature and expiry are checked here.
function createApiLimiter() {
  return rateLimit({
    windowMs: limits.RATE_LIMIT_WINDOW_MS,
    limit: limits.API_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => AUTH_LIMITED_PATHS.has(normalizedPath(req.path)),
    keyGenerator: (req) => {
      const match = /^Bearer (.+)$/.exec(req.headers.authorization || '');
      const userId = match ? authService.verifyToken(match[1]) : null;
      return userId ? `user:${userId}` : `ip:${req.ip}`;
    },
    handler: tooManyRequests,
  });
}

module.exports = { createAuthLimiter, createApiLimiter };
