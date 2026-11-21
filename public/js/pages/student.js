import { get, post, patch, ApiError } from '../api.js';
import { store } from '../store.js';
import {
  html, raw, icon, achievementIcon, initials, plural, num, timeAgo, fmtDate, fmtDateTime, dueText, rich, bar, spinner, empty,
  openSheet, closeSheet, toast, rewardSheet, infoSheet, confirmSheet, formData, showFieldErrors
} from '../ui.js';

const bump = () => window.dispatchEvent(new Event('cq:unread'));
const topbar = (title, backHref, right = '') => html`<div class="topbar"><a class="iconbtn" href="#${backHref}" aria-label="Back">${icon('back')}</a><h1 class="grow" style="font-size:20px">${title}</h1>${right}</div>`;

export function objectiveText(o) {
  const n = o.target;
  switch (o.kind) {
    case 'complete_lessons': return `Complete ${plural(n, 'lesson')}`;
    case 'pass_quiz': return n === 1 ? 'Pass a quiz' : `Pass ${n} quizzes`;
    case 'quiz_score': return `Score ${o.minScore}% or more on ${n === 1 ? 'a quiz' : n + ' quizzes'}`;
    case 'complete_module': return n === 1 ? 'Complete a module' : `Complete ${n} modules`;
    case 'streak_days': return `Study ${n} days in a row`;
    case 'activities': return `Complete ${n} learning ${n === 1 ? 'activity' : 'activities'}`;
    default: return '';
  }
}

function questEnds(q) {
  if (q.status === 'completed') return q.recurrence === 'daily' ? 'Done today · resets at midnight' : q.recurrence === 'weekly' ? 'Done this week' : 'Completed';
  if (q.status === 'expired') return `Expired ${fmtDate(q.deadline)}`;
  const base = q.recurrence === 'daily' ? 'Resets at midnight' : q.recurrence === 'weekly' ? 'Resets Monday' : '';
  const due = q.deadline ? dueText(q.deadline) : '';
  return [base, due].filter(Boolean).join(' · ') || objectiveText(q.objective);
}

const questIcon = (q) => (q.status === 'completed' ? html`<div class="ibox ok">${icon('check', 20, { sw: 2.5 })}</div>` : html`<div class="ibox ${q.status === 'expired' ? 'gray' : ''}">${icon('target')}</div>`);

// ======================================================= HOME
export async function home(ctx) {
  const [profile, qres, xp] = await Promise.all([get('/users/profile'), get('/quests'), get('/users/xp?limit=4')]);
  const L = profile.level;
  const primary = profile.courses[0];
  let course = null, lb = null, quizzes = [];
  if (primary) {
    [course, lb, quizzes] = await Promise.all([get(`/courses/${primary.id}`), get(`/gamification/leaderboard?courseId=${primary.id}`), get(`/courses/${primary.id}/quizzes`).then((r) => r.quizzes)]);
  }

  // Next best action: next unfinished lesson -> an open quiz -> the course
  let cta = null;
  if (course) {
    let nextLesson = null;
    for (const m of course.tree || []) {
      if (m.locked) continue;
      nextLesson = m.lessons.find((l) => !l.completed);
      if (nextLesson) { nextLesson.mod = m; break; }
    }
    const openQuiz = quizzes.find((q) => q.canStart && !q.bestPassed);
    if (nextLesson) cta = { title: nextLesson.title, sub: `${nextLesson.mod.title} · ${nextLesson.minutes} min · +10 XP`, label: 'Continue lesson', href: `/lesson/${nextLesson.id}` };
    else if (openQuiz) cta = { title: `Quiz · ${openQuiz.title}`, sub: `${plural(openQuiz.questionCount, 'question')} · pass at ${openQuiz.passingScore}%`, label: 'Take the quiz', href: `/quiz/${openQuiz.id}` };
    else cta = { title: 'You are all caught up', sub: 'New lessons appear here when your instructor releases them.', label: 'Open course', href: `/course/${course.id}` };
  }
  const upcoming = quizzes.filter((q) => q.availableUntil && new Date(q.availableUntil) > new Date() && q.attemptsLeft > 0 && !q.bestPassed).sort((a, b) => new Date(a.availableUntil) - new Date(b.availableUntil))[0];
  const today = (qres.quests || []).filter((q) => q.recurrence !== 'once' || q.status === 'active').sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || (a.recurrence === 'once') - (b.recurrence === 'once')).slice(0, 3);
  const me = lb && lb.me;

  ctx.show(html`<div class="page">
    <div class="spread" style="padding-top:4px">
      <div class="row"><div class="avatar">${initials(store.user.name)}</div><div><div class="small muted">Welcome back</div><div class="display bold" style="font-size:20px">${store.user.name.split(' ')[0]}</div></div></div>
      <a class="iconbtn" href="#/notifications" aria-label="Notifications">${icon('bell', 22)}<span class="count-badge js-unread" ${store.unread ? '' : 'hidden'}>${store.unread}</span></a>
    </div>

    <div class="hero col" style="gap:14px">
      <div class="spread top" style="align-items:flex-start">
        <div><div class="small" style="opacity:.9">Current level</div><div class="display" style="font-size:40px;font-weight:700;line-height:1.1">Level ${L.level}</div></div>
        <div class="row gap-6 semi" style="background:rgba(255,255,255,.16);border-radius:999px;padding:6px 12px;font-size:14px"><span style="color:#FBBF24;display:inline-flex">${icon('bolt', 16, { fill: true })}</span><span>${num(L.xp)} XP</span></div>
      </div>
      ${bar(L.progressPct, '', 'fat')}
      <div class="spread small"><span>${num(L.xpToNext)} XP to Level ${L.nextLevel}</span><span style="opacity:.9">${num(L.xp)} / ${num(L.nextLevelXp)}</span></div>
    </div>

    <div class="grid2">
      <div class="card pad col gap-4">
        <div class="row gap-6" style="color:var(--flame)">${icon('flame', 20)}<span class="bold ink" style="color:var(--ink)">${profile.streak.currentStreak}-day streak</span></div>
        <div class="xs muted">Longest: ${plural(profile.streak.longestStreak, 'day')}</div>
        <div class="week mt-8" aria-hidden="true">${profile.streak.week.map((d) => html`<span class="day${d.today ? ' today' : ''}"><i class="dot ${d.active ? '' : d.today ? 'off' : 'idle'}"></i><span>${'SMTWTFS'[new Date(d.date + 'T12:00:00Z').getUTCDay()]}</span></span>`)}</div>
        <div class="xs muted mt-4">Today: ${profile.streak.activeToday ? 'done, streak safe' : 'finish a lesson or quiz to keep it'}</div>
      </div>
      <a class="card pad col gap-4" href="#/leaderboard" style="text-decoration:none;color:inherit">
        <div class="row gap-6" style="color:var(--xp-strong)">${icon('trophy', 20)}<span class="bold" style="color:var(--ink)">${me ? `#${me.rank}` : '—'}${primary ? ` in ${primary.code || 'class'}` : ''}</span></div>
        <div class="xs muted">${lb ? (lb.totalMembers > 1 ? `out of ${plural(lb.totalMembers, 'student')}` : 'Only learner so far — invite classmates') : 'Join a course to compete'}</div>
        ${lb && lb.entries.length ? html`<div class="mini-lb mt-8">${lb.entries.slice(0, 3).map((e) => html`<div class="mini-row${e.isMe ? ' me' : ''}"><span class="mini-rank">${e.rank}</span><span class="grow ellipsis">${e.isMe ? 'You' : e.name}</span><span class="mini-xp">${num(e.xp)} XP</span></div>`)}</div>` : ''}
        ${(() => {
          if (!lb || !me || lb.totalMembers < 2) return '';
          const i = lb.entries.findIndex((e) => e.isMe);
          if (me.rank === 1) { const next = lb.entries.find((e) => !e.isMe); return next ? html`<div class="xs muted">You lead by ${num(me.xp - next.xp)} XP</div>` : ''; }
          const above = i > 0 ? lb.entries[i - 1] : null;
          return above ? html`<div class="xs muted">${num(above.xp - me.xp + 1)} XP to pass #${above.rank}</div>` : '';
        })()}
        <div class="small semi mt-auto" style="color:var(--accent)">See leaderboard</div>
      </a>
    </div>

    ${primary && cta ? html`<div class="card pad col">
      <div class="spread"><span class="chip">${primary.code} · ${primary.title}</span><span class="xs muted">${primary.progress.percent}% complete</span></div>
      <div><h2>${cta.title}</h2><div class="small muted mt-4">${cta.sub}</div></div>
      ${bar(primary.progress.percent)}
      <div class="row"><a class="btn primary grow" href="#${cta.href}">${cta.label}</a>${cta.href === `/course/${primary.id}` ? '' : html`<a class="btn" href="#/course/${primary.id}">Course</a>`}</div>
    </div>` : html`<div class="card pad-lg col center" style="align-items:center"><div class="ibox">${icon('book')}</div><h2>Join your first course</h2><p class="muted small">Enrol in a course to start earning XP, quests and badges.</p><a class="btn primary" href="#/courses">Browse courses</a></div>`}

    ${today.length ? html`<div class="spread"><h2>Today's quests</h2><a class="btn link" href="#/quests">See all</a></div>
    <div class="col gap-10" style="margin-top:-8px">${today.map((q) => html`<div class="card pad-sm row">
      ${questIcon(q)}
      <div class="grow col gap-8"><div class="spread top"><span class="semi small">${q.title}</span><span class="chip xp">+${q.xpReward} XP</span></div>
      <div class="row gap-8">${bar(Math.round(q.progress / q.target * 100), q.status === 'completed' ? 'ok' : '', 'thin')}<span class="xs muted nowrap">${q.progress}/${q.target}</span></div></div></div>`)}</div>` : ''}

    ${upcoming ? html`<h2>Coming up</h2>
    <a class="card pad-sm row" href="#/quiz/${upcoming.id}" style="text-decoration:none;color:inherit"><div class="ibox bad">${icon('clock')}</div><div class="grow"><div class="semi small">Quiz · ${upcoming.title}</div><div class="xs muted">${dueText(upcoming.availableUntil)} · ${plural(upcoming.attemptsLeft, 'attempt')} left</div></div>${icon('chevron', 18)}</a>` : ''}

    ${xp.transactions.length ? html`<h2>Recent XP</h2><div class="card pad" style="padding-top:2px;padding-bottom:2px">${xp.transactions.map((t) => html`<div class="log-row"><div><div class="small">${t.description}</div><div class="xs muted">${timeAgo(t.createdAt)}</div></div><div class="xp-text small nowrap">+${t.amount} XP</div></div>`)}</div>` : ''}
  </div>`, { title: 'Learn', nav: '/' });
}

// ======================================================= COURSES (explorer)
export async function courses(ctx) {
  let view = ctx.query.view === 'all' ? 'all' : 'mine';
  let q = '';
  let items = [];
  const load = async () => { items = (await get(`/courses?limit=60${q ? `&q=${encodeURIComponent(q)}` : ''}`)).items; };
  await load();

  const card = (c) => html`<div class="card pad col">
    <div class="spread"><span class="chip">${c.code || 'Course'}</span>${c.enrolled ? html`<span class="chip ok">Enrolled</span>` : c.requiresCode ? html`<span class="chip line">${icon('lock', 12)} Code needed</span>` : !c.enrollmentOpen ? html`<span class="chip bad">Closed</span>` : ''}</div>
    <div><h2>${c.title}</h2><div class="small muted mt-4">${c.instructorName || ''}${c.term ? ` · ${c.term}` : ''}</div></div>
    ${c.description ? html`<p class="small ink2" style="display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${c.description}</p>` : ''}
    ${c.enrolled && c.progress ? html`<div class="col gap-6">${bar(c.progress.percent)}<div class="xs muted">${c.progress.percent}% complete · ${c.progress.lessonsCompleted}/${c.progress.lessonsTotal} lessons</div></div>` : ''}
    <div class="row mt-auto"><a class="btn ${c.enrolled ? 'primary' : ''} grow" href="#/course/${c.id}">${c.enrolled ? 'Open course' : 'View details'}</a>${!c.enrolled && c.enrollmentOpen ? html`<button class="btn outline" data-act="join" data-id="${c.id}" data-code="${c.requiresCode ? '1' : ''}" data-title="${c.title}">Join</button>` : ''}</div>
  </div>`;

  const draw = () => {
    const list = view === 'mine' ? items.filter((c) => c.enrolled) : items;
    ctx.show(html`<div class="page">
      <div><h1>Courses</h1><p class="small muted mt-4">Browse what's open and join with one tap.</p></div>
      <div class="pills" role="tablist"><button class="pill" role="tab" data-act="view" data-v="mine" aria-selected="${view === 'mine'}">My courses</button><button class="pill" role="tab" data-act="view" data-v="all" aria-selected="${view === 'all'}">Explore all</button></div>
      <div class="field"><label class="sr-only" for="q">Search courses</label><input id="q" type="search" placeholder="Search by title, code or subject" value="${q}" data-input="search"></div>
      ${list.length ? html`<div class="grid-auto">${list.map(card)}</div>` : empty('book', view === 'mine' ? "You haven't joined a course yet" : 'No courses match your search', view === 'mine' ? 'Switch to "Explore all" to find one.' : '')}
    </div>`, { title: 'Courses', nav: '/courses' });
    const input = document.getElementById('q');
    if (input && document.activeElement === document.body && ctx._refocus) { input.focus(); input.setSelectionRange(q.length, q.length); }
  };

  let timer;
  ctx.cleanup(() => clearTimeout(timer));
  ctx.on.view = (el) => { view = el.dataset.v; draw(); };
  ctx.on.search = (el) => {
    q = el.value.trim();
    clearTimeout(timer);
    timer = setTimeout(async () => { await load(); ctx._refocus = true; draw(); const i = document.getElementById('q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 300);
  };
  ctx.on.join = (el) => joinFlow(ctx, el.dataset.id, el.dataset.title, !!el.dataset.code);
  draw();
}

// Shared join flow (explorer + course detail). Restricted courses ask for the code.
function joinFlow(ctx, id, title, needsCode) {
  const doJoin = async (code) => {
    const r = await post(`/courses/${id}/enroll`, code ? { code } : {});
    toast(r.alreadyEnrolled ? 'You are already enrolled.' : `You joined ${title}!`);
    closeSheet();
    ctx.go(`/course/${id}`);
  };
  if (!needsCode) return doJoin().catch((e) => toast(e.message, 'bad'));
  openSheet(html`<h2 style="font-size:20px">Join ${title}</h2><p class="small muted">This course is restricted. Enter the enrollment code from your instructor.</p>
    <form data-submit="join-code" class="col"><div class="field"><label for="code">Enrollment code</label><input id="code" name="code" type="text" autocomplete="off" required></div><div class="row"><button type="button" class="btn grow" data-act="close-sheet">Cancel</button><button class="btn primary grow" type="submit">Join course</button></div></form>`, { label: 'Enrollment code' });
  ctx.on['join-code'] = async (form) => {
    try { await doJoin(formData(form).code); } catch (e) { showFieldErrors(form, { code: e.message }); }
  };
}

// ======================================================= COURSE DETAIL
export async function course(ctx) {
  const id = ctx.params.id;
  const c = await get(`/courses/${id}`);
  if (c.isManager) { ctx.go(`/i/course/${id}`); return; }

  if (!c.enrolled) {
    ctx.show(html`<div class="page">
      ${topbar(c.title, '/courses')}
      <div class="card pad col"><div class="row wrap"><span class="chip">${c.code}</span>${c.term ? html`<span class="chip">${c.term}</span>` : ''}${c.requiresCode ? html`<span class="chip line">${icon('lock', 12)} Code needed</span>` : ''}</div>
        <p class="ink2">${c.description || 'No description yet.'}</p><div class="small muted">Taught by ${c.instructorName} · ${plural(c.studentCount, 'student')} enrolled</div>
        ${c.enrollmentOpen ? html`<button class="btn primary lg" data-act="join">Join this course</button>` : html`<div class="alert info">Enrollment for this course is closed.</div>`}</div>
      <h2>What's inside</h2>
      <div class="card flush">${(c.outline || []).length ? c.outline.map((m) => html`<div class="item"><div class="ibox">${icon('book')}</div><div class="grow semi small">${m.title}</div><span class="xs muted">${plural(m.lessonCount, 'lesson')}</span></div>`) : html`<div class="item muted small">Content is on its way.</div>`}</div>
      <p class="xs muted">Lessons, quizzes and quests unlock once you join.</p></div>`, { title: c.title, nav: '/courses' });
    ctx.on.join = () => joinFlow(ctx, id, c.title, c.requiresCode);
    return;
  }

  const [qres, quizRes] = await Promise.all([get(`/quests?courseId=${id}`), get(`/courses/${id}/quizzes`)]);
  const pr = c.progress;
  let target = null;
  for (const m of c.tree) { if (m.locked) continue; const l = m.lessons.find((x) => !x.completed); if (l) { target = l.id; break; } }

  ctx.show(html`<div class="page">
    ${topbar(c.title, '/courses')}
    <div class="small muted" style="margin-top:-8px">${c.code} · ${c.instructorName}</div>
    <div class="card pad col"><div class="spread" style="align-items:baseline"><span class="semi">Course progress</span><span class="display bold" style="font-size:24px;color:var(--accent)">${pr.percent}%</span></div>${bar(pr.percent, '', 'fat')}
      <div class="xs muted">${pr.lessonsCompleted} of ${pr.lessonsTotal} lessons · ${pr.quizzesPassed}/${pr.quizzesTotal} quizzes passed · ${pr.questsCompleted}/${pr.questsTotal} quests</div></div>
    ${c.tree.map((m) => html`<div class="card flush"><div class="pad-sm" style="padding:14px 16px;border-bottom:1px solid var(--line-2)"><div class="semi">${m.title}</div><div class="xs muted mt-4">${m.locked ? `Opens ${fmtDate(m.availableFrom)}` : `${m.completedCount} of ${m.lessons.length} lessons done`}</div></div>
      ${m.lessons.map((l) => m.locked
        ? html`<div class="item"><span class="lesson-ic locked">${icon('lock', 15)}</span><div class="grow"><div class="small muted">${l.title}</div><div class="xs muted">${l.minutes} min</div></div></div>`
        : html`<a class="item ${l.id === target ? 'target' : ''}" href="#/lesson/${l.id}"><span class="lesson-ic ${l.completed ? 'done' : ''}">${l.completed ? icon('check', 16, { sw: 3 }) : icon('play', 14, { fill: true })}</span><div class="grow"><div class="small semi">${l.title}</div><div class="xs muted">${l.minutes} min${l.id === target ? ' · +10 XP' : ''}</div></div><span class="xs semi" style="color:var(--accent)">${l.completed ? 'Review' : 'Start'}</span></a>`)}
      ${m.lessons.length === 0 ? html`<div class="item muted small">No lessons released yet.</div>` : ''}</div>`)}
    ${quizRes.quizzes.length ? html`<h2>Quizzes</h2>${quizRes.quizzes.map((z) => html`<a class="card pad row" href="#/quiz/${z.id}" style="text-decoration:none;color:inherit"><div class="ibox">${icon('help')}</div><div class="grow"><div class="semi small">${z.title}</div><div class="xs muted">${z.attemptsUsed > 0 ? `Best ${z.bestScore}% · ${z.attemptsUsed}/${z.attemptsAllowed} attempts used` : `${plural(z.questionCount, 'question')} · ${z.durationMinutes} min · pass at ${z.passingScore}%`}${z.availableUntil ? ` · ${dueText(z.availableUntil)}` : ''}</div></div>${z.bestPassed ? html`<span class="chip ok">Passed</span>` : ''}${icon('chevron', 18)}</a>`)}` : ''}
    ${qres.quests.length ? html`<div class="spread"><h2>Course quests</h2><a class="btn link" href="#/quests">All quests</a></div>${qres.quests.slice(0, 4).map((q) => html`<div class="card pad-sm row">${questIcon(q)}<div class="grow"><div class="semi small">${q.title}</div><div class="xs muted">${questEnds(q)}</div></div><span class="chip xp">+${q.xpReward} XP</span></div>`)}` : ''}
    <div class="row wrap"><a class="btn grow" href="#/leaderboard?course=${id}">${icon('trophy', 18)} Leaderboard</a><button class="btn danger" data-act="leave">Leave course</button></div>
  </div>`, { title: c.title, nav: '/courses' });

  ctx.on.leave = async () => {
    if (await confirmSheet({ title: 'Leave this course?', body: 'Your progress and XP are kept. You can join again later.', confirm: 'Leave course', danger: true })) {
      await post(`/courses/${id}/leave`);
      toast('You left the course.');
      ctx.go('/courses');
    }
  };
}

// ======================================================= LESSON
export async function lesson(ctx) {
  let d = await get(`/lessons/${ctx.params.id}`);
  let busy = false;
  const draw = () => ctx.show(html`<div class="page">
    <div class="topbar"><a class="iconbtn" href="#/course/${d.courseId}" aria-label="Back to course">${icon('back')}</a><div class="small muted">Module ${d.moduleNumber} · Lesson ${d.position} of ${d.count}</div></div>
    <div><h1 style="font-size:28px;line-height:1.2">${d.title}</h1><div class="row small muted mt-8 gap-10"><span>${d.minutes} min read</span><span>·</span><span class="xp-text">+10 XP</span></div></div>
    <div class="card pad-lg rich" style="font-size:15px">${rich(d.content)}</div>
    ${d.resources.map((r) => html`<a class="card pad-sm row" href="${r.url}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;color:inherit"><div class="ibox gray">${icon('download')}</div><div class="grow"><div class="small semi">${r.title}</div><div class="xs muted">Opens in a new tab · no XP for downloads</div></div></a>`)}
    ${d.completed
      ? html`<div class="col gap-10"><button class="btn done lg" data-act="already">${icon('check', 18, { sw: 2.5 })} Completed · XP awarded</button>
          ${d.nextId ? html`<a class="btn primary lg" href="#/lesson/${d.nextId}">Next lesson</a>` : ''}
          ${d.moduleQuiz ? html`<a class="btn ${d.nextId ? '' : 'primary'} lg" href="#/quiz/${d.moduleQuiz.id}">Take the ${d.moduleQuiz.title} quiz</a>` : ''}</div>`
      : html`<button class="btn primary lg" data-act="complete" ${busy ? 'disabled' : ''}>Mark as complete · +10 XP</button>`}
    ${d.prevId ? html`<a class="btn link" href="#/lesson/${d.prevId}">← Previous lesson</a>` : ''}
  </div>`, { title: d.title, nav: '/courses' });
  ctx.on.already = () => infoSheet('Already rewarded', 'You completed this lesson earlier and its XP is already in your history. Each reward is granted once, so repeating it adds nothing.');
  ctx.on.complete = async () => {
    if (busy) return;
    busy = true; draw();
    try {
      const r = await post(`/lessons/${d.id}/complete`);
      d.completed = true;
      busy = false;
      draw();
      if (r.alreadyCompleted) ctx.on.already();
      else { rewardSheet(r.rewards, r.rewards.moduleCompleted ? 'Module complete!' : 'Lesson complete'); bump(); }
    } catch (e) { busy = false; draw(); toast(e.message, 'bad'); }
  };
  draw();
}

// ======================================================= QUIZ
export async function quizIntro(ctx) {
  const z = await get(`/quizzes/${ctx.params.id}`);
  const stat = (label, val) => html`<div class="card pad-sm"><div class="xs muted">${label}</div><div class="display bold" style="font-size:20px">${val}</div></div>`;
  ctx.show(html`<div class="page">
    ${topbar(z.title, `/course/${z.courseId}`)}
    <div class="small muted" style="margin-top:-8px">${z.availableUntil ? dueText(z.availableUntil) : 'No deadline'}${z.description ? ` · ${z.description}` : ''}</div>
    <div class="grid2">${stat('Questions', z.questionCount)}${stat('Time limit', `${z.durationMinutes} min`)}${stat('Pass mark', `${z.passingScore}%`)}${stat('Attempts used', `${z.attemptsUsed} of ${z.attemptsAllowed}`)}</div>
    <div class="card pad col gap-10 small"><div class="bold">Rewards</div>
      <div class="spread"><span>Pass the quiz</span><span class="xp-text">+${z.rewards.pass} XP</span></div>
      <div class="spread"><span>Score ${z.rewards.bonusThreshold}% or more</span><span class="xp-text">+${z.rewards.bonus} XP bonus</span></div>
      <div class="xs muted" style="border-top:1px solid var(--line-2);padding-top:10px;line-height:1.5">Rewards are granted once per quiz. Retakes are recorded, but they can't earn the same XP twice. Leaving a quiz discards it without using an attempt.</div></div>
    ${z.bestScore !== null ? html`<div class="small ink2">Best score so far: <strong>${z.bestScore}%</strong> · <a href="#/quiz/${z.id}/result">View last result</a></div>` : ''}
    ${z.inProgress ? html`<div class="alert info">You have an attempt in progress. Resume it to keep your timer running.</div>` : ''}
    ${z.canStart ? html`<a class="btn primary lg" href="#/quiz/${z.id}/play">${z.inProgress ? 'Resume quiz' : z.attemptsUsed > 0 ? `Start attempt ${z.attemptsUsed + 1}` : 'Start quiz'}</a>` : html`<button class="btn lg" disabled>${z.blockedReason || 'Not available'}</button>`}
  </div>`, { title: z.title, nav: '/courses' });
}

export async function quizPlay(ctx) {
  const quizId = ctx.params.id;
  let att;
  try { att = await post(`/quizzes/${quizId}/start`); } catch (e) {
    ctx.show(html`<div class="page">${topbar('Quiz', `/quiz/${quizId}`)}<div class="card pad-lg center col" style="align-items:center"><div class="ibox bad">${icon('lock')}</div><h2>Can't start this quiz</h2><p class="muted">${e.message}</p><a class="btn primary" href="#/quiz/${quizId}">Back</a></div></div>`, { title: 'Quiz', nav: '/courses', bare: true });
    return;
  }
  const key = `cq-answers-${att.attemptId}`;
  let answers = {};
  try { answers = JSON.parse(sessionStorage.getItem(key) || '{}'); } catch { answers = {}; }
  const deadline = Date.now() + att.secondsLeft * 1000;
  let qi = 0;
  let submitting = false;
  const qs = att.questions;
  const left = () => Math.max(0, Math.round((deadline - Date.now()) / 1000));
  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  const draw = () => {
    const q = qs[qi];
    const answered = answers[q.id] !== undefined;
    const last = qi === qs.length - 1;
    const s = left();
    ctx.show(html`<div class="page" style="min-height:calc(100vh - 60px)">
      <div class="spread"><button class="iconbtn" data-act="leave" aria-label="Leave quiz">${icon('x')}</button><div class="semi">Question ${qi + 1} of ${qs.length}</div><div class="timer ${s <= 60 ? 'low' : ''}" id="timer">${icon('clock', 16)}<span id="timetext">${fmt(s)}</span></div></div>
      <div class="segs" aria-hidden="true">${qs.map((x, i) => html`<i class="${answers[x.id] !== undefined ? 'on' : i === qi ? 'cur' : ''}"></i>`)}</div>
      <span class="chip line" style="align-self:flex-start">${q.type === 'tf' ? 'True / False' : 'Multiple choice'}</span>
      <h1 id="qtext" tabindex="-1" style="font-size:22px;line-height:1.35">${q.text}</h1>
      <div class="col gap-10" role="group" aria-labelledby="qtext">${q.options.map((o, i) => html`<button class="option" data-act="pick" data-i="${i}" aria-pressed="${answers[q.id] === i}"><span class="letter">${'ABCDEF'[i]}</span><span>${o}</span></button>`)}</div>
      <div class="row mt-auto">${qi > 0 ? html`<button class="btn lg" data-act="prev">Back</button>` : ''}
        ${!answered ? html`<button class="btn lg grow" disabled>Choose an answer</button>` : last ? html`<button class="btn ok lg grow" data-act="submit" ${submitting ? 'disabled' : ''}>Submit quiz</button>` : html`<button class="btn primary lg grow" data-act="next">Next question</button>`}</div>
    </div>`, { title: att.quiz.title, nav: '/courses', bare: true });
  };

  const submit = async (auto) => {
    if (submitting) return;
    submitting = true;
    clearInterval(tick);
    try {
      const r = await post(`/quizzes/${quizId}/submit`, { attemptId: att.attemptId, answers });
      sessionStorage.removeItem(key);
      store.flash = { quizId, rewards: r.rewards, result: r.result, auto: !!auto };
      ctx.go(`/quiz/${quizId}/result?attempt=${r.result.attemptId}`);
    } catch (e) {
      submitting = false;
      toast(e.message, 'bad');
      draw();
    }
  };

  const tick = setInterval(() => {
    const s = left();
    const el = document.getElementById('timetext');
    if (el) el.textContent = fmt(s);
    const box = document.getElementById('timer');
    if (box) box.classList.toggle('low', s <= 60);
    if (s <= 0) submit(true);
  }, 1000);
  ctx.cleanup(() => clearInterval(tick));

  ctx.on.pick = (el) => { answers[qs[qi].id] = Number(el.dataset.i); sessionStorage.setItem(key, JSON.stringify(answers)); draw(); };
  ctx.on.next = () => { qi = Math.min(qs.length - 1, qi + 1); draw(); document.getElementById('qtext')?.focus(); };
  ctx.on.prev = () => { qi = Math.max(0, qi - 1); draw(); document.getElementById('qtext')?.focus(); };
  ctx.on.submit = () => submit(false);
  ctx.on.leave = async () => {
    if (await confirmSheet({ title: 'Leave this quiz?', body: 'Your answers will be discarded and this attempt will not be counted.', confirm: 'Leave quiz', danger: true })) {
      clearInterval(tick);
      await post(`/quizzes/${quizId}/abandon`);
      sessionStorage.removeItem(key);
      ctx.go(`/quiz/${quizId}`);
    }
  };
  draw();
  if (left() <= 0) submit(true);
}

export async function quizResult(ctx) {
  const quizId = ctx.params.id;
  const r = await get(`/quizzes/${quizId}/results${ctx.query.attempt ? `?attemptId=${ctx.query.attempt}` : ''}`);
  const flash = store.flash && store.flash.quizId === quizId ? store.flash : null;
  store.flash = null;
  if (!r.latest) {
    ctx.show(html`<div class="page">${topbar('Quiz results', `/quiz/${quizId}`)}${empty('help', 'No attempts yet', 'Finish a quiz to see your results here.')}</div>`, { title: 'Results', nav: '/courses' });
    return;
  }
  const L = r.latest;
  const hidden = L.showResults === 'none';
  const passed = L.passed;
  ctx.show(html`<div class="page">
    ${topbar('Quiz results', `/course/${r.quiz.courseId}`)}
    <div class="card pad-lg col center" style="align-items:center;gap:10px">
      ${hidden ? html`<div class="score-ring ${passed ? '' : 'fail'}" style="font-size:22px">${passed ? 'Passed' : 'Not passed'}</div>` : html`<div class="score-ring ${passed ? '' : 'fail'}">${L.score}%</div>`}
      <div class="display bold" style="font-size:22px;color:${passed ? 'var(--ok)' : 'var(--bad)'}">${passed ? 'Passed' : 'Not passed'}</div>
      <div class="small muted">${hidden ? '' : `${L.correctCount} of ${L.total} correct · `}Attempt ${r.attemptsUsed} of ${r.quiz.attemptsAllowed} recorded</div>
      ${L.timedOut ? html`<div class="small bad-text">Time ran out, so your answers were submitted automatically.</div>` : ''}
    </div>
    ${L.review ? html`<div><h2>Review answers</h2><div class="xs muted mt-4">Your instructor allows answer review after submission.</div></div>
      ${L.review.map((x) => html`<div class="card pad col gap-8 small"><div class="semi">Q${x.n}. ${x.text}</div>
        ${x.correct ? html`<div class="ok-text semi">Correct: ${x.options[x.selected]}</div>` : html`<div class="col" style="gap:2px"><div class="bad-text semi">Your answer: ${x.selected === null ? 'No answer' : x.options[x.selected]}</div><div class="ok-text semi">Correct answer: ${x.options[x.correctAnswer]}</div></div>`}
        ${x.explanation ? html`<div class="muted" style="line-height:1.5">${x.explanation}</div>` : ''}</div>`)}` : (hidden ? html`<div class="alert info">Your instructor has hidden scores and answers for this quiz.</div>` : '')}
    ${r.attempts.length > 1 ? html`<h2>All attempts</h2><div class="card pad">${r.attempts.map((a, i) => html`<div class="log-row small"><span>Attempt ${r.attempts.length - i} · ${timeAgo(a.submittedAt)}</span><span class="semi">${a.score !== undefined ? a.score + '% · ' : ''}${a.passed ? 'Passed' : 'Not passed'}</span></div>`)}</div>` : ''}
    <div class="row"><a class="btn grow lg" href="#/course/${r.quiz.courseId}">Back to course</a>${r.canStart ? html`<a class="btn primary grow lg" href="#/quiz/${quizId}/play">Retake (${r.attemptsLeft} left)</a>` : ''}</div>
  </div>`, { title: 'Quiz results', nav: '/courses' });

  if (flash) {
    bump();
    const rw = flash.rewards;
    if (rw && rw.total > 0) rewardSheet(rw, passed ? 'Quiz passed' : 'Quiz submitted');
    else if (passed) infoSheet('Attempt recorded', "You already earned this quiz's rewards on an earlier attempt. Your new score is saved, but the same XP isn't granted twice.");
    else infoSheet('Not passed yet', `You need ${r.quiz.passingScore}% to pass. No XP this time. ${r.attemptsLeft > 0 ? `You have ${plural(r.attemptsLeft, 'attempt')} left.` : 'You have used all attempts.'}`);
  }
}

// ======================================================= QUESTS
export async function quests(ctx) {
  const { quests: list, stats } = await get('/quests');
  let tab = 'All';
  const types = ['All', ...[...new Set(list.map((q) => q.type))]];
  const todayStr = new Date().toDateString();
  const doneToday = list.filter((q) => q.status === 'completed' && q.completedAt && new Date(q.completedAt).toDateString() === todayStr).length;
  const draw = () => {
    const shown = list.filter((q) => tab === 'All' || q.type === tab).sort((a, b) => ['active', 'completed', 'expired'].indexOf(a.status) - ['active', 'completed', 'expired'].indexOf(b.status));
    ctx.show(html`<div class="page">
      <div><h1>Quest Center</h1><div class="small muted mt-4">Quests complete themselves when you do the work.</div></div>
      <div class="grid3">
        <div class="card pad-sm"><div class="xs muted">Active</div><div class="display bold" style="font-size:22px">${list.filter((q) => q.status === 'active').length}</div></div>
        <div class="card pad-sm"><div class="xs muted">Done today</div><div class="display bold" style="font-size:22px">${doneToday}</div></div>
        <div class="card pad-sm"><div class="xs muted">All-time</div><div class="display bold" style="font-size:22px">${stats.completedAllTime}</div></div>
      </div>
      <div class="pills">${types.map((t) => html`<button class="pill" data-act="tab" data-t="${t}" aria-pressed="${tab === t}">${t}</button>`)}</div>
      ${shown.length ? shown.map((q) => html`<div class="card pad col gap-10" style="${q.status === 'expired' ? 'opacity:.65' : ''}">
        <div class="spread"><span class="chip line">${q.type}</span><span class="chip ${q.status === 'completed' ? 'ok' : q.status === 'expired' ? '' : 'accent'}">${q.status === 'completed' ? 'Completed' : q.status === 'expired' ? 'Expired' : 'Active'}</span></div>
        <div class="semi">${q.title}</div>
        <div class="row gap-6 xs muted">${icon('clock', 14)}<span>${questEnds(q)}</span></div>
        <div class="xs muted">${q.courseCode || q.courseTitle} · ${objectiveText(q.objective)}</div>
        <div class="row">${bar(Math.round(q.progress / q.target * 100), q.status === 'completed' ? 'ok' : q.status === 'expired' ? 'gray' : '')}<span class="xs muted nowrap">${q.progress}/${q.target}</span><span class="chip xp">+${q.xpReward} XP</span></div>
      </div>`) : empty('target', list.length ? 'No quests in this category' : 'No quests yet', list.length ? '' : 'Join a course to see its quests here.')}
    </div>`, { title: 'Quests', nav: '/quests' });
  };
  ctx.on.tab = (el) => { tab = el.dataset.t; draw(); };
  draw();
}

// ======================================================= LEADERBOARD
export async function leaderboard(ctx) {
  const courseId = ctx.query.course || '';
  const r = await get(`/gamification/leaderboard${courseId ? `?courseId=${courseId}` : ''}`);
  if (!r.course) {
    ctx.show(html`<div class="page"><h1>Leaderboard</h1>${empty('trophy', 'No leaderboard yet', 'Join a course to see how you rank against your classmates.')}<a class="btn primary" href="#/courses">Browse courses</a></div>`, { title: 'Leaderboard', nav: '/leaderboard' });
    return;
  }
  const rankCls = (n) => (n <= 3 ? `r${n}` : '');
  ctx.show(html`<div class="page">
    <div><h1>Leaderboard</h1><div class="small muted mt-4">${r.course.code} ${r.course.title} · ranked by XP</div></div>
    ${r.courses.length > 1 ? html`<div class="field"><label class="sr-only" for="course">Course</label><select id="course" data-change="pickCourse">${r.courses.map((c) => html`<option value="${c.id}" ${c.id === r.course.id ? 'selected' : ''}>${c.code} · ${c.title}</option>`)}</select></div>` : ''}
    ${r.me ? html`<div class="notice row" style="gap:14px"><div class="display bold" style="font-size:34px;color:var(--accent)">#${r.me.rank}</div><div class="grow"><div class="semi">Your position</div><div class="small ink2">${num(r.me.xp)} XP · Level ${r.me.level}</div></div></div>` : ''}
    <div class="card flush">${r.entries.map((e) => html`<div class="rank-row ${e.isMe ? 'me' : ''}"><span class="rank-num ${rankCls(e.rank)}">${e.rank}</span><span class="avatar sm" ${e.isMe ? raw('style="background:rgba(255,255,255,.2);color:#fff"') : ''}>${e.initials}</span><div class="grow"><div class="semi small">${e.isMe ? `${e.name} (you)` : e.name}</div><div class="xs muted">Level ${e.level}${e.isMe && e.hidden ? ' · hidden from others' : ''}</div></div><div class="semi small nowrap">${num(e.xp)} XP</div></div>`)}</div>
    <div class="row top small ink2" style="line-height:1.5">${icon('lock', 18)}<div>Only students enrolled in ${r.course.code} see this board. <a href="#/profile">Privacy settings</a></div></div>
  </div>`, { title: 'Leaderboard', nav: '/leaderboard' });
  ctx.on.pickCourse = (el) => ctx.go(`/leaderboard?course=${el.value}`);
}

// ======================================================= ACHIEVEMENTS
export async function achievements(ctx) {
  const { achievements: list } = await get('/users/achievements');
  const got = list.filter((a) => a.unlocked).length;
  ctx.show(html`<div class="page">
    <div class="spread"><div><h1>Achievements</h1><div class="small muted mt-4">${got} of ${list.length} badges unlocked</div></div></div>
    <div class="grid2">${list.map((a) => html`<div class="card badge-tile ${a.unlocked ? '' : 'locked'}"><div class="ibox ${a.unlocked ? 'gold' : ''}">${a.unlocked ? achievementIcon(a.icon) : icon('lock', 18)}</div><div class="bold small">${a.title}</div><div class="xs muted" style="line-height:1.4">${a.description}</div>
      ${a.unlocked ? html`<div class="xs semi ok-text">Unlocked ${fmtDate(a.unlockedAt, { month: 'short', day: 'numeric' })}</div>` : html`<div class="row gap-8">${bar(Math.round(a.progress / a.target * 100), 'gray', 'thin')}<span class="xs muted nowrap">${a.progress}/${a.target}</span></div>`}</div>`)}</div>
  </div>`, { title: 'Achievements', nav: '/achievements' });
}

// ======================================================= PROFILE
export async function profile(ctx) {
  let p = await get('/users/profile');
  let xp = await get('/users/xp?limit=10');
  const ach = await get('/users/achievements');
  const lessonsDone = p.courses.reduce((t, c) => t + c.progress.lessonsCompleted, 0);
  const questsDone = p.courses.reduce((t, c) => t + c.progress.questsCompleted, 0);

  const draw = () => ctx.show(html`<div class="page">
    <div class="col center" style="align-items:center;gap:6px;padding-top:12px"><div class="avatar lg">${initials(p.name)}</div><h1 style="font-size:22px">${p.name}</h1><div class="small ink2">Level ${p.level.level} · ${num(p.level.xp)} XP</div><div class="xs muted">${p.profile.department || ''}${p.profile.department && p.profile.year ? ' · ' : ''}${p.profile.year || ''}</div>${p.profile.bio ? html`<p class="small ink2" style="max-width:420px">${p.profile.bio}</p>` : ''}</div>
    <div class="grid3 center">
      <div class="card pad-sm"><div class="display bold" style="font-size:22px">${p.streak.longestStreak}</div><div class="xs muted">Longest streak</div></div>
      <div class="card pad-sm"><div class="display bold" style="font-size:22px">${lessonsDone}</div><div class="xs muted">Lessons done</div></div>
      <div class="card pad-sm"><div class="display bold" style="font-size:22px">${questsDone}</div><div class="xs muted">Quests done</div></div>
    </div>
    <div class="card pad row"><div class="grow"><div class="semi small">Show me on leaderboards</div><div class="xs muted">Classmates see your name, level and XP</div></div><button class="switch" role="switch" aria-checked="${p.profile.leaderboardVisible}" aria-label="Show me on leaderboards" data-act="toggle-public"><span></span></button></div>
    <div class="spread"><h2>Badges</h2><a class="btn link" href="#/achievements">${ach.achievements.filter((a) => a.unlocked).length} of ${ach.achievements.length} unlocked</a></div>
    <div class="pills">${ach.achievements.map((a) => html`<span class="chip ${a.unlocked ? 'xp' : ''}" title="${a.description}">${a.unlocked ? icon('medal', 13) : icon('lock', 12)} ${a.title}</span>`)}</div>
    ${p.courses.length ? html`<h2>My courses</h2><div class="card flush">${p.courses.map((c) => html`<a class="item" href="#/course/${c.id}"><div class="grow"><div class="semi small">${c.code} · ${c.title}</div>${bar(c.progress.percent, '', 'thin')}</div><span class="xs muted">${c.progress.percent}%</span></a>`)}</div>` : ''}
    <h2>XP history</h2>
    <div class="card pad" style="padding-top:2px;padding-bottom:2px">${xp.transactions.length ? xp.transactions.map((t) => html`<div class="log-row"><div><div class="small">${t.description}</div><div class="xs muted">${timeAgo(t.createdAt)}</div></div><div class="xp-text small nowrap">+${t.amount} XP</div></div>`) : html`<div class="empty">No XP yet. Complete a lesson to earn your first points.</div>`}</div>
    ${xp.page < xp.pages ? html`<button class="btn" data-act="more-xp">Show more</button>` : ''}
    <h2>Edit profile</h2>
    <form class="card pad col" data-submit="save-profile" novalidate>
      <div class="field"><label for="name">Name</label><input id="name" name="name" type="text" value="${p.name}" required></div>
      <div class="grid2"><div class="field"><label for="dep">Department</label><input id="dep" name="department" type="text" value="${p.profile.department}"></div><div class="field"><label for="yr">Year</label><input id="yr" name="year" type="text" value="${p.profile.year}"></div></div>
      <div class="field"><label for="bio">About you</label><textarea id="bio" name="bio" maxlength="300">${p.profile.bio}</textarea></div>
      <button class="btn primary" type="submit">Save changes</button></form>
    <form class="card pad col" data-submit="save-pw" novalidate><h3>${p.security.hasPassword ? 'Change password' : 'Set a password'}</h3>
      ${p.security.google ? html`<p class="small muted" style="margin:0">Google sign-in is connected to this account.${p.security.hasPassword ? '' : ' Add a password if you also want to log in with your email.'}</p>` : ''}
      ${p.security.hasPassword ? html`<div class="field"><label for="cp">Current password</label><input id="cp" name="currentPassword" type="password" autocomplete="current-password"></div>` : ''}
      <div class="field"><label for="np">New password</label><input id="np" name="newPassword" type="password" autocomplete="new-password" aria-describedby="nphelp"><div class="help" id="nphelp">At least 8 characters with a letter and a number. Other devices will be signed out.</div></div>
      <button class="btn" type="submit">${p.security.hasPassword ? 'Update password' : 'Set password'}</button></form>
    <button class="btn danger" data-act="logout">${icon('logout', 18)} Log out</button>
  </div>`, { title: 'Profile', nav: '/profile' });

  ctx.on['toggle-public'] = async () => {
    const next = !p.profile.leaderboardVisible;
    p.profile.leaderboardVisible = next; draw();
    try { await patch('/users/profile', { leaderboardVisible: next }); toast(next ? 'You are visible on leaderboards.' : 'You are hidden from classmates.'); }
    catch (e) { p.profile.leaderboardVisible = !next; draw(); toast(e.message, 'bad'); }
  };
  ctx.on['more-xp'] = async () => { const more = await get(`/users/xp?limit=10&page=${xp.page + 1}`); xp = { ...more, transactions: xp.transactions.concat(more.transactions) }; draw(); };
  ctx.on['save-profile'] = async (form) => {
    const d = formData(form);
    try { p = await patch('/users/profile', { name: d.name, department: d.department, year: d.year, bio: d.bio }); store.user.name = p.name; toast('Profile saved.'); draw(); }
    catch (e) { showFieldErrors(form, e.data.fields || {}); toast(e.message, 'bad'); }
  };
  ctx.on['save-pw'] = async (form) => {
    try { await post('/users/password', formData(form)); toast(p.security.hasPassword ? 'Password updated.' : 'Password set.'); p.security.hasPassword = true; draw(); }
    catch (e) { showFieldErrors(form, e.data.fields || (p.security.hasPassword ? { currentPassword: e.message } : { newPassword: e.message })); toast(e.message, 'bad'); }
  };
  draw();
}

// ======================================================= NOTIFICATIONS
export async function notifications(ctx) {
  let data = await get('/notifications?limit=50');
  const kind = { quest: ['accent', 'target'], achievement: ['gold', 'medal'], level: ['gold', 'bolt'], deadline: ['bad', 'clock'], course: ['info', 'book'], system: ['gray', 'bell'] };
  const draw = () => ctx.show(html`<div class="page">
    <div class="topbar"><a class="iconbtn" href="#/" aria-label="Back">${icon('back')}</a><h1 class="grow" style="font-size:20px">Notifications</h1><button class="btn link" data-act="read-all">Mark all read</button></div>
    ${data.items.length ? html`<div class="card flush">${data.items.map((n) => html`<button class="notif ${n.read ? '' : 'unread'}" data-act="read" data-id="${n.id}"><span class="ibox ${kind[n.type][0]}" style="width:36px;height:36px">${icon(kind[n.type][1], 18, { fill: n.type === 'level' })}</span><span class="grow"><span class="ntext small" style="display:block;line-height:1.4">${n.title}</span>${n.message ? html`<span class="xs muted" style="display:block">${n.message}</span>` : ''}<span class="xs muted" style="display:block;margin-top:2px">${timeAgo(n.createdAt)}</span></span>${n.read ? '' : html`<span class="unread-dot" aria-label="Unread"></span>`}</button>`)}</div>` : empty('bell', "You're all caught up", 'Quest rewards, badges and deadlines will show up here.')}
  </div>`, { title: 'Notifications', nav: '/notifications' });
  ctx.on.read = async (el) => {
    const n = data.items.find((x) => x.id === el.dataset.id);
    if (n && !n.read) { n.read = true; draw(); await patch(`/notifications/${n.id}/read`); bump(); }
  };
  ctx.on['read-all'] = async () => { await patch('/notifications/read-all'); data.items.forEach((n) => { n.read = true; }); draw(); bump(); };
  draw();
}
