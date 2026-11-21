const { Streak } = require('../models');
const { dayKey, diffDays, addDays } = require('../lib/dates');
const settings = require('./settings');

// The streak currently "alive" for display: if the last qualifying day is older than
// yesterday the streak has been broken, even if no activity has triggered the reset yet (FR-105).
function effective(doc, today) {
  if (!doc || !doc.lastQualifyingDate) return { current: 0, longest: doc ? doc.longestStreak : 0, activeToday: false };
  const gap = diffDays(today, doc.lastQualifyingDate);
  return {
    current: gap <= 1 ? doc.currentStreak : 0,
    longest: doc.longestStreak,
    activeToday: gap === 0
  };
}

async function getStreak(studentId, now = new Date()) {
  const cfg = await settings.get();
  const today = dayKey(now, cfg.timezone);
  const doc = await Streak.findOne({ studentId }).lean();
  const eff = effective(doc, today);
  const recent = (doc && doc.recentDays) || [];
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const k = addDays(today, -i);
    week.push({ date: k, active: recent.includes(k), today: i === 0 });
  }
  return {
    currentStreak: eff.current,
    longestStreak: eff.longest,
    activeToday: eff.activeToday,
    lastQualifyingDate: doc ? doc.lastQualifyingDate : null,
    streakStartDate: doc ? doc.streakStartDate : null,
    timezone: cfg.timezone,
    today,
    week
  };
}

// Register a qualifying activity (lesson / quiz submission / validated quest). At most one streak
// day per calendar day (FR-107). Uses an optimistic compare-and-set so concurrent requests
// cannot double-count a day.
async function recordQualifyingActivity(studentId, now = new Date()) {
  const cfg = await settings.get();
  const today = dayKey(now, cfg.timezone);

  for (let attempt = 0; attempt < 3; attempt++) {
    let doc = await Streak.findOne({ studentId }).lean();

    if (!doc) {
      try {
        const created = await Streak.create({
          studentId,
          currentStreak: 1,
          longestStreak: 1,
          lastQualifyingDate: today,
          streakStartDate: today,
          recentDays: [today],
          timezone: cfg.timezone
        });
        return { changed: true, current: 1, longest: 1, startDate: today, doc: created.toObject() };
      } catch (err) {
        if (err.code === 11000) continue; // raced with another request - re-read
        throw err;
      }
    }

    if (doc.lastQualifyingDate === today) {
      return { changed: false, current: doc.currentStreak, longest: doc.longestStreak, startDate: doc.streakStartDate, doc };
    }

    const gap = doc.lastQualifyingDate ? diffDays(today, doc.lastQualifyingDate) : Infinity;
    const continues = gap === 1;
    const current = continues ? doc.currentStreak + 1 : 1; // missed day => reset to 1 (configured rule)
    const longest = Math.max(doc.longestStreak, current);
    const startDate = continues ? doc.streakStartDate || today : today;
    const recentDays = [...(doc.recentDays || []).filter((d) => diffDays(today, d) < 30), today];

    const res = await Streak.updateOne(
      { studentId, lastQualifyingDate: doc.lastQualifyingDate },
      { $set: { currentStreak: current, longestStreak: longest, lastQualifyingDate: today, streakStartDate: startDate, recentDays, timezone: cfg.timezone } }
    );
    if (res.modifiedCount === 1) {
      return { changed: true, current, longest, startDate, doc: { ...doc, currentStreak: current, longestStreak: longest } };
    }
    // someone else updated first: loop and re-read
  }
  const doc = await Streak.findOne({ studentId }).lean();
  return { changed: false, current: doc.currentStreak, longest: doc.longestStreak, startDate: doc.streakStartDate, doc };
}

module.exports = { getStreak, recordQualifyingActivity, effective };
