import { api, setUnauthorizedHandler, ApiError } from './api.js';
import { store, roleHome } from './store.js';
import { html, raw, esc, icon, initials, spinner, closeSheet, sheetOpen, toast } from './ui.js';
import * as auth from './pages/auth.js';
import * as student from './pages/student.js';
import * as instructor from './pages/instructor.js';
import * as admin from './pages/admin.js';

const app = document.getElementById('app');

// [pattern, allowed role (null = signed-out only, '*' = anyone, 'auth' = any signed-in user), handler]
const routes = [
  ['/login', null, auth.login],
  ['/register', null, auth.register],
  ['/forgot', null, auth.forgot],
  ['/check-email', null, auth.checkEmail],
  ['/google-signup', null, auth.googleSignup],
  ['/reset', '*', auth.reset], // email links: work even if another account is signed in on this browser
  ['/verify', '*', auth.verify],

  ['/', 'student', student.home],
  ['/courses', 'student', student.courses],
  ['/course/:id', 'student', student.course],
  ['/lesson/:id', 'student', student.lesson],
  ['/quiz/:id', 'student', student.quizIntro],
  ['/quiz/:id/play', 'student', student.quizPlay],
  ['/quiz/:id/result', 'student', student.quizResult],
  ['/quests', 'student', student.quests],
  ['/leaderboard', 'student', student.leaderboard],
  ['/achievements', 'student', student.achievements],
  ['/profile', 'student', student.profile],
  ['/notifications', 'student', student.notifications],

  ['/i', 'instructor', instructor.dashboard],
  ['/i/courses', 'instructor', instructor.courses],
  ['/i/course/:id', 'instructor', instructor.courseManage],
  ['/i/quiz/:id', 'instructor', instructor.quizEditor],
  ['/i/student/:cid/:sid', 'instructor', instructor.studentDetail],
  ['/i/profile', 'instructor', instructor.profile],

  ['/a', 'admin', admin.dashboard],
  ['/a/users', 'admin', admin.users],
  ['/a/courses', 'admin', admin.courses],
  ['/a/settings', 'admin', admin.settings],
  ['/a/audit', 'admin', admin.audit]
].map(([pattern, role, handler]) => {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:[a-zA-Z]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '/?$');
  return { pattern, role, handler, rx, keys };
});

const NAV = {
  student: [
    ['/', 'Learn', 'home'], ['/courses', 'Courses', 'book'], ['/quests', 'Quests', 'target'], ['/leaderboard', 'Leaderboard', 'trophy'],
    ['/achievements', 'Badges', 'medal'], ['/notifications', 'Notifications', 'bell'], ['/profile', 'Profile', 'user']
  ],
  instructor: [['/i', 'Dashboard', 'chart'], ['/i/courses', 'My courses', 'book'], ['/i/profile', 'Profile', 'user']],
  admin: [['/a', 'Dashboard', 'chart'], ['/a/users', 'Users', 'users'], ['/a/courses', 'Courses', 'book'], ['/a/settings', 'Settings', 'settings'], ['/a/audit', 'Audit log', 'list']]
};
const BOTTOM = [['/', 'Learn', 'home'], ['/courses', 'Courses', 'book'], ['/quests', 'Quests', 'target'], ['/leaderboard', 'Ranks', 'trophy'], ['/profile', 'Profile', 'user']];

let current = null; // active page context

const navCurrent = (navKey, path) => (navKey === path ? 'page' : 'false');

function sideNav(role, navKey) {
  const u = store.user;
  return html`
    <aside class="side-nav">
      <a class="brand" href="#${roleHome(role)}" style="text-decoration:none;color:inherit;padding:0 8px"><span class="logo">${icon('bolt', 20, { fill: true })}</span>CampusQuest</a>
      <nav aria-label="Main">
        ${NAV[role].map(([p, label, ic]) => html`<a href="#${p}" aria-current="${navCurrent(navKey, p)}">${icon(ic, 18)}<span>${label}</span>${p === '/notifications' ? html`<span class="count js-unread" ${store.unread ? '' : 'hidden'}>${store.unread}</span>` : ''}</a>`)}
      </nav>
      <div style="margin-top:auto;display:flex;flex-direction:column;gap:10px">
        <div class="row" style="padding:0 8px"><div class="avatar sm">${initials(u.name)}</div><div class="grow"><div class="semi small">${u.name}</div><div class="xs muted" style="text-transform:capitalize">${u.role}</div></div></div>
        <button class="navlink" data-act="logout">${icon('logout', 18)}<span>Log out</span></button>
      </div>
    </aside>`;
}

function shell(role, content, opts) {
  const navKey = opts.nav;
  if (role === 'student') {
    if (opts.bare) return html`<div class="shell"><main id="main" class="main student" tabindex="-1">${content}</main></div>`;
    return html`
      <div class="shell has-side">
        ${sideNav(role, navKey)}
        <main id="main" class="main student" tabindex="-1">${content}</main>
        <nav class="bottom-nav" aria-label="Main">
          ${BOTTOM.map(([p, label, ic]) => html`<a href="#${p}" aria-current="${navCurrent(navKey, p)}">${icon(ic, 22)}${label}</a>`)}
        </nav>
      </div>`;
  }
  return html`
    <div class="shell has-side staff">
      ${sideNav(role, navKey)}
      <div class="staff-top"><nav aria-label="Main">${NAV[role].map(([p, label]) => html`<a href="#${p}" aria-current="${navCurrent(navKey, p)}">${label}</a>`)}<a href="#/login" data-act="logout">Log out</a></nav></div>
      <main id="main" class="main wide" tabindex="-1">${content}</main>
    </div>`;
}

function makeCtx(route, params, query) {
  const ctx = {
    params, query, route, user: store.user, on: {}, cleanups: [], shown: false,
    go(path) { location.hash = '#' + path; },
    cleanup(fn) { ctx.cleanups.push(fn); },
    show(content, opts = {}) {
      if (current !== ctx) return;
      const role = store.user ? store.user.role : null;
      const view = role && !opts.plain ? shell(role, content, { nav: opts.nav || route.pattern, bare: opts.bare }) : content;
      const y = window.scrollY;
      app.innerHTML = String(view);
      if (opts.title) document.title = `${opts.title} · CampusQuest`;
      if (!ctx.shown) {
        ctx.shown = true;
        window.scrollTo(0, 0);
        const main = document.getElementById('main');
        if (main && !opts.plain) main.focus({ preventScroll: true });
      } else window.scrollTo(0, y);
    },
    async refresh() { return run(); }
  };
  return ctx;
}

let navToken = 0;
async function run() {
  const token = ++navToken;
  let raw_ = location.hash.replace(/^#/, '') || '/';
  // Some email clients percent-encode the link: "#/verify%3Ftoken%3D..." -> "#/verify?token=..."
  if (!raw_.includes('?') && /%3F/i.test(raw_)) { try { raw_ = decodeURIComponent(raw_); } catch { /* leave as is */ } }
  const [path, qs] = raw_.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));

  let route = null;
  let params = {};
  for (const r of routes) {
    const m = r.rx.exec(path);
    if (m) { route = r; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); break; }
  }
  const user = store.user;
  if (!route) { location.replace('#' + (user ? roleHome(user.role) : '/login')); return; }
  const open = route.role === '*';
  if (!route.role && user) { location.replace('#' + roleHome(user.role)); return; }
  if (route.role && !open && !user) { location.replace('#/login'); return; }
  if (route.role && !open && route.role !== 'auth' && user.role !== route.role) { location.replace('#' + roleHome(user.role)); return; }

  if (current) current.cleanups.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  if (sheetOpen()) closeSheet();
  const ctx = makeCtx(route, params, query);
  current = ctx;
  if (user && !open) ctx.show(spinner(), { nav: route.pattern });
  try {
    await route.handler(ctx);
  } catch (err) {
    if (token !== navToken || current !== ctx) return;
    if (err.name === 'AbortError') return;
    console.error(err);
    const msg = err instanceof ApiError ? err.message : 'Something went wrong while loading this page.';
    ctx.show(html`<div class="page"><div class="card pad-lg col center" style="align-items:center"><div class="ibox bad">${icon('info')}</div><h2>We couldn't open that</h2><p class="muted">${msg}</p><div class="row"><button class="btn" data-act="reload">Try again</button><a class="btn primary" href="#${user ? roleHome(user.role) : '/login'}">Go home</a></div></div></div>`, { nav: route.pattern });
    ctx.on.reload = () => run();
  }
  refreshUnread();
}

async function refreshUnread() {
  if (!store.user || store.user.role !== 'student') return;
  try {
    const { unread } = await api('/notifications/unread-count');
    store.unread = unread;
    document.querySelectorAll('.js-unread').forEach((el) => { el.textContent = unread; el.hidden = unread === 0; });
  } catch { /* non-critical */ }
}
window.addEventListener('cq:unread', refreshUnread);

async function logout() {
  try { await api('/auth/logout', { method: 'POST', body: {} }); } catch { /* cookie may already be gone */ }
  store.user = null;
  store.unread = 0;
  location.hash = '#/login';
}

// ---------- global delegated events ----------
document.addEventListener('click', (e) => {
  const scrim = e.target.closest('[data-scrim]');
  if (scrim && e.target === scrim) { closeSheet(); return; }
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const name = t.dataset.act;
  if (name === 'close-sheet') { closeSheet(); return; }
  if (name === 'logout') { e.preventDefault(); logout(); return; }
  if (current && current.on[name]) {
    if (t.tagName === 'A' && !t.getAttribute('href')) e.preventDefault();
    Promise.resolve(current.on[name](t, e)).catch((err) => {
      console.error(err);
      toast(err instanceof ApiError ? err.message : 'Something went wrong.', 'bad');
    });
  }
});
document.addEventListener('submit', (e) => {
  const f = e.target.closest('[data-submit]');
  if (!f) return;
  e.preventDefault();
  const fn = current && current.on[f.dataset.submit];
  if (fn) Promise.resolve(fn(f, e)).catch((err) => { console.error(err); toast(err instanceof ApiError ? err.message : 'Something went wrong.', 'bad'); });
});
document.addEventListener('change', (e) => {
  const t = e.target.closest('[data-change]');
  if (t && current && current.on[t.dataset.change]) Promise.resolve(current.on[t.dataset.change](t, e)).catch((err) => toast(err.message || 'Something went wrong.', 'bad'));
});
document.addEventListener('input', (e) => {
  const t = e.target.closest('[data-input]');
  if (t && current && current.on[t.dataset.input]) current.on[t.dataset.input](t, e);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheetOpen()) closeSheet();
});

setUnauthorizedHandler(() => {
  if (!store.user) return;
  store.user = null;
  toast('Your session has ended. Please log in again.', 'bad');
  location.hash = '#/login';
});

window.addEventListener('hashchange', run);

(async function boot() {
  try {
    const { user } = await api('/auth/me');
    store.user = user;
  } catch { store.user = null; }
  if (!location.hash || location.hash === '#') location.replace('#' + (store.user ? roleHome(store.user.role) : '/login'));
  run();
})();
