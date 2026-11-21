const { Course, Enrollment, Module, Lesson, Quiz, Quest } = require('../models');
const { notFound, forbidden } = require('./errors');
const { validId } = require('./validate');

async function loadCourse(courseId) {
  if (!validId(String(courseId))) throw notFound('Course not found.');
  const course = await Course.findById(courseId);
  if (!course) throw notFound('Course not found.');
  return course;
}

const isAdmin = (user) => user.role === 'admin';

// Instructors may only manage courses they own; admins may manage any (FR-020, NFR-014, NFR-016).
function canManage(user, course) {
  return isAdmin(user) || (user.role === 'instructor' && String(course.instructorId) === String(user._id));
}

async function assertManager(user, courseId) {
  const course = await loadCourse(courseId);
  if (!canManage(user, course)) throw forbidden('You do not manage this course.');
  return course;
}

async function isEnrolled(studentId, courseId) {
  return !!(await Enrollment.exists({ studentId, courseId, status: 'active' }));
}

// Managers see everything; students need an active enrollment in a published course (FR-028).
async function assertViewer(user, courseId) {
  const course = await loadCourse(courseId);
  if (canManage(user, course)) return { course, isManager: true };
  if (user.role === 'student') {
    if (course.status === 'draft') throw forbidden('This course is not available.');
    if (!(await isEnrolled(user._id, course._id))) throw forbidden('Enrol in this course to access it.');
    return { course, isManager: false };
  }
  throw forbidden();
}

async function loadModuleFor(user, moduleId, { manage = false } = {}) {
  if (!validId(String(moduleId))) throw notFound('Module not found.');
  const mod = await Module.findById(moduleId);
  if (!mod) throw notFound('Module not found.');
  const ctx = manage ? { course: await assertManager(user, mod.courseId), isManager: true } : await assertViewer(user, mod.courseId);
  if (!ctx.isManager && (mod.status !== 'published' || (mod.availableFrom && mod.availableFrom > new Date()))) throw forbidden('This module is not available yet.');
  return { mod, ...ctx };
}

async function loadLessonFor(user, lessonId, { manage = false } = {}) {
  if (!validId(String(lessonId))) throw notFound('Lesson not found.');
  const lesson = await Lesson.findById(lessonId);
  if (!lesson) throw notFound('Lesson not found.');
  const { mod, course, isManager } = await loadModuleFor(user, lesson.moduleId, { manage });
  if (!isManager && lesson.status !== 'published') throw forbidden('This lesson is not available.');
  return { lesson, mod, course, isManager };
}

async function loadQuizFor(user, quizId, { manage = false } = {}) {
  if (!validId(String(quizId))) throw notFound('Quiz not found.');
  const quiz = await Quiz.findById(quizId);
  if (!quiz) throw notFound('Quiz not found.');
  const ctx = manage ? { course: await assertManager(user, quiz.courseId), isManager: true } : await assertViewer(user, quiz.courseId);
  if (!ctx.isManager && quiz.status !== 'published') throw forbidden('This quiz is not available.');
  return { quiz, ...ctx };
}

async function loadQuestFor(user, questId, { manage = false } = {}) {
  if (!validId(String(questId))) throw notFound('Quest not found.');
  const quest = await Quest.findById(questId);
  if (!quest) throw notFound('Quest not found.');
  const ctx = manage ? { course: await assertManager(user, quest.courseId), isManager: true } : await assertViewer(user, quest.courseId);
  return { quest, ...ctx };
}

module.exports = { loadCourse, canManage, assertManager, assertViewer, isEnrolled, loadModuleFor, loadLessonFor, loadQuizFor, loadQuestFor, isAdmin };
