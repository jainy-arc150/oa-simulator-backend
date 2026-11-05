const createApp = require('../../src/app');
const notFound = require('../../src/middleware/notFound');
const { createLogCapture } = require('./logCapture');

// The test file must contain:
//   jest.mock('../../src/middleware/notFound', () => jest.fn());
// Builds the real app. `handler` replaces the not-found middleware, so a test can run any code,
// or make a request fail, inside the real middleware chain and error handler.
// Without a handler the real not-found middleware is used.
function buildApp(handler) {
  notFound.mockImplementation(handler || jest.requireActual('../../src/middleware/notFound'));
  const capture = createLogCapture();
  return { app: createApp({ logStream: capture.stream }), logs: capture.lines };
}

module.exports = { buildApp };
