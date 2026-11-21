const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

test.before(() => h.start());
test.after(() => h.stop());

test('TC-001/AC-01: register, verify email, then logged in; passwords are hashed', async () => {
  await h.reset();
  const a = h.request.agent(h.app);
  const reg = await a.post('/api/auth/register').send({ name: 'New Student', email: 'New@Example.com', password: 'Secret123', role: 'student' });
  assert.equal(reg.status, 202);
  assert.equal(reg.body.email, 'new@example.com');
  assert.equal(await h.M.User.countDocuments({ email: 'new@example.com' }), 0); // no account until verified
  const ver = await a.post('/api/auth/verify-email').send({ token: h.lastEmailToken('new@example.com') });
  assert.equal(ver.status, 200);
  assert.equal(ver.body.user.role, 'student');
  assert.equal(ver.body.user.emailVerified, true);
  assert.ok(!('passwordHash' in ver.body.user));
  const stored = await h.M.User.findOne({ email: 'new@example.com' }).select('+passwordHash');
  assert.notEqual(stored.passwordHash, 'Secret123');
  assert.ok(stored.passwordHash.startsWith('$2'));
  const me = await a.get('/api/auth/me');
  assert.equal(me.body.user.name, 'New Student');
  assert.equal(await h.M.StudentProfile.countDocuments({ userId: stored._id }), 1);
});

test('TC-019: validation errors and duplicate emails', async () => {
  await h.reset();
  const bad = await h.request(h.app).post('/api/auth/register').send({ name: 'A', email: 'nope', password: '123' });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.fields.email);
  assert.ok(bad.body.fields.password);
  await h.makeUser('student', 'Dupe User', 'd@x.com');
  const dupe = await h.request(h.app).post('/api/auth/register').send({ name: 'Dupe User', email: 'D@x.com', password: 'Secret123' });
  assert.equal(dupe.status, 409);
});

test('privilege escalation via register is impossible', async () => {
  await h.reset();
  const r = await h.request(h.app).post('/api/auth/register').send({ name: 'Sneaky', email: 's@x.com', password: 'Secret123', role: 'admin' });
  assert.equal(r.status, 400);
  assert.equal(await h.M.User.countDocuments({ role: 'admin' }), 0);
});

test('TC-003: bad credentials; suspended accounts are denied (UC-02 A2)', async () => {
  await h.reset();
  const u = await h.makeUser('student', 'Login Test');
  const bad = await h.request(h.app).post('/api/auth/login').send({ email: u.email, password: 'wrong' });
  assert.equal(bad.status, 401);
  const unknown = await h.request(h.app).post('/api/auth/login').send({ email: 'ghost@x.com', password: 'wrong' });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.body.error, bad.body.error); // no account enumeration

  const agent = await h.login(u);
  await h.M.User.updateOne({ _id: u._id }, { status: 'suspended' });
  assert.equal((await agent.get('/api/auth/me')).status, 403); // existing session is cut immediately
  const again = await h.request(h.app).post('/api/auth/login').send({ email: u.email, password: 'Passw0rdTest' });
  assert.equal(again.status, 403);
});

test('unauthenticated requests are rejected', async () => {
  await h.reset();
  for (const p of ['/api/users/profile', '/api/courses', '/api/quests', '/api/notifications', '/api/admin/users', '/api/instructor/courses']) {
    assert.equal((await h.request(h.app).get(p)).status, 401, p);
  }
});

test('TC-004/TC-018/AC-21: role boundaries', async () => {
  await h.reset();
  const s = await h.scenario();
  const stu = await h.login(s.student);
  const other = await h.makeUser('instructor', 'Other Instructor');
  const oth = await h.login(other);
  const own = await h.login(s.instructor);

  assert.equal((await stu.post('/api/courses').send({ title: 'Hack course' })).status, 403);
  assert.equal((await stu.get('/api/admin/users')).status, 403);
  assert.equal((await stu.get(`/api/instructor/analytics/${s.course._id}`)).status, 403);
  assert.equal((await stu.get(`/api/quizzes/${s.quiz._id}/attempts`)).status, 403);
  assert.equal((await stu.patch(`/api/courses/${s.course._id}`).send({ title: 'x' })).status, 403);
  assert.equal((await oth.get('/api/admin/users')).status, 403);
  // instructors only manage their own courses
  assert.equal((await oth.patch(`/api/courses/${s.course._id}`).send({ title: 'Stolen' })).status, 403);
  assert.equal((await oth.get(`/api/instructor/analytics/${s.course._id}`)).status, 403);
  assert.equal((await oth.post(`/api/courses/${s.course._id}/modules`).send({ title: 'Nope' })).status, 403);
  assert.equal((await own.get(`/api/instructor/analytics/${s.course._id}`)).status, 200);
});

test('FR-028: students cannot read content of courses they are not enrolled in', async () => {
  await h.reset();
  const s = await h.scenario();
  const outsider = await h.makeUser('student', 'Outsider');
  const out = await h.login(outsider);
  assert.equal((await out.get(`/api/lessons/${s.l1._id}`)).status, 403);
  assert.equal((await out.post(`/api/lessons/${s.l1._id}/complete`)).status, 403);
  assert.equal((await out.post(`/api/quizzes/${s.quiz._id}/start`)).status, 403);
  assert.equal((await out.get(`/api/courses/${s.course._id}/modules`)).status, 403);
  const detail = await out.get(`/api/courses/${s.course._id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.enrolled, false);
  assert.ok(!detail.body.tree, 'no lesson tree before enrolling');
});

test('NFR-013: clients cannot set XP, role or status through profile endpoints', async () => {
  await h.reset();
  const s = await h.scenario();
  const a = await h.login(s.student);
  const r = await a.patch('/api/users/profile').send({ xp: 99999, role: 'admin', status: 'active', bio: 'hello', leaderboardVisible: false });
  assert.equal(r.status, 200);
  const user = await h.M.User.findById(s.student._id);
  const prof = await h.M.StudentProfile.findOne({ userId: s.student._id });
  assert.equal(user.role, 'student');
  assert.equal(prof.xp, 0);
  assert.equal(prof.bio, 'hello');
  assert.equal(prof.leaderboardVisible, false);
  // XP endpoints are read-only
  assert.equal((await a.post('/api/gamification/xp').send({ amount: 500 })).status, 404);
});

test('enrollment: restricted courses need the code, closed courses refuse, repeat is idempotent', async () => {
  await h.reset();
  const s = await h.scenario();
  const stu2 = await h.makeUser('student', 'Joiner');
  const a = await h.login(stu2);
  await h.M.Course.updateOne({ _id: s.course._id }, { enrollmentCode: 'SECRET1' });
  assert.equal((await a.post(`/api/courses/${s.course._id}/enroll`).send({})).status, 403);
  assert.equal((await a.post(`/api/courses/${s.course._id}/enroll`).send({ code: 'wrong' })).status, 403);
  const ok = await a.post(`/api/courses/${s.course._id}/enroll`).send({ code: 'secret1' });
  assert.equal(ok.status, 201);
  const again = await a.post(`/api/courses/${s.course._id}/enroll`).send({ code: 'secret1' });
  assert.equal(again.body.alreadyEnrolled, true);
  assert.equal(await h.M.Enrollment.countDocuments({ studentId: stu2._id }), 1);

  const stu3 = await h.makeUser('student', 'Late');
  await h.M.Course.updateOne({ _id: s.course._id }, { enrollmentOpen: false });
  assert.equal((await (await h.login(stu3)).post(`/api/courses/${s.course._id}/enroll`).send({ code: 'SECRET1' })).status, 403);
});

test('instructor workflow: course -> module -> lesson -> quiz -> quest (AC-03/05/08/12)', async () => {
  await h.reset();
  const ins = await h.login(await h.makeUser('instructor', 'Builder'));
  const course = await ins.post('/api/courses').send({ title: 'Built Course', code: 'b-1', description: 'd' });
  assert.equal(course.status, 201);
  const cid = course.body.id;
  const mod = await ins.post(`/api/courses/${cid}/modules`).send({ title: 'First module' });
  assert.equal(mod.status, 201);
  const les = await ins.post(`/api/modules/${mod.body.id}/lessons`).send({ title: 'First lesson', content: 'hello', resources: [{ title: 'Doc', url: 'https://example.com/a.pdf' }] });
  assert.equal(les.status, 201);
  const bad = await ins.post(`/api/modules/${mod.body.id}/lessons`).send({ title: 'XSS', resources: [{ title: 'bad', url: 'javascript:alert(1)' }] });
  assert.equal(bad.status, 400);

  const quiz = await ins.post(`/api/courses/${cid}/quizzes`).send({ title: 'Quick quiz', durationMinutes: 5, attemptsAllowed: 2, passingScore: 60, questions: [{ type: 'mcq', text: 'Which?', options: ['a', 'b'], correctAnswer: 1 }, { type: 'tf', text: 'Yes?', correctAnswer: 0 }] });
  assert.equal(quiz.status, 201);
  const badQ = await ins.post(`/api/quizzes/${quiz.body.id}/questions`).send({ type: 'mcq', text: 'Bad', options: ['only'], correctAnswer: 0 });
  assert.equal(badQ.status, 400);
  const pub = await ins.patch(`/api/quizzes/${quiz.body.id}`).send({ status: 'published' });
  assert.equal(pub.status, 200);

  const q = await ins.post('/api/quests').send({ courseId: cid, title: 'Ace it', type: 'Course', objective: { kind: 'pass_quiz', target: 1 }, xpReward: 40 });
  assert.equal(q.status, 201);
  const tooMuch = await ins.post('/api/quests').send({ courseId: cid, title: 'Huge reward', type: 'Daily', objective: { kind: 'complete_lessons', target: 1 }, xpReward: 5000 });
  assert.equal(tooMuch.status, 400);
  const past = await ins.post('/api/quests').send({ courseId: cid, title: 'In the past', type: 'Daily', objective: { kind: 'complete_lessons', target: 1 }, xpReward: 20, deadline: '2020-01-01' });
  assert.equal(past.status, 400);
});

test('bulk question import: validated, appended, owner-only', async () => {
  await h.reset();
  const s = await h.scenario();
  const ins = await h.login(s.instructor);
  const good = [{ type: 'mcq', text: 'Q one', options: ['a', 'b'], correctAnswer: 1 }, { type: 'tf', text: 'Q two', correctAnswer: 0 }];
  const r = await ins.post(`/api/quizzes/${s.quiz._id}/questions/import`).send({ questions: good });
  assert.equal(r.status, 201);
  assert.equal(r.body.added, 2);
  assert.equal(await h.M.Question.countDocuments({ quizId: s.quiz._id }), 4);
  const bad = await ins.post(`/api/quizzes/${s.quiz._id}/questions/import`).send({ questions: [{ type: 'mcq', text: 'Bad', options: ['a', 'b'], correctAnswer: 5 }] });
  assert.equal(bad.status, 400);
  assert.equal(await h.M.Question.countDocuments({ quizId: s.quiz._id }), 4); // all-or-nothing
  const stu = await h.login(s.student);
  assert.equal((await stu.post(`/api/quizzes/${s.quiz._id}/questions/import`).send({ questions: good })).status, 403);
  const other = await h.login(await h.makeUser('instructor', 'Other'));
  assert.equal((await other.post(`/api/quizzes/${s.quiz._id}/questions/import`).send({ questions: good })).status, 403);
});

test('admin: manage users with audit trail; cannot demote self', async () => {
  await h.reset();
  const admin = await h.makeUser('admin', 'Boss');
  const target = await h.makeUser('student', 'Target');
  const a = await h.login(admin);
  const upd = await a.patch(`/api/admin/users/${target._id}`).send({ status: 'suspended' });
  assert.equal(upd.status, 200);
  assert.equal((await h.M.User.findById(target._id)).status, 'suspended');
  assert.equal((await a.patch(`/api/admin/users/${admin._id}`).send({ role: 'student' })).status, 403);
  const logs = await a.get('/api/admin/audit-logs');
  assert.ok(logs.body.items.some((l) => l.action === 'user.update'));
  const set = await a.put('/api/admin/settings').send({ xp: { lesson: 15 } });
  assert.equal(set.body.xp.lesson, 15);
  assert.equal((await a.put('/api/admin/settings').send({ timezone: 'Not/AZone' })).status, 400);
  const dash = await a.get('/api/admin/dashboard');
  assert.equal(dash.status, 200);
});

test('password reset flow', async () => {
  await h.reset();
  const u = await h.makeUser('student', 'Forgetful');
  const old = await h.login(u);
  const r = await h.request(h.app).post('/api/auth/forgot-password').send({ email: u.email });
  assert.equal(r.status, 200);
  const token = h.lastEmailToken(u.email);
  assert.ok(token);
  assert.equal((await h.request(h.app).get(`/api/auth/reset-password/check?token=${token}`)).body.valid, true);
  assert.equal((await h.request(h.app).post('/api/auth/reset-password').send({ token: 'x'.repeat(64), password: 'NewPass123' })).status, 400);
  const ok = await h.request(h.app).post('/api/auth/reset-password').send({ token, password: 'NewPass123' });
  assert.equal(ok.status, 200);
  assert.equal((await old.get('/api/auth/me')).status, 401); // sessions from before the reset are revoked
  assert.equal((await h.request(h.app).post('/api/auth/reset-password').send({ token, password: 'Another123' })).status, 400); // single use
  const login = await h.request(h.app).post('/api/auth/login').send({ email: u.email, password: 'NewPass123' });
  assert.equal(login.status, 200);
  const unknown = await h.request(h.app).post('/api/auth/forgot-password').send({ email: 'nobody@x.com' });
  assert.equal(unknown.body.message, r.body.message);
});

test('analytics for instructors (AC-19)', async () => {
  await h.reset();
  const s = await h.scenario();
  const stu = await h.login(s.student);
  await stu.post(`/api/lessons/${s.l1._id}/complete`);
  const st = await stu.post(`/api/quizzes/${s.quiz._id}/start`);
  await stu.post(`/api/quizzes/${s.quiz._id}/submit`).send({ attemptId: st.body.attemptId, answers: { [s.q1._id]: 1, [s.q2._id]: 0 } });
  const ins = await h.login(s.instructor);
  const r = await ins.get(`/api/instructor/analytics/${s.course._id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.enrolled, 1);
  assert.equal(r.body.lessonCompletion, 50);
  assert.equal(r.body.quiz.average, 100);
  assert.equal(r.body.engagement.activeStudents7d, 1);
  const prog = await ins.get(`/api/instructor/students/${s.student._id}/progress?courseId=${s.course._id}`);
  assert.equal(prog.status, 200);
  assert.equal(prog.body.progress.lessonsCompleted, 1);
  const quizzes = await ins.get(`/api/instructor/analytics/${s.course._id}/quizzes`);
  assert.equal(quizzes.body.quizzes[0].attempts, 1);
  const attempts = await ins.get(`/api/quizzes/${s.quiz._id}/attempts`);
  assert.equal(attempts.body.questionStats.length, 2);
});
