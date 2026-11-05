const AppError = require('../errors/AppError');

// Maps known non-AppError failures to an AppError (spec 6.2, 6.3).
function translate(err) {
  if (err instanceof AppError) return err;

  if (err.type === 'entity.parse.failed') {
    return new AppError('VALIDATION_ERROR', 400, 'Malformed JSON body');
  }
  if (err.type === 'entity.too.large') {
    return new AppError('CODE_TOO_LARGE', 413, 'Request body is too large');
  }
  if (err.code === 11000 && err.keyPattern && err.keyPattern.email) {
    return new AppError('EMAIL_TAKEN', 409, 'This email is already registered');
  }
  if (err.code === 11000 && err.keyPattern && err.keyPattern.user) {
    return new AppError('ACTIVE_ROUND_EXISTS', 409, 'You already have an active round');
  }
  return null;
}

// Central error middleware (spec 6.3): every error leaves as { error: { code, message, details? } }.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  let appError = translate(err);
  if (!appError) {
    appError = new AppError('INTERNAL_ERROR', 500, 'Something went wrong');
  }

  // The full error goes to the log under this request's id; the client only gets the generic message.
  if (appError.status >= 500) {
    req.log.error({ err }, 'request failed');
  }

  const body = { error: { code: appError.code, message: appError.message } };
  if (appError.details !== undefined) body.error.details = appError.details;
  res.status(appError.status).json(body);
}

module.exports = errorHandler;
