const { Enrollment, Quiz, Quest, QuizAttempt, QuestProgress } = require('../models');
const { notify } = require('./notifications');

// Creates "deadline" notifications (FR-120) for quizzes/quests closing within 24 hours.
// dedupeKey makes this safe to run as often as we like.
async function runDeadlineReminders(now = new Date()) {
  const soon = new Date(now.getTime() + 24 * 3600 * 1000);
  let created = 0;

  const quizzes = await Quiz.find({ status: 'published', availableUntil: { $gt: now, $lte: soon } }).populate('courseId', 'title code').lean();
  for (const q of quizzes) {
    const students = await Enrollment.find({ courseId: q.courseId._id, status: 'active' }, 'studentId').lean();
    for (const s of students) {
      const used = await QuizAttempt.countDocuments({ quizId: q._id, studentId: s.studentId, status: 'submitted' });
      if (used >= q.attemptsAllowed) continue;
      const n = await notify(s.studentId, { type: 'deadline', courseId: q.courseId._id, title: `${q.title} closes soon`, message: `Due ${q.availableUntil.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`, dedupeKey: `quiz-due:${q._id}` });
      if (n) created++;
    }
  }

  const quests = await Quest.find({ status: 'active', deadline: { $gt: now, $lte: soon }, type: { $nin: ['Daily', 'Weekly'] } }).populate('courseId', 'title code').lean();
  for (const q of quests) {
    const students = await Enrollment.find({ courseId: q.courseId._id, status: 'active' }, 'studentId').lean();
    for (const s of students) {
      if (await QuestProgress.exists({ studentId: s.studentId, questId: q._id, completed: true })) continue;
      const n = await notify(s.studentId, { type: 'deadline', courseId: q.courseId._id, title: `Quest ending soon: ${q.title}`, message: `+${q.xpReward} XP if you finish before the deadline`, dedupeKey: `quest-due:${q._id}` });
      if (n) created++;
    }
  }
  return created;
}

let timer = null;
function start() {
  if (timer) return;
  const tick = () => runDeadlineReminders().catch((e) => console.error('[scheduler]', e.message));
  setTimeout(tick, 5000).unref();
  timer = setInterval(tick, 30 * 60 * 1000);
  timer.unref();
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { runDeadlineReminders, start, stop };
