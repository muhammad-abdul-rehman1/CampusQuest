import { get, post, patch, put } from '../api.js';
import { store } from '../store.js';
import { html, icon, plural, num, timeAgo, fmtDateTime, empty, openSheet, closeSheet, toast, confirmSheet, formData, showFieldErrors } from '../ui.js';

const field = (label, id, control, help = '') => html`<div class="field"><label for="${id}">${label}</label>${control}${help ? html`<div class="help">${help}</div>` : ''}</div>`;
const head = (title, sub, right = '') => html`<div class="spread wrap" style="align-items:flex-end"><div><div class="small muted">${sub}</div><h1 style="font-size:30px;margin-top:4px">${title}</h1></div>${right}</div>`;
const intOr = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const pager = (d) => (d.pages > 1 ? html`<div class="row" style="justify-content:center"><button class="btn sm" data-act="prev" ${d.page <= 1 ? 'disabled' : ''}>Previous</button><span class="small muted">Page ${d.page} of ${d.pages}</span><button class="btn sm" data-act="next" ${d.page >= d.pages ? 'disabled' : ''}>Next</button></div>` : '');

function formError(form, err) {
  showFieldErrors(form, (err.data && err.data.fields) || {});
  let box = form.querySelector('.form-alert');
  if (!box) { box = document.createElement('div'); box.setAttribute('role', 'alert'); form.prepend(box); }
  box.className = 'form-alert alert bad';
  box.textContent = err.message;
}

const ACTION_LABEL = {
  'user.create': 'Created a user', 'user.update': 'Updated a user', 'course.create': 'Created a course', 'course.status': 'Changed course status', 'course.archive': 'Archived a course', 'course.delete': 'Deleted a course',
  'course.announce': 'Posted an announcement', 'module.delete': 'Deleted a module', 'settings.update': 'Changed platform settings', 'auth.password_reset': 'Password reset', 'auth.signup': 'Signed up', 'auth.invite_accepted': 'Accepted invitation', 'user.invite': 'Re-sent an invitation'
};

const LABELS = { method: 'Method', title: 'Title', role: 'Role', status: 'Status', email: 'Email', recipients: 'Recipients', modules: 'Modules removed', xp: 'XP rewards', levelBase: 'Level base', timezone: 'Timezone', lesson: 'Lesson', module: 'Module', quizPass: 'Quiz pass', quizBonus: 'Quiz bonus', quizBonusThreshold: 'Bonus threshold' };
const flat = (o) => (o && typeof o === 'object' ? Object.entries(o).map(([k, v]) => `${LABELS[k] || k} ${typeof v === 'object' ? `(${flat(v)})` : v}`).join(', ') : String(o));

// Turns an audit record's details object into a human-readable sentence (no raw JSON).
function describe(a) {
  const d = a.details;
  if (!d || typeof d !== 'object') return '';
  if (a.action === 'settings.update') {
    const changes = [];
    for (const k of ['levelBase', 'timezone']) if (d.before && d.after && d.before[k] !== d.after[k]) changes.push(`${LABELS[k]}: ${d.before[k]} → ${d.after[k]}`);
    for (const k of Object.keys((d.after && d.after.xp) || {})) if (d.before.xp[k] !== d.after.xp[k]) changes.push(`${LABELS[k] || k} XP: ${d.before.xp[k]} → ${d.after.xp[k]}`);
    return changes.length ? changes.join(' · ') : 'Saved with no changes';
  }
  return Object.entries(d).map(([k, v]) => {
    if (v && typeof v === 'object' && 'from' in v && 'to' in v) return `${LABELS[k] || k}: ${v.from} → ${v.to}`;
    return `${LABELS[k] || k}: ${typeof v === 'object' ? flat(v) : v}`;
  }).join(' · ');
}

// ======================================================= DASHBOARD
export async function dashboard(ctx) {
  const d = await get('/admin/dashboard');
  const kpi = (label, val, foot) => html`<div class="card pad"><div class="small muted">${label}</div><div class="display bold" style="font-size:32px">${num(val)}</div><div class="xs muted">${foot}</div></div>`;
  ctx.show(html`<div class="page" style="gap:24px">
    ${head('Platform overview', 'Administrator dashboard')}
    <div class="grid-kpi">
      ${kpi('Users', d.users.total, `${d.users.students} students · ${d.users.instructors} instructors · ${d.users.admins} admins`)}
      ${kpi('Courses', d.courses.total, `${d.courses.published} published`)}
      ${kpi('Active enrollments', d.enrollments, 'across all courses')}
      ${kpi('Suspended / deactivated', d.users.inactive, 'accounts without access')}
    </div>
    <section class="card pad-lg col"><div><h2>Activity in the last 7 days</h2><div class="small muted">System activity summary</div></div>
      <div class="grid-kpi"><div><div class="display bold" style="font-size:26px">${num(d.activity7d.lessonsCompleted)}</div><div class="small muted">Lessons completed</div></div><div><div class="display bold" style="font-size:26px">${num(d.activity7d.quizAttempts)}</div><div class="small muted">Quiz attempts</div></div><div><div class="display bold" style="font-size:26px">${num(d.activity7d.questsCompleted)}</div><div class="small muted">Quests completed</div></div><div><div class="display bold xp-text" style="font-size:26px">${num(d.activity7d.xpAwarded)}</div><div class="small muted">XP awarded</div></div></div></section>
    <section class="card pad-lg col"><div class="spread"><h2>Recent administrative activity</h2><a class="btn link" href="#/a/audit">View audit log</a></div>
      ${d.recentAudit.length ? d.recentAudit.map((a) => html`<div class="log-row small"><span>${ACTION_LABEL[a.action] || a.action} <span class="muted">by ${a.actor || 'system'}</span></span><span class="muted">${timeAgo(a.createdAt)}</span></div>`) : html`<div class="empty">Nothing recorded yet.</div>`}</section>
  </div>`, { title: 'Admin', nav: '/a' });
}

// ======================================================= USERS
export async function users(ctx) {
  let q = '', role = '', status = '', page = 1;
  let d = null;
  const load = async () => { d = await get(`/admin/users?limit=15&page=${page}${q ? `&q=${encodeURIComponent(q)}` : ''}${role ? `&role=${role}` : ''}${status ? `&status=${status}` : ''}`); };
  await load();
  const draw = () => ctx.show(html`<div class="page" style="gap:20px">
    ${head('User management', 'Administration', html`<button class="btn primary" data-act="new">${icon('plus', 18)} New user</button>`)}
    <div class="row wrap"><div class="field grow" style="min-width:200px"><label class="sr-only" for="q">Search users</label><input id="q" type="search" placeholder="Search name or email" value="${q}" data-input="search"></div>
      <select aria-label="Filter by role" data-change="role" style="width:auto"><option value="">All roles</option>${['student', 'instructor', 'admin'].map((r) => html`<option value="${r}" ${role === r ? 'selected' : ''}>${r}</option>`)}</select>
      <select aria-label="Filter by status" data-change="status" style="width:auto"><option value="">Any status</option>${['active', 'suspended', 'deactivated'].map((r) => html`<option value="${r}" ${status === r ? 'selected' : ''}>${r}</option>`)}</select></div>
    <div class="card pad-lg"><div class="tablewrap"><table><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last login</th><th>Action</th></tr></thead><tbody>
      ${d.items.map((u) => html`<tr><td><div class="semi">${u.name}</div><div class="xs muted">${u.email}</div></td>
        <td><select aria-label="Role for ${u.name}" data-change="set-role" data-id="${u.id}" style="min-height:36px;width:auto" ${u.id === store.user.id ? 'disabled' : ''}>${['student', 'instructor', 'admin'].map((r) => html`<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`)}</select></td>
        <td>${u.status === 'active' && !u.emailVerified ? html`<span class="chip">invited</span><div><button class="btn link xs" style="min-height:28px" data-act="reinvite" data-id="${u.id}">Resend invite</button></div>` : html`<span class="chip ${u.status === 'active' ? 'ok' : 'bad'}">${u.status}</span>`}</td><td class="muted small">${u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'Never'}</td>
        <td>${u.id === store.user.id ? html`<span class="xs muted">You</span>` : u.status === 'active' ? html`<button class="btn sm danger" data-act="suspend" data-id="${u.id}" data-name="${u.name}">Suspend</button>` : html`<button class="btn sm" data-act="activate" data-id="${u.id}">Reactivate</button>`}</td></tr>`)}
    </tbody></table></div>${d.items.length ? '' : empty('users', 'No users match')}</div>
    ${pager(d)}
  </div>`, { title: 'Users', nav: '/a/users' });

  let timer;
  ctx.cleanup(() => clearTimeout(timer));
  const refetch = async () => { await load(); draw(); };
  ctx.on.search = (el) => { clearTimeout(timer); timer = setTimeout(async () => { q = el.value.trim(); page = 1; await load(); draw(); const i = document.getElementById('q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 300); };
  ctx.on.role = (el) => { role = el.value; page = 1; refetch(); };
  ctx.on.status = (el) => { status = el.value; page = 1; refetch(); };
  ctx.on.prev = () => { page--; refetch(); };
  ctx.on.next = () => { page++; refetch(); };
  ctx.on['set-role'] = async (el) => {
    const ok = await confirmSheet({ title: 'Change this role?', body: `This user will become ${el.value === 'admin' ? 'an' : 'a'} ${el.value}. The change is recorded in the audit log.`, confirm: 'Change role' });
    if (ok) { await patch(`/admin/users/${el.dataset.id}`, { role: el.value }); toast('Role updated.'); }
    await refetch();
  };
  ctx.on.suspend = async (el) => {
    if (await confirmSheet({ title: `Suspend ${el.dataset.name}?`, body: 'They will be signed out immediately and cannot log in until reactivated. Their progress is kept.', confirm: 'Suspend', danger: true })) {
      await patch(`/admin/users/${el.dataset.id}`, { status: 'suspended' }); toast('Account suspended.'); await refetch();
    }
  };
  ctx.on.activate = async (el) => { await patch(`/admin/users/${el.dataset.id}`, { status: 'active' }); toast('Account reactivated.'); await refetch(); };
  ctx.on.new = () => openSheet(html`<h2 style="font-size:20px">New user</h2><form data-submit="create" class="col" novalidate>
    ${field('Full name', 'n1', html`<input id="n1" name="name" type="text">`)}${field('Email', 'n2', html`<input id="n2" name="email" type="email">`)}
    ${field('Role', 'n4', html`<select id="n4" name="role"><option value="student">Student</option><option value="instructor">Instructor</option><option value="admin">Administrator</option></select>`)}
    <p class="small muted" style="margin:0">They'll get an email invitation to set their own password. The link expires in 72 hours.</p>
    <div class="row"><button type="button" class="btn grow" data-act="close-sheet">Cancel</button><button class="btn primary grow" type="submit">Send invitation</button></div></form>`, { label: 'New user' });
  const devLinkSheet = (link) => openSheet(html`<h2 style="font-size:20px">Invitation link</h2><div class="alert info small" style="word-break:break-all">Development mode: email isn't configured, so the invitation was printed in the server console. Share this link with the user: <a href="${link}">${link}</a></div><button class="btn" data-act="close-sheet">Done</button>`, { label: 'Invitation link' });
  ctx.on.create = async (form) => {
    try {
      const r = await post('/admin/users', formData(form));
      closeSheet(); toast(`Invitation sent to ${r.email}.`); await refetch();
      if (r.devLink) devLinkSheet(r.devLink);
    } catch (e) { formError(form, e); }
  };
  ctx.on.reinvite = async (el) => {
    const r = await post(`/admin/users/${el.dataset.id}/invite`);
    toast('Invitation sent again.');
    if (r.devLink) devLinkSheet(r.devLink);
  };
  draw();
}

// ======================================================= COURSES
export async function courses(ctx) {
  let status = '', page = 1, q = '';
  let d = null;
  const load = async () => { d = await get(`/admin/courses?limit=15&page=${page}${status ? `&status=${status}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`); };
  await load();
  const draw = () => ctx.show(html`<div class="page" style="gap:20px">
    ${head('Courses', 'Administration')}
    <div class="row wrap"><div class="field grow" style="min-width:200px"><label class="sr-only" for="q">Search courses</label><input id="q" type="search" placeholder="Search title or code" value="${q}" data-input="search"></div>
      <select aria-label="Filter by status" data-change="status" style="width:auto"><option value="">Any status</option>${['draft', 'published', 'archived'].map((r) => html`<option value="${r}" ${status === r ? 'selected' : ''}>${r}</option>`)}</select></div>
    <div class="card pad-lg"><div class="tablewrap"><table><thead><tr><th>Course</th><th>Instructor</th><th>Students</th><th>Status</th></tr></thead><tbody>
      ${d.items.map((c) => html`<tr><td><div class="semi">${c.title}</div><div class="xs muted">${c.code} ${c.term ? '· ' + c.term : ''}</div></td><td>${c.instructorName || '—'}</td><td>${c.studentCount}</td>
        <td><select aria-label="Status for ${c.title}" data-change="set-status" data-id="${c.id}" style="min-height:36px;width:auto">${['draft', 'published', 'archived'].map((r) => html`<option value="${r}" ${c.status === r ? 'selected' : ''}>${r}</option>`)}</select></td></tr>`)}</tbody></table></div>${d.items.length ? '' : empty('book', 'No courses match')}</div>
    ${pager(d)}</div>`, { title: 'Courses', nav: '/a/courses' });
  let timer;
  ctx.cleanup(() => clearTimeout(timer));
  const refetch = async () => { await load(); draw(); };
  ctx.on.search = (el) => { clearTimeout(timer); timer = setTimeout(async () => { q = el.value.trim(); page = 1; await load(); draw(); const i = document.getElementById('q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 300); };
  ctx.on.status = (el) => { status = el.value; page = 1; refetch(); };
  ctx.on.prev = () => { page--; refetch(); };
  ctx.on.next = () => { page++; refetch(); };
  ctx.on['set-status'] = async (el) => { await patch(`/admin/courses/${el.dataset.id}`, { status: el.value }); toast('Course status updated.'); await refetch(); };
  draw();
}

// ======================================================= SETTINGS
export async function settings(ctx) {
  const s = await get('/admin/settings');
  const ms = s.streakMilestones[0] || { days: 7, xp: 100 };
  const num_ = (name, id, label, val, help = '', min = 0, max = 1000) => field(label, id, html`<input id="${id}" name="${name}" type="number" min="${min}" max="${max}" value="${val}">`, help);
  ctx.show(html`<div class="page" style="gap:20px;max-width:760px">
    ${head('Platform settings', 'Administration')}
    <form class="card pad-lg col" data-submit="save" novalidate>
      <div><h2>XP rewards</h2><div class="small muted">Applies to activity from now on. Existing XP is never rewritten.</div></div>
      <div class="grid2">${num_('xp.lesson', 'x1', 'Complete a lesson', s.xp.lesson)}${num_('xp.module', 'x2', 'Complete a module', s.xp.module, '', 0, 5000)}${num_('xp.quizPass', 'x3', 'Pass a quiz', s.xp.quizPass)}${num_('xp.quizBonus', 'x4', 'Quiz high-score bonus', s.xp.quizBonus)}${num_('xp.quizBonusThreshold', 'x5', 'Bonus threshold (%)', s.xp.quizBonusThreshold, '', 50, 100)}${num_('levelBase', 'x6', 'Level curve base XP', s.levelBase, 'Level L needs base × L × (L−1) ÷ 2 XP. Default 100.', 10, 1000)}</div>
      <div><h2>Streaks</h2><div class="small muted">A streak day needs a lesson, a quiz submission or a validated quest. Opening the app doesn't count.</div></div>
      <div class="grid2">${num_('ms.days', 'm1', 'Milestone (days)', ms.days, '', 2, 365)}${num_('ms.xp', 'm2', 'Milestone reward (XP)', ms.xp, '', 0, 5000)}</div>
      ${field('Timezone for day boundaries', 'tz', html`<input id="tz" name="timezone" type="text" value="${s.timezone}">`, 'IANA name, e.g. Asia/Karachi. Daily quests and streaks reset at local midnight.')}
      <div><h2>Access &amp; privacy</h2></div>
      <label class="checkrow"><input type="checkbox" name="allowInstructorSignup" ${s.allowInstructorSignup ? 'checked' : ''}> Let people register as instructors themselves</label>
      <label class="checkrow"><input type="checkbox" name="leaderboardDefaultVisible" ${s.leaderboardDefaultVisible ? 'checked' : ''}> New students appear on leaderboards by default</label>
      ${num_('inactivityDays', 'ia', 'Flag students after N inactive days', s.inactivityDays, 'Shown in the instructor "needs attention" list.', 1, 60)}
      <button class="btn primary lg" type="submit">Save settings</button></form>
  </div>`, { title: 'Settings', nav: '/a/settings' });
  ctx.on.save = async (form) => {
    const d = formData(form);
    const body = {
      xp: { lesson: intOr(d['xp.lesson'], 10), module: intOr(d['xp.module'], 75), quizPass: intOr(d['xp.quizPass'], 30), quizBonus: intOr(d['xp.quizBonus'], 50), quizBonusThreshold: intOr(d['xp.quizBonusThreshold'], 90) },
      levelBase: intOr(d.levelBase, 100),
      streakMilestones: [{ days: intOr(d['ms.days'], 7), xp: intOr(d['ms.xp'], 100) }],
      timezone: d.timezone.trim(),
      allowInstructorSignup: d.allowInstructorSignup, leaderboardDefaultVisible: d.leaderboardDefaultVisible,
      inactivityDays: intOr(d.inactivityDays, 3)
    };
    try { await put('/admin/settings', body); toast('Settings saved.'); } catch (e) { formError(form, e); }
  };
}

// ======================================================= AUDIT LOG
export async function audit(ctx) {
  let page = 1;
  let d = await get('/admin/audit-logs?limit=25&page=1');
  const draw = () => ctx.show(html`<div class="page" style="gap:20px">
    ${head('Audit log', 'Administration')}
    <div class="card pad-lg">${d.items.length ? html`<div class="tablewrap"><table class="left-last"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead><tbody>${d.items.map((a) => html`<tr><td class="small nowrap">${fmtDateTime(a.createdAt)}</td><td class="semi small">${a.actor || 'system'}</td><td class="small">${ACTION_LABEL[a.action] || a.action}<div class="xs muted">${a.targetType || ''} ${a.targetId ? a.targetId.slice(-6) : ''}</div></td><td class="small muted" style="word-break:break-word">${describe(a)}</td></tr>`)}</tbody></table></div>` : empty('list', 'No audit records yet')}</div>
    ${pager(d)}</div>`, { title: 'Audit log', nav: '/a/audit' });
  const refetch = async () => { d = await get(`/admin/audit-logs?limit=25&page=${page}`); draw(); };
  ctx.on.prev = () => { page--; refetch(); };
  ctx.on.next = () => { page++; refetch(); };
  draw();
}
