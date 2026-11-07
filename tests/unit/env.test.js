const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ENV_FILE = path.resolve(__dirname, '../../src/config/env.js');
const VALID = {
  MONGODB_URI: 'mongodb://127.0.0.1:27017/x',
  JWT_SECRET: 'a-valid-secret-that-is-at-least-32-chars',
};

// Loads the real env.js in a fresh process, because it validates and exits when it is required.
function loadEnv(settings) {
  const result = spawnSync(process.execPath, ['-e', `console.log(JSON.stringify(require(${JSON.stringify(ENV_FILE)})))`], {
    env: { PATH: process.env.PATH, ...settings },
    cwd: os.tmpdir(),
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('config/env.js (spec 6.6)', () => {
  test('valid settings load, with the documented defaults', () => {
    const { status, stdout } = loadEnv(VALID);
    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      NODE_ENV: 'development',
      PORT: 5000,
      JWT_EXPIRES_IN: '1d',
      BCRYPT_COST: 10,
      TRUST_PROXY: false,
      LOG_LEVEL: 'info',
      PYTHON_BIN: 'python3',
      RUNNER_CONCURRENCY: 2,
      RUNNER_QUEUE_MAX: 10,
      RUNNER_STDOUT_LIMIT_BYTES: 65536,
      RUNNER_STDERR_LIMIT_BYTES: 8192,
    });
  });

  test('TRUST_PROXY "false" is false and "true" is true', () => {
    expect(JSON.parse(loadEnv({ ...VALID, TRUST_PROXY: 'false' }).stdout).TRUST_PROXY).toBe(false);
    expect(JSON.parse(loadEnv({ ...VALID, TRUST_PROXY: 'true' }).stdout).TRUST_PROXY).toBe(true);
  });

  test('a missing MONGODB_URI exits with a non-zero code and names the setting', () => {
    const { status, stderr } = loadEnv({ JWT_SECRET: VALID.JWT_SECRET });
    expect(status).toBe(1);
    expect(stderr).toContain('MONGODB_URI');
  });

  test('a missing JWT_SECRET exits with a non-zero code and names the setting', () => {
    const { status, stderr } = loadEnv({ MONGODB_URI: VALID.MONGODB_URI });
    expect(status).toBe(1);
    expect(stderr).toContain('JWT_SECRET');
  });

  test('a JWT_SECRET shorter than 32 characters exits and names the setting', () => {
    const { status, stderr } = loadEnv({ ...VALID, JWT_SECRET: 'too-short' });
    expect(status).toBe(1);
    expect(stderr).toContain('JWT_SECRET');
  });

  test('CORS_ORIGIN is required in production only', () => {
    const missing = loadEnv({ ...VALID, NODE_ENV: 'production' });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('CORS_ORIGIN');
    expect(loadEnv({ ...VALID, NODE_ENV: 'production', CORS_ORIGIN: 'https://a.example' }).status).toBe(0);
    expect(loadEnv({ ...VALID, NODE_ENV: 'development' }).status).toBe(0);
  });

  test('6.1: CORS_ORIGIN is a comma-separated list of origins; unset means none', () => {
    const listed = JSON.parse(loadEnv({ ...VALID, CORS_ORIGIN: 'https://a.example, https://b.example ,' }).stdout);
    expect(listed.CORS_ORIGIN).toEqual(['https://a.example', 'https://b.example']);
    expect(JSON.parse(loadEnv(VALID).stdout).CORS_ORIGIN).toEqual([]);
  });

  test('6.1: a wildcard CORS_ORIGIN stops the server in production, with a clear message', () => {
    for (const value of ['*', 'https://a.example,*']) {
      const { status, stderr } = loadEnv({ ...VALID, NODE_ENV: 'production', CORS_ORIGIN: value });
      expect(status).toBe(1);
      expect(stderr).toContain('CORS_ORIGIN: cannot be * in production');
    }
    // An empty list in production is the same as a missing one.
    expect(loadEnv({ ...VALID, NODE_ENV: 'production', CORS_ORIGIN: ' , ' }).stderr).toContain('CORS_ORIGIN: is required in production');
  });

  test('6.6: .env.example lists exactly the settings that env.js reads', () => {
    const example = require('fs')
      .readFileSync(path.resolve(__dirname, '../../.env.example'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.split('=')[0]);
    const settings = Object.keys(JSON.parse(loadEnv(VALID).stdout));
    expect([...example].sort()).toEqual([...settings].sort());
  });

  test('BCRYPT_COST outside 10 to 12 is rejected', () => {
    expect(loadEnv({ ...VALID, BCRYPT_COST: '9' }).status).toBe(1);
    expect(loadEnv({ ...VALID, BCRYPT_COST: '13' }).status).toBe(1);
    expect(loadEnv({ ...VALID, BCRYPT_COST: '12' }).status).toBe(0);
  });

  test('an invalid NODE_ENV is rejected and reports every bad setting at once', () => {
    const { status, stderr } = loadEnv({ NODE_ENV: 'staging' });
    expect(status).toBe(1);
    expect(stderr).toContain('NODE_ENV');
    expect(stderr).toContain('MONGODB_URI');
    expect(stderr).toContain('JWT_SECRET');
  });
});
