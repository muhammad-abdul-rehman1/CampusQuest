const express = require('express');
const bcrypt = require('bcryptjs');
const asyncHandler = require('../lib/asyncHandler');
const { z, parse, text } = require('../lib/validate');
const { badRequest, unauthorized } = require('../lib/errors');
const { User, StudentProfile, InstructorProfile, Enrollment, Course, XpTransaction, LessonProgress, QuizAttempt, Lesson, Quiz } = require('../models');
const { authenticate, requireRole, signToken, setAuthCookie } = require('../middleware/auth');
const gamification = require('../services/gamification');
const achievements = require('../services/achievements');
const streaks = require('../services/streaks');
const progress = require('../services/progress');
const settings = require('../services/settings');
const { publicUser } = require('../lib/serialize');
const { parsePage, pageMeta } = require('../lib/paginate');

const router = express.Router();
router.use(authenticate);

async function profileFor(user) {
  const secrets = await User.findById(user._id).select('+passwordHash +googleId').lean();
  // Which sign-in methods the account has (never the values themselves).
  const base = { ...publicUser(user), security: { hasPassword: Boolean(secrets && secrets.passwordHash), google: Boolean(secrets && secrets.googleId) } };
  if (user.role === 'student') {
    const [p, info, streak, ach, enrollments] = await Promise.all([
      StudentProfile.findOne({ userId: user._id }).lean(),
      gamification.getXpSummary(user._id),
      streaks.getStreak(user._id),
      achievements.listForStudent(user._id),
      Enrollment.find({ studentId: user._id, status: 'active' }).populate({ path: 'courseId', populate: { path: 'instructorId', select: 'name' } }).lean()
    ]);
    const courses = [];
    for (const e of enrollments) {
      if (!e.courseId || e.courseId.status === 'archived') continue;
      const pr = await progress.courseProgress(user._id, e.courseId._id);
      courses.push({ id: String(e.courseId._id), title: e.courseId.title, code: e.courseId.code, instructorName: e.courseId.instructorId && e.courseId.instructorId.name, enrolledAt: e.enrolledAt, progress: pr });
    }
    return {
      ...base,
      profile: {
        department: p ? p.department : '',
        year: p ? p.year : '',
        bio: p ? p.bio : '',
        leaderboardVisible: p ? p.leaderboardVisible : true
      },
      level: info,
      streak,
      achievements: { unlocked: ach.filter((a) => a.unlocked).length, total: ach.length },
      courses
    };
  }
  if (user.role === 'instructor') {
    const p = await InstructorProfile.findOne({ userId: user._id }).lean();
    return { ...base, profile: { department: p ? p.department : '', title: p ? p.title : '', bio: p ? p.bio : '' } };
  }
  return base;
}

router.get(
  '/profile',
  asyncHandler(async (req, res) => {
    res.json(await profileFor(req.user));
  })
);

const profileSchema = z.object({
  name: text(2, 80).optional(),
  department: z.string().trim().max(80).optional(),
  year: z.string().trim().max(20).optional(),
  title: z.string().trim().max(80).optional(),
  bio: z.string().trim().max(300).optional(),
  leaderboardVisible: z.boolean().optional()
});

// Only whitelisted fields can be changed - role, status and XP are never writable here (FR-008, FR-018, NFR-013).
router.patch(
  '/profile',
  asyncHandler(async (req, res) => {
    const data = parse(profileSchema, req.body);
    if (data.name) await User.updateOne({ _id: req.user._id }, { name: data.name });
    if (req.user.role === 'student') {
      const set = {};
      for (const k of ['department', 'year', 'bio', 'leaderboardVisible']) if (data[k] !== undefined) set[k] = data[k];
      if (Object.keys(set).length) await StudentProfile.updateOne({ userId: req.user._id }, { $set: set }, { upsert: true });
    } else if (req.user.role === 'instructor') {
      const set = {};
      for (const k of ['department', 'title', 'bio']) if (data[k] !== undefined) set[k] = data[k];
      if (Object.keys(set).length) await InstructorProfile.updateOne({ userId: req.user._id }, { $set: set }, { upsert: true });
    }
    const fresh = await User.findById(req.user._id).lean();
    res.json(await profileFor(fresh));
  })
);

router.post(
  '/password',
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = parse(
      z.object({
        currentPassword: z.string().max(128).optional().default(''),
        newPassword: z.string().min(8, 'Password must be at least 8 characters.').max(128).refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must include a letter and a number.')
      }),
      req.body
    );
    const user = await User.findById(req.user._id).select('+passwordHash');
    // Google-only accounts have no password yet and may set one; everyone else must prove the current one.
    if (user.passwordHash) {
      if (!currentPassword) throw badRequest('Enter your current password.', { fields: { currentPassword: 'Enter your current password.' } });
      if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw unauthorized('Your current password is incorrect.');
    }
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.tokenVersion = (user.tokenVersion || 0) + 1; // signs out other devices
    await user.save();
    setAuthCookie(res, signToken(user)); // ...but keeps this one signed in
    res.json({ ok: true });
  })
);

const studentOnly = requireRole('student');

router.get(
  '/progress',
  studentOnly,
  asyncHandler(async (req, res) => {
    const enrollments = await Enrollment.find({ studentId: req.user._id, status: 'active' }).populate('courseId', 'title code status').lean();
    const items = [];
    for (const e of enrollments) {
      if (!e.courseId || e.courseId.status === 'archived') continue;
      items.push({ courseId: String(e.courseId._id), title: e.courseId.title, code: e.courseId.code, ...(await progress.courseProgress(req.user._id, e.courseId._id)) });
    }
    res.json({ courses: items });
  })
);

router.get(
  '/achievements',
  studentOnly,
  asyncHandler(async (req, res) => {
    res.json({ achievements: await achievements.listForStudent(req.user._id) });
  })
);

router.get(
  '/streak',
  studentOnly,
  asyncHandler(async (req, res) => {
    res.json(await streaks.getStreak(req.user._id));
  })
);

router.get(
  '/xp',
  studentOnly,
  asyncHandler(async (req, res) => {
    const pg = parsePage(req.query, { defaultLimit: 20 });
    const [info, total, rows] = await Promise.all([
      gamification.getXpSummary(req.user._id),
      XpTransaction.countDocuments({ studentId: req.user._id }),
      XpTransaction.find({ studentId: req.user._id }).sort({ createdAt: -1, _id: -1 }).skip(pg.skip).limit(pg.limit).lean()
    ]);
    res.json({
      ...info,
      transactions: rows.map((t) => ({ id: String(t._id), amount: t.amount, sourceType: t.sourceType, description: t.description, createdAt: t.createdAt })),
      ...pageMeta(total, pg)
    });
  })
);

// Learning history (FR-046): lessons, quiz attempts and XP in one timeline with timestamps (FR-047).
router.get(
  '/history',
  studentOnly,
  asyncHandler(async (req, res) => {
    const limit = Math.min(100, parseInt(req.query.limit, 10) || 30);
    const [lessons, attempts] = await Promise.all([
      LessonProgress.find({ studentId: req.user._id }).sort({ completedAt: -1 }).limit(limit).lean(),
      QuizAttempt.find({ studentId: req.user._id, status: 'submitted' }).sort({ submittedAt: -1 }).limit(limit).lean()
    ]);
    const [ls, qs] = await Promise.all([Lesson.find({ _id: { $in: lessons.map((l) => l.lessonId) } }, 'title').lean(), Quiz.find({ _id: { $in: attempts.map((a) => a.quizId) } }, 'title').lean()]);
    const lt = new Map(ls.map((l) => [String(l._id), l.title]));
    const qt = new Map(qs.map((q) => [String(q._id), q.title]));
    const items = [
      ...lessons.map((l) => ({ type: 'lesson', title: lt.get(String(l.lessonId)) || 'Lesson', at: l.completedAt, detail: 'Completed' })),
      ...attempts.map((a) => ({ type: 'quiz', title: qt.get(String(a.quizId)) || 'Quiz', at: a.submittedAt, detail: `${a.score}% · ${a.passed ? 'Passed' : 'Not passed'}` }))
    ]
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, limit);
    res.json({ items });
  })
);

module.exports = router;
