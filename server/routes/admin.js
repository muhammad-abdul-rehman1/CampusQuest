const express = require('express');
const asyncHandler = require('../lib/asyncHandler');
const { z, parse, validId, text } = require('../lib/validate');
const { HttpError, badRequest, notFound, forbidden } = require('../lib/errors');
const config = require('../config');
const mailer = require('../services/mailer');
const tokens = require('../services/authTokens');
const { User, StudentProfile, InstructorProfile, Course, Enrollment, LessonProgress, QuizAttempt, QuestProgress, XpTransaction, AuditLog } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { audit } = require('../services/audit');
const settings = require('../services/settings');
const { parsePage, pageMeta, escapeRegex } = require('../lib/paginate');
const { courseOut, publicUser } = require('../lib/serialize');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

const DAY = 86400000;

router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const since = new Date(Date.now() - 7 * DAY);
    const [users, byRole, courses, published, enrollments, lessons7, attempts7, quests7, xp7, suspended, recentAudit] = await Promise.all([
      User.countDocuments(),
      User.aggregate([{ $group: { _id: '$role', n: { $sum: 1 } } }]),
      Course.countDocuments({ status: { $ne: 'archived' } }),
      Course.countDocuments({ status: 'published' }),
      Enrollment.countDocuments({ status: 'active' }),
      LessonProgress.countDocuments({ completedAt: { $gte: since } }),
      QuizAttempt.countDocuments({ status: 'submitted', submittedAt: { $gte: since } }),
      QuestProgress.countDocuments({ completed: true, completedAt: { $gte: since } }),
      XpTransaction.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      User.countDocuments({ status: { $ne: 'active' } }),
      AuditLog.find().sort({ createdAt: -1 }).limit(6).lean()
    ]);
    const roleMap = Object.fromEntries(byRole.map((r) => [r._id, r.n]));
    res.json({
      users: { total: users, students: roleMap.student || 0, instructors: roleMap.instructor || 0, admins: roleMap.admin || 0, inactive: suspended },
      courses: { total: courses, published },
      enrollments,
      activity7d: { lessonsCompleted: lessons7, quizAttempts: attempts7, questsCompleted: quests7, xpAwarded: xp7[0] ? xp7[0].total : 0 },
      recentAudit: recentAudit.map((a) => ({ id: String(a._id), action: a.action, actor: a.actorName, targetType: a.targetType, createdAt: a.createdAt }))
    });
  })
);

router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const pg = parsePage(req.query, { defaultLimit: 25 });
    const filter = {};
    if (['student', 'instructor', 'admin'].includes(req.query.role)) filter.role = req.query.role;
    if (['active', 'suspended', 'deactivated'].includes(req.query.status)) filter.status = req.query.status;
    if (req.query.q) {
      const rx = new RegExp(escapeRegex(String(req.query.q).slice(0, 60)), 'i');
      filter.$or = [{ name: rx }, { email: rx }];
    }
    const [total, rows] = await Promise.all([User.countDocuments(filter), User.find(filter).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit).lean()]);
    res.json({ items: rows.map((u) => ({ ...publicUser(u), lastLoginAt: u.lastLoginAt })), ...pageMeta(total, pg) });
  })
);

const createUserSchema = z.object({
  name: text(2, 80),
  email: z.string().trim().toLowerCase().max(160).pipe(z.email('Enter a valid email address.')),
  role: z.enum(['student', 'instructor', 'admin'])
});

// Admins never pick passwords for people. The new user gets an invitation email, sets their own
// password from it, and that also verifies their email address.
async function sendInvite(user) {
  await tokens.revoke({ userId: user._id, purpose: 'reset_password' });
  const raw = await tokens.create('reset_password', { email: user.email, userId: user._id, invite: true }, config.tokens.inviteHours);
  try {
    return await mailer.send({ to: user.email, ...mailer.templates.invite(user.name, tokens.link('reset', raw), user.role) });
  } catch (err) {
    console.error('[mail] invite failed for', user.email, '-', err.message);
    throw new HttpError(502, "The account exists, but we couldn't send the invitation email. Try 'Resend invite' in a few minutes.");
  }
}
const devLinksAllowed = !config.isProd && mailer.mode() === 'console' && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(config.appUrl);
const devExtra = (sent) => (devLinksAllowed && sent && sent.link ? { devLink: sent.link } : {});

router.post(
  '/users',
  asyncHandler(async (req, res) => {
    const data = parse(createUserSchema, req.body);
    if (await User.exists({ email: data.email })) throw badRequest('An account with this email already exists.', { fields: { email: 'Already registered.' } });
    const user = await User.create({ name: data.name, email: data.email, role: data.role, emailVerified: false });
    if (user.role === 'student') await StudentProfile.create({ userId: user._id });
    if (user.role === 'instructor') await InstructorProfile.create({ userId: user._id });
    await audit(req, 'user.create', 'user', user._id, { role: user.role, email: user.email });
    const sent = await sendInvite(user);
    res.status(201).json({ ...publicUser(user), invited: true, ...devExtra(sent) });
  })
);

router.post(
  '/users/:userId/invite',
  asyncHandler(async (req, res) => {
    if (!validId(req.params.userId)) throw notFound('User not found.');
    const user = await User.findById(req.params.userId);
    if (!user) throw notFound('User not found.');
    if (user.emailVerified !== false) throw badRequest('This user has already activated their account.');
    if (user.status !== 'active') throw badRequest('Reactivate the account before sending an invitation.');
    const sent = await sendInvite(user);
    await audit(req, 'user.invite', 'user', user._id, { email: user.email });
    res.json({ ok: true, ...devExtra(sent) });
  })
);

const patchUserSchema = z.object({ role: z.enum(['student', 'instructor', 'admin']).optional(), status: z.enum(['active', 'suspended', 'deactivated']).optional(), name: text(2, 80).optional() });

router.patch(
  '/users/:userId',
  asyncHandler(async (req, res) => {
    if (!validId(req.params.userId)) throw notFound('User not found.');
    const data = parse(patchUserSchema, req.body);
    const user = await User.findById(req.params.userId);
    if (!user) throw notFound('User not found.');
    const self = String(user._id) === String(req.user._id);
    if (self && ((data.role && data.role !== 'admin') || (data.status && data.status !== 'active'))) throw forbidden('You cannot demote or suspend your own account.');

    const changes = {};
    if (data.role && data.role !== user.role) {
      changes.role = { from: user.role, to: data.role };
      user.role = data.role;
      if (data.role === 'student') await StudentProfile.updateOne({ userId: user._id }, { $setOnInsert: { userId: user._id } }, { upsert: true });
      if (data.role === 'instructor') await InstructorProfile.updateOne({ userId: user._id }, { $setOnInsert: { userId: user._id } }, { upsert: true });
    }
    if (data.status && data.status !== user.status) {
      changes.status = { from: user.status, to: data.status };
      user.status = data.status;
    }
    if (data.name) user.name = data.name;
    await user.save();
    if (Object.keys(changes).length) await audit(req, 'user.update', 'user', user._id, changes);
    res.json(publicUser(user));
  })
);

router.get(
  '/courses',
  asyncHandler(async (req, res) => {
    const pg = parsePage(req.query, { defaultLimit: 25 });
    const filter = {};
    if (['draft', 'published', 'archived'].includes(req.query.status)) filter.status = req.query.status;
    if (req.query.q) {
      const rx = new RegExp(escapeRegex(String(req.query.q).slice(0, 60)), 'i');
      filter.$or = [{ title: rx }, { code: rx }];
    }
    const [total, rows] = await Promise.all([Course.countDocuments(filter), Course.find(filter).populate('instructorId', 'name').sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit).lean()]);
    const counts = await Enrollment.aggregate([{ $match: { courseId: { $in: rows.map((r) => r._id) }, status: 'active' } }, { $group: { _id: '$courseId', n: { $sum: 1 } } }]);
    const m = new Map(counts.map((c) => [String(c._id), c.n]));
    res.json({ items: rows.map((c) => courseOut(c, { studentCount: m.get(String(c._id)) || 0 })), ...pageMeta(total, pg) });
  })
);

router.patch(
  '/courses/:courseId',
  asyncHandler(async (req, res) => {
    if (!validId(req.params.courseId)) throw notFound('Course not found.');
    const data = parse(z.object({ status: z.enum(['draft', 'published', 'archived']) }), req.body);
    const course = await Course.findById(req.params.courseId);
    if (!course) throw notFound('Course not found.');
    const from = course.status;
    course.status = data.status;
    await course.save();
    await audit(req, 'course.status', 'course', course._id, { from, to: data.status });
    res.json(courseOut(course));
  })
);

const settingsSchema = z.object({
  xp: z
    .object({
      lesson: z.number().int().min(0).max(1000),
      module: z.number().int().min(0).max(5000),
      quizPass: z.number().int().min(0).max(1000),
      quizBonus: z.number().int().min(0).max(1000),
      quizBonusThreshold: z.number().int().min(50).max(100),
      dailyQuestSuggested: z.number().int().min(0).max(1000),
      weeklyQuestSuggested: z.number().int().min(0).max(5000)
    })
    .partial()
    .optional(),
  streakMilestones: z.array(z.object({ days: z.number().int().min(2).max(365), xp: z.number().int().min(0).max(5000) })).max(10).optional(),
  levelBase: z.number().int().min(10).max(1000).optional(),
  timezone: z
    .string()
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'Enter a valid IANA timezone, e.g. Asia/Karachi')
    .optional(),
  allowInstructorSignup: z.boolean().optional(),
  leaderboardDefaultVisible: z.boolean().optional(),
  inactivityDays: z.number().int().min(1).max(60).optional()
});

router.get('/settings', asyncHandler(async (req, res) => res.json(await settings.get())));

router.put(
  '/settings',
  asyncHandler(async (req, res) => {
    const data = parse(settingsSchema, req.body);
    const before = await settings.get();
    const next = await settings.update(data);
    await audit(req, 'settings.update', 'settings', 'platform', { before: { xp: before.xp, levelBase: before.levelBase, timezone: before.timezone }, after: { xp: next.xp, levelBase: next.levelBase, timezone: next.timezone } });
    res.json(next);
  })
);

router.get(
  '/audit-logs',
  asyncHandler(async (req, res) => {
    const pg = parsePage(req.query, { defaultLimit: 40 });
    const filter = {};
    if (req.query.action) filter.action = new RegExp('^' + escapeRegex(String(req.query.action).slice(0, 40)));
    const [total, rows] = await Promise.all([AuditLog.countDocuments(filter), AuditLog.find(filter).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit).lean()]);
    res.json({ items: rows.map((a) => ({ id: String(a._id), action: a.action, actor: a.actorName, targetType: a.targetType, targetId: a.targetId, details: a.details, ip: a.ip, createdAt: a.createdAt })), ...pageMeta(total, pg) });
  })
);

module.exports = router;
