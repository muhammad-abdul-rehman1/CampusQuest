const { mongoose } = require('../db');
const { Schema } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const quizSchema = new Schema(
  {
    courseId: { type: ObjectId, ref: 'Course', required: true, index: true },
    moduleId: { type: ObjectId, ref: 'Module', default: null },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    durationMinutes: { type: Number, default: 10, min: 1, max: 300 },
    attemptsAllowed: { type: Number, default: 2, min: 1, max: 20 },
    passingScore: { type: Number, default: 60, min: 0, max: 100 },
    availableFrom: { type: Date, default: null },
    availableUntil: { type: Date, default: null },
    // 'full' = score + answer review, 'score' = score only, 'none' = pass/fail only (FR-062)
    showResults: { type: String, enum: ['full', 'score', 'none'], default: 'full' },
    status: { type: String, enum: ['draft', 'published'], default: 'draft' }
  },
  { timestamps: true }
);

const questionSchema = new Schema(
  {
    quizId: { type: ObjectId, ref: 'Quiz', required: true, index: true },
    type: { type: String, enum: ['mcq', 'tf'], required: true },
    text: { type: String, required: true, trim: true, maxlength: 600 },
    options: [{ type: String, trim: true, maxlength: 300 }],
    // Index into `options` (tf questions use ['True','False']).
    correctAnswer: { type: Number, required: true, min: 0 },
    explanation: { type: String, trim: true, maxlength: 600, default: '' },
    points: { type: Number, default: 1, min: 1, max: 100 },
    order: { type: Number, default: 0 }
  },
  { timestamps: true }
);

const attemptSchema = new Schema(
  {
    quizId: { type: ObjectId, ref: 'Quiz', required: true },
    courseId: { type: ObjectId, ref: 'Course', required: true },
    studentId: { type: ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['in_progress', 'submitted'], default: 'in_progress' },
    startedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    submittedAt: Date,
    timedOut: { type: Boolean, default: false },
    // Answers are stored with the attempt (FR-063).
    answers: [
      {
        _id: false,
        questionId: { type: ObjectId, required: true },
        selected: { type: Number, default: null },
        correct: { type: Boolean, default: false },
        points: { type: Number, default: 0 }
      }
    ],
    pointsEarned: { type: Number, default: 0 },
    pointsTotal: { type: Number, default: 0 },
    score: { type: Number, default: 0 }, // percent 0-100
    passed: { type: Boolean, default: false }
  },
  { timestamps: true }
);
attemptSchema.index({ quizId: 1, studentId: 1, status: 1 });
// Only one open attempt per student+quiz, so double-clicking "Start" cannot burn an attempt.
attemptSchema.index(
  { quizId: 1, studentId: 1 },
  { unique: true, partialFilterExpression: { status: 'in_progress' }, name: 'one_open_attempt' }
);

module.exports = {
  Quiz: mongoose.model('Quiz', quizSchema),
  Question: mongoose.model('Question', questionSchema),
  QuizAttempt: mongoose.model('QuizAttempt', attemptSchema)
};
