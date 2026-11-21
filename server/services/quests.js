const { Quest, QuestProgress, Enrollment } = require('../models');
const { dayKey, weekKey } = require('../lib/dates');
const { notify } = require('./notifications');
const settings = require('./settings');

// Daily quests reset each calendar day, weekly quests each ISO week, everything else is one-shot.
function periodKeyFor(quest, now, tz) {
  const day = dayKey(now, tz);
  if (quest.type === 'Daily') return day;
  if (quest.type === 'Weekly') return weekKey(day);
  return 'once';
}

function isOpen(quest, now) {
  if (quest.status !== 'active') return false;
  if (quest.availableFrom && new Date(quest.availableFrom) > now) return false;
  if (quest.deadline && new Date(quest.deadline) < now) return false; // expired quests can't progress (FR-079)
  return true;
}

// Does this activity move this quest forward, and by how much?
function increment(quest, evt) {
  const o = quest.objective;
  switch (o.kind) {
    case 'complete_lessons':
      return evt.kind === 'lesson' && (!o.moduleId || String(o.moduleId) === String(evt.lessonModuleId)) ? 1 : 0;
    case 'pass_quiz':
      return evt.kind === 'quiz' && evt.quiz.passed && (!o.quizId || String(o.quizId) === String(evt.quiz.id)) ? 1 : 0;
    case 'quiz_score':
      return evt.kind === 'quiz' && evt.quiz.score >= o.minScore && (!o.quizId || String(o.quizId) === String(evt.quiz.id)) ? 1 : 0;
    case 'complete_module':
      return evt.kind === 'module' && (!o.moduleId || String(o.moduleId) === String(evt.moduleId)) ? 1 : 0;
    case 'activities':
      return evt.kind === 'lesson' || (evt.kind === 'quiz' && evt.quiz.passed) ? 1 : 0;
    default:
      return 0;
  }
}

// Mark a quest completed exactly once and award its XP. Safe to call repeatedly:
// the completed:false filter AND the XP eventKey both guard against duplicates (FR-078).
async function finalize(rc, award, quest, progress, now) {
  const done = await QuestProgress.findOneAndUpdate(
    { _id: progress._id, completed: false },
    { $set: { completed: true, completedAt: now } },
    { new: true }
  );
  if (!done) return false; // already completed earlier
  await award({
    amount: quest.xpReward,
    sourceType: 'quest',
    sourceId: String(quest._id),
    description: `${quest.type} quest · ${quest.title}`,
    eventKey: `quest:${quest._id}:${progress.studentId}:${progress.periodKey}`
  });
  rc.quests.push({ id: String(quest._id), title: quest.title, xp: quest.xpReward });
  await notify(progress.studentId, {
    type: 'quest',
    courseId: quest.courseId,
    title: `Quest complete: ${quest.title}`,
    message: `+${quest.xpReward} XP`,
    dedupeKey: `quest:${quest._id}:${progress.periodKey}`
  });
  return true;
}

// Called by the gamification engine after every qualifying activity.
async function onEvent(rc, award, evt, now = new Date()) {
  const cfg = await settings.get();
  const quests = await Quest.find({ courseId: evt.courseId, status: 'active' }).lean();
  for (const quest of quests) {
    if (!isOpen(quest, now)) continue;
    const periodKey = periodKeyFor(quest, now, cfg.timezone);
    const filter = { studentId: rc.studentId, questId: quest._id, periodKey };
    const existing = await QuestProgress.findOne(filter);
    if (existing && existing.completed) continue;

    let update;
    if (quest.objective.kind === 'streak_days') {
      if (evt.kind === 'module' || !evt.streakCurrent) continue;
      update = { $max: { progress: evt.streakCurrent }, $setOnInsert: { courseId: quest.courseId } };
    } else {
      const inc = increment(quest, evt);
      if (!inc) continue;
      update = { $inc: { progress: inc }, $setOnInsert: { courseId: quest.courseId } };
    }

    let progress;
    try {
      progress = await QuestProgress.findOneAndUpdate(filter, update, { upsert: true, new: true });
    } catch (err) {
      if (err.code !== 11000) throw err;
      progress = await QuestProgress.findOneAndUpdate(filter, { $inc: update.$inc || {}, ...(update.$max ? { $max: update.$max } : {}) }, { new: true });
    }
    if (progress && progress.progress >= quest.objective.target) {
      await finalize(rc, award, quest, progress, now);
    }
  }
}

// Student-facing list with per-period progress and computed status (FR-073, FR-074, FR-080).
async function listForStudent(studentId, { courseId } = {}, now = new Date()) {
  const cfg = await settings.get();
  const enrollments = await Enrollment.find({ studentId, status: 'active', ...(courseId ? { courseId } : {}) }).lean();
  const courseIds = enrollments.map((e) => e.courseId);
  if (!courseIds.length) return [];
  const quests = await Quest.find({ courseId: { $in: courseIds }, status: 'active' }).populate('courseId', 'title code').sort({ createdAt: 1 }).lean();
  const visible = quests.filter((q) => !q.availableFrom || new Date(q.availableFrom) <= now);

  const progressDocs = await QuestProgress.find({ studentId, questId: { $in: visible.map((q) => q._id) } }).lean();
  const byKey = new Map(progressDocs.map((p) => [`${p.questId}:${p.periodKey}`, p]));

  return visible.map((q) => {
    const pk = periodKeyFor(q, now, cfg.timezone);
    let p = byKey.get(`${q._id}:${pk}`);
    const expired = !!q.deadline && new Date(q.deadline) < now;
    // An expired one-shot quest that was completed earlier should still show as completed.
    const completed = !!(p && p.completed);
    const target = q.objective.target;
    const prog = Math.min(p ? p.progress : 0, target);
    return {
      id: String(q._id),
      courseId: String(q.courseId._id),
      courseTitle: q.courseId.title,
      courseCode: q.courseId.code,
      title: q.title,
      description: q.description,
      type: q.type,
      objective: q.objective,
      xpReward: q.xpReward,
      deadline: q.deadline,
      availableFrom: q.availableFrom,
      recurrence: q.type === 'Daily' ? 'daily' : q.type === 'Weekly' ? 'weekly' : 'once',
      progress: prog,
      target,
      status: completed ? 'completed' : expired ? 'expired' : 'active',
      completedAt: p && p.completedAt ? p.completedAt : null
    };
  });
}

module.exports = { onEvent, finalize, listForStudent, periodKeyFor, isOpen, increment };
