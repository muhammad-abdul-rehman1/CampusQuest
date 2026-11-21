const express = require('express');
const asyncHandler = require('../lib/asyncHandler');
const { z, parse, text, validId } = require('../lib/validate');
const { badRequest, forbidden, notFound, conflict } = require('../lib/errors');
const { Quiz, Question, QuizAttempt, Module, User } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { assertManager, assertViewer, loadQuizFor } = require('../lib/access');
const gamification = require('../services/gamification');
const settings = require('../services/settings');
const { parsePage, pageMeta } = require('../lib/paginate');

const router = express.Router();
router.use(authenticate);

const GRACE_MS = 60 * 1000; // network slack after the timer ends

const dateField = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).nullable().optional();
const toDate = (v) => (v === null || v === undefined || v === '' ? null : new Date(v));

const questionSchema = z
  .object({
    type: z.enum(['mcq', 'tf']),
    text: text(3, 600),
    options: z.array(text(1, 300)).max(6).optional(),
    correctAnswer: z.number().int().min(0).max(5),
    explanation: z.string().trim().max(600).optional(),
    points: z.number().int().min(1).max(100).optional()
  })
  .superRefine((q, ctx) => {
    if (q.type === 'mcq') {
      if (!q.options || q.options.length < 2) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Multiple-choice questions need at least 2 options.' });
      else if (q.correctAnswer >= q.options.length) ctx.addIssue({ code: 'custom', path: ['correctAnswer'], message: 'Pick one of the options as the correct answer.' });
      else if (new Set(q.options.map((o) => o.toLowerCase())).size !== q.options.length) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Options must be different from each other.' });
    } else if (q.correctAnswer > 1) {
      ctx.addIssue({ code: 'custom', path: ['correctAnswer'], message: 'True/false answers must be True or False.' });
    }
  });

const quizFields = {
  title: text(3, 140),
  description: z.string().trim().max(1000).optional(),
  moduleId: z.string().nullable().optional(),
  durationMinutes: z.number().int().min(1).max(300).optional(),
  attemptsAllowed: z.number().int().min(1).max(20).optional(),
  passingScore: z.number().int().min(0).max(100).optional(),
  availableFrom: dateField,
  availableUntil: dateField,
  showResults: z.enum(['full', 'score', 'none']).optional(),
  status: z.enum(['draft', 'published']).optional()
};

function normalizeQuestion(q) {
  const options = q.type === 'tf' ? ['True', 'False'] : q.options;
  return { type: q.type, text: q.text, options, correctAnswer: q.correctAnswer, explanation: q.explanation || '', points: q.points || 1 };
}

function availability(quiz, now = new Date()) {
  if (quiz.availableFrom && quiz.availableFrom > now) return { open: false, reason: 'This quiz opens later.' };
  if (quiz.availableUntil && quiz.availableUntil < now) return { open: false, reason: 'This quiz is closed.' };
  return { open: true };
}

async function gradeAttempt(attempt, questions, rawAnswers, ignoreAnswers) {
  const answers = [];
  let earned = 0;
  let total = 0;
  for (const q of questions) {
    total += q.points;
    let selected = ignoreAnswers ? undefined : rawAnswers[String(q._id)];
    selected = Number.isInteger(selected) && selected >= 0 && selected < q.options.length ? selected : null;
    const correct = selected !== null && selected === q.correctAnswer;
    if (correct) earned += q.points;
    answers.push({ questionId: q._id, selected, correct, points: correct ? q.points : 0 });
  }
  return { answers, earned, total, score: total ? Math.round((earned / total) * 100) : 0 };
}

// Finalise an open attempt: grade server-side, record it, then run the reward pipeline once.
async function finalizeAttempt(quiz, attempt, rawAnswers, now = new Date()) {
  const late = now.getTime() > attempt.expiresAt.getTime();
  const tooLate = now.getTime() > attempt.expiresAt.getTime() + GRACE_MS;
  const questions = await Question.find({ quizId: quiz._id }).sort({ order: 1, createdAt: 1 }).lean();
  const g = await gradeAttempt(attempt, questions, rawAnswers || {}, tooLate);
  const passed = g.score >= quiz.passingScore;

  // Atomic open -> submitted transition. If two submits race, only one wins (and rewards once).
  const done = await QuizAttempt.findOneAndUpdate(
    { _id: attempt._id, status: 'in_progress' },
    { $set: { status: 'submitted', submittedAt: now, timedOut: late, answers: g.answers, pointsEarned: g.earned, pointsTotal: g.total, score: g.score, passed } },
    { new: true }
  );
  if (!done) return { attempt: null };

  let rewards = null;
  try {
    rewards = await gamification.handleActivity({
      studentId: attempt.studentId,
      courseId: quiz.courseId,
      kind: 'quiz',
      quiz: { id: String(quiz._id), title: quiz.title, score: g.score, passed },
      now
    });
  } catch (err) {
    console.error('[quiz] reward pipeline failed for attempt', String(attempt._id), err);
    // The attempt itself stays recorded; no reward is confirmed to the student.
    rewards = null;
  }
  return { attempt: done, questions, rewards };
}

function reviewFor(attempt, questions) {
  const byQ = new Map(attempt.answers.map((a) => [String(a.questionId), a]));
  return questions.map((q, i) => {
    const a = byQ.get(String(q._id));
    return {
      n: i + 1,
      questionId: String(q._id),
      text: q.text,
      options: q.options,
      selected: a ? a.selected : null,
      correctAnswer: q.correctAnswer,
      correct: !!(a && a.correct),
      explanation: q.explanation
    };
  });
}

function resultFor(quiz, attempt, questions) {
  const base = { attemptId: String(attempt._id), score: attempt.score, passed: attempt.passed, timedOut: attempt.timedOut, submittedAt: attempt.submittedAt, correctCount: attempt.answers.filter((a) => a.correct).length, total: attempt.answers.length, showResults: quiz.showResults };
  if (quiz.showResults === 'none') return { attemptId: base.attemptId, passed: base.passed, timedOut: base.timedOut, submittedAt: base.submittedAt, showResults: 'none' };
  if (quiz.showResults === 'full') return { ...base, review: reviewFor(attempt, questions) };
  return base;
}

function quizOut(q, extra = {}) {
  return {
    id: String(q._id),
    courseId: String(q.courseId),
    moduleId: q.moduleId ? String(q.moduleId) : null,
    title: q.title,
    description: q.description,
    durationMinutes: q.durationMinutes,
    attemptsAllowed: q.attemptsAllowed,
    passingScore: q.passingScore,
    availableFrom: q.availableFrom,
    availableUntil: q.availableUntil,
    showResults: q.showResults,
    status: q.status,
    ...extra
  };
}

// Auto-submit attempts whose timer ran out while the student was away (UC-08 A1).
async function settleExpired(quiz, studentId) {
  const open = await QuizAttempt.findOne({ quizId: quiz._id, studentId, status: 'in_progress' });
  if (open && open.expiresAt.getTime() < Date.now()) {
    await finalizeAttempt(quiz, open, {});
    return null;
  }
  return open;
}

async function studentSummary(quiz, studentId) {
  const [used, best, open] = await Promise.all([
    QuizAttempt.countDocuments({ quizId: quiz._id, studentId, status: 'submitted' }),
    QuizAttempt.findOne({ quizId: quiz._id, studentId, status: 'submitted' }).sort({ score: -1 }).lean(),
    QuizAttempt.findOne({ quizId: quiz._id, studentId, status: 'in_progress' }).lean()
  ]);
  const avail = availability(quiz);
  return {
    attemptsUsed: used,
    attemptsLeft: Math.max(0, quiz.attemptsAllowed - used),
    bestScore: best ? best.score : null,
    bestPassed: best ? best.passed : false,
    inProgress: !!open && open.expiresAt.getTime() > Date.now(),
    canStart: avail.open && used < quiz.attemptsAllowed,
    blockedReason: !avail.open ? avail.reason : used >= quiz.attemptsAllowed ? 'Attempt limit reached.' : null
  };
}

router.get(
  '/courses/:courseId/quizzes',
  asyncHandler(async (req, res) => {
    const { course, isManager } = await assertViewer(req.user, req.params.courseId);
    const quizzes = await Quiz.find({ courseId: course._id, ...(isManager ? {} : { status: 'published' }) }).sort({ createdAt: 1 }).lean();
    const out = [];
    for (const q of quizzes) {
      if (isManager) {
        const [questionCount, attemptCount] = await Promise.all([Question.countDocuments({ quizId: q._id }), QuizAttempt.countDocuments({ quizId: q._id, status: 'submitted' })]);
        out.push(quizOut(q, { questionCount, attemptCount }));
      } else {
        const [questionCount, summary] = await Promise.all([Question.countDocuments({ quizId: q._id }), studentSummary(q, req.user._id)]);
        out.push(quizOut(q, { questionCount, ...summary }));
      }
    }
    res.json({ quizzes: out });
  })
);

router.post(
  '/courses/:courseId/quizzes',
  requireRole('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const course = await assertManager(req.user, req.params.courseId);
    const data = parse(z.object({ ...quizFields, questions: z.array(questionSchema).max(100).optional() }), req.body);
    if (data.moduleId) {
      if (!validId(data.moduleId) || !(await Module.exists({ _id: data.moduleId, courseId: course._id }))) throw badRequest('Choose a module from this course.');
    }
    if (data.availableFrom && data.availableUntil && toDate(data.availableUntil) <= toDate(data.availableFrom)) throw badRequest('The closing time must be after the opening time.');
    const { questions, ...rest } = data;
    const quiz = await Quiz.create({ ...rest, moduleId: data.moduleId || null, availableFrom: toDate(data.availableFrom), availableUntil: toDate(data.availableUntil), courseId: course._id });
    if (questions && questions.length) await Question.insertMany(questions.map((q, i) => ({ ...normalizeQuestion(q), quizId: quiz._id, order: i })));
    res.status(201).json(quizOut(quiz));
  })
);

router.get(
  '/quizzes/:quizId',
  asyncHandler(async (req, res) => {
    const { quiz, isManager } = await loadQuizFor(req.user, req.params.quizId);
    const questions = await Question.find({ quizId: quiz._id }).sort({ order: 1, createdAt: 1 }).lean();
    if (isManager) {
      return res.json(
        quizOut(quiz, {
          questions: questions.map((q) => ({ id: String(q._id), type: q.type, text: q.text, options: q.options, correctAnswer: q.correctAnswer, explanation: q.explanation, points: q.points }))
        })
      );
    }
    const cfg = await settings.get();
    const summary = await studentSummary(quiz, req.user._id);
    res.json(
      quizOut(quiz, {
        questionCount: questions.length,
        totalPoints: questions.reduce((t, q) => t + q.points, 0),
        rewards: { pass: cfg.xp.quizPass, bonus: cfg.xp.quizBonus, bonusThreshold: cfg.xp.quizBonusThreshold },
        ...summary
      })
    );
  })
);

router.patch(
  '/quizzes/:quizId',
  requireRole('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const { quiz, course } = await loadQuizFor(req.user, req.params.quizId, { manage: true });
    const data = parse(z.object(quizFields).partial(), req.body);
    if ('moduleId' in data && data.moduleId) {
      if (!validId(data.moduleId) || !(await Module.exists({ _id: data.moduleId, courseId: course._id }))) throw badRequest('Choose a module from this course.');
    }
    if ('availableFrom' in data) data.availableFrom = toDate(data.availableFrom);
    if ('availableUntil' in data) data.availableUntil = toDate(data.availableUntil);
    if (data.status === 'published' && (await Question.countDocuments({ quizId: quiz._id })) === 0) throw badRequest('Add at least one question before publishing.');
    const from = 'availableFrom' in data ? data.availableFrom : quiz.availableFrom;
    const until = 'availableUntil' in data ? data.availableUntil : quiz.availableUntil;
    if (from && until && until <= from) throw badRequest('The closing time must be after the opening time.');
    Object.assign(quiz, data);
    await quiz.save();
    res.json(quizOut(quiz));
  })
);

router.delete(
  '/quizzes/:quizId',
  requireRole('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const { quiz } = await loadQuizFor(req.user, req.params.quizId, { manage: true });
    if (await QuizAttempt.exists({ quizId: quiz._id, status: 'submitted' })) throw conflict('Students have already attempted this quiz. Set it to draft instead of deleting it.');
    await Promise.all([Question.deleteMany({ quizId: quiz._id }), QuizAttempt.deleteMany({ quizId: quiz._id }), Quiz.deleteOne({ _id: quiz._id })]);
    res.json({ ok: true });
  })
);

// ---- question editor (instructor) ----
router.post(
  '/quizzes/:quizId/questions',
  requireRole('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const { quiz } = await loadQuizFor(req.user, req.params.quizId, { manage: true });
    const q = parse(questionSchema, req.body);
    const last = await Question.findOne({ quizId: quiz._id }).sort({ order: -1 }).lean();
    const doc = await Question.create({ ...normalizeQuestion(q), quizId: quiz._id, order: last ? last.order + 1 : 0 });
    res.status(201).json({ id: String(doc._id) });
  })
);

// Bulk import (CSV upload): validates every question with the same rules as the editor.
router.post(
  '/quizzes/:quizId/questions/import',
  requireRole('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const { quiz } = await loadQuizFor(req.user, req.params.quizId, { manage: true });
    const { questions } = parse(z.object({ questions: z.array(z.any()).min(1, 'No questions to import.').max(100, 'Import at most 100 questions at a time.') }), req.body);
    const clean = questions.map((q, i) => {
      const r = questionSchema.safeParse(q);
      if (!r.success) throw badRequest(`Question ${i + 1}: ${r.error.issues[0].message}`);
      return r.data;
    });
    const existing = await Question.countDocuments({ quizId: quiz._id });
    if (existing + clean.length > 200) throw badRequest('A quiz can have at most 200 questions.');
    const last = await Question.findOne({ quizId: quiz._id }).sort({ order: -1 }).lean();
    const start = last ? last.order + 1 : 0;
    await Question.insertMany(clean.map((q, i) => ({ ...normalizeQuestion(q), quizId: quiz._id, order: start + i })));
    res.status(201).json({ added: clean.length });
  })
);

async function loadQuestion(user, id) {
  if (!validId(id)) throw notFound('Question not found.');
  const q = await Question.findById(id);
  if (!q) throw notFound('Question not found.');
  await loadQuizFor(user, q.quizId, { manage: true });
  return q;
}

router.patch(
  '/questions/:questionId',
  requireRole('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const q = await loadQuestion(req.user, req.params.questionId);
    const data = parse(questionSchema, req.body);
    Object.assign(q, normalizeQuestion(data));
    await q.save();
    res.json({ id: String(q._id) });
  })
);

router.delete(
  '/questions/:questionId',
  requireRole('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const q = await loadQuestion(req.user, req.params.questionId);
    await Question.deleteOne({ _id: q._id });
    res.json({ ok: true });
  })
);

// ---- attempts (student) ----
router.post(
  '/quizzes/:quizId/start',
  requireRole('student'),
  asyncHandler(async (req, res) => {
    const { quiz } = await loadQuizFor(req.user, req.params.quizId);
    const avail = availability(quiz);
    if (!avail.open) throw forbidden(avail.reason);

    let open = await settleExpired(quiz, req.user._id); // may auto-submit an abandoned timed-out attempt
    const used = await QuizAttempt.countDocuments({ quizId: quiz._id, studentId: req.user._id, status: 'submitted' });
    if (!open && used >= quiz.attemptsAllowed) throw forbidden('You have used all attempts for this quiz.'); // FR-066

    const questions = await Question.find({ quizId: quiz._id }).sort({ order: 1, createdAt: 1 }).lean();
    if (!questions.length) throw badRequest('This quiz has no questions yet.');

    if (!open) {
      const now = new Date();
      try {
        open = await QuizAttempt.create({ quizId: quiz._id, courseId: quiz.courseId, studentId: req.user._id, startedAt: now, expiresAt: new Date(now.getTime() + quiz.durationMinutes * 60000), pointsTotal: questions.reduce((t, q) => t + q.points, 0) });
      } catch (err) {
        if (err.code !== 11000) throw err;
        open = await QuizAttempt.findOne({ quizId: quiz._id, studentId: req.user._id, status: 'in_progress' }); // double-click: resume the same one
      }
    }
    res.status(201).json({
      attemptId: String(open._id),
      startedAt: open.startedAt,
      expiresAt: open.expiresAt,
      secondsLeft: Math.max(0, Math.round((open.expiresAt.getTime() - Date.now()) / 1000)),
      quiz: { id: String(quiz._id), title: quiz.title, durationMinutes: quiz.durationMinutes },
      // Correct answers are deliberately NOT included.
      questions: questions.map((q) => ({ id: String(q._id), type: q.type, text: q.text, options: q.options, points: q.points }))
    });
  })
);

const submitSchema = z.object({ attemptId: z.string().optional(), answers: z.record(z.string(), z.number().int().min(0).max(5)).default({}) });

router.post(
  '/quizzes/:quizId/submit',
  requireRole('student'),
  asyncHandler(async (req, res) => {
    const { quiz } = await loadQuizFor(req.user, req.params.quizId);
    const { attemptId, answers } = parse(submitSchema, req.body);
    const filter = { quizId: quiz._id, studentId: req.user._id, status: 'in_progress', ...(attemptId && validId(attemptId) ? { _id: attemptId } : {}) };
    const attempt = await QuizAttempt.findOne(filter);
    if (!attempt) {
      // Already submitted (double-click / retry)? Return the recorded result instead of failing, and never re-reward.
      const last = await QuizAttempt.findOne({ quizId: quiz._id, studentId: req.user._id, status: 'submitted', ...(attemptId && validId(attemptId) ? { _id: attemptId } : {}) }).sort({ submittedAt: -1 });
      if (last) {
        const qs = await Question.find({ quizId: quiz._id }).sort({ order: 1, createdAt: 1 }).lean();
        return res.json({ duplicate: true, result: resultFor(quiz, last, qs), rewards: null });
      }
      throw conflict('There is no active attempt to submit. Start the quiz first.');
    }
    const out = await finalizeAttempt(quiz, attempt, answers);
    if (!out.attempt) return res.status(409).json({ error: 'This attempt was already submitted.' });
    const used = await QuizAttempt.countDocuments({ quizId: quiz._id, studentId: req.user._id, status: 'submitted' });
    res.json({ result: resultFor(quiz, out.attempt, out.questions), rewards: out.rewards, attemptsUsed: used, attemptsLeft: Math.max(0, quiz.attemptsAllowed - used) });
  })
);

// Discard an open attempt without grading (it is not counted).
router.post(
  '/quizzes/:quizId/abandon',
  requireRole('student'),
  asyncHandler(async (req, res) => {
    const { quiz } = await loadQuizFor(req.user, req.params.quizId);
    const open = await QuizAttempt.findOne({ quizId: quiz._id, studentId: req.user._id, status: 'in_progress' });
    if (open && open.expiresAt.getTime() < Date.now()) await finalizeAttempt(quiz, open, {});
    else if (open) await QuizAttempt.deleteOne({ _id: open._id });
    res.json({ ok: true });
  })
);

router.get(
  '/quizzes/:quizId/results',
  requireRole('student'),
  asyncHandler(async (req, res) => {
    const { quiz } = await loadQuizFor(req.user, req.params.quizId);
    const attempts = await QuizAttempt.find({ quizId: quiz._id, studentId: req.user._id, status: 'submitted' }).sort({ submittedAt: -1 }).lean();
    const hide = quiz.showResults === 'none';
    const list = attempts.map((a) => ({ attemptId: String(a._id), score: hide ? undefined : a.score, passed: a.passed, submittedAt: a.submittedAt, timedOut: a.timedOut }));
    let latest = null;
    if (attempts.length) {
      const pick = (req.query.attemptId && attempts.find((a) => String(a._id) === req.query.attemptId)) || attempts[0];
      const qs = await Question.find({ quizId: quiz._id }).sort({ order: 1, createdAt: 1 }).lean();
      latest = resultFor(quiz, pick, qs);
    }
    const summary = await studentSummary(quiz, req.user._id);
    res.json({ quiz: quizOut(quiz), attempts: list, latest, ...summary });
  })
);

// Instructor view of attempts + per-question performance (FR-064).
router.get(
  '/quizzes/:quizId/attempts',
  requireRole('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const { quiz } = await loadQuizFor(req.user, req.params.quizId, { manage: true });
    const pg = parsePage(req.query, { defaultLimit: 50 });
    const filter = { quizId: quiz._id, status: 'submitted' };
    const [total, rows, all, questions] = await Promise.all([
      QuizAttempt.countDocuments(filter),
      QuizAttempt.find(filter).sort({ submittedAt: -1 }).skip(pg.skip).limit(pg.limit).lean(),
      QuizAttempt.find(filter, 'score passed answers').lean(),
      Question.find({ quizId: quiz._id }).sort({ order: 1 }).lean()
    ]);
    const users = await User.find({ _id: { $in: rows.map((r) => r.studentId) } }, 'name').lean();
    const nameOf = new Map(users.map((u) => [String(u._id), u.name]));
    const scores = all.map((a) => a.score);
    const questionStats = questions.map((q) => {
      let right = 0;
      let seen = 0;
      for (const a of all) {
        const ans = a.answers.find((x) => String(x.questionId) === String(q._id));
        if (ans) {
          seen++;
          if (ans.correct) right++;
        }
      }
      return { id: String(q._id), text: q.text, correctRate: seen ? Math.round((right / seen) * 100) : null, answered: seen };
    });
    res.json({
      attempts: rows.map((r) => ({ id: String(r._id), studentId: String(r.studentId), studentName: nameOf.get(String(r.studentId)) || 'Unknown', score: r.score, passed: r.passed, timedOut: r.timedOut, submittedAt: r.submittedAt })),
      stats: { attempts: total, average: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null, passRate: all.length ? Math.round((all.filter((a) => a.passed).length / all.length) * 100) : null },
      questionStats,
      ...pageMeta(total, pg)
    });
  })
);

module.exports = router;
module.exports.finalizeAttempt = finalizeAttempt;
