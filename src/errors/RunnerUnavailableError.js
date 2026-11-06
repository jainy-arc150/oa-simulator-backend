// Thrown when the runner itself fails (Python not found, no temp folder, queue full, ...).
// It is never returned as a result, so it cannot be mistaken for a student error (spec 5.1).
class RunnerUnavailableError extends Error {
  constructor(message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'RunnerUnavailableError';
  }
}

module.exports = RunnerUnavailableError;
