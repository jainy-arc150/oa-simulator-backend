// Express 4 does not catch rejected promises. This sends them to the error middleware (spec 6.3).
function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}

module.exports = asyncHandler;
