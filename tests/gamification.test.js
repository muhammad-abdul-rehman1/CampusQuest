const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { levelForXp, xpForLevel } = require('../server/lib/levels');
const { weekKey, addDays, diffDays } = require('../server/lib/dates');

test.before(() => h.start());
test.after(() => h.stop());

test('level formula matches SRS 6.4 table', () => {
  const table = { 1: 0, 2: 100, 3: 300, 4: 600, 5: 1000, 6: 1500, 7: 2100, 8: 2800, 9: 3600, 10: 4500 };
  for (const [lvl, xp] of Object.entries(table)) {
    assert.equal(xpForLevel(Number(lvl)), xp);
    assert.equal(levelForXp(xp), Number(lvl));
    if (xp > 0) assert.equal(levelForXp(xp - 1), Number(lvl) - 1); // AC-15
  }
});

test('date helpers', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(diffDays('2026-12-01', '2026-11-29'), 2);
  assert.equal(weekKey('2026-11-21'), '2026-W47');
});

test('TC-007/TC-008: lesson gives XP once; repeat completion gives nothing', async () => {
  await h.reset();
  const s = await h.scenario();
  const agent = await h.login(s.student);

  const r1 = await agent.post(`/api/lessons/${s.l1._id}/complete`);
  assert.equal(r1.status, 200);
  assert.equal(r1.body.alreadyCompleted, false);
  assert.equal(r1.body.rewards.total, 10); // lesson XP only
  assert.equal(r1.body.progress.percent, 50);

  const r2 = await agent.post(`/api/lessons/${s.l1._id}/complete`);
  assert.equal(r2.body.alreadyCompleted, true);
  assert.equal(r2.body.rewards, null);

  const profile = await h.M.StudentProfile.findOne({ userId: s.student._id });
  assert.equal(profile.xp, 10);
  assert.equal(await h.M.XpTransaction.countDocuments({ studentId: s.student._id, sourceType: 'lesson' }), 1);
});

test('concurrent lesson completions pay XP exactly once (NFR-026)', async () => {
  await h.reset();
  const s = await h.scenario();
  const agent = await h.login(s.student);
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => agent.post(`/api/lessons/${s.l1._id}/complete`)));
  assert.equal(results.filter((r) => r.body.alreadyCompleted === false).length, 1);
  const profile = await h.M.StudentProfile.findOne({ userId: s.student._id });
  assert.equal(profile.xp, 10 + 0);
});

test('module completion awards module XP, first streak day and First Steps badge', async () => {
  await h.reset();
  const s = await h.scenario();
  const agent = await h.login(s.student);
  const a = await agent.post(`/api/lessons/${s.l1._id}/complete`);
  assert.deepEqual(a.body.rewards.badges.map((b) => b.title), ['First Steps']);
  assert.equal(a.body.rewards.streak.current, 1);
  const b = await agent.post(`/api/lessons/${s.l2._id}/complete`);
  const labels = b.body.rewards.lines.map((l) => l.label);
  assert.ok(labels.some((l) => l.startsWith('Module complete')));
  assert.equal(b.body.rewards.total, 10 + 75);
  assert.equal(b.body.rewards.streak.current, 1); // same calendar day: no second streak day (FR-107)
});

test('quiz grading, pass XP, 90% bonus and no double rewards on retake', async () => {
  await h.reset();
  const s = await h.scenario();
  const agent = await h.login(s.student);

  const start = await agent.post(`/api/quizzes/${s.quiz._id}/start`);
  assert.equal(start.status, 201);
  assert.ok(start.body.questions.every((q) => !('correctAnswer' in q)), 'answers must not leak');

  const sub = await agent.post(`/api/quizzes/${s.quiz._id}/submit`).send({ attemptId: start.body.attemptId, answers: { [s.q1._id]: 1, [s.q2._id]: 0 } });
  assert.equal(sub.status, 200);
  assert.equal(sub.body.result.score, 100);
  assert.equal(sub.body.rewards.total, 30 + 50); // pass + 90% bonus
  assert.ok(sub.body.rewards.badges.some((b) => b.title === 'Perfect Score'));

  // retake: recorded, but the same XP is not granted twice
  const start2 = await agent.post(`/api/quizzes/${s.quiz._id}/start`);
  const sub2 = await agent.post(`/api/quizzes/${s.quiz._id}/submit`).send({ attemptId: start2.body.attemptId, answers: { [s.q1._id]: 1, [s.q2._id]: 0 } });
  assert.equal(sub2.body.rewards.total, 0);
  assert.equal(sub2.body.attemptsLeft, 0);

  // TC-010: attempt limit
  const start3 = await agent.post(`/api/quizzes/${s.quiz._id}/start`);
  assert.equal(start3.status, 403);

  const profile = await h.M.StudentProfile.findOne({ userId: s.student._id });
  assert.equal(profile.xp, 80);
});

test('failed quiz: recorded, no XP, still counts as an attempt', async () => {
  await h.reset();
  const s = await h.scenario();
  const agent = await h.login(s.student);
  const start = await agent.post(`/api/quizzes/${s.quiz._id}/start`);
  const sub = await agent.post(`/api/quizzes/${s.quiz._id}/submit`).send({ attemptId: start.body.attemptId, answers: { [s.q1._id]: 0, [s.q2._id]: 1 } });
  assert.equal(sub.body.result.score, 0);
  assert.equal(sub.body.result.passed, false);
  assert.equal(sub.body.rewards.total, 0);
  assert.equal(sub.body.attemptsLeft, 1);
});

test('TC-011/TC-012: quest completes once; duplicate completion request awards no extra XP', async () => {
  await h.reset();
  const s = await h.scenario();
  const quest = await h.M.Quest.create({ courseId: s.course._id, title: 'Do a lesson', type: 'Course', objective: { kind: 'complete_lessons', target: 1 }, xpReward: 25, createdBy: s.instructor._id });
  const agent = await h.login(s.student);

  const early = await agent.post(`/api/quests/${quest._id}/complete`);
  assert.equal(early.status, 409);
  assert.equal(early.body.status, 'incomplete');

  const les = await agent.post(`/api/lessons/${s.l1._id}/complete`);
  assert.equal(les.body.rewards.quests.length, 1);
  assert.equal(les.body.rewards.total, 10 + 25);

  const dup = await agent.post(`/api/quests/${quest._id}/complete`);
  assert.equal(dup.status, 200);
  assert.equal(dup.body.status, 'already_completed');
  assert.equal(dup.body.rewards, null);

  const txs = await h.M.XpTransaction.find({ studentId: s.student._id, sourceType: 'quest' });
  assert.equal(txs.length, 1);
  assert.equal((await h.M.StudentProfile.findOne({ userId: s.student._id })).xp, 35);
});

test('expired quests cannot progress', async () => {
  await h.reset();
  const s = await h.scenario();
  await h.M.Quest.create({ courseId: s.course._id, title: 'Old', type: 'Course', objective: { kind: 'complete_lessons', target: 1 }, xpReward: 25, deadline: new Date(Date.now() - 1000) });
  const agent = await h.login(s.student);
  const les = await agent.post(`/api/lessons/${s.l1._id}/complete`);
  assert.equal(les.body.rewards.quests.length, 0);
  const list = await agent.get('/api/quests');
  assert.equal(list.body.quests[0].status, 'expired');
});

test('streak: consecutive days extend, a missed day resets, 7-day milestone pays once', async () => {
  await h.reset();
  const s = await h.scenario();
  const streaks = require('../server/services/streaks');
  const { handleActivity } = require('../server/services/gamification');
  const day = (n) => new Date(Date.UTC(2026, 5, 1 + n, 8, 0, 0)); // 08:00 UTC = 13:00 Karachi, same calendar day
  let last;
  for (let n = 0; n < 7; n++) {
    const lesson = await h.M.Lesson.create({ courseId: s.course._id, moduleId: s.mod._id, title: 'L' + n, status: 'draft' });
    last = await handleActivity({ studentId: s.student._id, courseId: s.course._id, kind: 'lesson', lesson: { id: String(lesson._id), title: lesson.title, moduleId: s.mod._id, moduleTitle: 'Mod 1' }, now: day(n) });
  }
  assert.equal(last.streak.current, 7);
  assert.ok(last.lines.some((l) => l.label.startsWith('Streak · 7 days')));
  assert.ok(last.badges.some((b) => b.title === 'Consistency Champion'));

  // same day again -> no change
  const again = await streaks.recordQualifyingActivity(s.student._id, day(6));
  assert.equal(again.changed, false);

  // skip a day -> reset to 1, longest preserved
  const reset = await streaks.recordQualifyingActivity(s.student._id, day(8));
  assert.equal(reset.current, 1);
  assert.equal(reset.longest, 7);

  // second run reaching 7 again must NOT pay the milestone a second time for the same run key,
  // and a brand new run pays under its own key
  const milestones = await h.M.XpTransaction.countDocuments({ studentId: s.student._id, sourceType: 'streak' });
  assert.equal(milestones, 1);
});

test('level up notification when XP crosses a threshold', async () => {
  await h.reset();
  const s = await h.scenario();
  await h.M.StudentProfile.updateOne({ userId: s.student._id }, { xp: 95 });
  const agent = await h.login(s.student);
  const r = await agent.post(`/api/lessons/${s.l1._id}/complete`);
  assert.equal(r.body.rewards.level.leveledUp, true);
  assert.equal(r.body.rewards.level.after, 2);
  const n = await agent.get('/api/notifications');
  assert.ok(n.body.items.some((x) => x.type === 'level'));
  assert.ok(n.body.unread >= 1);
  await agent.patch('/api/notifications/read-all');
  assert.equal((await agent.get('/api/notifications/unread-count')).body.unread, 0);
});

test('leaderboard: course members only, ranks by XP, opt-out is anonymised', async () => {
  await h.reset();
  const s = await h.scenario();
  const other = await h.makeUser('student', 'Other One');
  const hidden = await h.makeUser('student', 'Hidden One');
  await h.M.Enrollment.create({ studentId: other._id, courseId: s.course._id });
  await h.M.Enrollment.create({ studentId: hidden._id, courseId: s.course._id });
  await h.M.StudentProfile.updateOne({ userId: s.student._id }, { xp: 50 });
  await h.M.StudentProfile.updateOne({ userId: other._id }, { xp: 200 });
  await h.M.StudentProfile.updateOne({ userId: hidden._id }, { xp: 120, leaderboardVisible: false });

  const agent = await h.login(s.student);
  const r = await agent.get(`/api/gamification/leaderboard?courseId=${s.course._id}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.entries.map((e) => e.xp), [200, 120, 50]);
  assert.equal(r.body.entries[1].name, 'Anonymous learner');
  assert.equal(r.body.me.rank, 3);

  const outsider = await h.makeUser('student', 'Outsider');
  const oa = await h.login(outsider);
  const denied = await oa.get(`/api/gamification/leaderboard?courseId=${s.course._id}`);
  assert.equal(denied.status, 403);
});
