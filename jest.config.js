module.exports = {
  testEnvironment: 'node',
  collectCoverageFrom: ['src/**/*.js', '!src/**/*.test.js'],
  testMatch: ['**/__tests__/**/*.js', '**/?(*.)+(spec|test).js'],
  setupFiles: ['<rootDir>/tests/jest-setup.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testTimeout: 10000,
  verbose: true,
};
