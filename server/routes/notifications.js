const express = require('express');
const asyncHandler = require('../lib/asyncHandler');
const { validId } = require('../lib/validate');
const { notFound } = require('../lib/errors');
const { Notification } = require('../models');
const { authenticate } = require('../middleware/auth');
const { parsePage, pageMeta } = require('../lib/paginate');

const router = express.Router();
router.use(authenticate);

const out = (n) => ({ id: String(n._id), type: n.type, title: n.title, message: n.message, read: n.read, courseId: n.courseId ? String(n.courseId) : null, createdAt: n.createdAt });

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const pg = parsePage(req.query, { defaultLimit: 30 });
    const filter = { userId: req.user._id };
    const [total, unread, rows] = await Promise.all([
      Notification.countDocuments(filter),
      Notification.countDocuments({ ...filter, read: false }),
      Notification.find(filter).sort({ createdAt: -1, _id: -1 }).skip(pg.skip).limit(pg.limit).lean()
    ]);
    res.json({ items: rows.map(out), unread, ...pageMeta(total, pg) });
  })
);

router.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    res.json({ unread: await Notification.countDocuments({ userId: req.user._id, read: false }) });
  })
);

// Declared before '/:id/read' so "read-all" is not parsed as an id.
router.patch(
  '/read-all',
  asyncHandler(async (req, res) => {
    const r = await Notification.updateMany({ userId: req.user._id, read: false }, { read: true });
    res.json({ ok: true, updated: r.modifiedCount });
  })
);

router.patch(
  '/:notificationId/read',
  asyncHandler(async (req, res) => {
    if (!validId(req.params.notificationId)) throw notFound('Notification not found.');
    // userId in the filter => users can only touch their own notifications (NFR-009)
    const n = await Notification.findOneAndUpdate({ _id: req.params.notificationId, userId: req.user._id }, { read: true }, { new: true }).lean();
    if (!n) throw notFound('Notification not found.');
    res.json(out(n));
  })
);

module.exports = router;
