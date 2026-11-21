// Demo data that mirrors the design prototype (CS-201 Data Structures, Dr. Farooq, Areeb ...).
//   npm run seed          -> WIPES the configured database and loads demo data
// All people/numbers are fictional sample data. Demo passwords are printed at the end - local use only.
const bcrypt = require('bcryptjs');
const config = require('./config');
const db = require('./db');
const M = require('./models');
const { ensureDefaults } = require('./services/defaults');
const { dayKey, addDays, weekKey } = require('./lib/dates');

const DEMO = { admin: 'Admin1234', instructor: 'Teach1234', student: 'Learn1234' };

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const ago = (days, hour = 10) => {
  const d = new Date(Date.now() - days * DAY);
  d.setHours(hour, 0, 0, 0);
  return d;
};

function nextFriday() {
  const d = new Date();
  const add = ((5 - d.getDay() + 7) % 7) || 7;
  d.setDate(d.getDate() + add);
  d.setHours(23, 59, 0, 0);
  return d;
}

const LESSON_TEXT = {
  'What is a data structure?': 'A data structure is a way of organising data so that a program can use it efficiently.\n\n**Why it matters.** The same problem can be easy or impossible depending on how the data is arranged. Looking a name up in a sorted list is far faster than scanning an unsorted pile.\n\nIn this course you will meet arrays, linked lists, stacks, queues and trees, and learn when each one is the right tool.',
  'Big-O notation basics': 'Big-O describes how the cost of an algorithm grows as its input grows.\n\n**O(1)** is constant time, **O(log n)** grows slowly, **O(n)** grows in step with the input and **O(n²)** explodes quickly.\n\nWe ignore constants and small terms because they stop mattering once the input is large.',
  'Arrays and memory': 'An array stores its elements next to each other in memory, which makes reading element i a single calculation: O(1).\n\n**Trade-off.** Inserting in the middle means shifting everything after it, which costs O(n).\n\nDynamic arrays grow by allocating a bigger block and copying, so appends are O(1) on average.',
  'Linked lists': 'A linked list stores each element in a node that points to the next one.\n\n**Strength.** Inserting or removing after a node you already hold is O(1), with no shifting.\n\n**Weakness.** There is no jumping to element i; you walk the chain, which is O(n).',
  'Doubly linked lists': 'A doubly linked list gives every node a pointer to the previous node as well.\n\nThat lets you walk backwards and remove a node in O(1) when you hold a reference to it, at the cost of one extra pointer per node.',
  'Stacks & queues': 'Stacks and queues are linear structures that limit where you can add and remove items. That limit is the point: it makes certain problems simple and fast.\n\n**Stack (LIFO).** You push onto the top and pop from the top, so the last item in is the first out. Think of a pile of plates, the browser back button or an editor\'s undo history.\n\n**Queue (FIFO).** You enqueue at the rear and dequeue from the front, so the first item in is the first out, like a line at the cafeteria or a printer\'s job list.\n\nBoth can sit on top of an array or a linked list. With a linked list that tracks its head and tail, every core operation runs in O(1).\n\n**Key operations.** Stack: push, pop, peek. Queue: enqueue, dequeue, front.',
  'Binary trees': 'A binary tree is a hierarchy where every node has at most two children, called left and right.\n\nTrees model file systems, expressions and decisions, and they are the base for the structures in the next lessons.',
  'Tree traversals': 'There are three depth-first orders: **pre-order** (node, left, right), **in-order** (left, node, right) and **post-order** (left, right, node).\n\nBreadth-first traversal visits the tree level by level using a queue.',
  'Binary search trees': 'A binary search tree keeps smaller keys on the left and larger keys on the right, so a lookup discards half the remaining tree at each step.\n\nOn a balanced tree that is O(log n); on a degenerate chain it falls back to O(n).'
};

async function main() {
  if (config.isProd && !process.argv.includes('--force')) {
    console.error('Refusing to wipe a production database. Re-run with --force if you are sure.');
    process.exit(1);
  }
  // Demo accounts have publicly known passwords (README), so never load them into an online database by accident.
  const local = /^mongodb:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(config.mongoUri);
  if (!local && !process.argv.includes('--force')) {
    console.error('MONGO_URI points to a remote database. Seeding WIPES it and creates demo accounts with public passwords.');
    console.error('Refusing. Re-run with "npm run seed -- --force" only if that database is a throw-away demo.');
    process.exit(1);
  }
  await db.connect();
  console.log(`Wiping database "${db.mongoose.connection.name}" and loading demo data...`);
  await db.mongoose.connection.dropDatabase();
  await db.mongoose.syncIndexes();
  await ensureDefaults();

  const hash = {
    admin: await bcrypt.hash(DEMO.admin, 10),
    instructor: await bcrypt.hash(DEMO.instructor, 10),
    student: await bcrypt.hash(DEMO.student, 10)
  };
  const mkUser = async (name, email, role) => {
    const u = await M.User.create({ name, email, role, passwordHash: hash[role], emailVerified: true, emailVerifiedAt: new Date(), lastLoginAt: new Date() });
    if (role === 'student') await M.StudentProfile.create({ userId: u._id, xp: 0, department: 'Computer Science', year: '2nd year' });
    if (role === 'instructor') await M.InstructorProfile.create({ userId: u._id, department: 'Computer Science', title: 'Associate Professor' });
    return u;
  };

  await mkUser('Platform Admin', 'admin@campusquest.test', 'admin');
  const farooq = await mkUser('Dr. Farooq', 'farooq@campusquest.test', 'instructor');
  const areeb = await mkUser('Areeb Rehman', 'areeb@campusquest.test', 'student');
  const peers = [
    ['Ayesha Khan', 1240, 6, 100], ['Hamza Raza', 905, 6, 80], ['Zainab Malik', 760, 5, 80], ['Bilal Shah', 610, 5, 60], ['Mahnoor Tariq', 455, 4, 80], ['Usman Ali', 300, 3, 60]
  ];
  const peerUsers = [];
  for (const [name] of peers) peerUsers.push(await mkUser(name, name.toLowerCase().replace(/[^a-z]+/g, '.') + '@campusquest.test', 'student'));
  const atRisk = [
    ['Hassan Ali', 2, 6, 48], ['Saad Iqbal', 1, 5, null], ['Fatima Noor', 3, 4, 55], ['Iqra Javed', 4, 3, null]
  ];
  const riskUsers = [];
  for (const [name] of atRisk) riskUsers.push(await mkUser(name, name.toLowerCase().replace(/[^a-z]+/g, '.') + '@campusquest.test', 'student'));

  // ---------- courses ----------
  const cs201 = await M.Course.create({ title: 'Data Structures', code: 'CS-201', description: 'Arrays, linked lists, stacks, queues and trees, with the Big-O reasoning to choose between them.', category: 'Computer Science', term: 'Fall 2026', instructorId: farooq._id, status: 'published' });
  const cs305 = await M.Course.create({ title: 'Algorithms', code: 'CS-305', description: 'Sorting, searching, graph algorithms and dynamic programming.', category: 'Computer Science', term: 'Fall 2026', instructorId: farooq._id, status: 'published', enrollmentCode: 'ALGO305' });
  await M.Course.create({ title: 'Database Systems', code: 'CS-330', description: 'Relational modelling, SQL and transactions. (Draft)', category: 'Computer Science', term: 'Spring 2027', instructorId: farooq._id, status: 'draft' });

  const modNames = [['Foundations', null], ['Linear structures', null], ['Trees', new Date(Date.now() + 4 * DAY)]];
  const lessonTitles = [
    ['What is a data structure?', 8, 'Big-O notation basics', 12, 'Arrays and memory', 10],
    ['Linked lists', 14, 'Doubly linked lists', 10, 'Stacks & queues', 12],
    ['Binary trees', 15, 'Tree traversals', 12, 'Binary search trees', 14]
  ];
  const mods = [];
  const lessons = []; // flat, in order
  for (let i = 0; i < 3; i++) {
    const m = await M.Module.create({ courseId: cs201._id, title: modNames[i][0], description: '', order: i, status: 'published', availableFrom: modNames[i][1] });
    mods.push(m);
    for (let j = 0; j < 3; j++) {
      const title = lessonTitles[i][j * 2];
      const l = await M.Lesson.create({
        courseId: cs201._id, moduleId: m._id, title, minutes: lessonTitles[i][j * 2 + 1], order: j, status: 'published',
        content: LESSON_TEXT[title],
        resources: title === 'Stacks & queues' ? [{ title: 'Lecture notes (PDF): stacks-and-queues', url: 'https://example.com/stacks-and-queues.pdf' }] : []
      });
      lessons.push(l);
    }
  }
  const L = (i) => lessons[i];

  // ---------- quizzes ----------
  const quizDue = nextFriday();
  const quiz1 = await M.Quiz.create({ courseId: cs201._id, moduleId: mods[0]._id, title: 'Foundations check', description: 'Arrays and memory', durationMinutes: 5, attemptsAllowed: 2, passingScore: 60, status: 'published', availableUntil: ago(-30) });
  await M.Question.insertMany([
    { quizId: quiz1._id, type: 'mcq', text: 'How long does reading arr[i] take?', options: ['O(1)', 'O(n)', 'O(log n)', 'O(n²)'], correctAnswer: 0, explanation: 'Elements sit side by side in memory, so the address is computed directly.', order: 0 },
    { quizId: quiz1._id, type: 'tf', text: 'Inserting at the start of an array requires shifting elements.', options: ['True', 'False'], correctAnswer: 0, explanation: 'Every existing element has to move one place to make room.', order: 1 }
  ]);
  const quiz2 = await M.Quiz.create({ courseId: cs201._id, moduleId: mods[1]._id, title: 'Stacks & Queues', description: 'Module 2 quiz', durationMinutes: 5, attemptsAllowed: 2, passingScore: 60, status: 'published', availableUntil: quizDue, showResults: 'full' });
  await M.Question.insertMany([
    { type: 'mcq', text: 'Which order does a stack follow?', options: ['LIFO: last in, first out', 'FIFO: first in, first out', 'Sorted order', 'Random order'], correctAnswer: 0, explanation: 'A stack only exposes its top, so the most recently pushed item is the first one popped.' },
    { type: 'tf', text: 'In a queue, elements are removed from the front.', options: ['True', 'False'], correctAnswer: 0, explanation: 'Queues are FIFO: items join at the rear and leave from the front.' },
    { type: 'mcq', text: 'Which operation places a new element on top of a stack?', options: ['enqueue', 'push', 'pop', 'peek'], correctAnswer: 1, explanation: 'push adds to the top, pop removes from it, and peek reads it without removing anything.' },
    { type: 'mcq', text: 'With a linked list that keeps a tail pointer, how long does enqueue take?', options: ['O(n)', 'O(log n)', 'O(1)', 'O(n²)'], correctAnswer: 2, explanation: 'The tail pointer lets you attach the new node directly, with no traversal.' },
    { type: 'tf', text: 'The undo feature in a text editor is usually built with a queue.', options: ['True', 'False'], correctAnswer: 1, explanation: 'Undo reverses the most recent action first, which is stack (LIFO) behaviour.' }
  ].map((q, i) => ({ ...q, quizId: quiz2._id, order: i })));

  // ---------- quests ----------
  const endOfWeek = ago(-3);
  const d1 = await M.Quest.create({ courseId: cs201._id, title: 'Complete one lesson', type: 'Daily', objective: { kind: 'complete_lessons', target: 1 }, xpReward: 25, createdBy: farooq._id });
  const d2 = await M.Quest.create({ courseId: cs201._id, title: 'Score 80% or more on a quiz', type: 'Daily', objective: { kind: 'quiz_score', target: 1, minScore: 80 }, xpReward: 25, createdBy: farooq._id });
  const w1 = await M.Quest.create({ courseId: cs201._id, title: 'Complete 5 learning activities', type: 'Weekly', objective: { kind: 'activities', target: 5 }, xpReward: 100, createdBy: farooq._id });
  const c1 = await M.Quest.create({ courseId: cs201._id, title: 'Finish Module 2: Linear structures', type: 'Course', objective: { kind: 'complete_lessons', target: 3, moduleId: mods[1]._id }, xpReward: 75, deadline: ago(-5), createdBy: farooq._id, description: 'Set by Dr. Farooq' });
  const a1 = await M.Quest.create({ courseId: cs201._id, title: 'Study 7 days in a row', type: 'Achievement', objective: { kind: 'streak_days', target: 7 }, xpReward: 100, createdBy: farooq._id, description: 'Lessons and quizzes count, opening the app does not.' });
  await M.Quest.create({ courseId: cs201._id, title: 'Finish a lesson before 9 AM', type: 'Daily', objective: { kind: 'complete_lessons', target: 1 }, xpReward: 25, availableFrom: ago(3), deadline: ago(0, 9), createdBy: farooq._id });

  // ---------- enrollments ----------
  const everyone = [areeb, ...peerUsers, ...riskUsers];
  await M.Enrollment.insertMany(everyone.map((u, i) => ({ studentId: u._id, courseId: cs201._id, enrolledAt: ago(30 - i) })));
  await M.Enrollment.create({ studentId: peerUsers[0]._id, courseId: cs305._id, enrolledAt: ago(10) });

  // ---------- helper to write history ----------
  const tx = (studentId, amount, sourceType, sourceId, description, when, eventKey, courseId = cs201._id) =>
    M.XpTransaction.create({ studentId, amount, sourceType, sourceId: String(sourceId), courseId, description, eventKey, createdAt: when });
  const doneLesson = (u, idx, when) => M.LessonProgress.create({ studentId: u._id, lessonId: L(idx)._id, courseId: cs201._id, moduleId: L(idx).moduleId, completedAt: when });
  const attempt = (u, quiz, score, when) =>
    M.QuizAttempt.create({ quizId: quiz._id, courseId: cs201._id, studentId: u._id, status: 'submitted', startedAt: when, expiresAt: new Date(when.getTime() + 5 * 60000), submittedAt: when, score, passed: score >= 60, pointsEarned: Math.round(score / 20), pointsTotal: 5, answers: [] });

  // ---------- Areeb: 380 XP, level 4, 6-day streak, last active yesterday ----------
  const today = dayKey(new Date(), config.timezone);
  let areebXp = 0;
  const give = async (...a) => { await tx(areeb._id, ...a); areebXp += a[0]; };
  for (let i = 0; i < 5; i++) {
    const when = ago(6 - i, 18);
    await doneLesson(areeb, i, when);
    await give(10, 'lesson', L(i)._id, `Lesson · ${L(i).title}`, when, `lesson:${L(i)._id}:${areeb._id}`);
  }
  await give(75, 'module', mods[0]._id, 'Module complete · Foundations', ago(4, 18), `module:${mods[0]._id}:${areeb._id}`);
  await attempt(areeb, quiz1, 80, ago(4, 19));
  await give(30, 'quiz_pass', quiz1._id, 'Quiz passed · Foundations check', ago(4, 19), `quiz-pass:${quiz1._id}:${areeb._id}`);
  const prevWeek = weekKey(addDays(today, -7));
  for (let n = 1; n <= 5; n++) {
    const key = addDays(today, -n);
    await M.QuestProgress.create({ studentId: areeb._id, questId: d1._id, courseId: cs201._id, periodKey: key, progress: 1, completed: true, completedAt: ago(n, 18) });
    await give(25, 'quest', d1._id, 'Daily quest · Complete one lesson', ago(n, 18), `quest:${d1._id}:${areeb._id}:${key}`);
  }
  await M.QuestProgress.create({ studentId: areeb._id, questId: w1._id, courseId: cs201._id, periodKey: prevWeek, progress: 5, completed: true, completedAt: ago(6, 18) });
  await give(100, 'quest', w1._id, 'Weekly quest · Complete 5 learning activities', ago(6, 18), `quest:${w1._id}:${areeb._id}:${prevWeek}`);
  await M.QuestProgress.create({ studentId: areeb._id, questId: w1._id, courseId: cs201._id, periodKey: weekKey(today), progress: 3, completed: false });
  await M.QuestProgress.create({ studentId: areeb._id, questId: c1._id, courseId: cs201._id, periodKey: 'once', progress: 2, completed: false });
  await M.QuestProgress.create({ studentId: areeb._id, questId: a1._id, courseId: cs201._id, periodKey: 'once', progress: 6, completed: false });
  await M.StudentProfile.updateOne({ userId: areeb._id }, { xp: areebXp });
  const days = [1, 2, 3, 4, 5, 6].map((n) => addDays(today, -n)).reverse();
  await M.Streak.create({ studentId: areeb._id, currentStreak: 6, longestStreak: 9, lastQualifyingDate: addDays(today, -1), streakStartDate: addDays(today, -6), recentDays: days, timezone: config.timezone });
  const first = await M.Achievement.findOne({ key: 'first_steps' });
  await M.StudentAchievement.create({ studentId: areeb._id, achievementId: first._id, unlockedAt: ago(6, 18) });
  await M.Notification.insertMany([
    { userId: areeb._id, type: 'deadline', courseId: cs201._id, title: 'The Stacks & Queues quiz is due Friday at 11:59 PM', createdAt: ago(0, 8) },
    { userId: areeb._id, type: 'course', courseId: cs201._id, title: 'Dr. Farooq posted a new course quest: Finish Module 2', createdAt: ago(1, 12) },
    { userId: areeb._id, type: 'achievement', title: 'Badge unlocked: First Steps', read: true, createdAt: ago(6, 18) }
  ]);

  // ---------- classmates ----------
  for (let i = 0; i < peers.length; i++) {
    const [, xp, nLessons, score] = peers[i];
    const u = peerUsers[i];
    for (let k = 0; k < nLessons; k++) await doneLesson(u, k, ago(8 - k, 15));
    await attempt(u, quiz1, score, ago(1, 15)); // classmates were active yesterday, so only the 4 low-activity students are flagged
    if (nLessons >= 6) await attempt(u, quiz2, score, ago(1, 16));
    await tx(u._id, xp, 'adjustment', 'seed', 'Seeded sample history', ago(2), `seed:${u._id}`);
    await M.StudentProfile.updateOne({ userId: u._id }, { xp });
    const iso = addDays(today, -(i % 3));
    await M.Streak.create({ studentId: u._id, currentStreak: 2 + i, longestStreak: 4 + i, lastQualifyingDate: iso, streakStartDate: addDays(iso, -(1 + i)), recentDays: [iso], timezone: config.timezone });
  }
  await M.StudentProfile.updateOne({ userId: peerUsers[3]._id }, { leaderboardVisible: false }); // Bilal opted out - shows as anonymous

  // ---------- students who need attention ----------
  for (let i = 0; i < atRisk.length; i++) {
    const [, nLessons, daysAgo, score] = atRisk[i];
    for (let k = 0; k < nLessons; k++) await doneLesson(riskUsers[i], k, ago(daysAgo + (nLessons - k), 14));
    if (score !== null) await attempt(riskUsers[i], quiz1, score, ago(daysAgo, 14));
    const xp = nLessons * 10;
    await tx(riskUsers[i]._id, xp, 'adjustment', 'seed', 'Seeded sample history', ago(daysAgo), `seed:${riskUsers[i]._id}`);
    await M.StudentProfile.updateOne({ userId: riskUsers[i]._id }, { xp });
  }

  console.log('\nDone. Demo accounts (local use only):');
  console.log(`  Student     areeb@campusquest.test   / ${DEMO.student}`);
  console.log(`  Instructor  farooq@campusquest.test  / ${DEMO.instructor}`);
  console.log(`  Admin       admin@campusquest.test   / ${DEMO.admin}`);
  console.log(`  CS-305 enrollment code: ALGO305`);
  await db.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.disconnect().catch(() => {});
  process.exit(1);
});
