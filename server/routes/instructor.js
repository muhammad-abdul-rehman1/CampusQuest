const express = require('express');
const asyncHandler = require('../lib/asyncHandler');
const { validId } = require('../lib/validate');
const { badRequest, notFound } = require('../lib/errors');
const { Course, Enrollment, Module, Lesson, LessonProgress, Quiz, QuizAttempt, Quest, QuestProgress, User, StudentProfile } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { assertManager } = require('../lib/access');
const { levelForXp } = require('../lib/levels');
const { notify } = require('../services/notifications');
const progressSvc = require('../services/progress');
const streaks = require('../services/streaks');
const settings = require('../services/settings');
const { dayKey } = require('../lib/dates');

const router = express.Router();
router.use(authenticate, requireRole('instructor', 'admin'));

const DAY = 86400000;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

const BUCKETS = [
  { label: '0–59%', min: 0, max: 59, tone: 'bad' },
  { label: '60–79%', min: 60, max: 79, tone: 'mid' },
  { label: '80–89%', min: 80, max: 89, tone: 'good' },
  { label: '90–100%', min: 90, max: 100, tone: 'best' }
];
const distribution = (scores) => BUCKETS.map((b) => ({ label: b.label, tone: b.tone, count: scores.filter((s) => s >= b.min && s <= b.max).length }));

// Last qualifying activity per student in a course.
async function lastActivity(courseId, studentIds) {
  const [l, a] = await Promise.all([
    LessonProgress.aggregate([{ $match: { courseId, studentId: { $in: studentIds } } }, { $group: { _id: '$studentId', at: { $max: '$completedAt' } } }]),
    QuizAttempt.aggregate([{ $match: { courseId, studentId: { $in: studentIds }, status: 'submitted' } }, { $group: { _id: '$studentId', at: { $max: '$submittedAt' } } }])
  ]);
  const map = new Map();
  for (const r of [...l, ...a]) {
    const k = String(r._id);
    if (!map.has(k) || map.get(k) < r.at) map.set(k, r.at);
  }
  return map;
}

function agoText(date, now = Date.now()) {
  if (!date) return 'Never';
  const days = Math.floor((now - new Date(date).getTime()) / DAY);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
}

async function enrolledStudents(courseId) {
  const en = await Enrollment.find({ courseId, status: 'active' }).lean();
  return en;
}

router.get(
  '/courses',
  asyncHandler(async (req, res) => {
    const filter = req.user.role === 'admin' ? {} : { instructorId: req.user._id };
    const courses = await Course.find({ ...filter, status: { $ne: 'archived' } }).sort({ createdAt: -1 }).lean();
    const out = [];
    for (const c of courses) {
      const enrolled = await Enrollment.countDocuments({ courseId: c._id, status: 'active' });
      out.push({ id: String(c._id), title: c.title, code: c.code, status: c.status, enrolled });
    }
    res.json({ courses: out });
  })
);

// Dashboard (FR-124..FR-132)
router.get(
  '/analytics/:courseId',
  asyncHandler(async (req, res) => {
    const course = await assertManager(req.user, req.params.courseId);
    const cfg = await settings.get();
    const now = Date.now();
    const en = await enrolledStudents(course._id);
    const studentIds = en.map((e) => e.studentId);
    const total = studentIds.length;

    const [mods, lessons, quizzes, quests] = await Promise.all([
      Module.find({ courseId: course._id, status: 'published' }).sort({ order: 1 }).lean(),
      Lesson.find({ courseId: course._id, status: 'published' }, '_id moduleId').lean(),
      Quiz.find({ courseId: course._id, status: 'published' }, '_id title passingScore').lean(),
      Quest.find({ courseId: course._id, status: 'active' }).lean()
    ]);
    const lessonIds = lessons.map((l) => l._id);
    const [progressRows, attempts, questDone] = await Promise.all([
      LessonProgress.find({ courseId: course._id, studentId: { $in: studentIds }, lessonId: { $in: lessonIds } }, 'studentId lessonId moduleId completedAt').lean(),
      QuizAttempt.find({ courseId: course._id, studentId: { $in: studentIds }, status: 'submitted' }, 'quizId studentId score passed submittedAt').lean(),
      QuestProgress.find({ courseId: course._id, studentId: { $in: studentIds }, completed: true }, 'questId studentId').lean()
    ]);

    const lessonCompletion = pct(progressRows.length, lessons.length * total);
    const scores = attempts.map((a) => a.score);
    const avgQuiz = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    const questCompletion = pct(new Set(questDone.map((q) => `${q.studentId}:${q.questId}`)).size, quests.length * total);

    const modules = mods.map((m) => {
      const ls = lessons.filter((l) => String(l.moduleId) === String(m._id));
      const finishers = studentIds.filter((sid) => ls.length && ls.every((l) => progressRows.some((p) => String(p.studentId) === String(sid) && String(p.lessonId) === String(l._id)))).length;
      return { id: String(m._id), title: m.title, lessons: ls.length, completedStudents: finishers, percent: pct(finishers, total), opensAt: m.availableFrom && m.availableFrom.getTime() > now ? m.availableFrom : null };
    });

    // Students needing attention: inactive for N+ days, or below a quiz pass mark (FR-131)
    const last = await lastActivity(course._id, studentIds);
    const users = await User.find({ _id: { $in: studentIds } }, 'name').lean();
    const nameOf = new Map(users.map((u) => [String(u._id), u.name]));
    const passOf = new Map(quizzes.map((q) => [String(q._id), q.passingScore]));
    const attention = [];
    for (const e of en) {
      const sid = String(e.studentId);
      const lastAt = last.get(sid) || null;
      const inactiveDays = lastAt ? Math.floor((now - new Date(lastAt).getTime()) / DAY) : Math.floor((now - new Date(e.enrolledAt).getTime()) / DAY);
      const mine = attempts.filter((a) => String(a.studentId) === sid);
      const best = mine.length ? Math.max(...mine.map((a) => a.score)) : null;
      const failing = mine.length > 0 && !mine.some((a) => a.passed);
      const inactive = inactiveDays >= cfg.inactivityDays;
      if (!inactive && !failing) continue;
      const done = progressRows.filter((p) => String(p.studentId) === sid).length;
      attention.push({ studentId: sid, name: nameOf.get(sid) || 'Student', lastActive: agoText(lastAt, now), inactiveDays, lessons: `${done} of ${lessons.length}`, bestQuiz: best, reasons: [inactive ? 'inactive' : null, failing ? 'below pass mark' : null].filter(Boolean) });
    }
    attention.sort((a, b) => b.inactiveDays - a.inactiveDays);

    // Engagement: active students and activities per day for the last 7 days
    const activeWeek = new Set();
    const perDay = {};
    const tz = cfg.timezone;
    const addDay = (d, sid) => {
      if (now - new Date(d).getTime() > 7 * DAY) return;
      activeWeek.add(String(sid));
      const k = dayKey(new Date(d), tz);
      perDay[k] = (perDay[k] || 0) + 1;
    };
    progressRows.forEach((p) => addDay(p.completedAt, p.studentId));
    attempts.forEach((a) => addDay(a.submittedAt, a.studentId));
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const k = dayKey(new Date(now - i * DAY), tz);
      days.push({ date: k, activities: perDay[k] || 0 });
    }

    res.json({
      course: { id: String(course._id), title: course.title, code: course.code },
      enrolled: total,
      newThisWeek: en.filter((e) => now - new Date(e.enrolledAt).getTime() < 7 * DAY).length,
      lessonCompletion,
      lessonsPublished: lessons.length,
      quiz: { attempts: attempts.length, average: avgQuiz, passRate: attempts.length ? pct(attempts.filter((a) => a.passed).length, attempts.length) : null, passed: attempts.filter((a) => a.passed).length, below: attempts.filter((a) => !a.passed).length, distribution: distribution(scores) },
      questCompletion,
      questCount: quests.length,
      modules,
      attention,
      engagement: { activeStudents7d: activeWeek.size, activePercent: pct(activeWeek.size, total), perDay: days }
    });
  })
);

router.get(
  '/analytics/:courseId/quizzes',
  asyncHandler(async (req, res) => {
    const course = await assertManager(req.user, req.params.courseId);
    const quizzes = await Quiz.find({ courseId: course._id }).sort({ createdAt: 1 }).lean();
    const out = [];
    for (const q of quizzes) {
      const at = await QuizAttempt.find({ quizId: q._id, status: 'submitted' }, 'score passed studentId').lean();
      const scores = at.map((a) => a.score);
      out.push({
        id: String(q._id),
        title: q.title,
        status: q.status,
        passingScore: q.passingScore,
        attempts: at.length,
        students: new Set(at.map((a) => String(a.studentId))).size,
        average: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
        passRate: at.length ? pct(at.filter((a) => a.passed).length, at.length) : null,
        distribution: distribution(scores)
      });
    }
    res.json({ quizzes: out });
  })
);

router.get(
  '/analytics/:courseId/quests',
  asyncHandler(async (req, res) => {
    const course = await assertManager(req.user, req.params.courseId);
    const enrolled = await Enrollment.countDocuments({ courseId: course._id, status: 'active' });
    const quests = await Quest.find({ courseId: course._id }).sort({ createdAt: -1 }).lean();
    const out = [];
    for (const q of quests) {
      const done = (await QuestProgress.distinct('studentId', { questId: q._id, completed: true })).length;
      out.push({ id: String(q._id), title: q.title, type: q.type, status: q.status, xpReward: q.xpReward, deadline: q.deadline, completed: done, enrolled, percent: pct(done, enrolled) });
    }
    res.json({ quests: out });
  })
);

router.get(
  '/students/:studentId/progress',
  asyncHandler(async (req, res) => {
    const { studentId } = req.params;
    const courseId = req.query.courseId;
    if (!validId(studentId) || !validId(String(courseId || ''))) throw badRequest('Provide a valid studentId and courseId.');
    const course = await assertManager(req.user, courseId);
    const enrollment = await Enrollment.findOne({ studentId, courseId: course._id, status: 'active' }).lean();
    if (!enrollment) throw notFound('That student is not enrolled in this course.'); // only your own students (NFR-009)

    const cfg = await settings.get();
    const [user, profile, tree, prog, attempts, quests, qprog, streak, last] = await Promise.all([
      User.findById(studentId, 'name email').lean(),
      StudentProfile.findOne({ userId: studentId }).lean(),
      progressSvc.courseTree(studentId, course._id),
      progressSvc.courseProgress(studentId, course._id),
      QuizAttempt.find({ courseId: course._id, studentId, status: 'submitted' }).sort({ submittedAt: -1 }).lean(),
      Quest.find({ courseId: course._id, status: 'active' }).lean(),
      QuestProgress.find({ courseId: course._id, studentId }).lean(),
      streaks.getStreak(studentId),
      lastActivity(course._id, [new (require('mongoose').Types.ObjectId)(studentId)])
    ]);
    const quizzes = await Quiz.find({ _id: { $in: attempts.map((a) => a.quizId) } }, 'title').lean();
    const qt = new Map(quizzes.map((q) => [String(q._id), q.title]));
    const xp = profile ? profile.xp : 0;
    res.json({
      student: { id: String(user._id), name: user.name, email: user.email, xp, level: levelForXp(xp, cfg.levelBase) },
      progress: prog,
      modules: tree.map((m) => ({ title: m.title, lessons: m.lessons.map((l) => ({ title: l.title, completed: l.completed })) })),
      quizAttempts: attempts.map((a) => ({ quiz: qt.get(String(a.quizId)) || 'Quiz', score: a.score, passed: a.passed, submittedAt: a.submittedAt })),
      quests: quests.map((q) => {
        const p = qprog.find((x) => String(x.questId) === String(q._id) && x.completed);
        return { title: q.title, type: q.type, completed: !!p };
      }),
      streak: { current: streak.currentStreak, longest: streak.longestStreak },
      lastActive: agoText([...last.values()][0])
    });
  })
);

// "Send reminder" nudge for an inactive student (instructor dashboard). One per student per day.
router.post(
  '/courses/:courseId/students/:studentId/remind',
  asyncHandler(async (req, res) => {
    const course = await assertManager(req.user, req.params.courseId);
    const { studentId } = req.params;
    if (!validId(studentId)) throw badRequest('Invalid student.');
    if (!(await Enrollment.exists({ studentId, courseId: course._id, status: 'active' }))) throw notFound('That student is not enrolled in this course.');
    const cfg = await settings.get();
    const n = await notify(studentId, {
      type: 'course',
      courseId: course._id,
      title: `${course.code || course.title}: your instructor sent a reminder`,
      message: 'Pick up where you left off — a quick lesson keeps your streak alive.',
      dedupeKey: `remind:${course._id}:${dayKey(new Date(), cfg.timezone)}`
    });
    res.json({ ok: true, sent: !!n });
  })
);

module.exports = router;
