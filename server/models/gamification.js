const { mongoose } = require('../db');
const { Schema } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const QUEST_TYPES = ['Daily', 'Weekly', 'Course', 'Module', 'Quiz', 'Streak', 'Achievement'];
const OBJECTIVE_KINDS = ['complete_lessons', 'pass_quiz', 'quiz_score', 'complete_module', 'streak_days', 'activities'];

const questSchema = new Schema(
  {
    courseId: { type: ObjectId, ref: 'Course', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    description: { type: String, trim: true, maxlength: 600, default: '' },
    type: { type: String, enum: QUEST_TYPES, required: true },
    objective: {
      kind: { type: String, enum: OBJECTIVE_KINDS, required: true },
      target: { type: Number, default: 1, min: 1, max: 1000 },
      minScore: { type: Number, default: 0, min: 0, max: 100 }, // quiz_score
      quizId: { type: ObjectId, default: null }, // optional restriction
      moduleId: { type: ObjectId, default: null } // optional restriction
    },
    xpReward: { type: Number, required: true, min: 1, max: 1000 },
    availableFrom: { type: Date, default: null },
    deadline: { type: Date, default: null },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
    createdBy: { type: ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

const questProgressSchema = new Schema(
  {
    studentId: { type: ObjectId, ref: 'User', required: true },
    questId: { type: ObjectId, ref: 'Quest', required: true },
    courseId: { type: ObjectId, ref: 'Course', required: true },
    // 'once' for non-recurring quests, YYYY-MM-DD for Daily, YYYY-Www for Weekly.
    periodKey: { type: String, required: true },
    progress: { type: Number, default: 0 },
    completed: { type: Boolean, default: false },
    completedAt: Date
  },
  { timestamps: true }
);
questProgressSchema.index({ studentId: 1, questId: 1, periodKey: 1 }, { unique: true });
questProgressSchema.index({ questId: 1, completed: 1 });

const xpTransactionSchema = new Schema(
  {
    studentId: { type: ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true },
    sourceType: {
      type: String,
      enum: ['lesson', 'module', 'quiz_pass', 'quiz_bonus', 'quest', 'streak', 'achievement', 'adjustment'],
      required: true
    },
    sourceId: { type: String, default: '' },
    courseId: { type: ObjectId, ref: 'Course', default: null },
    description: { type: String, default: '' },
    // The idempotency key. The UNIQUE index is what makes duplicate XP impossible
    // (FR-078, FR-089, NFR-026, TC-012), even under concurrent requests.
    eventKey: { type: String, required: true, unique: true },
    status: { type: String, enum: ['completed'], default: 'completed' }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
xpTransactionSchema.index({ studentId: 1, createdAt: -1 });

const achievementSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    icon: { type: String, default: 'medal' },
    // Data-driven condition: { metric, target } - metrics are resolved in services/achievements.js
    condition: {
      metric: { type: String, required: true },
      target: { type: Number, required: true, min: 1 }
    },
    xpReward: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

const studentAchievementSchema = new Schema(
  {
    studentId: { type: ObjectId, ref: 'User', required: true },
    achievementId: { type: ObjectId, ref: 'Achievement', required: true },
    unlockedAt: { type: Date, default: Date.now }
  },
  { timestamps: false }
);
studentAchievementSchema.index({ studentId: 1, achievementId: 1 }, { unique: true }); // FR-099

const streakSchema = new Schema(
  {
    studentId: { type: ObjectId, ref: 'User', required: true, unique: true },
    currentStreak: { type: Number, default: 0 },
    longestStreak: { type: Number, default: 0 },
    lastQualifyingDate: { type: String, default: null }, // YYYY-MM-DD in the platform timezone
    streakStartDate: { type: String, default: null },
    recentDays: [{ type: String }], // last 30 qualifying day keys
    timezone: { type: String, default: 'Asia/Karachi' }
  },
  { timestamps: true }
);

module.exports = {
  QUEST_TYPES,
  OBJECTIVE_KINDS,
  Quest: mongoose.model('Quest', questSchema),
  QuestProgress: mongoose.model('QuestProgress', questProgressSchema),
  XpTransaction: mongoose.model('XpTransaction', xpTransactionSchema),
  Achievement: mongoose.model('Achievement', achievementSchema),
  StudentAchievement: mongoose.model('StudentAchievement', studentAchievementSchema),
  Streak: mongoose.model('Streak', streakSchema)
};
