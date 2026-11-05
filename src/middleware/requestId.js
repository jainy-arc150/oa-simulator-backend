const { randomUUID } = require('crypto');

// Section 6.3: Every response carries an X-Request-Id header (a UUID)

function requestIdMiddleware(req, res, next) {
  const requestId = randomUUID();
  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}

module.exports = requestIdMiddleware;
