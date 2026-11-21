// Tiny UI toolkit: auto-escaping html`` templates, icons, formatting, sheets and toasts.
// Everything user-supplied goes through esc() - there is no innerHTML of raw user text (XSS defence).

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);

function part(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  if (v === null || v === undefined || v === false) return '';
  return esc(v);
}
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s + (i < vals.length ? part(vals[i]) : ''); });
  return new Raw(out);
}

// ---------- icons (stroke icons from the design prototype) ----------
const P = {
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
  flame: '<path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 0 2 1 3 2 3 0-3-1-5.5.5-8z"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M16 5h3v2a3 3 0 0 1-3 3"/><path d="M8 5H5v2a3 3 0 0 0 3 3"/><path d="M12 13v4"/><path d="M8 21h8"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4l2-2z"/><path d="M10 21h4"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  check: '<path d="M5 12.5 10 17 19 7"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  medal: '<circle cx="12" cy="9" r="6"/><path d="M8.5 14 7 22l5-3 5 3-1.5-8"/>',
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5c2.5 0 4.5 1.5 4.5 4"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  download: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
  x: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2V5z"/><path d="M4 19a2 2 0 0 1 2-2h14"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7"/><path d="M12 17h.01"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  chart: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
  up: '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>',
  down: '<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>',
  settings: '<path d="M4 6h10"/><path d="M18 6h2"/><circle cx="16" cy="6" r="2"/><path d="M4 12h2"/><path d="M10 12h10"/><circle cx="8" cy="12" r="2"/><path d="M4 18h12"/><path d="M20 18h0"/><circle cx="18" cy="18" r="2"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  logout: '<path d="M9 4H5v16h4"/><path d="M16 8l4 4-4 4"/><path d="M20 12H9"/>',
  footsteps: '<ellipse cx="8" cy="15" rx="3" ry="5"/><ellipse cx="16" cy="9" rx="3" ry="5"/>',
  brain: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5 13.5 13.5 8.5 15.5 10.5 10.5z"/>',
  map: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c3 3 3 15 0 18"/><path d="M12 3c-3 3-3 15 0 18"/>',
  layers: '<path d="M12 3 3 8l9 5 9-5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  send: '<path d="M4 12l16-8-6 16-3-7-7-1z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5h.01"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'
};
export function icon(name, size = 20, { fill = false, sw = 2, label } = {}) {
  const body = P[name] || P.medal;
  const aria = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
  return raw(`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" ${aria}>${body}</svg>`);
}
export const achievementIcon = (name) => icon(P[name] ? name : 'medal', 22);

// ---------- formatting ----------
export const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const num = (n) => Number(n || 0).toLocaleString('en-US');

export function timeAgo(d) {
  if (!d) return '';
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const days = Math.floor(s / 86400);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
export const fmtDate = (d, opts = { weekday: 'short', month: 'short', day: 'numeric' }) => (d ? new Date(d).toLocaleDateString('en-US', opts) : '');
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

// "Ends tonight", "3 days left" ...
export function dueText(d) {
  if (!d) return '';
  const ms = new Date(d).getTime() - Date.now();
  if (ms < 0) return 'Closed';
  const hrs = ms / 3600000;
  if (hrs < 24) return `Due ${fmtDate(d, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`;
  const days = Math.ceil(ms / 86400000);
  return days <= 6 ? `${days} days left` : `Due ${fmtDate(d)}`;
}

// Lightweight lesson formatting: blank line = paragraph, **bold**. Input is escaped first.
export function rich(text) {
  const paras = String(text || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (!paras.length) return raw('<p class="muted">No written content for this lesson yet.</p>');
  return raw(paras.map((p) => `<p>${esc(p).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')}</p>`).join(''));
}

export const bar = (pctVal, cls = '', size = '') => html`<div class="track ${size}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pctVal}"><div class="fill ${cls}" style="width:${Math.max(0, Math.min(100, pctVal))}%"></div></div>`;
export const spinner = () => raw('<div class="spinner" role="status" aria-label="Loading"></div>');
export const empty = (iconName, title, body = '') => html`<div class="empty"><div class="ibox gray">${icon(iconName)}</div><div class="semi ink2">${title}</div>${body ? html`<div class="small mt-4">${body}</div>` : ''}</div>`;

// ---------- overlay sheets ----------
let lastFocus = null;
export function openSheet(content, { wide = false, label = 'Dialog', onClose } = {}) {
  const overlay = document.getElementById('overlay');
  lastFocus = document.activeElement;
  overlay.innerHTML = String(html`<div class="scrim" data-scrim><div class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${label}" tabindex="-1">${content}</div></div>`);
  const sheet = overlay.querySelector('.sheet');
  sheet.focus();
  overlay._onClose = onClose;
  document.body.style.overflow = 'hidden';
  return sheet;
}
export function closeSheet() {
  const overlay = document.getElementById('overlay');
  const cb = overlay._onClose;
  overlay._onClose = null;
  overlay.innerHTML = '';
  document.body.style.overflow = '';
  if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch { /* element gone */ }
  if (cb) cb();
}
export const sheetOpen = () => !!document.querySelector('#overlay .sheet');

export function toast(message, kind = '') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// Reward sheet shown after lessons / quizzes / quests (mirrors the prototype's reward bottom sheet).
export function rewardSheet(rw, title) {
  const lines = rw.lines || [];
  const content = html`
    <div class="col center gap-4" style="align-items:center">
      <div class="ibox gold pop" style="width:56px;height:56px;border-radius:18px">${icon('bolt', 28, { fill: true })}</div>
      <h2 class="mt-8" style="font-size:20px">${title}</h2>
      <div class="display xp-text pop" style="font-size:36px;font-weight:700">+${rw.total} XP</div>
    </div>
    ${lines.length ? html`<div class="reward-lines">${lines.map((l) => html`<div><span>${l.label}</span><span class="xp-text nowrap">+${l.xp}</span></div>`)}</div>` : ''}
    ${rw.level && rw.level.leveledUp ? html`<div class="levelup pop">${icon('star', 28, { fill: true })}<div><div class="bold" style="font-size:16px">Level up! You reached Level ${rw.level.after}</div><div class="small" style="opacity:.9">Your leaderboard position has been updated.</div></div></div>` : ''}
    ${(rw.badges || []).map((b) => html`<div class="badge-won pop">${icon('medal', 26)}<div><div class="xs semi">Badge unlocked</div><div class="bold">${b.title}</div></div></div>`)}
    ${rw.streak && rw.streak.extendedToday ? html`<div class="row small ink2">${icon('flame', 18)}<span>${rw.streak.current}-day streak. Keep it going tomorrow.</span></div>` : ''}
    <button class="btn primary lg" data-act="close-sheet">Keep going</button>`;
  openSheet(content, { label: title });
}

export function infoSheet(title, note, btn = 'Got it') {
  openSheet(html`
    <div class="row top gap-16">
      <div class="ibox" style="width:44px;height:44px;border-radius:14px">${icon('info', 22)}</div>
      <div><h2 style="font-size:20px">${title}</h2><p class="ink2 mt-4" style="line-height:1.5">${note}</p></div>
    </div>
    <button class="btn primary lg" data-act="close-sheet">${btn}</button>`, { label: title });
}

export function confirmSheet({ title, body, confirm = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    openSheet(html`
      <h2 style="font-size:20px">${title}</h2>
      <p class="ink2" style="line-height:1.5">${body}</p>
      <div class="row">
        <button class="btn grow" data-act="sheet-no">Cancel</button>
        <button class="btn ${danger ? 'danger' : 'primary'} grow" data-act="sheet-yes">${confirm}</button>
      </div>`, { label: title, onClose: () => resolve(false) });
    const overlay = document.getElementById('overlay');
    overlay.onclick = (e) => {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      if (t.dataset.act === 'sheet-yes') { overlay._onClose = null; closeSheet(); resolve(true); }
      if (t.dataset.act === 'sheet-no') closeSheet();
    };
  });
}

// Reads a form into a plain object (checkboxes -> boolean, numbers stay strings; callers convert).
export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else out[el.name] = el.value;
  }
  return out;
}

export function showFieldErrors(form, fields = {}) {
  form.querySelectorAll('.field-error').forEach((e) => e.remove());
  form.querySelectorAll('.invalid').forEach((e) => e.classList.remove('invalid'));
  for (const [name, msg] of Object.entries(fields)) {
    const el = form.elements[name];
    if (!el) continue;
    el.classList.add('invalid');
    const p = document.createElement('div');
    p.className = 'field-error';
    p.textContent = msg;
    (el.closest('.field') || el.parentElement).appendChild(p);
  }
}
