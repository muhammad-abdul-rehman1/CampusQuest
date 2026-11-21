const express = require('express');
const asyncHandler = require('../lib/asyncHandler');
const { z, parse, text, validId } = require('../lib/validate');
const { badRequest, conflict } = require('../lib/errors');
const { Module, Lesson, LessonProgress, Quiz, Quest } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { assertManager, assertViewer, loadModuleFor, loadLessonFor } = require('../lib/access');
const progress = require('../services/progress');
const gamification = require('../services/gamification');
const { audit } = require('../services/audit');

const router = express.Router();
router.use(authenticate);

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine((u) => /^https?:\/\/[^\s]+$/i.test(u), 'Resource links must start with http:// or https://'); // blocks javascript: URLs

const moduleSchema = z.object({
  title: text(2, 120),
  description: z.string().trim().max(600).optional(),
  order: z.number().int().min(0).max(10000).optional(),
  status: z.enum(['draft', 'published']).optional(),
  availableFrom: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).nullable().optional()
});

const lessonSchema = z.object({
  title: text(2, 140),
  content: z.string().max(40000).optional(),
  resources: z.array(z.object({ title: text(1, 120), url: httpUrl })).max(20).optional(),
  minutes: z.number().int().min(1).max(600).optional(),
  order: z.number().int().min(0).max(10000).optional(),
  status: z.enum(['draft', 'published']).optional()
});

const toDate = (v) => (v === null || v === undefined || v === '' ? null : new Date(v));

router.get(
  '/courses/:courseId/modules',
  asyncHandler(async (req, res) => {
    const { course, isManager } = await assertViewer(req.user, req.params.courseId);
    const tree = await progress.courseTree(isManager ? null : req.user._id, course._id, { includeDrafts: isManager });
    res.json({ modules: tree });
  })
);

router.post(
  '/courses/:courseId/modules',
  requireRole('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const course = await assertManager(req.user, req.params.courseId);
    const data = parse(moduleSchema, req.body);
    const last = await Module.findOne({ courseId: course._id }).sort({ order: -1 }).lean();
    const mod = await Module.create({ ...data, availableFrom: toDate(data.availableFrom), courseId: course._id, order: data.order ?? (last ? last.order + 1 : 0) });
    res.status(201).json({ id: String(mod._id), title: mod.title, order: mod.order });
  })
);

// Reorder modules (FR-031): body { ids: [moduleId, ...] } in the new order.
router.patch(
  '/courses/:courseId/modules/reorder',
  requireRole('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const course = await assertManager(req.user, req.params.courseId);
    const { ids } = parse(z.object({ ids: z.array(z.string()).min(1).max(200) }), req.body);
    if (!ids.every(validId)) throw badRequest('Invalid module id.');
    await Promise.all(ids.map((id, i) => Module.updateOne({ _id: id, courseId: course._id }, { order: i })));
    res.json({ ok: true });
  })
);

router.patch(
  '/modules/:moduleId',
  requireRole('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const { mod } = await loadModuleFor(req.user, req.params.moduleId, { manage: true });
    const data = parse(moduleSchema.partial(), req.body);
    if ('availableFrom' in data) data.availableFrom = toDate(data.availableFrom);
    Object.assign(mod, data);
    await mod.save();
    res.json({ id: String(mod._id), title: mod.title, order: mod.order, status: mod.status });
  })
);

router.delete(
  '/modules/:moduleId',
  requireRole('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const { mod } = await loadModuleFor(req.user, req.params.moduleId, { manage: true });
    if (await LessonProgress.exists({ moduleId: mod._id })) throw conflict('Students have already completed lessons in this module. Unpublish it instead of deleting.');
    await Promise.all([Lesson.deleteMany({ moduleId: mod._id }), Module.deleteOne({ _id: mod._id })]);
    await audit(req, 'module.delete', 'module', mod._id, { title: mod.title });
    res.json({ ok: true });
  })
);

router.get(
  '/modules/:moduleId/lessons',
  asyncHandler(async (req, res) => {
    const { mod, isManager } = await loadModuleFor(req.user, req.params.moduleId);
    const lessons = await Lesson.find({ moduleId: mod._id, ...(isManager ? {} : { status: 'published' }) }).sort({ order: 1, createdAt: 1 }).lean();
    const done = isManager ? [] : await LessonProgress.find({ studentId: req.user._id, moduleId: mod._id }).lean();
    const doneSet = new Set(done.map((d) => String(d.lessonId)));
    res.json({ lessons: lessons.map((l) => ({ id: String(l._id), title: l.title, minutes: l.minutes, order: l.order, status: l.status, completed: doneSet.has(String(l._id)) })) });
  })
);

router.post(
  '/modules/:moduleId/lessons',
  requireRole('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const { mod } = await loadModuleFor(req.user, req.params.moduleId, { manage: true });
    const data = parse(lessonSchema, req.body);
    const last = await Lesson.findOne({ moduleId: mod._id }).sort({ order: -1 }).lean();
    const lesson = await Lesson.create({ ...data, moduleId: mod._id, courseId: mod.courseId, order: data.order ?? (last ? last.order + 1 : 0) });
    res.status(201).json({ id: String(lesson._id), title: lesson.title });
  })
);

router.patch(
  '/modules/:moduleId/lessons/reorder',
  requireRole('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const { mod } = await loadModuleFor(req.user, req.params.moduleId, { manage: true });
    const { ids } = parse(z.object({ ids: z.array(z.string()).min(1).max(500) }), req.body);
    if (!ids.every(validId)) throw badRequest('Invalid lesson id.');
    await Promise.all(ids.map((id, i) => Lesson.updateOne({ _id: id, moduleId: mod._id }, { order: i })));
    res.json({ ok: true });
  })
);

router.get(
  '/lessons/:lessonId',
  asyncHandler(async (req, res) => {
    const { lesson, mod, isManager } = await loadLessonFor(req.user, req.params.lessonId);
    const siblings = await Lesson.find({ moduleId: mod._id, ...(isManager ? {} : { status: 'published' }) }, '_id title').sort({ order: 1, createdAt: 1 }).lean();
    const idx = siblings.findIndex((s) => String(s._id) === String(lesson._id));
    const allMods = await Module.find({ courseId: mod.courseId, ...(isManager ? {} : { status: 'published' }) }, '_id').sort({ order: 1, createdAt: 1 }).lean();
    const completed = isManager ? false : !!(await LessonProgress.exists({ studentId: req.user._id, lessonId: lesson._id }));
    const quiz = await Quiz.findOne({ courseId: mod.courseId, moduleId: mod._id, status: 'published' }, 'title').lean();
    res.json({
      id: String(lesson._id),
      courseId: String(lesson.courseId),
      moduleId: String(mod._id),
      moduleTitle: mod.title,
      moduleNumber: allMods.findIndex((m) => String(m._id) === String(mod._id)) + 1,
      title: lesson.title,
      content: lesson.content,
      resources: lesson.resources,
      minutes: lesson.minutes,
      status: lesson.status,
      position: idx + 1,
      count: siblings.length,
      prevId: idx > 0 ? String(siblings[idx - 1]._id) : null,
      nextId: idx >= 0 && idx < siblings.length - 1 ? String(siblings[idx + 1]._id) : null,
      completed,
      moduleQuiz: quiz ? { id: String(quiz._id), title: quiz.title } : null
    });
  })
);

router.patch(
  '/lessons/:lessonId',
  requireRole('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const { lesson } = await loadLessonFor(req.user, req.params.lessonId, { manage: true });
    const data = parse(lessonSchema.partial(), req.body);
    Object.assign(lesson, data);
    await lesson.save();
    res.json({ id: String(lesson._id), title: lesson.title, status: lesson.status });
  })
);

router.delete(
  '/lessons/:lessonId',
  requireRole('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const { lesson } = await loadLessonFor(req.user, req.params.lessonId, { manage: true });
    if (await LessonProgress.exists({ lessonId: lesson._id })) throw conflict('Students have completed this lesson. Unpublish it instead of deleting.');
    await Lesson.deleteOne({ _id: lesson._id });
    res.json({ ok: true });
  })
);

// Complete a lesson (UC-06). Idempotent: the unique (studentId, lessonId) index decides who
// "completed it first", and only that call triggers rewards (FR-037/038, TC-008).
router.post(
  '/lessons/:lessonId/complete',
  requireRole('student'),
  asyncHandler(async (req, res) => {
    const { lesson, mod } = await loadLessonFor(req.user, req.params.lessonId);
    const r = await LessonProgress.updateOne(
      { studentId: req.user._id, lessonId: lesson._id },
      { $setOnInsert: { courseId: lesson.courseId, moduleId: lesson.moduleId, completed: true, completedAt: new Date() } },
      { upsert: true }
    );
    const first = r.upsertedCount === 1;
    if (!first) {
      return res.json({ alreadyCompleted: true, rewards: null, progress: await progress.courseProgress(req.user._id, lesson.courseId) });
    }
    let rewards;
    try {
      rewards = await gamification.handleActivity({
        studentId: req.user._id,
        courseId: lesson.courseId,
        kind: 'lesson',
        lesson: { id: String(lesson._id), title: lesson.title, moduleId: mod._id, moduleTitle: mod.title }
      });
    } catch (err) {
      // Roll the completion back so the student can retry; never confirm a reward that failed (UC-06 A3, TC-020).
      await LessonProgress.deleteOne({ studentId: req.user._id, lessonId: lesson._id });
      throw err;
    }
    res.json({ alreadyCompleted: false, rewards, progress: await progress.courseProgress(req.user._id, lesson.courseId) });
  })
);

module.exports = router;
