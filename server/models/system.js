const { mongoose } = require('../db');
const { Schema } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const notificationSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, maxlength: 140 },
    message: { type: String, default: '', maxlength: 600 },
    type: { type: String, enum: ['quest', 'achievement', 'level', 'deadline', 'course', 'system'], default: 'system' },
    courseId: { type: ObjectId, ref: 'Course', default: null },
    read: { type: Boolean, default: false },
    // Prevents duplicate notifications (e.g. a deadline reminder created twice).
    dedupeKey: { type: String }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, read: 1 });
notificationSchema.index({ userId: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });

const auditLogSchema = new Schema(
  {
    actorId: { type: ObjectId, ref: 'User', index: true },
    actorName: String,
    action: { type: String, required: true },
    targetType: String,
    targetId: String,
    details: Schema.Types.Mixed,
    ip: String
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
auditLogSchema.index({ createdAt: -1 });

const settingSchema = new Schema({ key: { type: String, unique: true, required: true }, value: Schema.Types.Mixed }, { timestamps: true });

module.exports = {
  Notification: mongoose.model('Notification', notificationSchema),
  AuditLog: mongoose.model('AuditLog', auditLogSchema),
  Setting: mongoose.model('Setting', settingSchema)
};
