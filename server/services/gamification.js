const { StudentProfile, XpTransaction, Lesson, LessonProgress } = require('../models');
const { levelForXp, levelInfo } = require('../lib/levels');
const settings = require('./settings');
const streaks = require('./streaks');
const quests = require('./quests');
const achievements = require('./achievements');
const { notify } = require('./notifications');

class Rewards {
  constructor(studentId, xpStart) {
    this.studentId = studentId;
    this.xpStart = xpStart;
    this.lines = [];
    this.total = 0;
    this.badges = [];
    this.quests = [];
    this.streak = null;
    this.moduleCompleted = null;
  }
}

// The ONLY place XP is created. XP is never taken from the client (SRS 2.5, NFR-013).
// The unique eventKey makes this idempotent: the same reward event can never pay out twice,
// even if two requests race (FR-089, NFR-026).
async function awardXp(rc, { amount, sourceType, sourceId, courseId = null, description, eventKey }) {
  if (!(amount > 0)) return false;
  let tx;
  try {
    tx = await XpTransaction.create({ studentId: rc.studentId, amount, sourceType, sourceId: String(sourceId || ''), courseId, description, eventKey });
  } catch (err) {
    if (err && err.code === 11000) return false; // duplicate reward event - no XP
    throw err;
  }
  try {
    await StudentProfile.updateOne({ userId: rc.studentId }, { $inc: { xp: amount } });
  } catch (err) {
    // Compensate so the ledger and the total never disagree (NFR-027).
    await XpTransaction.deleteOne({ _id: tx._id }).catch(() => {});
    throw err;
  }
  rc.lines.push({ label: description, xp: amount });
  rc.total += amount;
  return true;
}

// Run the full reward pipeline for one qualifying learning activity.
//   evt = { studentId, courseId, kind: 'lesson'|'quiz', lesson?, quiz?, now? }
async function handleActivity(evt) {
  const cfg = await settings.get();
  const now = evt.now || new Date();
  const profile = await StudentProfile.findOne({ userId: evt.studentId }).lean();
  const rc = new Rewards(evt.studentId, profile ? profile.xp : 0);
  const award = (o) => awardXp(rc, { courseId: evt.courseId, ...o });
  const sid = String(evt.studentId);

  // 1) Base XP for the activity itself
  let moduleDone = null;
  if (evt.kind === 'lesson') {
    const l = evt.lesson;
    await award({ amount: cfg.xp.lesson, sourceType: 'lesson', sourceId: l.id, description: `Lesson · ${l.title}`, eventKey: `lesson:${l.id}:${sid}` });
    const ids = await Lesson.find({ moduleId: l.moduleId, status: 'published' }).distinct('_id');
    const doneCount = await LessonProgress.countDocuments({ studentId: evt.studentId, lessonId: { $in: ids } });
    if (ids.length > 0 && doneCount >= ids.length) {
      moduleDone = { id: String(l.moduleId), title: l.moduleTitle };
      await award({ amount: cfg.xp.module, sourceType: 'module', sourceId: String(l.moduleId), description: `Module complete · ${l.moduleTitle}`, eventKey: `module:${l.moduleId}:${sid}` });
      rc.moduleCompleted = moduleDone;
    }
  } else if (evt.kind === 'quiz' && evt.quiz.passed) {
    const q = evt.quiz;
    await award({ amount: cfg.xp.quizPass, sourceType: 'quiz_pass', sourceId: q.id, description: `Quiz passed · ${q.title}`, eventKey: `quiz-pass:${q.id}:${sid}` });
    if (q.score >= cfg.xp.quizBonusThreshold) {
      await award({ amount: cfg.xp.quizBonus, sourceType: 'quiz_bonus', sourceId: q.id, description: `High score bonus · ${cfg.xp.quizBonusThreshold}% or more`, eventKey: `quiz-bonus:${q.id}:${sid}` });
    }
  }

  // 2) Streak (lessons and quiz submissions qualify; opening the app does not)
  const st = await streaks.recordQualifyingActivity(evt.studentId, now);
  rc.streak = { current: st.current, longest: st.longest, extendedToday: st.changed };
  if (st.changed) {
    for (const m of cfg.streakMilestones) {
      if (st.current === m.days) {
        const paid = await award({ amount: m.xp, sourceType: 'streak', sourceId: String(m.days), description: `Streak · ${m.days} days in a row`, eventKey: `streak:${sid}:${m.days}:${st.startDate}` });
        if (paid) await notify(evt.studentId, { type: 'achievement', title: `${m.days}-day streak!`, message: `+${m.xp} XP for studying ${m.days} days in a row.`, dedupeKey: `streak:${m.days}:${st.startDate}` });
      }
    }
  }

  // 3) Quests
  const base = { courseId: evt.courseId, streakCurrent: st.current, lessonModuleId: evt.lesson ? String(evt.lesson.moduleId) : null };
  await quests.onEvent(rc, award, { ...base, kind: evt.kind, quiz: evt.quiz }, now);
  if (moduleDone) await quests.onEvent(rc, award, { ...base, kind: 'module', moduleId: moduleDone.id }, now);

  // 4) Achievements (after quests so "Quest Hunter" sees the quest we just completed)
  rc.badges = await achievements.evaluate(evt.studentId, award);

  // 5) Level progression
  const after = await StudentProfile.findOne({ userId: evt.studentId }).lean();
  const xpEnd = after ? after.xp : rc.xpStart;
  const before = levelForXp(rc.xpStart, cfg.levelBase);
  const lvl = levelForXp(xpEnd, cfg.levelBase);
  if (lvl > before) {
    await notify(evt.studentId, { type: 'level', title: `Level up! You reached Level ${lvl}`, message: 'Your leaderboard position has been updated.', dedupeKey: `level:${lvl}` });
  }

  return {
    lines: rc.lines,
    total: rc.total,
    xp: { before: rc.xpStart, after: xpEnd },
    level: { before, after: lvl, leveledUp: lvl > before },
    badges: rc.badges,
    quests: rc.quests,
    streak: rc.streak,
    moduleCompleted: rc.moduleCompleted
  };
}

// Server-side validation path for POST /quests/:id/complete. Progress already satisfies the
// objective; this only finalises (idempotently) if the automatic pipeline hadn't yet.
async function claimQuest(studentId, quest, progress, now = new Date()) {
  const cfg = await settings.get();
  const profile = await StudentProfile.findOne({ userId: studentId }).lean();
  const rc = new Rewards(studentId, profile ? profile.xp : 0);
  const award = (o) => awardXp(rc, { courseId: quest.courseId, ...o });
  const done = await quests.finalize(rc, award, quest, progress, now);
  if (done) rc.badges = await achievements.evaluate(studentId, award);
  const after = await StudentProfile.findOne({ userId: studentId }).lean();
  const xpEnd = after ? after.xp : rc.xpStart;
  const before = levelForXp(rc.xpStart, cfg.levelBase);
  const lvl = levelForXp(xpEnd, cfg.levelBase);
  if (lvl > before) await notify(studentId, { type: 'level', title: `Level up! You reached Level ${lvl}`, message: 'Your leaderboard position has been updated.', dedupeKey: `level:${lvl}` });
  return { lines: rc.lines, total: rc.total, xp: { before: rc.xpStart, after: xpEnd }, level: { before, after: lvl, leveledUp: lvl > before }, badges: rc.badges, quests: rc.quests, streak: null, moduleCompleted: null };
}

async function getXpSummary(studentId) {
  const cfg = await settings.get();
  const profile = await StudentProfile.findOne({ userId: studentId }).lean();
  const xp = profile ? profile.xp : 0;
  return levelInfo(xp, cfg.levelBase);
}

// Repair tool: recompute the cached total from the immutable ledger.
async function reconcileXp(studentId) {
  const [row] = await XpTransaction.aggregate([{ $match: { studentId } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
  const total = row ? row.total : 0;
  await StudentProfile.updateOne({ userId: studentId }, { $set: { xp: total } });
  return total;
}

module.exports = { awardXp, handleActivity, claimQuest, getXpSummary, reconcileXp, Rewards };
