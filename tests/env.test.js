/**
 * Tests for environment variable validation (section 6.6)
 *
 * These tests verify that environment variables are validated with zod
 * and that the schema accepts valid inputs.
 */

const { z } = require('zod');

describe('Environment Validation', () => {
  test('MONGODB_URI is required', () => {
    const envSchema = z.object({
      MONGODB_URI: z.string().url().or(z.string().startsWith('mongodb')),
    });

    expect(() => {
      envSchema.parse({});
    }).toThrow();
  });

  test('JWT_SECRET must be at least 32 characters', () => {
    const envSchema = z.object({
      JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    });

    expect(() => {
      envSchema.parse({ JWT_SECRET: 'short' });
    }).toThrow();
  });

  test('Valid environment variables pass validation', () => {
    const envSchema = z.object({
      NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
      PORT: z.coerce.number().int().positive().default(5000),
      MONGODB_URI: z.string().url().or(z.string().startsWith('mongodb')),
      JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    });

    const result = envSchema.parse({
      NODE_ENV: 'test',
      PORT: '5000',
      MONGODB_URI: 'mongodb://localhost:27017/oa-simulator',
      JWT_SECRET: 'valid-secret-key-that-is-long-enough-for-validation',
    });

    expect(result.MONGODB_URI).toBeDefined();
    expect(result.JWT_SECRET).toBeDefined();
    expect(result.PORT).toBe(5000);
  });

  test('Loaded env module has all expected properties', () => {
    const env = require('../src/config/env');

    expect(env).toHaveProperty('NODE_ENV');
    expect(env).toHaveProperty('PORT');
    expect(env).toHaveProperty('MONGODB_URI');
    expect(env).toHaveProperty('JWT_SECRET');
    expect(env).toHaveProperty('LOG_LEVEL');
  });
});
