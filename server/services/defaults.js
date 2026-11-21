const bcrypt = require('bcryptjs');
const { Achievement, Setting, User } = require('../models');
const settings = require('./settings');

// SRS 6.5 - the eight launch achievements. Conditions are data; metrics live in services/achievements.js.
const ACHIEVEMENTS = [
  { key: 'first_steps', title: 'First Steps', description: 'Complete your first lesson', icon: 'footsteps', condition: { metric: 'lessonsCompleted', target: 1 } },
  { key: 'perfect_score', title: 'Perfect Score', description: 'Get 100% on a quiz', icon: 'target', condition: { metric: 'perfectQuizzes', target: 1 } },
  { key: 'quiz_master', title: 'Quiz Master', description: 'Score 90%+ in five quizzes', icon: 'brain', condition: { metric: 'highScoreQuizzes', target: 5 } },
  { key: 'quest_hunter', title: 'Quest Hunter', description: 'Complete ten quests', icon: 'compass', condition: { metric: 'questsCompleted', target: 10 } },
  { key: 'knowledge_builder', title: 'Knowledge Builder', description: 'Complete 20 lessons', icon: 'book', condition: { metric: 'lessonsCompleted', target: 20 } },
  { key: 'consistency_champion', title: 'Consistency Champion', description: 'Keep a 7-day study streak', icon: 'flame', condition: { metric: 'bestStreak', target: 7 } },
  { key: 'explorer', title: 'Explorer', description: 'Complete learning activities in three courses', icon: 'map', condition: { metric: 'coursesActive', target: 3 } },
  { key: 'module_master', title: 'Module Master', description: 'Complete five modules', icon: 'layers', condition: { metric: 'modulesCompleted', target: 5 } }
];

async function ensureDefaults() {
  for (const a of ACHIEVEMENTS) {
    await Achievement.updateOne({ key: a.key }, { $setOnInsert: a }, { upsert: true });
  }
  if (!(await Setting.exists({ key: 'platform' }))) await settings.update({});

  // Accounts created before email verification existed are treated as verified, so nobody is locked out.
  await User.updateMany({ emailVerified: { $exists: false } }, { $set: { emailVerified: true } });

  // Optional bootstrap admin for fresh deployments: ADMIN_EMAIL + ADMIN_PASSWORD env vars.
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (ADMIN_EMAIL && ADMIN_PASSWORD && !(await User.exists({ role: 'admin' }))) {
    await User.create({ name: 'Administrator', email: ADMIN_EMAIL.toLowerCase(), role: 'admin', emailVerified: true, emailVerifiedAt: new Date(), passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12) });
    console.log(`[bootstrap] created admin account ${ADMIN_EMAIL}`);
  }
}

module.exports = { ensureDefaults, ACHIEVEMENTS };
