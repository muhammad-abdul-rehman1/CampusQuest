const { AuditLog } = require('../models');

// Records sensitive operations (FR-140, NFR-017). Never throws - auditing must not break the action.
async function audit(req, action, targetType, targetId, details) {
  try {
    await AuditLog.create({
      actorId: req.user && req.user._id,
      actorName: req.user && req.user.name,
      action,
      targetType,
      targetId: targetId ? String(targetId) : undefined,
      details,
      ip: req.ip
    });
  } catch (err) {
    console.error('[audit] failed to write audit record:', err.message);
  }
}

module.exports = { audit };
