const { Achievement, StudentAchievement, LessonProgress, QuizAttempt, QuestProgress, XpTransaction, Streak } = require('../models');
const { notify } = require('./notifications');

// Achievement conditions are data ({ metric, target }) not code, so new achievements can be added
// without touching the evaluator unless a brand-new metric is needed (SRS 6.5, FR-091/092).
const METRICS = {
  lessonsCompleted: (sid) => LessonProgress.countDocuments({ studentId: sid, completed: true }),
  perfectQuizzes: async (sid) => (await QuizAttempt.distinct('quizId', { studentId: sid, status: 'submitted', score: 100 })).length,
  highScoreQuizzes: async (sid) => (await QuizAttempt.distinct('quizId', { studentId: sid, status: 'submitted', score: { $gte: 90 } })).length,
  questsCompleted: (sid) => QuestProgress.countDocuments({ studentId: sid, completed: true }),
  modulesCompleted: (sid) => XpTransaction.countDocuments({ studentId: sid, sourceType: 'module' }),
  coursesActive: async (sid) => {
    const [a, b] = await Promise.all([
      LessonProgress.distinct('courseId', { studentId: sid }),
      QuizAttempt.distinct('courseId', { studentId: sid, status: 'submitted' })
    ]);
    return new Set([...a, ...b].map(String)).size;
  },
  bestStreak: async (sid) => {
    const s = await Streak.findOne({ studentId: sid }).lean();
    return s ? s.longestStreak : 0;
  }
};

async function metricValues(studentId, names) {
  const out = {};
  await Promise.all(
    [...new Set(names)].map(async (n) => {
      out[n] = METRICS[n] ? await METRICS[n](studentId) : 0;
    })
  );
  return out;
}

// Check every not-yet-unlocked achievement; unlock + notify the ones now satisfied.
async function evaluate(studentId, award) {
  const [all, owned] = await Promise.all([
    Achievement.find({ active: true }).lean(),
    StudentAchievement.find({ studentId }).lean()
  ]);
  const ownedIds = new Set(owned.map((o) => String(o.achievementId)));
  const pending = all.filter((a) => !ownedIds.has(String(a._id)));
  if (!pending.length) return [];

  const values = await metricValues(studentId, pending.map((a) => a.condition.metric));
  const unlocked = [];
  for (const a of pending) {
    if ((values[a.condition.metric] || 0) < a.condition.target) continue;
    try {
      await StudentAchievement.create({ studentId, achievementId: a._id });
    } catch (err) {
      if (err.code === 11000) continue; // already awarded by a concurrent request (FR-099)
      throw err;
    }
    unlocked.push({ id: String(a._id), title: a.title, icon: a.icon });
    await notify(studentId, { type: 'achievement', title: `Badge unlocked: ${a.title}`, message: a.description, dedupeKey: `ach:${a._id}` });
    if (a.xpReward > 0 && award) {
      await award({
        amount: a.xpReward,
        sourceType: 'achievement',
        sourceId: String(a._id),
        description: `Achievement · ${a.title}`,
        eventKey: `achievement:${a._id}:${studentId}`
      });
    }
  }
  return unlocked;
}

// All achievements with unlocked state + progress, for the badge collection (FR-096/097).
async function listForStudent(studentId) {
  const [all, owned] = await Promise.all([Achievement.find({ active: true }).sort({ createdAt: 1 }).lean(), StudentAchievement.find({ studentId }).lean()]);
  const ownedMap = new Map(owned.map((o) => [String(o.achievementId), o.unlockedAt]));
  const values = await metricValues(studentId, all.map((a) => a.condition.metric));
  return all.map((a) => {
    const unlockedAt = ownedMap.get(String(a._id)) || null;
    const raw = values[a.condition.metric] || 0;
    return {
      id: String(a._id),
      key: a.key,
      title: a.title,
      description: a.description,
      icon: a.icon,
      xpReward: a.xpReward,
      unlocked: !!unlockedAt,
      unlockedAt,
      progress: Math.min(raw, a.condition.target),
      target: a.condition.target
    };
  });
}

module.exports = { evaluate, listForStudent, METRICS };
