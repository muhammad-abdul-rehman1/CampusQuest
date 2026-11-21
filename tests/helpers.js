// Test harness: isolated database, supertest agents per role.
process.env.NODE_ENV = 'test';
process.env.MONGO_URI = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/campusquest_test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123';
process.env.APP_TIMEZONE = 'Asia/Karachi';
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
// Set (not delete) so dotenv can't fill them in from the developer's real .env: tests never send real email.
process.env.SMTP_HOST = '';
process.env.ALLOWED_EMAIL_DOMAINS = '';
process.env.APP_URL = 'http://localhost:3000';

const request = require('supertest');
const bcrypt = require('bcryptjs');
const db = require('../server/db');
const M = require('../server/models');
const app = require('../server/app');
const { ensureDefaults } = require('../server/services/defaults');
const settings = require('../server/services/settings');

async function reset() {
  await db.mongoose.connection.dropDatabase();
  await db.mongoose.syncIndexes();
  settings.invalidate();
  await ensureDefaults();
}

async function start() {
  await db.connect();
  await reset();
}

async function stop() {
  await db.mongoose.connection.dropDatabase();
  await db.disconnect();
}

async function makeUser(role, name = role, email) {
  const u = await M.User.create({ name, email: email || `${name.toLowerCase().replace(/\W+/g, '.')}.${Math.random().toString(36).slice(2, 7)}@t.test`, role, emailVerified: true, passwordHash: await bcrypt.hash('Passw0rdTest', 4) });
  if (role === 'student') await M.StudentProfile.create({ userId: u._id });
  if (role === 'instructor') await M.InstructorProfile.create({ userId: u._id });
  return u;
}

async function login(user) {
  const agent = request.agent(app);
  const r = await agent.post('/api/auth/login').send({ email: user.email, password: 'Passw0rdTest' });
  if (r.status !== 200) throw new Error('login failed: ' + JSON.stringify(r.body));
  return agent;
}

// Course with 1 module / 2 lessons, 1 quiz (2 questions), quests, enrolled student.
async function scenario() {
  const instructor = await makeUser('instructor', 'Dr Test');
  const student = await makeUser('student', 'Stu Dent');
  const course = await M.Course.create({ title: 'Testing 101', code: 'T-101', instructorId: instructor._id, status: 'published' });
  const mod = await M.Module.create({ courseId: course._id, title: 'Mod 1', order: 0 });
  const l1 = await M.Lesson.create({ courseId: course._id, moduleId: mod._id, title: 'Lesson A', order: 0, content: 'x' });
  const l2 = await M.Lesson.create({ courseId: course._id, moduleId: mod._id, title: 'Lesson B', order: 1, content: 'y' });
  const quiz = await M.Quiz.create({ courseId: course._id, moduleId: mod._id, title: 'Quiz 1', durationMinutes: 5, attemptsAllowed: 2, passingScore: 60, status: 'published' });
  const q1 = await M.Question.create({ quizId: quiz._id, type: 'mcq', text: 'Pick B', options: ['A', 'B', 'C'], correctAnswer: 1, order: 0 });
  const q2 = await M.Question.create({ quizId: quiz._id, type: 'tf', text: 'True?', options: ['True', 'False'], correctAnswer: 0, order: 1 });
  await M.Enrollment.create({ studentId: student._id, courseId: course._id });
  return { instructor, student, course, mod, l1, l2, quiz, q1, q2 };
}

// Pull the one-time token out of the last email sent to `to`.
const { outbox } = require('../server/services/mailer');
function lastEmailToken(to) {
  const mail = outbox.filter((m) => m.to === to).pop();
  if (!mail) throw new Error('no email sent to ' + to);
  return new URL(mail.link.replace('/#/', '/')).searchParams.get('token');
}

module.exports = { request, app, M, db, start, stop, reset, makeUser, login, scenario, outbox, lastEmailToken };
