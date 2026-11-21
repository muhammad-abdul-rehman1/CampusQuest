import { get, post, patch, put, del, ApiError } from '../api.js';
import { store } from '../store.js';
import { html, raw, icon, initials, plural, num, timeAgo, fmtDate, fmtDateTime, dueText, bar, empty, openSheet, closeSheet, toast, confirmSheet, formData, showFieldErrors } from '../ui.js';
import { objectiveText } from './student.js';
import { AI_PROMPT, readQuestionsFile, downloadTemplate } from '../csv.js';

const csvHelp = html`<div class="small muted" style="line-height:1.5">Columns: <code>type, question, option_a … option_d, correct, explanation, points</code>. Use <code>mcq</code> or <code>tf</code>; <code>correct</code> is A–D (or True/False).</div>
  <div class="row wrap"><button type="button" class="btn sm" data-act="csv-template">${icon('download', 16)} Download template</button><button type="button" class="btn sm" data-act="csv-prompt">Copy AI prompt</button></div>`;
const csvPreview = (r) => html`${r.questions.length ? html`<div class="alert ok"><strong>${plural(r.questions.length, 'question')}</strong> ready to import.</div><ol class="small" style="margin:0;padding-left:20px">${r.questions.slice(0, 4).map((q) => html`<li>${q.text}</li>`)}${r.questions.length > 4 ? html`<li class="muted">…and ${r.questions.length - 4} more</li>` : ''}</ol>` : ''}
  ${r.errors.length ? html`<div class="alert bad"><strong>${plural(r.errors.length, 'row')} skipped:</strong><ul style="margin:4px 0 0;padding-left:18px">${r.errors.slice(0, 6).map((e) => html`<li>${e.row ? `Row ${e.row}: ` : ''}${e.message}</li>`)}${r.errors.length > 6 ? html`<li>…and ${r.errors.length - 6} more</li>` : ''}</ul></div>` : ''}`;
function csvCommon(ctx) {
  ctx.on['csv-template'] = () => downloadTemplate();
  ctx.on['csv-prompt'] = async () => { try { await navigator.clipboard.writeText(AI_PROMPT); toast('AI prompt copied. Replace [YOUR TOPIC] and paste it into your AI tool.'); } catch { toast('Could not copy automatically.', 'bad'); } };
}

const localInput = (d) => { if (!d) return ''; const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
const isoOrNull = (v) => (v ? new Date(v).toISOString() : null);
const intOr = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const statusChip = (s) => html`<span class="chip ${s === 'published' || s === 'active' ? 'ok' : s === 'archived' ? 'bad' : ''}" style="text-transform:capitalize">${s}</span>`;
const field = (label, id, control, help = '') => html`<div class="field"><label for="${id}">${label}</label>${control}${help ? html`<div class="help">${help}</div>` : ''}</div>`;

function pageHead(title, sub, right = '') {
  return html`<div class="spread wrap" style="align-items:flex-end"><div><div class="small muted">${sub}</div><h1 style="font-size:30px;margin-top:4px">${title}</h1></div>${right}</div>`;
}

function formError(form, err) {
  showFieldErrors(form, (err.data && err.data.fields) || {});
  let box = form.querySelector('.form-alert');
  if (!box) { box = document.createElement('div'); box.setAttribute('role', 'alert'); form.prepend(box); }
  box.className = 'form-alert alert bad';
  box.textContent = err.message;
}

// ======================================================= DASHBOARD
export async function dashboard(ctx) {
  const { courses } = await get('/instructor/courses');
  if (!courses.length) {
    ctx.show(html`<div class="page">${pageHead('Welcome to CampusQuest', 'Instructor dashboard')}<div class="card pad-lg col center" style="align-items:center"><div class="ibox">${icon('book')}</div><h2>Create your first course</h2><p class="muted small">Add modules, lessons, quizzes and quests, then publish it for students.</p><a class="btn primary" href="#/i/courses">Create a course</a></div></div>`, { title: 'Dashboard', nav: '/i' });
    return;
  }
  const busiest = courses.slice().sort((a, b) => (b.status === 'published') - (a.status === 'published') || b.enrolled - a.enrolled)[0];
  const cid = ctx.query.course && courses.find((c) => c.id === ctx.query.course) ? ctx.query.course : busiest.id;
  const a = await get(`/instructor/analytics/${cid}`);
  let sent = {};
  const toneColor = { bad: 'var(--bad)', mid: '#9CA3AF', good: 'var(--accent)', best: 'var(--ok)' };
  const max = Math.max(1, ...a.quiz.distribution.map((d) => d.count));
  const maxDay = Math.max(1, ...a.engagement.perDay.map((d) => d.activities));
  const kpi = (label, val, foot, good = false) => html`<div class="card pad"><div class="small muted">${label}</div><div class="display bold" style="font-size:32px">${val}</div><div class="xs ${good ? 'ok-text semi' : 'muted'}">${foot}</div></div>`;

  const draw = () => ctx.show(html`<div class="page" style="gap:24px">
    ${pageHead(`${a.course.code} ${a.course.title}`, 'Instructor dashboard', html`<div class="row wrap"><div class="field" style="min-width:220px"><label class="sr-only" for="cs">Course</label><select id="cs" data-change="pickCourse">${courses.map((c) => html`<option value="${c.id}" ${c.id === cid ? 'selected' : ''}>${c.code} · ${c.title}</option>`)}</select></div><a class="btn primary" href="#/i/course/${cid}">Manage course</a></div>`)}
    <div class="small ink2" style="margin-top:-16px">${plural(a.enrolled, 'student')} enrolled · ${a.lessonsPublished} published lessons</div>
    <div class="grid-kpi">
      ${kpi('Enrolled students', a.enrolled, a.newThisWeek ? `+${a.newThisWeek} this week` : 'No new students this week', a.newThisWeek > 0)}
      ${kpi('Average quiz score', a.quiz.average === null ? '—' : `${a.quiz.average}%`, `${plural(a.quiz.attempts, 'attempt')}`)}
      ${kpi('Lesson completion', `${a.lessonCompletion}%`, 'of released lessons')}
      ${kpi('Quest completion', `${a.questCompletion}%`, `across ${plural(a.questCount, 'live quest')}`)}
    </div>
    <div class="grid-auto" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))">
      <section class="card pad-lg col"><div><h2>Quiz performance</h2><div class="small muted">Score distribution across all attempts</div></div>
        ${a.quiz.attempts ? a.quiz.distribution.map((d) => html`<div class="dist-row"><span class="ink2">${d.label}</span><div class="track"><div class="fill" style="width:${Math.round(d.count / max * 100)}%;background:${toneColor[d.tone]}"></div></div><span class="semi" style="text-align:right">${plural(d.count, 'attempt')}</span></div>`) : empty('chart', 'No quiz attempts yet')}
        ${a.quiz.attempts ? html`<div class="small ink2" style="border-top:1px solid var(--line-2);padding-top:12px">${a.quiz.passed} of ${a.quiz.attempts} attempts passed (${a.quiz.passRate}%) · ${a.quiz.below} below the pass mark</div>` : ''}</section>
      <section class="card pad-lg col"><div><h2>Lesson completion by module</h2><div class="small muted">Share of enrolled students who finished every lesson</div></div>
        ${a.modules.length ? a.modules.map((m) => html`<div class="col gap-6 small"><div class="spread"><span class="semi">${m.title}</span><span class="ink2">${m.opensAt ? `Opens ${fmtDate(m.opensAt)}` : `${m.percent}%`}</span></div>${bar(m.percent, '', 'fat')}</div>`) : empty('book', 'No published modules yet')}</section>
    </div>
    <section class="card pad-lg col"><div class="spread wrap"><div><h2>Engagement this week</h2><div class="small muted">${a.engagement.activeStudents7d} of ${a.enrolled} students active in the last 7 days (${a.engagement.activePercent}%)</div></div></div>
      <div class="bars" role="img" aria-label="Learning activities per day for the last 7 days">${a.engagement.perDay.map((d) => html`<div class="b"><span>${d.activities}</span><i style="height:${Math.round(d.activities / maxDay * 64) + 2}px"></i><span>${d.date.slice(8)}</span></div>`)}</div></section>
    <section class="card pad-lg col"><div><h2>Students who need attention</h2><div class="small muted">No qualifying activity for 3+ days, or below the quiz pass mark</div></div>
      ${a.attention.length ? html`<div class="tablewrap"><table><thead><tr><th>Student</th><th>Last active</th><th>Lessons</th><th>Best quiz</th><th>Action</th></tr></thead><tbody>
        ${a.attention.map((s) => html`<tr><td><a href="#/i/student/${cid}/${s.studentId}" class="semi" style="text-decoration:none;color:inherit">${s.name}</a></td><td class="bad-text">${s.lastActive}</td><td>${s.lessons}</td><td>${s.bestQuiz === null ? 'Not attempted' : `${s.bestQuiz}%`}</td><td>${sent[s.studentId] ? html`<span class="small semi ok-text">Reminder sent</span>` : html`<button class="btn sm outline" data-act="remind" data-id="${s.studentId}">Send reminder</button>`}</td></tr>`)}</tbody></table></div>` : html`<div class="empty">Everyone is on track. Nice work.</div>`}</section>
  </div>`, { title: 'Dashboard', nav: '/i' });

  ctx.on.pickCourse = (el) => ctx.go(`/i?course=${el.value}`);
  ctx.on.remind = async (el) => {
    const r = await post(`/instructor/courses/${cid}/students/${el.dataset.id}/remind`);
    sent[el.dataset.id] = true; draw();
    toast(r.sent ? 'Reminder sent.' : 'A reminder was already sent today.');
  };
  draw();
}

// ======================================================= COURSES LIST
export async function courses(ctx) {
  const { items } = await get('/courses?limit=100');
  ctx.show(html`<div class="page" style="gap:20px">
    ${pageHead('My courses', 'Course management', html`<button class="btn primary" data-act="new">${icon('plus', 18)} New course</button>`)}
    ${items.length ? html`<div class="grid-auto">${items.map((c) => html`<a class="card pad col" href="#/i/course/${c.id}" style="text-decoration:none;color:inherit"><div class="spread"><span class="chip">${c.code || 'Course'}</span>${statusChip(c.status)}</div><h2>${c.title}</h2><div class="small muted">${c.term || ''}${c.term && c.category ? ' · ' : ''}${c.category || ''}</div><div class="small ink2">${plural(c.studentCount, 'student')} enrolled</div><div class="small semi" style="color:var(--accent)">Manage →</div></a>`)}</div>` : empty('book', 'No courses yet', 'Create one to get started.')}
  </div>`, { title: 'Courses', nav: '/i/courses' });

  ctx.on.new = () => {
    openSheet(html`<h2 style="font-size:20px">Create a course</h2>
      <form data-submit="create" class="col" novalidate>
        ${field('Course title', 'ct', html`<input id="ct" name="title" type="text" required placeholder="e.g. Data Structures">`)}
        <div class="grid2">${field('Course code', 'cc', html`<input id="cc" name="code" type="text" placeholder="CS-201">`)}${field('Term', 'cterm', html`<input id="cterm" name="term" type="text" placeholder="Fall 2026">`)}</div>
        ${field('Subject area', 'ccat', html`<input id="ccat" name="category" type="text" placeholder="Computer Science">`)}
        ${field('Description', 'cd', html`<textarea id="cd" name="description" placeholder="What will students learn?"></textarea>`)}
        <div class="row"><button type="button" class="btn grow" data-act="close-sheet">Cancel</button><button class="btn primary grow" type="submit">Create course</button></div>
      </form>`, { label: 'Create course' });
  };
  ctx.on.create = async (form) => {
    try {
      const c = await post('/courses', formData(form));
      closeSheet(); toast('Course created. Add modules and lessons next.');
      ctx.go(`/i/course/${c.id}`);
    } catch (e) { formError(form, e); }
  };
}

// ======================================================= COURSE MANAGE
const TABS = [['content', 'Content'], ['quizzes', 'Quizzes'], ['quests', 'Quests'], ['students', 'Students'], ['settings', 'Settings']];
const KINDS = [
  ['complete_lessons', 'Complete lessons'], ['pass_quiz', 'Pass quizzes'], ['quiz_score', 'Score at least X% on a quiz'],
  ['complete_module', 'Complete modules'], ['streak_days', 'Study N days in a row'], ['activities', 'Complete N learning activities']
];

export async function courseManage(ctx) {
  const id = ctx.params.id;
  const tab = TABS.some(([k]) => k === ctx.query.tab) ? ctx.query.tab : 'content';
  let c = await get(`/courses/${id}`);
  let data = {};
  const loadTab = async () => {
    c = await get(`/courses/${id}`);
    if (tab === 'quizzes') data = await get(`/courses/${id}/quizzes`);
    if (tab === 'quests') data = await get(`/quests?courseId=${id}`);
    if (tab === 'students') data = await get(`/courses/${id}/students?limit=100`);
  };
  await loadTab();
  const reload = async () => { await loadTab(); draw(); };
  const act = (fn, okMsg) => async (el, e) => { try { await fn(el, e); if (okMsg) toast(okMsg); await reload(); } catch (err) { toast(err.message, 'bad'); } };

  const modulesOpts = (sel = '') => html`<option value="">Whole course</option>${c.tree.map((m) => html`<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${m.title}</option>`)}`;

  const contentTab = () => html`
    <div class="spread wrap"><h2>Modules &amp; lessons</h2><button class="btn primary" data-act="add-module">${icon('plus', 18)} Add module</button></div>
    ${c.tree.length ? c.tree.map((m, mi) => html`<div class="card flush">
      <div class="pad-sm spread wrap" style="padding:14px 16px;border-bottom:1px solid var(--line-2)">
        <div class="row"><div><div class="semi">${m.title}</div><div class="xs muted">${plural(m.lessons.length, 'lesson')}${m.availableFrom ? ` · opens ${fmtDate(m.availableFrom)}` : ''}</div></div>${statusChip(m.status)}</div>
        <div class="row gap-6">
          <button class="iconbtn sm" data-act="mod-up" data-id="${m.id}" aria-label="Move module up" ${mi === 0 ? 'disabled' : ''}>${icon('up', 16)}</button>
          <button class="iconbtn sm" data-act="mod-down" data-id="${m.id}" aria-label="Move module down" ${mi === c.tree.length - 1 ? 'disabled' : ''}>${icon('down', 16)}</button>
          <button class="btn sm" data-act="mod-toggle" data-id="${m.id}" data-s="${m.status}">${m.status === 'published' ? 'Unpublish' : 'Publish'}</button>
          <button class="iconbtn sm" data-act="mod-edit" data-id="${m.id}" aria-label="Edit module">${icon('edit', 16)}</button>
          <button class="iconbtn sm" data-act="mod-del" data-id="${m.id}" aria-label="Delete module">${icon('trash', 16)}</button></div></div>
      ${m.lessons.map((l, li) => html`<div class="item"><span class="lesson-ic ${l.status === 'published' ? '' : 'locked'}">${icon('book', 14)}</span><div class="grow"><div class="small semi">${l.title}</div><div class="xs muted">${l.minutes} min</div></div>${statusChip(l.status)}
        <div class="row gap-6"><button class="iconbtn sm" data-act="les-up" data-m="${m.id}" data-id="${l.id}" aria-label="Move lesson up" ${li === 0 ? 'disabled' : ''}>${icon('up', 16)}</button><button class="iconbtn sm" data-act="les-down" data-m="${m.id}" data-id="${l.id}" aria-label="Move lesson down" ${li === m.lessons.length - 1 ? 'disabled' : ''}>${icon('down', 16)}</button>
        <button class="iconbtn sm" data-act="les-edit" data-id="${l.id}" aria-label="Edit lesson">${icon('edit', 16)}</button><button class="iconbtn sm" data-act="les-del" data-id="${l.id}" aria-label="Delete lesson">${icon('trash', 16)}</button></div></div>`)}
      <div class="item"><button class="btn sm outline" data-act="add-lesson" data-id="${m.id}">${icon('plus', 16)} Add lesson</button></div></div>`) : empty('layers', 'No modules yet', 'Start with a module, then add lessons to it.')}`;

  const quizzesTab = () => html`<div class="spread wrap"><h2>Quizzes</h2><button class="btn primary" data-act="new-quiz">${icon('plus', 18)} New quiz</button></div>
    ${data.quizzes && data.quizzes.length ? data.quizzes.map((q) => html`<div class="card pad row wrap"><div class="ibox">${icon('help')}</div><div class="grow"><div class="semi">${q.title}</div><div class="xs muted">${plural(q.questionCount, 'question')} · ${q.durationMinutes} min · ${plural(q.attemptsAllowed, 'attempt')} · pass at ${q.passingScore}% · ${plural(q.attemptCount, 'submission')}</div></div>${statusChip(q.status)}<a class="btn sm" href="#/i/quiz/${q.id}">Edit &amp; results</a></div>`) : empty('help', 'No quizzes yet', 'Create a quiz with multiple-choice and true/false questions.')}`;

  const questsTab = () => html`<div class="grid-auto" style="align-items:start;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))">
    <form class="card pad-lg col" data-submit="create-quest" novalidate>
      <div><h2>Create a quest</h2><div class="small muted">Students see it in their Quest Center as soon as you publish.</div></div>
      ${field('Quest title', 'qt', html`<input id="qt" name="title" type="text" placeholder="e.g. Ace the trees warm-up">`)}
      <div class="grid2">
        ${field('Category', 'qtype', html`<select id="qtype" name="type"><option>Daily</option><option>Weekly</option><option selected>Course</option><option>Module</option><option>Quiz</option><option>Streak</option><option>Achievement</option></select>`)}
        ${field('XP reward', 'qxp', html`<input id="qxp" name="xpReward" type="number" min="5" max="500" value="75">`)}
      </div>
      ${field('Completion condition', 'qk', html`<select id="qk" name="kind" data-change="kind">${KINDS.map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select>`)}
      <div class="grid2">${field('Target (how many)', 'qtg', html`<input id="qtg" name="target" type="number" min="1" max="1000" value="1">`)}<div class="field hidden" id="minscore">${raw('')}<label for="qms">Minimum score %</label><input id="qms" name="minScore" type="number" min="1" max="100" value="80"></div></div>
      ${field('Limit to a module (optional)', 'qmod', html`<select id="qmod" name="moduleId">${modulesOpts()}</select>`, 'Applies to "complete lessons" and "complete modules".')}
      ${field('Deadline (optional)', 'qdl', html`<input id="qdl" name="deadline" type="date">`)}
      <button class="btn primary" type="submit">Publish quest</button>
      <div class="xs muted" style="line-height:1.5">The system checks completion automatically and awards XP once per student. Instructors can't edit a student's XP directly. Suggested rewards: daily 25 XP, weekly 100 XP.</div>
    </form>
    <section class="card pad-lg col" style="gap:4px"><div style="margin-bottom:8px"><h2>Published quests</h2><div class="small muted">Completion across ${plural((data.quests[0] && data.quests[0].enrolled) || c.studentCount || 0, 'student')}</div></div>
      ${data.quests.length ? data.quests.map((q) => html`<div class="col gap-8" style="padding:14px 0;border-top:1px solid var(--line-2)"><div class="spread top"><div><div class="semi small">${q.title}</div><div class="xs muted mt-4">${q.type} · ${objectiveText(q.objective)} · ${q.deadline ? `Due ${fmtDate(q.deadline)}` : 'No deadline'}</div></div><div class="row gap-6">${q.isNew ? html`<span class="chip ok">New</span>` : ''}${q.status === 'archived' ? html`<span class="chip">Archived</span>` : ''}<span class="chip xp">+${q.xpReward} XP</span></div></div>
        <div class="row">${bar(q.enrolled ? Math.round(q.completedCount / q.enrolled * 100) : 0)}<span class="xs ink2 nowrap">${q.completedCount} of ${q.enrolled} done</span></div>
        <div><button class="btn sm" data-act="quest-toggle" data-id="${q.id}" data-s="${q.status}">${q.status === 'active' ? 'Archive' : 'Reactivate'}</button></div></div>`) : html`<div class="empty">No quests yet.</div>`}</section></div>`;

  const studentsTab = () => html`<div class="spread wrap"><h2>Students</h2><span class="small muted">${plural(data.total || 0, 'student')} enrolled</span></div>
    ${data.items && data.items.length ? html`<div class="card pad-lg"><div class="tablewrap"><table><thead><tr><th>Student</th><th>XP</th><th>Progress</th><th>Lessons</th><th>Action</th></tr></thead><tbody>${data.items.map((s) => html`<tr><td><div class="row"><span class="avatar sm">${s.initials}</span><div><div class="semi">${s.name}</div><div class="xs muted">${s.email}</div></div></div></td><td class="xp-text">${num(s.xp)}</td><td style="min-width:140px"><div class="row gap-8">${bar(s.progress.percent, '', 'thin')}<span class="xs">${s.progress.percent}%</span></div></td><td>${s.progress.lessonsCompleted}/${s.progress.lessonsTotal}</td><td><div class="row gap-6" style="justify-content:flex-end"><a class="btn sm" href="#/i/student/${id}/${s.id}">View</a><button class="btn sm outline" data-act="remind" data-id="${s.id}">Remind</button></div></td></tr>`)}</tbody></table></div></div>` : empty('users', 'No students yet', c.requiresCode ? 'Share your enrollment code with students.' : 'Publish the course so students can join.')}`;

  const settingsTab = () => html`<div class="grid-auto" style="align-items:start;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))">
    <form class="card pad-lg col" data-submit="save-course" novalidate><h2>Course details</h2>
      ${field('Title', 's1', html`<input id="s1" name="title" type="text" value="${c.title}">`)}
      <div class="grid2">${field('Code', 's2', html`<input id="s2" name="code" type="text" value="${c.code}">`)}${field('Term', 's3', html`<input id="s3" name="term" type="text" value="${c.term}">`)}</div>
      ${field('Subject area', 's4', html`<input id="s4" name="category" type="text" value="${c.category}">`)}
      ${field('Description', 's5', html`<textarea id="s5" name="description">${c.description}</textarea>`)}
      ${field('Status', 's6', html`<select id="s6" name="status"><option value="draft" ${c.status === 'draft' ? 'selected' : ''}>Draft (hidden from students)</option><option value="published" ${c.status === 'published' ? 'selected' : ''}>Published</option><option value="archived" ${c.status === 'archived' ? 'selected' : ''}>Archived</option></select>`)}
      <label class="checkrow"><input type="checkbox" name="enrollmentOpen" ${c.enrollmentOpen ? 'checked' : ''}> Enrollment is open</label>
      ${field('Enrollment code (optional)', 's7', html`<input id="s7" name="enrollmentCode" type="text" value="${c.enrollmentCode || ''}" autocomplete="off">`, 'If set, students must enter this code to join.')}
      <button class="btn primary" type="submit">Save changes</button></form>
    <div class="col">
      <form class="card pad-lg col" data-submit="announce" novalidate><h2>Post an announcement</h2><div class="small muted">Sent as a notification to all ${plural(c.studentCount, 'enrolled student')}.</div>
        ${field('Headline', 'a1', html`<input id="a1" name="title" type="text">`)}${field('Message (optional)', 'a2', html`<textarea id="a2" name="message" maxlength="500" style="min-height:72px"></textarea>`)}<button class="btn" type="submit">${icon('send', 16)} Send announcement</button></form>
      <div class="card pad-lg col"><h2>Danger zone</h2><div class="small muted">Courses with students are archived rather than deleted so progress is kept.</div><button class="btn danger" data-act="del-course">Archive / delete course</button></div></div></div>`;

  const draw = () => ctx.show(html`<div class="page" style="gap:20px">
    <div class="topbar"><a class="iconbtn" href="#/i/courses" aria-label="Back to courses">${icon('back')}</a><div class="grow"><div class="small muted">${c.code} · ${plural(c.studentCount, 'student')}</div><h1 style="font-size:26px">${c.title}</h1></div>${statusChip(c.status)}</div>
    ${c.status === 'draft' ? html`<div class="alert info">This course is a draft, so students can't see it yet. Publish it under Settings when you're ready.</div>` : ''}
    <div class="tabs-line" role="tablist">${TABS.map(([k, l]) => html`<button role="tab" aria-selected="${k === tab}" data-act="tab" data-t="${k}">${l}</button>`)}</div>
    ${tab === 'content' ? contentTab() : tab === 'quizzes' ? quizzesTab() : tab === 'quests' ? questsTab() : tab === 'students' ? studentsTab() : settingsTab()}
  </div>`, { title: c.title, nav: '/i/courses' });

  ctx.on.tab = (el) => ctx.go(`/i/course/${id}?tab=${el.dataset.t}`);

  // ----- modules -----
  const modForm = (m) => html`<h2 style="font-size:20px">${m ? 'Edit module' : 'Add module'}</h2><form data-submit="${m ? 'mod-save' : 'mod-create'}" data-id="${m ? m.id : ''}" class="col" novalidate>
    ${field('Title', 'mt', html`<input id="mt" name="title" type="text" value="${m ? m.title : ''}" required>`)}
    ${field('Description (optional)', 'md', html`<textarea id="md" name="description" style="min-height:72px">${m ? m.description : ''}</textarea>`)}
    ${field('Opens on (optional)', 'mo', html`<input id="mo" name="availableFrom" type="date" value="${m && m.availableFrom ? String(m.availableFrom).slice(0, 10) : ''}">`, 'Lessons stay locked for students until this date.')}
    <div class="row"><button type="button" class="btn grow" data-act="close-sheet">Cancel</button><button class="btn primary grow" type="submit">Save module</button></div></form>`;
  const findMod = (mid) => c.tree.find((m) => m.id === mid);
  ctx.on['add-module'] = () => openSheet(modForm(null), { label: 'Add module' });
  ctx.on['mod-edit'] = (el) => openSheet(modForm(findMod(el.dataset.id)), { label: 'Edit module' });
  ctx.on['mod-create'] = async (form) => { try { const d = formData(form); await post(`/courses/${id}/modules`, { title: d.title, description: d.description, availableFrom: d.availableFrom || null }); closeSheet(); toast('Module added.'); await reload(); } catch (e) { formError(form, e); } };
  ctx.on['mod-save'] = async (form) => { try { const d = formData(form); await patch(`/modules/${form.dataset.id}`, { title: d.title, description: d.description, availableFrom: d.availableFrom || null }); closeSheet(); toast('Module saved.'); await reload(); } catch (e) { formError(form, e); } };
  ctx.on['mod-toggle'] = act((el) => patch(`/modules/${el.dataset.id}`, { status: el.dataset.s === 'published' ? 'draft' : 'published' }));
  const moveMod = (dir) => act(async (el) => { const ids = c.tree.map((m) => m.id); const i = ids.indexOf(el.dataset.id); const j = i + dir; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; await patch(`/courses/${id}/modules/reorder`, { ids }); });
  ctx.on['mod-up'] = moveMod(-1); ctx.on['mod-down'] = moveMod(1);
  ctx.on['mod-del'] = async (el) => { if (await confirmSheet({ title: 'Delete this module?', body: 'The module and all of its lessons will be removed. This cannot be undone.', confirm: 'Delete module', danger: true })) await act(() => del(`/modules/${el.dataset.id}`), 'Module deleted.')(); };

  // ----- lessons -----
  const lesForm = (l, modId) => html`<h2 style="font-size:20px">${l ? 'Edit lesson' : 'Add lesson'}</h2><form data-submit="${l ? 'les-save' : 'les-create'}" data-id="${l ? l.id : modId}" class="col" novalidate>
    ${field('Title', 'lt', html`<input id="lt" name="title" type="text" value="${l ? l.title : ''}" required>`)}
    <div class="grid2">${field('Minutes to read', 'lm', html`<input id="lm" name="minutes" type="number" min="1" max="600" value="${l ? l.minutes : 10}">`)}${field('Status', 'ls', html`<select id="ls" name="status"><option value="published" ${!l || l.status === 'published' ? 'selected' : ''}>Published</option><option value="draft" ${l && l.status === 'draft' ? 'selected' : ''}>Draft</option></select>`)}</div>
    ${field('Lesson content', 'lc', html`<textarea id="lc" name="content" style="min-height:180px">${l ? l.content : ''}</textarea>`, 'Leave a blank line between paragraphs. Wrap text in **double asterisks** for bold.')}
    ${field('Links & downloads (one per line)', 'lr', html`<textarea id="lr" name="resources" style="min-height:72px" placeholder="Lecture notes | https://example.com/notes.pdf">${l ? l.resources.map((r) => `${r.title} | ${r.url}`).join('\n') : ''}</textarea>`, 'Format: Title | https://link')}
    <div class="row"><button type="button" class="btn grow" data-act="close-sheet">Cancel</button><button class="btn primary grow" type="submit">Save lesson</button></div></form>`;
  const parseRes = (txt) => String(txt || '').split('\n').map((s) => s.trim()).filter(Boolean).map((line) => { const [t, ...u] = line.split('|'); return u.length ? { title: t.trim(), url: u.join('|').trim() } : { title: line.replace(/^https?:\/\//, '').slice(0, 60), url: line }; });
  ctx.on['add-lesson'] = (el) => openSheet(lesForm(null, el.dataset.id), { label: 'Add lesson', wide: true });
  ctx.on['les-edit'] = async (el) => { const l = await get(`/lessons/${el.dataset.id}`); openSheet(lesForm(l), { label: 'Edit lesson', wide: true }); };
  const lessonBody = (d) => ({ title: d.title, minutes: intOr(d.minutes, 10), status: d.status, content: d.content, resources: parseRes(d.resources) });
  ctx.on['les-create'] = async (form) => { try { await post(`/modules/${form.dataset.id}/lessons`, lessonBody(formData(form))); closeSheet(); toast('Lesson added.'); await reload(); } catch (e) { formError(form, e); } };
  ctx.on['les-save'] = async (form) => { try { await patch(`/lessons/${form.dataset.id}`, lessonBody(formData(form))); closeSheet(); toast('Lesson saved.'); await reload(); } catch (e) { formError(form, e); } };
  ctx.on['les-del'] = async (el) => { if (await confirmSheet({ title: 'Delete this lesson?', body: 'This cannot be undone. Lessons that students have completed can only be unpublished.', confirm: 'Delete lesson', danger: true })) await act(() => del(`/lessons/${el.dataset.id}`), 'Lesson deleted.')(); };
  const moveLes = (dir) => act(async (el) => { const m = findMod(el.dataset.m); const ids = m.lessons.map((l) => l.id); const i = ids.indexOf(el.dataset.id); const j = i + dir; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; await patch(`/modules/${m.id}/lessons/reorder`, { ids }); });
  ctx.on['les-up'] = moveLes(-1); ctx.on['les-down'] = moveLes(1);

  // ----- quizzes -----
  ctx.on['new-quiz'] = () => openSheet(html`<h2 style="font-size:20px">New quiz</h2><form data-submit="quiz-create" class="col" novalidate>
    ${field('Title', 'zt', html`<input id="zt" name="title" type="text" required>`)}
    ${field('Description (optional)', 'zd', html`<input id="zd" name="description" type="text">`)}
    ${field('Attach to a module (optional)', 'zm', html`<select id="zm" name="moduleId">${modulesOpts()}</select>`)}
    <div class="grid3 keep">${field('Minutes', 'zdur', html`<input id="zdur" name="durationMinutes" type="number" min="1" max="300" value="10">`)}${field('Attempts', 'zat', html`<input id="zat" name="attemptsAllowed" type="number" min="1" max="20" value="2">`)}${field('Pass %', 'zps', html`<input id="zps" name="passingScore" type="number" min="0" max="100" value="60">`)}</div>
    <div class="grid2">${field('Opens (optional)', 'zf', html`<input id="zf" name="availableFrom" type="datetime-local">`)}${field('Closes (optional)', 'zu', html`<input id="zu" name="availableUntil" type="datetime-local">`)}</div>
    ${field('After submitting, students see', 'zs', html`<select id="zs" name="showResults"><option value="full">Score and answer review</option><option value="score">Score only</option><option value="none">Pass / fail only</option></select>`)}
    <div class="field"><label for="zcsv">Create from a CSV file (optional)</label><input id="zcsv" name="csv" type="file" accept=".csv,text/csv" data-change="new-csv"><div id="new-csv-preview" class="col gap-8"></div></div>${csvHelp}
    <div class="row"><button type="button" class="btn grow" data-act="close-sheet">Cancel</button><button class="btn primary grow" type="submit">Create &amp; add questions</button></div></form>`, { label: 'New quiz', wide: true });
  csvCommon(ctx);
  ctx.on['new-csv'] = async (el) => { const r = await readQuestionsFile(el.files[0]); document.getElementById('new-csv-preview').innerHTML = String(csvPreview(r)); };
  ctx.on['quiz-create'] = async (form) => {
    const d = formData(form);
    try {
      const file = form.elements.csv && form.elements.csv.files[0];
      const imported = file ? await readQuestionsFile(file) : { questions: [], errors: [] };
      if (file && !imported.questions.length) { document.getElementById('new-csv-preview').innerHTML = String(csvPreview(imported)); toast('No valid questions found in that file.', 'bad'); return; }
      const q = await post(`/courses/${id}/quizzes`, { title: d.title, description: d.description, moduleId: d.moduleId || null, durationMinutes: intOr(d.durationMinutes, 10), attemptsAllowed: intOr(d.attemptsAllowed, 2), passingScore: intOr(d.passingScore, 60), availableFrom: isoOrNull(d.availableFrom), availableUntil: isoOrNull(d.availableUntil), showResults: d.showResults, questions: imported.questions });
      closeSheet();
      if (file) toast(`Quiz created with ${plural(imported.questions.length, 'question')}${imported.errors.length ? ` (${imported.errors.length} skipped)` : ''}. Review it, then publish.`);
      ctx.go(`/i/quiz/${q.id}`);
    } catch (e) { formError(form, e); }
  };

  // ----- quests -----
  ctx.on.kind = (el) => { const ms = document.getElementById('minscore'); if (ms) ms.classList.toggle('hidden', el.value !== 'quiz_score'); };
  ctx.on['create-quest'] = async (form) => {
    const d = formData(form);
    const objective = { kind: d.kind, target: intOr(d.target, 1) };
    if (d.kind === 'quiz_score') objective.minScore = intOr(d.minScore, 80);
    if (d.moduleId && ['complete_lessons', 'complete_module'].includes(d.kind)) objective.moduleId = d.moduleId;
    try {
      await post('/quests', { courseId: id, title: d.title, type: d.type, xpReward: intOr(d.xpReward, 0), objective, deadline: d.deadline || null });
      toast(`"${d.title}" is live. Enrolled students can see it now.`);
      await reload();
    } catch (e) { formError(form, e); }
  };
  ctx.on['quest-toggle'] = act((el) => patch(`/quests/${el.dataset.id}`, { status: el.dataset.s === 'active' ? 'archived' : 'active' }));

  // ----- students -----
  ctx.on.remind = async (el) => { const r = await post(`/instructor/courses/${id}/students/${el.dataset.id}/remind`); toast(r.sent ? 'Reminder sent.' : 'A reminder was already sent today.'); };

  // ----- settings -----
  ctx.on['save-course'] = async (form) => {
    const d = formData(form);
    try { await patch(`/courses/${id}`, { title: d.title, code: d.code, term: d.term, category: d.category, description: d.description, status: d.status, enrollmentOpen: d.enrollmentOpen, enrollmentCode: d.enrollmentCode }); toast('Course saved.'); await reload(); }
    catch (e) { formError(form, e); }
  };
  ctx.on.announce = async (form) => {
    const d = formData(form);
    try { const r = await post(`/courses/${id}/announcements`, { title: d.title, message: d.message }); toast(`Announcement sent to ${plural(r.recipients, 'student')}.`); form.reset(); }
    catch (e) { formError(form, e); }
  };
  ctx.on['del-course'] = async () => {
    if (await confirmSheet({ title: 'Archive or delete this course?', body: 'A course with enrolled students is archived (hidden, progress kept). An empty draft course is deleted permanently.', confirm: 'Continue', danger: true })) {
      const r = await del(`/courses/${id}`);
      toast(r.deleted ? 'Course deleted.' : 'Course archived.');
      ctx.go('/i/courses');
    }
  };
  draw();
}

// ======================================================= QUIZ EDITOR
export async function quizEditor(ctx) {
  const id = ctx.params.id;
  let z = await get(`/quizzes/${id}`);
  let res = await get(`/quizzes/${id}/attempts?limit=20`);
  const reload = async () => { z = await get(`/quizzes/${id}`); res = await get(`/quizzes/${id}/attempts?limit=20`); draw(); };
  const stat = (l, v) => html`<div class="card pad-sm"><div class="xs muted">${l}</div><div class="display bold" style="font-size:22px">${v}</div></div>`;

  const qForm = (q) => {
    const type = q ? q.type : 'mcq';
    const opts = q && q.type === 'mcq' ? q.options : [];
    return html`<h2 style="font-size:20px">${q ? 'Edit question' : 'Add question'}</h2><form data-submit="q-save" data-id="${q ? q.id : ''}" class="col" novalidate>
      <div class="grid2">${field('Type', 'qty', html`<select id="qty" name="type" data-change="q-type"><option value="mcq" ${type === 'mcq' ? 'selected' : ''}>Multiple choice</option><option value="tf" ${type === 'tf' ? 'selected' : ''}>True / false</option></select>`)}${field('Points', 'qpt', html`<input id="qpt" name="points" type="number" min="1" max="100" value="${q ? q.points : 1}">`)}</div>
      ${field('Question', 'qtx', html`<textarea id="qtx" name="text" style="min-height:72px">${q ? q.text : ''}</textarea>`)}
      <fieldset id="mcq-box" class="${type === 'mcq' ? '' : 'hidden'}" style="border:0;padding:0;margin:0"><legend class="label" style="padding:0;margin-bottom:6px">Options — select the correct one</legend><div class="col gap-8">
        ${[0, 1, 2, 3].map((i) => html`<div class="row gap-8"><input type="radio" name="mcqCorrect" value="${i}" aria-label="Option ${'ABCD'[i]} is correct" ${(q && q.type === 'mcq' ? q.correctAnswer : 0) === i ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)"><input type="text" name="opt${i}" placeholder="Option ${'ABCD'[i]}" value="${opts[i] || ''}" aria-label="Option ${'ABCD'[i]} text"></div>`)}</div><div class="help mt-4">Leave unused options blank (minimum 2).</div></fieldset>
      <fieldset id="tf-box" class="${type === 'tf' ? '' : 'hidden'}" style="border:0;padding:0;margin:0"><legend class="label" style="padding:0;margin-bottom:6px">Correct answer</legend><div class="row"><label class="checkrow"><input type="radio" name="tfCorrect" value="0" ${!q || q.type !== 'tf' || q.correctAnswer === 0 ? 'checked' : ''}> True</label><label class="checkrow"><input type="radio" name="tfCorrect" value="1" ${q && q.type === 'tf' && q.correctAnswer === 1 ? 'checked' : ''}> False</label></div></fieldset>
      ${field('Explanation shown after the quiz (optional)', 'qex', html`<textarea id="qex" name="explanation" style="min-height:64px">${q ? q.explanation : ''}</textarea>`)}
      <div class="row"><button type="button" class="btn grow" data-act="close-sheet">Cancel</button><button class="btn primary grow" type="submit">Save question</button></div></form>`;
  };

  const draw = () => ctx.show(html`<div class="page" style="gap:20px">
    <div class="topbar"><a class="iconbtn" href="#/i/course/${z.courseId}?tab=quizzes" aria-label="Back to quizzes">${icon('back')}</a><div class="grow"><div class="small muted">Quiz editor</div><h1 style="font-size:26px">${z.title}</h1></div>${statusChip(z.status)}</div>
    <div class="grid-auto" style="align-items:start;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))">
      <form class="card pad-lg col" data-submit="save-quiz" novalidate><h2>Settings</h2>
        ${field('Title', 'e1', html`<input id="e1" name="title" type="text" value="${z.title}">`)}
        ${field('Description', 'e2', html`<input id="e2" name="description" type="text" value="${z.description}">`)}
        <div class="grid3 keep">${field('Minutes', 'e3', html`<input id="e3" name="durationMinutes" type="number" min="1" max="300" value="${z.durationMinutes}">`)}${field('Attempts', 'e4', html`<input id="e4" name="attemptsAllowed" type="number" min="1" max="20" value="${z.attemptsAllowed}">`)}${field('Pass %', 'e5', html`<input id="e5" name="passingScore" type="number" min="0" max="100" value="${z.passingScore}">`)}</div>
        <div class="grid2">${field('Opens', 'e6', html`<input id="e6" name="availableFrom" type="datetime-local" value="${localInput(z.availableFrom)}">`)}${field('Closes', 'e7', html`<input id="e7" name="availableUntil" type="datetime-local" value="${localInput(z.availableUntil)}">`)}</div>
        ${field('Students see after submitting', 'e8', html`<select id="e8" name="showResults"><option value="full" ${z.showResults === 'full' ? 'selected' : ''}>Score and answer review</option><option value="score" ${z.showResults === 'score' ? 'selected' : ''}>Score only</option><option value="none" ${z.showResults === 'none' ? 'selected' : ''}>Pass / fail only</option></select>`)}
        ${field('Status', 'e9', html`<select id="e9" name="status"><option value="draft" ${z.status === 'draft' ? 'selected' : ''}>Draft (hidden)</option><option value="published" ${z.status === 'published' ? 'selected' : ''}>Published</option></select>`)}
        <button class="btn primary" type="submit">Save settings</button></form>
      <section class="col"><div class="spread"><h2>Questions (${z.questions.length})</h2><div class="row gap-6"><button class="btn sm" data-act="import-q">${icon('download', 16)} Import CSV</button><button class="btn primary sm" data-act="add-q">${icon('plus', 16)} Add</button></div></div>
        ${z.questions.length ? z.questions.map((q, i) => html`<div class="q-edit col gap-8"><div class="spread top"><div class="small semi">${i + 1}. ${q.text}</div><div class="row gap-6"><button class="iconbtn sm" data-act="edit-q" data-id="${q.id}" aria-label="Edit question ${i + 1}">${icon('edit', 16)}</button><button class="iconbtn sm" data-act="del-q" data-id="${q.id}" aria-label="Delete question ${i + 1}">${icon('trash', 16)}</button></div></div>
          <div class="xs muted">${q.type === 'tf' ? 'True / false' : 'Multiple choice'} · ${plural(q.points, 'point')}</div>
          <div class="col" style="gap:2px">${q.options.map((o, oi) => html`<div class="small ${oi === q.correctAnswer ? 'ok-text semi' : 'muted'}">${oi === q.correctAnswer ? '✓' : '○'} ${o}</div>`)}</div></div>`) : empty('help', 'No questions yet', 'Add at least one question before publishing.')}</section></div>
    <section class="card pad-lg col"><div><h2>Results</h2><div class="small muted">${res.stats.attempts ? `${plural(res.stats.attempts, 'submission')} · average ${res.stats.average}% · ${res.stats.passRate}% pass rate` : 'No submissions yet.'}</div></div>
      ${res.stats.attempts ? html`<div class="grid-auto"><div>${res.questionStats.map((q, i) => html`<div class="col gap-6 small" style="margin-bottom:10px"><div class="spread"><span>${i + 1}. ${q.text.length > 60 ? q.text.slice(0, 60) + '…' : q.text}</span><span class="semi">${q.correctRate === null ? '—' : `${q.correctRate}% correct`}</span></div>${bar(q.correctRate || 0, q.correctRate !== null && q.correctRate < 50 ? 'gray' : '', 'thin')}</div>`)}</div>
        <div class="tablewrap"><table><thead><tr><th>Student</th><th>Score</th><th>Result</th><th>When</th></tr></thead><tbody>${res.attempts.map((a) => html`<tr><td class="semi">${a.studentName}</td><td>${a.score}%</td><td><span class="chip ${a.passed ? 'ok' : 'bad'}">${a.passed ? 'Passed' : 'Not passed'}</span></td><td class="muted">${timeAgo(a.submittedAt)}</td></tr>`)}</tbody></table></div></div>` : ''}</section>
  </div>`, { title: z.title, nav: '/i/courses' });

  ctx.on['q-type'] = (el) => { document.getElementById('mcq-box').classList.toggle('hidden', el.value !== 'mcq'); document.getElementById('tf-box').classList.toggle('hidden', el.value !== 'tf'); };
  ctx.on['add-q'] = () => openSheet(qForm(null), { label: 'Add question', wide: true });
  // ----- CSV import (e.g. a file generated by an AI tool) -----
  let pending = { questions: [], errors: [] };
  csvCommon(ctx);
  ctx.on['import-q'] = () => {
    pending = { questions: [], errors: [] };
    openSheet(html`<h2 style="font-size:20px">Import questions from CSV</h2>
      <p class="small ink2" style="line-height:1.5">Upload a CSV (for example one generated by an AI tool). Questions are added to this quiz; existing ones are kept. Rows with problems are skipped and listed.</p>
      <div class="field"><label for="csvf">CSV file</label><input id="csvf" type="file" accept=".csv,text/csv" data-change="csv-file"></div>
      ${csvHelp}<div id="csv-preview" class="col gap-8"></div>
      <div class="row"><button type="button" class="btn grow" data-act="close-sheet">Cancel</button><button class="btn primary grow" id="csv-go" data-act="csv-confirm" disabled>Import questions</button></div>`, { label: 'Import questions', wide: true });
  };
  ctx.on['csv-file'] = async (el) => {
    pending = await readQuestionsFile(el.files[0]);
    document.getElementById('csv-preview').innerHTML = String(csvPreview(pending));
    const go = document.getElementById('csv-go');
    go.disabled = !pending.questions.length;
    go.textContent = pending.questions.length ? `Import ${plural(pending.questions.length, 'question')}` : 'Import questions';
  };
  ctx.on['csv-confirm'] = async () => {
    if (!pending.questions.length) return;
    const r = await post(`/quizzes/${id}/questions/import`, { questions: pending.questions });
    closeSheet(); toast(`${plural(r.added, 'question')} added.`); await reload();
  };
  ctx.on['edit-q'] = (el) => openSheet(qForm(z.questions.find((q) => q.id === el.dataset.id)), { label: 'Edit question', wide: true });
  ctx.on['q-save'] = async (form) => {
    const d = formData(form);
    const body = { type: d.type, text: d.text, explanation: d.explanation, points: intOr(d.points, 1) };
    if (d.type === 'mcq') {
      const picked = [0, 1, 2, 3].map((i) => ({ i, t: (d[`opt${i}`] || '').trim() })).filter((o) => o.t);
      body.options = picked.map((o) => o.t);
      const idx = picked.findIndex((o) => String(o.i) === d.mcqCorrect);
      if (idx < 0) { showFieldErrors(form, { mcqCorrect: 'Select an option that has text as the correct answer.' }); toast('Pick a correct answer that has text.', 'bad'); return; }
      body.correctAnswer = idx;
    } else body.correctAnswer = intOr(d.tfCorrect, 0);
    try {
      if (form.dataset.id) await patch(`/questions/${form.dataset.id}`, body); else await post(`/quizzes/${id}/questions`, body);
      closeSheet(); toast('Question saved.'); await reload();
    } catch (e) { formError(form, e); }
  };
  ctx.on['del-q'] = async (el) => { if (await confirmSheet({ title: 'Delete this question?', body: 'Students who already attempted the quiz keep their recorded scores.', confirm: 'Delete', danger: true })) { await del(`/questions/${el.dataset.id}`); toast('Question deleted.'); await reload(); } };
  ctx.on['save-quiz'] = async (form) => {
    const d = formData(form);
    try {
      await patch(`/quizzes/${id}`, { title: d.title, description: d.description, durationMinutes: intOr(d.durationMinutes, 10), attemptsAllowed: intOr(d.attemptsAllowed, 2), passingScore: intOr(d.passingScore, 60), availableFrom: isoOrNull(d.availableFrom), availableUntil: isoOrNull(d.availableUntil), showResults: d.showResults, status: d.status });
      toast('Quiz saved.'); await reload();
    } catch (e) { formError(form, e); }
  };
  draw();
}

// ======================================================= STUDENT DETAIL
export async function studentDetail(ctx) {
  const { cid, sid } = ctx.params;
  const r = await get(`/instructor/students/${sid}/progress?courseId=${cid}`);
  ctx.show(html`<div class="page" style="gap:20px">
    <div class="topbar"><a class="iconbtn" href="#/i/course/${cid}?tab=students" aria-label="Back to students">${icon('back')}</a><div class="grow"><div class="small muted">Student progress</div><h1 style="font-size:26px">${r.student.name}</h1></div></div>
    <div class="grid-kpi">
      <div class="card pad"><div class="small muted">Level</div><div class="display bold" style="font-size:30px">${r.student.level}</div><div class="xs muted">${num(r.student.xp)} XP</div></div>
      <div class="card pad"><div class="small muted">Course progress</div><div class="display bold" style="font-size:30px">${r.progress.percent}%</div><div class="xs muted">${r.progress.lessonsCompleted}/${r.progress.lessonsTotal} lessons</div></div>
      <div class="card pad"><div class="small muted">Streak</div><div class="display bold" style="font-size:30px">${r.streak.current}</div><div class="xs muted">Longest ${r.streak.longest} days</div></div>
      <div class="card pad"><div class="small muted">Last active</div><div class="display bold" style="font-size:22px;margin-top:8px">${r.lastActive}</div></div>
    </div>
    <div class="grid-auto" style="align-items:start;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))">
      <section class="card pad-lg col"><h2>Lessons</h2>${r.modules.map((m) => html`<div><div class="semi small">${m.title}</div>${m.lessons.map((l) => html`<div class="row small" style="padding:6px 0"><span class="lesson-ic ${l.completed ? 'done' : 'locked'}" style="width:22px;height:22px">${l.completed ? icon('check', 12, { sw: 3 }) : ''}</span><span class="${l.completed ? '' : 'muted'}">${l.title}</span></div>`)}</div>`)}</section>
      <div class="col"><section class="card pad-lg col"><h2>Quiz attempts</h2>${r.quizAttempts.length ? r.quizAttempts.map((a) => html`<div class="log-row small"><span>${a.quiz} · ${timeAgo(a.submittedAt)}</span><span class="semi ${a.passed ? 'ok-text' : 'bad-text'}">${a.score}% ${a.passed ? '· Passed' : '· Not passed'}</span></div>`) : html`<div class="muted small">No attempts yet.</div>`}</section>
      <section class="card pad-lg col"><h2>Quests</h2>${r.quests.length ? r.quests.map((q) => html`<div class="log-row small"><span>${q.title}</span><span class="chip ${q.completed ? 'ok' : ''}">${q.completed ? 'Completed' : 'Open'}</span></div>`) : html`<div class="muted small">No quests in this course.</div>`}</section></div>
    </div></div>`, { title: r.student.name, nav: '/i/courses' });
}

// ======================================================= INSTRUCTOR PROFILE
export async function profile(ctx) {
  const p = await get('/users/profile');
  ctx.show(html`<div class="page" style="max-width:560px">
    <div class="row"><div class="avatar lg">${initials(p.name)}</div><div><h1 style="font-size:24px">${p.name}</h1><div class="small muted">${p.email} · Instructor</div></div></div>
    <form class="card pad-lg col" data-submit="save" novalidate><h2>Your details</h2>
      ${field('Name', 'p1', html`<input id="p1" name="name" type="text" value="${p.name}">`)}
      <div class="grid2">${field('Department', 'p2', html`<input id="p2" name="department" type="text" value="${p.profile.department}">`)}${field('Title', 'p3', html`<input id="p3" name="title" type="text" value="${p.profile.title}">`)}</div>
      ${field('Bio', 'p4', html`<textarea id="p4" name="bio" maxlength="300">${p.profile.bio}</textarea>`)}<button class="btn primary" type="submit">Save changes</button></form>
    <form class="card pad-lg col" data-submit="pw" novalidate><h2>${p.security.hasPassword ? 'Change password' : 'Set a password'}</h2>
      ${p.security.google ? html`<p class="small muted" style="margin:0">Google sign-in is connected to this account.${p.security.hasPassword ? '' : ' Add a password if you also want to log in with your email.'}</p>` : ''}
      ${p.security.hasPassword ? field('Current password', 'p5', html`<input id="p5" name="currentPassword" type="password" autocomplete="current-password">`) : ''}${field('New password', 'p6', html`<input id="p6" name="newPassword" type="password" autocomplete="new-password">`, 'At least 8 characters with a letter and a number. Other devices will be signed out.')}<button class="btn" type="submit">${p.security.hasPassword ? 'Update password' : 'Set password'}</button></form>
  </div>`, { title: 'Profile', nav: '/i/profile' });
  ctx.on.save = async (form) => { try { const r = await patch('/users/profile', formData(form)); store.user.name = r.name; toast('Profile saved.'); } catch (e) { formError(form, e); } };
  ctx.on.pw = async (form) => { try { await post('/users/password', formData(form)); toast(p.security.hasPassword ? 'Password updated.' : 'Password set.'); ctx.refresh(); } catch (e) { formError(form, e); } };
}
