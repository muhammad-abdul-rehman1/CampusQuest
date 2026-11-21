const config = require('../config');
const { Setting } = require('../models');

// Configurable XP values etc. (FR-090). Stored in one document so admins can tune them
// without a deploy; DEFAULTS mirror SRS 6.2.
const DEFAULTS = {
  xp: {
    lesson: 10,
    module: 75,
    quizPass: 30,
    quizBonus: 50,
    quizBonusThreshold: 90,
    dailyQuestSuggested: 25,
    weeklyQuestSuggested: 100
  },
  streakMilestones: [{ days: 7, xp: 100 }],
  levelBase: 100,
  timezone: config.timezone,
  allowInstructorSignup: true,
  leaderboardDefaultVisible: true,
  inactivityDays: 3
};

let cache = null;
let cachedAt = 0;
const TTL = 15000;

function merge(stored) {
  const s = stored || {};
  return {
    ...DEFAULTS,
    ...s,
    xp: { ...DEFAULTS.xp, ...(s.xp || {}) },
    streakMilestones: Array.isArray(s.streakMilestones) ? s.streakMilestones : DEFAULTS.streakMilestones
  };
}

async function get() {
  if (cache && Date.now() - cachedAt < TTL) return cache;
  const doc = await Setting.findOne({ key: 'platform' }).lean();
  cache = merge(doc && doc.value);
  cachedAt = Date.now();
  return cache;
}

async function update(patch) {
  const current = await get();
  const next = merge({ ...current, ...patch, xp: { ...current.xp, ...(patch.xp || {}) } });
  await Setting.updateOne({ key: 'platform' }, { $set: { value: next } }, { upsert: true });
  cache = next;
  cachedAt = Date.now();
  return next;
}

function invalidate() {
  cache = null;
}

module.exports = { get, update, invalidate, DEFAULTS };
