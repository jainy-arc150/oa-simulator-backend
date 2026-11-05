const AppError = require('../errors/AppError');

// Section 6.2: An unknown route returns 404 NOT_FOUND

function notFoundMiddleware(req, res, next) {
  const error = new AppError('NOT_FOUND', 404, 'Route not found');
  next(error);
}

module.exports = notFoundMiddleware;
