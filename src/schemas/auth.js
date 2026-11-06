const { z } = require('zod');
const limits = require('../config/limits');

const name = z.string().trim().min(limits.NAME_LENGTH_MIN).max(limits.NAME_LENGTH_MAX);

const email = z.string().trim().toLowerCase().max(limits.EMAIL_LENGTH_MAX).email();

// Spec 6.1, 6.2: 8 to 72 bytes (72 is the bcrypt limit).
const password = z.string().refine(
  (value) => {
    const bytes = Buffer.byteLength(value, 'utf8');
    return bytes >= limits.PASSWORD_BYTES_MIN && bytes <= limits.PASSWORD_BYTES_MAX;
  },
  { message: `must be ${limits.PASSWORD_BYTES_MIN} to ${limits.PASSWORD_BYTES_MAX} bytes long` }
);

// z.object removes unknown fields.
const registerSchema = z.object({ name, email, password });
const loginSchema = z.object({ email, password });

module.exports = { registerSchema, loginSchema };
