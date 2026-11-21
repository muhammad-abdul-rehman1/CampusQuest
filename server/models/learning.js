const { mongoose } = require('../db');
const { Schema } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const courseSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    code: { type: String, trim: true, uppercase: true, maxlength: 20, default: '' },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    category: { type: String, trim: true, maxlength: 60, default: '' },
    term: { type: String, trim: true, maxlength: 40, default: '' },
    instructorId: { type: ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft', index: true },
    enrollmentOpen: { type: Boolean, default: true },
    // When set, students must supply this code to enrol (FR-025 "authorized enrollment mechanism").
    enrollmentCode: { type: String, trim: true, maxlength: 40, default: '' }
  },
  { timestamps: true }
);

const enrollmentSchema = new Schema(
  {
    studentId: { type: ObjectId, ref: 'User', required: true },
    courseId: { type: ObjectId, ref: 'Course', required: true },
    status: { type: String, enum: ['active', 'dropped'], default: 'active' },
    enrolledAt: { type: Date, default: Date.now }
  },
  { timestamps: false }
);
enrollmentSchema.index({ studentId: 1, courseId: 1 }, { unique: true });
enrollmentSchema.index({ courseId: 1, status: 1 });

const moduleSchema = new Schema(
  {
    courseId: { type: ObjectId, ref: 'Course', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 600, default: '' },
    order: { type: Number, default: 0 },
    status: { type: String, enum: ['draft', 'published'], default: 'published' },
    // Optional scheduled release ("Opens Monday")
    availableFrom: { type: Date, default: null }
  },
  { timestamps: true }
);

const lessonSchema = new Schema(
  {
    courseId: { type: ObjectId, ref: 'Course', required: true, index: true },
    moduleId: { type: ObjectId, ref: 'Module', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    content: { type: String, default: '', maxlength: 40000 },
    resources: [{ _id: false, title: { type: String, trim: true, maxlength: 120 }, url: { type: String, trim: true, maxlength: 500 } }],
    minutes: { type: Number, default: 10, min: 1, max: 600 },
    order: { type: Number, default: 0 },
    status: { type: String, enum: ['draft', 'published'], default: 'published' }
  },
  { timestamps: true }
);

const lessonProgressSchema = new Schema(
  {
    studentId: { type: ObjectId, ref: 'User', required: true },
    lessonId: { type: ObjectId, ref: 'Lesson', required: true },
    courseId: { type: ObjectId, ref: 'Course', required: true },
    moduleId: { type: ObjectId, ref: 'Module', required: true },
    completed: { type: Boolean, default: true },
    completedAt: { type: Date, default: Date.now }
  },
  { timestamps: false }
);
lessonProgressSchema.index({ studentId: 1, lessonId: 1 }, { unique: true });
lessonProgressSchema.index({ courseId: 1, studentId: 1 });

module.exports = {
  Course: mongoose.model('Course', courseSchema),
  Enrollment: mongoose.model('Enrollment', enrollmentSchema),
  Module: mongoose.model('Module', moduleSchema),
  Lesson: mongoose.model('Lesson', lessonSchema),
  LessonProgress: mongoose.model('LessonProgress', lessonProgressSchema)
};
