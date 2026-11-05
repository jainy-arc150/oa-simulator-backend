const { z } = require('zod');
require('dotenv').config();

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(5000),
    MONGODB_URI: z.string().min(1),
    JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
    JWT_EXPIRES_IN: z.string().min(1).default('1d'),
    BCRYPT_COST: z.coerce.number().int().min(10).max(12).default(10),
    CORS_ORIGIN: z.string().min(1).optional(),
    TRUST_PROXY: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    LOG_LEVEL: z.string().min(1).default('info'),
    PYTHON_BIN: z.string().min(1).default('python3'),
    RUNNER_CONCURRENCY: z.coerce.number().int().positive().default(2),
    RUNNER_QUEUE_MAX: z.coerce.number().int().positive().default(10),
    RUNNER_STDOUT_LIMIT_BYTES: z.coerce.number().int().positive().default(65536),
    RUNNER_STDERR_LIMIT_BYTES: z.coerce.number().int().positive().default(8192),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production' && !value.CORS_ORIGIN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGIN'],
        message: 'is required in production',
      });
    }
  });

const result = envSchema.safeParse(process.env);

if (!result.success) {
  const lines = result.error.issues.map((issue) => {
    const name = issue.path.join('.');
    const problem = issue.message === 'Required' ? 'is missing' : issue.message;
    return `  ${name}: ${problem}`;
  });
  console.error(`Invalid environment settings:\n${lines.join('\n')}`);
  process.exit(1);
}

module.exports = result.data;
