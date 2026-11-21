const express = require('express');
const asyncHandler = require('../lib/asyncHandler');
const { z, parse, text, validId } = require('../lib/validate');
const { badRequest, conflict } = require('../lib/errors');
const { Quest, QuestProgress, Enrollment, Quiz, Module, Course } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { assertManager, loadQuestFor, canManage } = require('../lib/access');
const questsSvc = require('../services/quests');
const gamification = require('../services/gamification');
const settings = require('../services/settings');
const { notify } = require('../services/notifications');
const { dayKey } = require('../lib/dates');
const { QUEST_TYPES, OBJECTIVE_KINDS } = require('../models');

const router = express.Router();
router.use(authenticate);

const dateField = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).nullable().optional();
const toDate = (v, endOfDay = false) => {
  if (v === null || v === undefined || v === '') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T${endOfDay ? '23:59:59' : '00:00:00'}`);
  return new Date(v);
};

const objectiveSchema = z.object({
  kind: z.enum(OBJECTIVE_KINDS),
  target: z.number().int().min(1).max(1000).default(1),
  minScore: z.number().int().min(0).max(100).optional(),
  quizId: z.string().nullable().optional(),
  moduleId: z.string().nullable().optional()
});

const questFields = {
  title: text(3, 140),
  description: z.string().trim().max(600).optional(),
  type: z.enum(QUEST_TYPES),
  objective: objectiveSchema,
  xpReward: z.number().int().min(5, 'The XP reward must be between 5 and 500.').max(500, 'The XP reward must be between 5 and 500.'),
  availableFrom: dateField,
  deadline: dateField,
  status: z.enum(['active', 'archived']).optional()
};

async function checkObjective(course, o) {
  if (o.kind === 'quiz_score' && !(o.minScore > 0)) throw badRequest('Set the minimum quiz score for this quest.');
  if (o.quizId && (!validId(o.quizId) || !(await Quiz.exists({ _id: o.quizId, courseId: course._id })))) throw badRequest('Choose a quiz from this course.');
  if (o.moduleId && (!validId(o.moduleId) || !(await Module.exists({ _id: o.moduleId, courseId: course._id })))) throw badRequest('Choose a module from this course.');
}

function questOut(q, extra = {}) {
  return {
    id: String(q._id),
    courseId: String(q.courseId),
    title: q.title,
    description: q.description,
    type: q.type,
    objective: { kind: q.objective.kind, target: q.objective.target, minScore: q.objective.minScore || 0, quizId: q.objective.quizId ? String(q.objective.quizId) : null, moduleId: q.objective.moduleId ? String(q.objective.moduleId) : null },
    xpReward: q.xpReward,
    availableFrom: q.availableFrom,
    deadline: q.deadline,
    status: q.status,
    createdAt: q.createdAt,
    ...extra
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { user } = req;
    const courseId = req.query.courseId && validId(String(req.query.courseId)) ? String(req.query.courseId) : undefined;
    if (user.role === 'student') {
      const [list, completedAllTime] = await Promise.all([questsSvc.listForStudent(user._id, { courseId }), QuestProgress.countDocuments({ studentId: user._id, completed: true })]);
      return res.json({ quests: list, stats: { completedAllTime } });
    }
    // Instructor / admin: quests of managed courses with completion stats
    let courseIds;
    if (courseId) {
      await assertManager(user, courseId);
      courseIds = [courseId];
    } else if (user.role === 'instructor') {
      courseIds = await Course.find({ instructorId: user._id }).distinct('_id');
    }
    const quests = await Quest.find(courseIds ? { courseId: { $in: courseIds } } : {}).sort({ createdAt: -1 }).limit(200).lean();
    const out = [];
    for (const q of quests) {
      const [enrolled, completed] = await Promise.all([Enrollment.countDocuments({ courseId: q.courseId, status: 'active' }), QuestProgress.distinct('studentId', { questId: q._id, completed: true }).then((a) => a.length)]);
      out.push(questOut(q, { enrolled, completedCount: completed, isNew: Date.now() - new Date(q.createdAt).getTime() < 15 * 60 * 1000 }));
    }
    res.json({ quests: out });
  })
);

router.post(
  '/',
  requireRole('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const data = parse(z.object({ ...questFields, courseId: z.string() }), req.body);
    const course = await assertManager(req.user, data.courseId);
    await checkObjective(course, data.objective);
    const availableFrom = toDate(data.availableFrom);
    const deadline = toDate(data.deadline, true);
    if (availableFrom && deadline && deadline <= availableFrom) throw badRequest('The deadline must be after the start date.');
    if (deadline && deadline < new Date()) throw badRequest('The deadline is in the past.');
    const { courseId: _c, ...rest } = data;
    const quest = await Quest.create({ ...rest, availableFrom, deadline, courseId: course._id, createdBy: req.user._id });

    // Tell enrolled students a new quest exists (FR-120)
    if (course.status === 'published') {
      const students = await Enrollment.find({ courseId: course._id, status: 'active' }, 'studentId').lean();
      for (const s of students) await notify(s.studentId, { type: 'course', courseId: course._id, title: `New quest in ${course.code || course.title}: ${quest.title}`, message: `+${quest.xpReward} XP`, dedupeKey: `newquest:${quest._id}` });
    }
    res.status(201).json(questOut(quest));
  })
);

router.get(
  '/:questId',
  asyncHandler(async (req, res) => {
    const { quest, isManager } = await loadQuestFor(req.user, req.params.questId);
    if (isManager) return res.json(questOut(quest));
    const list = await questsSvc.listForStudent(req.user._id, { courseId: quest.courseId });
    const found = list.find((q) => q.id === String(quest._id));
    if (!found) return res.status(404).json({ error: 'Quest not found.' });
    res.json(found);
  })
);

router.patch(
  '/:questId',
  requireRole('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const { quest, course } = await loadQuestFor(req.user, req.params.questId, { manage: true });
    const data = parse(z.object(questFields).partial(), req.body);
    if (data.objective) await checkObjective(course, data.objective);
    if ('availableFrom' in data) data.availableFrom = toDate(data.availableFrom);
    if ('deadline' in data) data.deadline = toDate(data.deadline, true);
    const from = 'availableFrom' in data ? data.availableFrom : quest.availableFrom;
    const dl = 'deadline' in data ? data.deadline : quest.deadline;
    if (from && dl && dl <= from) throw badRequest('The deadline must be after the start date.');
    Object.assign(quest, data);
    await quest.save();
    res.json(questOut(quest));
  })
);

router.get(
  '/:questId/progress',
  requireRole('student'),
  asyncHandler(async (req, res) => {
    const { quest } = await loadQuestFor(req.user, req.params.questId);
    const list = await questsSvc.listForStudent(req.user._id, { courseId: quest.courseId });
    const found = list.find((q) => q.id === String(quest._id));
    if (!found) return res.status(404).json({ error: 'Quest not found.' });
    res.json({ progress: found.progress, target: found.target, status: found.status, completedAt: found.completedAt });
  })
);

// "Request quest completion validation" (UC-07). The server decides - the client cannot claim a quest.
router.post(
  '/:questId/complete',
  requireRole('student'),
  asyncHandler(async (req, res) => {
    const { quest } = await loadQuestFor(req.user, req.params.questId);
    const now = new Date();
    const cfg = await settings.get();
    if (quest.status !== 'active' || (quest.availableFrom && quest.availableFrom > now)) throw badRequest('This quest is not available.');

    const periodKey = questsSvc.periodKeyFor(quest, now, cfg.timezone);
    const prog = await QuestProgress.findOne({ studentId: req.user._id, questId: quest._id, periodKey });

    if (prog && prog.completed) return res.json({ status: 'already_completed', duplicate: true, rewards: null }); // A3 / TC-012
    if (quest.deadline && quest.deadline < now) throw conflict('This quest has expired.', { status: 'expired' }); // A2
    if (!prog || prog.progress < quest.objective.target) {
      throw conflict('The quest objective is not complete yet.', { status: 'incomplete', progress: prog ? prog.progress : 0, target: quest.objective.target }); // A1/A4
    }
    const rewards = await gamification.claimQuest(req.user._id, quest, prog, now);
    res.json({ status: 'completed', rewards });
  })
);

module.exports = router;
