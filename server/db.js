const mongoose = require('mongoose');
const config = require('./config');

mongoose.set('strictQuery', true);

async function connect(uri = config.mongoUri) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  // Make sure unique indexes (duplicate-reward protection!) exist before serving traffic.
  await mongoose.syncIndexes();
  return mongoose.connection;
}

async function disconnect() {
  await mongoose.disconnect();
}

module.exports = { connect, disconnect, mongoose };
