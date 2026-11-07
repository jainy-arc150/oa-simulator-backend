const { randomUUID } = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const env = require('../config/env');
const clock = require('../clock');
const AppError = require('../errors/AppError');
const User = require('../models/User');

// Compared against when the email is unknown, so a wrong email and a wrong password take about
// the same time (spec 6.1). Made once with the configured cost.
const DUMMY_HASH = bcrypt.hashSync(randomUUID(), env.BCRYPT_COST);

const unauthorized = () => new AppError('UNAUTHORIZED', 401, 'Authentication required');
const nowInSeconds = () => Math.floor(clock.now().getTime() / 1000);

function publicUser(user) {
  return { id: String(user._id), name: user.name, email: user.email };
}

// The token's issue time and expiry come from now() (spec 6.7), so tests can control time.
function issueToken(user) {
  return jwt.sign({ sub: String(user._id), iat: nowInSeconds() }, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.JWT_EXPIRES_IN,
  });
}

async function register({ name, email, password }) {
  if (await User.exists({ email })) {
    throw new AppError('EMAIL_TAKEN', 409, 'This email is already registered');
  }
  // If two requests pass the check above together, the unique index refuses the second one and
  // the error handler turns that into the same 409.
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_COST);
  const user = await User.create({ name, email, passwordHash });
  return { token: issueToken(user), user: publicUser(user) };
}

async function login({ email, password }) {
  const user = await User.findOne({ email }).select('+passwordHash');
  const matches = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !matches) {
    throw new AppError('INVALID_CREDENTIALS', 401, 'Invalid email or password');
  }
  return { token: issueToken(user), user: publicUser(user) };
}

// Checks a token's signature and expiry only, with no database call (spec 6.1). Returns the user
// id it holds, or null for a bad or expired token.
function verifyToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], clockTimestamp: nowInSeconds() });
  } catch (err) {
    return null;
  }
  if (typeof payload.exp !== 'number') return null;
  if (typeof payload.sub !== 'string' || !mongoose.isValidObjectId(payload.sub)) return null;
  return payload.sub;
}

// Returns the user for a Bearer token, or throws 401 UNAUTHORIZED for a bad or expired token
// or a user that no longer exists (spec 6.1).
async function authenticate(token) {
  const userId = verifyToken(token);
  if (!userId) throw unauthorized();

  const user = await User.findById(userId);
  if (!user) throw unauthorized();
  return user;
}

module.exports = { register, login, authenticate, verifyToken, publicUser };
