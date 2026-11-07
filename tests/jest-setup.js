// Test settings. These are fake values; no .env file is read for tests.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/oa-simulator-test';
process.env.JWT_SECRET = 'test-secret-key-that-is-at-least-32-chars';
process.env.LOG_LEVEL = 'info';

// supertest starts a fresh server on a new port for every request. Since Node 19 the global HTTP
// agent keeps connections alive, so a pooled connection to an earlier, closed server can be reused
// when a port comes round again, and the request fails with "socket hang up". Tests use plain
// connections instead.
const http = require('http');

http.globalAgent = new http.Agent({ keepAlive: false });
