const mongoose = require('mongoose');
const env = require('./env');

async function connectDB() {
  await mongoose.connect(env.MONGODB_URI);
}

async function disconnectDB() {
  await mongoose.disconnect();
}

module.exports = { connectDB, disconnectDB };
