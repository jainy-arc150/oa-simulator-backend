const AppError = require('../errors/AppError');
const pino = require('pino');

const logger = pino();

// Section 6.3: One central error middleware turns AppError into standard JSON
// Any other error returns 500 INTERNAL_ERROR with generic message

function errorHandler(err, req, res, next) {
  let error = err;

  // Handle Express JSON parsing errors
  if (err instanceof SyntaxError && 'body' in err) {
    error = new AppError('VALIDATION_ERROR', 400, 'Malformed JSON');
  }

  // Handle Mongoose duplicate key error (section 6.3)
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    if (field === 'email') {
      error = new AppError('EMAIL_TAKEN', 409, 'This email is already registered');
    } else {
      error = new AppError('DUPLICATE_KEY', 409, `Duplicate value for ${field}`);
    }
  }

  // Handle validation errors
  if (err.name === 'ValidationError') {
    const details = Object.entries(err.errors).map(([field, err]) => ({
      field,
      message: err.message,
    }));
    error = new AppError('VALIDATION_ERROR', 400, 'Invalid input', details);
  }

  // Handle Mongoose CastError (invalid ObjectId)
  if (err.name === 'CastError') {
    error = new AppError('NOT_FOUND', 404, 'Resource not found');
  }

  // Convert to AppError if it's not already
  if (!(error instanceof AppError)) {
    // Log the full error for debugging
    logger.error({ requestId: req.id, error: err }, 'Unhandled error');
    error = new AppError('INTERNAL_ERROR', 500, 'Something went wrong');
  }

  // Log the error
  const status = error.status || 500;
  const logData = {
    requestId: req.id,
    code: error.code,
    status,
    message: error.message,
  };
  if (status >= 500) {
    logger.error(logData);
  } else {
    logger.warn(logData);
  }

  // Send response (section 4.2: every error returns { error: { code, message, details? } })
  const response = {
    error: {
      code: error.code,
      message: error.message,
    },
  };

  if (error.details) {
    response.error.details = error.details;
  }

  res.status(status).json(response);
}

module.exports = errorHandler;
