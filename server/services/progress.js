const { Module, Lesson, LessonProgress, Quiz, QuizAttempt, Quest, QuestProgress } = require('../models');

// Course tree for a student: modules -> lessons with completion + lock state (FR-036, FR-039).
async function courseTree(studentId, courseId, { includeDrafts = false, now = new Date() } = {}) {
  const modFilter = { courseId, ...(includeDrafts ? {} : { status: 'published' }) };
  const [mods, lessons, done] = await Promise.all([
    Module.find(modFilter).sort({ order: 1, createdAt: 1 }).lean(),
    Lesson.find({ courseId, ...(includeDrafts ? {} : { status: 'published' }) }).sort({ order: 1, createdAt: 1 }).lean(),
    studentId ? LessonProgress.find({ studentId, courseId }).lean() : []
  ]);
  const doneSet = new Set(done.map((d) => String(d.lessonId)));
  return mods.map((m) => {
    const locked = !!(m.availableFrom && m.availableFrom > now) && !includeDrafts;
    const ls = lessons
      .filter((l) => String(l.moduleId) === String(m._id))
      .map((l) => ({
        id: String(l._id),
        title: l.title,
        minutes: l.minutes,
        order: l.order,
        status: l.status,
        completed: doneSet.has(String(l._id)),
        locked
      }));
    return {
      id: String(m._id),
      title: m.title,
      description: m.description,
      order: m.order,
      status: m.status,
      availableFrom: m.availableFrom,
      locked,
      lessons: ls,
      completedCount: ls.filter((l) => l.completed).length
    };
  });
}

// Completion percentage = completed lessons / published lessons (FR-040, FR-044).
async function courseProgress(studentId, courseId) {
  const lessonIds = await Lesson.find({ courseId, status: 'published' }).distinct('_id');
  const total = lessonIds.length;
  const [completed, quizIds, questIds] = await Promise.all([
    LessonProgress.countDocuments({ studentId, lessonId: { $in: lessonIds } }),
    Quiz.find({ courseId, status: 'published' }).distinct('_id'),
    Quest.find({ courseId, status: 'active' }).distinct('_id')
  ]);
  const [quizzesPassed, questsDone] = await Promise.all([
    QuizAttempt.distinct('quizId', { studentId, quizId: { $in: quizIds }, status: 'submitted', passed: true }).then((a) => a.length),
    QuestProgress.countDocuments({ studentId, questId: { $in: questIds }, completed: true })
  ]);
  return {
    lessonsTotal: total,
    lessonsCompleted: completed,
    percent: total ? Math.round((completed / total) * 100) : 0,
    quizzesTotal: quizIds.length,
    quizzesPassed,
    questsTotal: questIds.length,
    questsCompleted: questsDone
  };
}

module.exports = { courseTree, courseProgress };
