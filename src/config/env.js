const { z } = require('zod');
require('dotenv').config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  MONGODB_URI: z.string().url().or(z.string().startsWith('mongodb')),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('1d'),
  BCRYPT_COST: z.coerce.number().int().min(10).max(12).default(10),
  CORS_ORIGIN: z.string().optional(),
  TRUST_PROXY: z.coerce.boolean().default(false),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  PYTHON_BIN: z.string().default('python3'),
  RUNNER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  RUNNER_QUEUE_MAX: z.coerce.number().int().positive().default(10),
  RUNNER_STDOUT_LIMIT_BYTES: z.coerce.number().int().positive().default(65536),
  RUNNER_STDERR_LIMIT_BYTES: z.coerce.number().int().positive().default(8192),
});

let env;

try {
  env = envSchema.parse(process.env);
} catch (error) {
  const issues = error.issues.map(issue => `${issue.path[0]}: ${issue.message}`).join('\n');
  console.error('Environment validation failed:\n' + issues);
  process.exit(1);
}

module.exports = env;
