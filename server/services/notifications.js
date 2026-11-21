const { Notification } = require('../models');

// Create an in-app notification. A repeated dedupeKey is silently ignored.
async function notify(userId, { type = 'system', title, message = '', courseId = null, dedupeKey }) {
  try {
    const doc = await Notification.create({ userId, type, title, message, courseId, dedupeKey });
    return doc;
  } catch (err) {
    if (err && err.code === 11000) return null;
    throw err;
  }
}

async function notifyMany(userIds, payload) {
  for (const id of userIds) {
    await notify(id, { ...payload, dedupeKey: payload.dedupeKey ? `${payload.dedupeKey}` : undefined });
  }
}

module.exports = { notify, notifyMany };
