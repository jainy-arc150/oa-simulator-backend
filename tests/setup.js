// Jest setup file for all tests
// Configure test environment before running tests

// Suppress console output in tests unless explicitly needed
if (process.env.DEBUG !== 'true') {
  global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
  };
}
