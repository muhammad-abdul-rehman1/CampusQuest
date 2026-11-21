const express = require('express');
const asyncHandler = require('../lib/asyncHandler');
const { badRequest, notFound } = require('../lib/errors');
const { validId } = require('../lib/validate');
const { Enrollment, StudentProfile, User, Course } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { assertManager } = require('../lib/access');
const { levelForXp } = require('../lib/levels');
const { initials } = require('../lib/serialize');
const gamification = require('../services/gamification');
const achievements = require('../services/achievements');
const streaks = require('../services/streaks');
const settings = require('../services/settings');

const router = express.Router();
router.use(authenticate);

router.get('/xp', requireRole('student'), asyncHandler(async (req, res) => res.json(await gamification.getXpSummary(req.user._id))));
router.get('/level', requireRole('student'), asyncHandler(async (req, res) => res.json(await gamification.getXpSummary(req.user._id))));
router.get('/achievements', requireRole('student'), asyncHandler(async (req, res) => res.json({ achievements: await achievements.listForStudent(req.user._id) })));
router.get('/streak', requireRole('student'), asyncHandler(async (req, res) => res.json(await streaks.getStreak(req.user._id))));

// Course leaderboard (FR-108..FR-115). Only members of the course (or its managers) can see it.
// Students who opted out appear as "Anonymous learner" to everyone else, but still see their own rank.
router.get(
  '/leaderboard',
  asyncHandler(async (req, res) => {
    const { user } = req;
    let courseId = req.query.courseId && String(req.query.courseId);
    if (courseId && !validId(courseId)) throw badRequest('Invalid course.');

    if (user.role === 'student') {
      if (!courseId) {
        const first = await Enrollment.findOne({ studentId: user._id, status: 'active' }).sort({ enrolledAt: 1 }).lean();
        if (!first) return res.json({ course: null, entries: [], me: null, courses: [] });
        courseId = String(first.courseId);
      } else if (!(await Enrollment.exists({ studentId: user._id, courseId, status: 'active' }))) {
        return res.status(403).json({ error: 'Only students enrolled in this course can see its leaderboard.' });
      }
    } else {
      if (!courseId) throw badRequest('Choose a course.');
      await assertManager(user, courseId);
    }

    const course = await Course.findById(courseId, 'title code').lean();
    if (!course) throw notFound('Course not found.');
    const cfg = await settings.get();
    const members = await Enrollment.find({ courseId, status: 'active' }, 'studentId').lean();
    const ids = members.map((m) => m.studentId);
    const [users, profiles] = await Promise.all([User.find({ _id: { $in: ids }, status: 'active' }, 'name').lean(), StudentProfile.find({ userId: { $in: ids } }, 'userId xp leaderboardVisible').lean()]);
    const prof = new Map(profiles.map((p) => [String(p.userId), p]));

    const rows = users
      .map((u) => {
        const p = prof.get(String(u._id)) || { xp: 0, leaderboardVisible: true };
        return { id: String(u._id), name: u.name, xp: p.xp, visible: p.leaderboardVisible !== false };
      })
      .sort((a, b) => b.xp - a.xp || a.name.localeCompare(b.name));

    // Competition ranking: equal XP => equal rank
    let lastXp = null;
    let lastRank = 0;
    rows.forEach((r, i) => {
      r.rank = r.xp === lastXp ? lastRank : i + 1;
      lastXp = r.xp;
      lastRank = r.rank;
    });

    const canSeeAll = user.role !== 'student';
    const shape = (r) => {
      const isMe = String(r.id) === String(user._id);
      const reveal = isMe || r.visible || canSeeAll;
      return { rank: r.rank, userId: reveal ? r.id : undefined, name: reveal ? r.name : 'Anonymous learner', initials: reveal ? initials(r.name) : '?', level: levelForXp(r.xp, cfg.levelBase), xp: r.xp, isMe, hidden: !r.visible };
    };
    const limit = Math.min(100, parseInt(req.query.limit, 10) || 50);
    const entries = rows.slice(0, limit).map(shape);
    const mine = rows.find((r) => String(r.id) === String(user._id));
    const courses = user.role === 'student' ? await Enrollment.find({ studentId: user._id, status: 'active' }).populate('courseId', 'title code').lean() : [];
    res.json({
      course: { id: String(course._id), title: course.title, code: course.code },
      entries,
      me: mine ? shape(mine) : null,
      totalMembers: rows.length,
      courses: courses.filter((c) => c.courseId).map((c) => ({ id: String(c.courseId._id), title: c.courseId.title, code: c.courseId.code }))
    });
  })
);

module.exports = router;
