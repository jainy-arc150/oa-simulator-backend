// Test settings. These are fake values; no .env file is read for tests.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/oa-simulator-test';
process.env.JWT_SECRET = 'test-secret-key-that-is-at-least-32-chars';
process.env.LOG_LEVEL = 'info';
