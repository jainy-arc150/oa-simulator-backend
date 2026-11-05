// Section 6.3: Application code throws AppError carrying code, HTTP status, message and details

class AppError extends Error {
  constructor(code, status, message, details = undefined) {
    super(message);
    this.code = code;
    this.status = status;
    this.message = message;
    this.details = details;
    this.name = 'AppError';
  }
}

module.exports = AppError;
