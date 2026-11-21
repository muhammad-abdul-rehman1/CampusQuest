const express = require('express');
const asyncHandler = require('../lib/asyncHandler');
const { z, parse, text, validId } = require('../lib/validate');
const { badRequest, forbidden, notFound, conflict } = require('../lib/errors');
const { Course, Enrollment, Module, Lesson, LessonProgress, Quiz, Quest, User, StudentProfile } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { loadCourse, canManage, assertManager, assertViewer } = require('../lib/access');
const { courseOut, initials } = require('../lib/serialize');
const { parsePage, pageMeta, escapeRegex } = require('../lib/paginate');
const progress = require('../services/progress');
const { notify } = require('../services/notifications');
const { audit } = require('../services/audit');

const router = express.Router();
router.use(authenticate);

const courseFields = {
  title: text(3, 120),
  code: z.string().trim().max(20).optional(),
  description: z.string().trim().max(2000).optional(),
  category: z.string().trim().max(60).optional(),
  term: z.string().trim().max(40).optional(),
  enrollmentOpen: z.boolean().optional(),
  enrollmentCode: z.string().trim().max(40).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional()
};

// Browse / list courses. Students see published courses; instructors see their own; admins see all.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const pg = parsePage(req.query, { defaultLimit: 24 });
    const filter = {};
    const { user } = req;
    if (user.role === 'student') {
      filter.status = 'published';
    } else if (user.role === 'instructor') {
      filter.instructorId = user._id;
      if (req.query.status && ['draft', 'published', 'archived'].includes(req.query.status)) filter.status = req.query.status;
    } else if (req.query.status && ['draft', 'published', 'archived'].includes(req.query.status)) {
      filter.status = req.query.status;
    }
    if (req.query.q) {
      const rx = new RegExp(escapeRegex(String(req.query.q).slice(0, 60)), 'i');
      filter.$or = [{ title: rx }, { code: rx }, { category: rx }];
    }

    let enrolledIds = new Set();
    if (user.role === 'student') {
      const en = await Enrollment.find({ studentId: user._id, status: 'active' }, 'courseId').lean();
      enrolledIds = new Set(en.map((e) => String(e.courseId)));
      if (req.query.enrolled === '1') filter._id = { $in: [...enrolledIds] };
    }

    const [total, rows] = await Promise.all([
      Course.countDocuments(filter),
      Course.find(filter).populate('instructorId', 'name').sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit).lean()
    ]);
    const counts = await Enrollment.aggregate([{ $match: { courseId: { $in: rows.map((r) => r._id) }, status: 'active' } }, { $group: { _id: '$courseId', n: { $sum: 1 } } }]);
    const countMap = new Map(counts.map((c) => [String(c._id), c.n]));

    const items = [];
    for (const c of rows) {
      const extra = { studentCount: countMap.get(String(c._id)) || 0 };
      if (user.role === 'student') {
        extra.enrolled = enrolledIds.has(String(c._id));
        if (extra.enrolled) extra.progress = await progress.courseProgress(user._id, c._id);
      }
      items.push(courseOut(c, extra));
    }
    res.json({ items, ...pageMeta(total, pg) });
  })
);

router.post(
  '/',
  requireRole('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const data = parse(z.object({ ...courseFields, instructorId: z.string().optional() }), req.body);
    let instructorId = req.user._id;
    if (req.user.role === 'admin' && data.instructorId) {
      if (!validId(data.instructorId) || !(await User.exists({ _id: data.instructorId, role: 'instructor' }))) throw badRequest('Choose a valid instructor.');
      instructorId = data.instructorId;
    }
    const { instructorId: _ignored, ...rest } = data;
    const course = await Course.create({ ...rest, instructorId });
    await audit(req, 'course.create', 'course', course._id, { title: course.title });
    res.status(201).json(courseOut(course));
  })
);

router.get(
  '/:courseId',
  asyncHandler(async (req, res) => {
    const course = await loadCourse(req.params.courseId);
    const { user } = req;
    const manager = canManage(user, course);
    if (!manager && (course.status !== 'published' || user.role !== 'student')) throw notFound('Course not found.');
    await course.populate('instructorId', 'name');

    const out = courseOut(course);
    if (manager) {
      out.enrollmentCode = course.enrollmentCode;
      out.isManager = true;
      out.studentCount = await Enrollment.countDocuments({ courseId: course._id, status: 'active' });
      out.tree = await progress.courseTree(null, course._id, { includeDrafts: true });
      return res.json(out);
    }

    out.enrolled = await Enrollment.exists({ studentId: user._id, courseId: course._id, status: 'active' }).then(Boolean);
    out.studentCount = await Enrollment.countDocuments({ courseId: course._id, status: 'active' });
    if (out.enrolled) {
      out.tree = await progress.courseTree(user._id, course._id);
      out.progress = await progress.courseProgress(user._id, course._id);
      const quizzes = await Quiz.find({ courseId: course._id, status: 'published' }).sort({ createdAt: 1 }).lean();
      out.quizzes = quizzes.map((q) => ({ id: String(q._id), title: q.title, moduleId: q.moduleId ? String(q.moduleId) : null, durationMinutes: q.durationMinutes, availableUntil: q.availableUntil }));
    } else {
      // Not enrolled: structure only, no lesson content or list (NFR-014)
      const [mods, lessons] = await Promise.all([Module.find({ courseId: course._id, status: 'published' }).sort({ order: 1 }).lean(), Lesson.find({ courseId: course._id, status: 'published' }, 'moduleId').lean()]);
      out.outline = mods.map((m) => ({ id: String(m._id), title: m.title, lessonCount: lessons.filter((l) => String(l.moduleId) === String(m._id)).length }));
    }
    res.json(out);
  })
);

router.patch(
  '/:courseId',
  requireRole('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const course = await assertManager(req.user, req.params.courseId);
    const data = parse(z.object(courseFields).partial(), req.body);
    const statusChanged = data.status && data.status !== course.status;
    Object.assign(course, data);
    await course.save();
    if (statusChanged) await audit(req, 'course.status', 'course', course._id, { status: course.status });
    res.json(courseOut(course, { enrollmentCode: course.enrollmentCode }));
  })
);

// Archive (soft delete). A never-used draft course can be removed outright (FR-021).
router.delete(
  '/:courseId',
  requireRole('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const course = await assertManager(req.user, req.params.courseId);
    const enrolled = await Enrollment.countDocuments({ courseId: course._id });
    if (course.status === 'draft' && enrolled === 0) {
      const mods = await Module.find({ courseId: course._id }, '_id').lean();
      await Promise.all([
        Lesson.deleteMany({ courseId: course._id }),
        Module.deleteMany({ courseId: course._id }),
        Quiz.deleteMany({ courseId: course._id }),
        Quest.deleteMany({ courseId: course._id }),
        Course.deleteOne({ _id: course._id })
      ]);
      await audit(req, 'course.delete', 'course', course._id, { title: course.title, modules: mods.length });
      return res.json({ ok: true, deleted: true });
    }
    course.status = 'archived';
    await course.save();
    await audit(req, 'course.archive', 'course', course._id, { title: course.title });
    res.json({ ok: true, archived: true });
  })
);

const enrollSchema = z.object({ code: z.string().trim().max(40).optional() });

router.post(
  '/:courseId/enroll',
  requireRole('student'),
  asyncHandler(async (req, res) => {
    const { code } = parse(enrollSchema, req.body);
    const course = await loadCourse(req.params.courseId);
    if (course.status !== 'published') throw notFound('Course not found.');

    const existing = await Enrollment.findOne({ studentId: req.user._id, courseId: course._id });
    if (existing && existing.status === 'active') return res.json({ ok: true, alreadyEnrolled: true });
    if (!course.enrollmentOpen) throw forbidden('Enrollment for this course is closed.');
    if (course.enrollmentCode && (code || '').toLowerCase() !== course.enrollmentCode.toLowerCase()) {
      throw forbidden('This course is restricted. Enter the enrollment code from your instructor.', { requiresCode: true });
    }
    try {
      if (existing) {
        existing.status = 'active';
        existing.enrolledAt = new Date();
        await existing.save();
      } else {
        await Enrollment.create({ studentId: req.user._id, courseId: course._id });
      }
    } catch (err) {
      if (err.code === 11000) return res.json({ ok: true, alreadyEnrolled: true });
      throw err;
    }
    res.status(201).json({ ok: true, enrolled: true });
  })
);

router.post(
  '/:courseId/leave',
  requireRole('student'),
  asyncHandler(async (req, res) => {
    const course = await loadCourse(req.params.courseId);
    await Enrollment.updateOne({ studentId: req.user._id, courseId: course._id }, { status: 'dropped' });
    res.json({ ok: true });
  })
);

router.get(
  '/:courseId/students',
  requireRole('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const course = await assertManager(req.user, req.params.courseId);
    const pg = parsePage(req.query, { defaultLimit: 50 });
    const filter = { courseId: course._id, status: 'active' };
    const [total, rows] = await Promise.all([Enrollment.countDocuments(filter), Enrollment.find(filter).populate('studentId', 'name email').sort({ enrolledAt: -1 }).skip(pg.skip).limit(pg.limit).lean()]);
    const profiles = await StudentProfile.find({ userId: { $in: rows.map((r) => r.studentId && r.studentId._id) } }, 'userId xp').lean();
    const xpMap = new Map(profiles.map((p) => [String(p.userId), p.xp]));
    const items = [];
    for (const r of rows) {
      if (!r.studentId) continue;
      const pr = await progress.courseProgress(r.studentId._id, course._id);
      items.push({ id: String(r.studentId._id), name: r.studentId.name, email: r.studentId.email, initials: initials(r.studentId.name), enrolledAt: r.enrolledAt, xp: xpMap.get(String(r.studentId._id)) || 0, progress: pr });
    }
    res.json({ items, ...pageMeta(total, pg) });
  })
);

router.post(
  '/:courseId/announcements',
  requireRole('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const course = await assertManager(req.user, req.params.courseId);
    const { title, message } = parse(z.object({ title: text(3, 120), message: z.string().trim().max(500).optional() }), req.body);
    const students = await Enrollment.find({ courseId: course._id, status: 'active' }, 'studentId').lean();
    const stamp = Date.now();
    for (const s of students) await notify(s.studentId, { type: 'course', courseId: course._id, title: `${course.code || course.title}: ${title}`, message: message || '', dedupeKey: `announce:${course._id}:${stamp}` });
    await audit(req, 'course.announce', 'course', course._id, { title, recipients: students.length });
    res.status(201).json({ ok: true, recipients: students.length });
  })
);

module.exports = router;
