const mongoose = require('mongoose');
const env = require('./env');

async function connectDB() {
  try {
    await mongoose.connect(env.MONGODB_URI);
    console.log('MongoDB connected');
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    process.exit(1);
  }
}

async function waitForIndexes() {
  try {
    // This will be called after all models are defined
    // For now, just ensure Mongoose is ready
    await mongoose.connection.ensureIndexes();
  } catch (error) {
    console.error('Index creation error:', error.message);
    process.exit(1);
  }
}

async function disconnectDB() {
  try {
    await mongoose.disconnect();
    console.log('MongoDB disconnected');
  } catch (error) {
    console.error('MongoDB disconnection error:', error.message);
  }
}

module.exports = {
  connectDB,
  waitForIndexes,
  disconnectDB,
};
