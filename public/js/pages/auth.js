import { get, post, ApiError } from '../api.js';
import { store, roleHome } from '../store.js';
import { html, raw, icon, formData, showFieldErrors, toast } from '../ui.js';

const brand = html`<div class="brand"><span class="logo">${icon('bolt', 22, { fill: true })}</span>CampusQuest</div>`;

// Official multi-colour Google "G" mark (required by Google's sign-in branding guidelines).
const googleG = raw(`<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`);

const GOOGLE_ERRORS = {
  google_disabled: 'Google sign-in is not set up on this server yet.',
  google_cancelled: 'Google sign-in was cancelled.',
  google_expired: 'The Google sign-in took too long or was started in another tab. Please try again.',
  google_failed: "We couldn't complete Google sign-in. Please try again.",
  google_unverified: 'Your Google account email is not verified, so it cannot be used here.',
  domain_not_allowed: 'Please use your college Google account.',
  account_suspended: 'This account has been suspended or deactivated. Contact an administrator.'
};

let configCache = null;
async function authConfig() {
  if (!configCache) {
    try { configCache = await get('/auth/config'); } catch { configCache = { google: false, allowInstructorSignup: true, allowedEmailDomains: [], demoAccounts: false }; }
  }
  return configCache;
}

const frame = (title, sub, body) => html`
  <div class="auth"><div class="auth-card" id="main">
    ${brand}
    <div><h1>${title}</h1>${sub ? html`<p class="muted mt-4">${sub}</p>` : ''}</div>
    <div class="card pad-lg col" style="gap:16px">${body}</div>
  </div></div>`;

// Login page: sign in to an existing account (new Google users are asked for their role first).
// Sign-up page: create the account with the role ticked on that page.
const googleHref = (intent, role = 'student') => (intent === 'signup' ? `/api/auth/google?intent=signup&role=${role}` : '/api/auth/google?intent=login');
const googleButton = (label, intent) => html`<a class="btn google lg" id="google-btn" href="${googleHref(intent)}">${googleG}<span>${label}</span></a><div class="or-divider">or</div>`;

const devLinkBox = (link) => (link ? html`<div class="alert info small" style="word-break:break-word">Development mode: email isn't configured yet, so the message was printed in the server console instead of being sent. <a href="${link}">Open the link</a></div>` : '');

function setBusy(form, busy, label) {
  const b = form.querySelector('button[type=submit]');
  if (!b) return;
  b.disabled = busy;
  if (label) b.textContent = busy ? 'Please wait…' : label;
}

function alertBox(form, msg, kind = 'bad') {
  let box = form.querySelector('.form-alert');
  if (!box) { box = document.createElement('div'); box.className = 'form-alert'; box.setAttribute('role', 'alert'); form.prepend(box); }
  box.className = `form-alert alert ${kind}`;
  box.textContent = msg;
}

const signedIn = (user) => { store.user = user; location.hash = '#' + roleHome(user.role); };

// The address waiting for verification is kept for this browser tab only (not in the URL),
// so the code screen survives a refresh and can be reopened from the login page.
const PENDING_KEY = 'cq_pending_email';
const rememberPending = (email) => { try { sessionStorage.setItem(PENDING_KEY, email); } catch { /* storage blocked */ } };
const recallPending = () => { try { return sessionStorage.getItem(PENDING_KEY) || ''; } catch { return ''; } };
const forgetPending = () => { try { sessionStorage.removeItem(PENDING_KEY); } catch { /* storage blocked */ } };
let pendingDevLink = null; // development-mode link from the last sign-up, shown once

// Route #/check-email: enter the 6-digit code (after sign-up, after an unverified login, or any time later).
export async function checkEmail(ctx) {
  const devLink = pendingDevLink;
  pendingDevLink = null;
  const fromLogin = ctx.query.from === 'login';
  showCheckEmail(ctx, recallPending(), devLink, { fromLogin, cooldown: ctx.query.from === 'register' ? 45 : 0, heading: fromLogin ? 'Verify your email' : 'Check your email' });
}

// "Check your inbox" screen. With no known address it also asks for the email.
function showCheckEmail(ctx, knownEmail, devLink, { heading = 'Check your email', fromLogin = false, cooldown: initialCooldown = 0 } = {}) {
  const email = knownEmail;
  const intro = email
    ? html`${fromLogin ? 'Your email address is not verified yet. ' : ''}We sent a 6-digit code and a link to <b>${email}</b>. Enter the code below to ${fromLogin ? 'activate your account' : 'finish creating your account'}.`
    : html`Enter the email you signed up with and the 6-digit code from your verification email.`;
  ctx.show(frame(heading, '', html`
    <div class="mail-ic">${icon('mail', 28)}</div>
    <p class="center">${intro}</p>
    <form data-submit="code" class="col" style="gap:12px" novalidate>
      ${email ? '' : html`<div class="field"><label for="cemail">Email</label><input id="cemail" name="email" type="email" autocomplete="email" required></div>`}
      <div class="field"><label for="code">Verification code</label>
        <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="7" pattern="[0-9 ]*" placeholder="123456" required style="font-size:24px;letter-spacing:8px;text-align:center;font-weight:700"></div>
      <button class="btn primary lg" type="submit">Verify</button>
    </form>
    <p class="small muted center" style="margin:0">Or open the link in the email on this device. The code expires in 24 hours. Can't find the email? Check your spam or promotions folder.</p>
    <div id="devbox">${devLinkBox(devLink)}</div>
    <button class="btn lg" data-act="resend" id="resend-btn">Resend email</button>
    <div class="small center">${email ? html`<a href="#/register" data-act="other-email">Sign up with a different email</a> · ` : ''}<a href="#/login">Back to log in</a></div>`), { plain: true, title: 'Check your email' });

  const currentEmail = () => email || String((document.getElementById('cemail') || {}).value || '').trim().toLowerCase();
  ctx.on['other-email'] = () => forgetPending();

  let cooldown = null;
  const startCooldown = (secs) => {
    const b = document.getElementById('resend-btn');
    if (!b) return;
    let left = secs;
    b.disabled = true;
    const tick = () => { if (!document.body.contains(b)) return clearInterval(cooldown); b.textContent = left > 0 ? `Resend email (${left}s)` : 'Resend email'; b.disabled = left > 0; if (left-- <= 0) clearInterval(cooldown); };
    clearInterval(cooldown); tick(); cooldown = setInterval(tick, 1000);
  };
  ctx.cleanup(() => clearInterval(cooldown));
  startCooldown(initialCooldown);
  setTimeout(() => { const c = document.getElementById(email ? 'code' : 'cemail'); if (c) c.focus(); }, 0);
  ctx.on.code = async (form) => {
    const d = formData(form);
    showFieldErrors(form, {});
    const code = String(d.code || '').replace(/\s+/g, '');
    const addr = currentEmail();
    if (!addr) { showFieldErrors(form, { email: 'Enter your email.' }); return; }
    if (!/^\d{6}$/.test(code)) { showFieldErrors(form, { code: 'Enter the 6-digit code from the email.' }); return; }
    setBusy(form, true, 'Verify');
    try {
      const { user } = await post('/auth/verify-code', { email: addr, code });
      forgetPending();
      toast('Email verified. Welcome to CampusQuest!');
      signedIn(user);
    } catch (err) {
      showFieldErrors(form, err.data.fields || { code: err.message });
      alertBox(form, err.message);
      setBusy(form, false, 'Verify');
    }
  };
  ctx.on.resend = async () => {
    const addr = currentEmail();
    if (!addr) { toast('Enter your email first.', 'bad'); return; }
    try {
      const r = await post('/auth/resend-verification', { email: addr });
      toast(r.message);
      if (r.devLink) document.getElementById('devbox').innerHTML = String(devLinkBox(r.devLink));
      startCooldown(45);
    } catch (err) { toast(err.message, 'bad'); }
  };
}

// ---------------------------------------------------------------- log in
export async function login(ctx) {
  const cfg = await authConfig();
  const err = ctx.query.error && GOOGLE_ERRORS[ctx.query.error];
  ctx.show(frame('Welcome back', 'Log in to keep your streak going.', html`
    ${err ? html`<div class="alert bad" role="alert">${err}</div>` : ''}
    ${cfg.google ? googleButton('Continue with Google', 'login') : ''}
    <form data-submit="login" class="col" style="gap:16px" novalidate>
      <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required></div>
      <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
      <button class="btn primary lg" type="submit">Log in</button>
      <div class="spread small"><a href="#/forgot">Forgot password?</a><a href="#/register">Create an account</a></div>
      <div class="small center"><a href="#/check-email">Have a verification code?</a></div>
    </form>
    ${cfg.demoAccounts ? html`<div class="demo-box">Demo accounts (after <code>npm run seed</code>)
      <div><button type="button" data-act="fill" data-email="areeb@campusquest.test" data-pw="Learn1234">Student · areeb@campusquest.test</button></div>
      <div><button type="button" data-act="fill" data-email="farooq@campusquest.test" data-pw="Teach1234">Instructor · farooq@campusquest.test</button></div>
      <div><button type="button" data-act="fill" data-email="admin@campusquest.test" data-pw="Admin1234">Admin · admin@campusquest.test</button></div></div>` : ''}`), { plain: true, title: 'Log in' });

  ctx.on.fill = (el) => { document.getElementById('email').value = el.dataset.email; document.getElementById('password').value = el.dataset.pw; };
  ctx.on.login = async (form) => {
    const d = formData(form);
    showFieldErrors(form, {});
    if (!d.email || !d.password) { alertBox(form, 'Enter your email and password.'); return; }
    setBusy(form, true, 'Log in');
    try {
      const { user } = await post('/auth/login', { email: d.email, password: d.password });
      signedIn(user);
    } catch (e) {
      if (e instanceof ApiError && e.data.code === 'EMAIL_NOT_VERIFIED') { rememberPending(d.email.trim().toLowerCase()); ctx.go('/check-email?from=login'); return; }
      alertBox(form, e.message);
      setBusy(form, false, 'Log in');
    }
  };
}

// ---------------------------------------------------------------- sign up
export async function register(ctx) {
  const cfg = await authConfig();
  const domains = cfg.allowedEmailDomains || [];
  ctx.show(frame('Create your account', 'Earn XP, keep streaks and climb your course leaderboard.', html`
    ${cfg.allowInstructorSignup ? html`<fieldset style="border:0;padding:0;margin:0" class="field"><legend class="label" style="padding:0;margin-bottom:6px">I am a</legend>
      <div class="pills"><label class="checkrow"><input type="radio" name="role" value="student" data-change="role" checked> Student</label><label class="checkrow"><input type="radio" name="role" value="instructor" data-change="role"> Instructor</label></div>
    </fieldset>` : ''}
    ${cfg.google ? googleButton('Sign up with Google', 'signup') : ''}
    <form data-submit="register" class="col" style="gap:16px" novalidate>
      <div class="field"><label for="name">Full name</label><input id="name" name="name" type="text" autocomplete="name" required></div>
      <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required ${domains.length ? raw('aria-describedby="emailhelp"') : ''}>${domains.length ? html`<div class="help" id="emailhelp">Use your college email (${domains.map((x) => '@' + x).join(', ')}).</div>` : ''}</div>
      <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="new-password" required aria-describedby="pwhelp"><div class="help" id="pwhelp">At least 8 characters with a letter and a number.</div></div>
      <button class="btn primary lg" type="submit">Create account</button>
      <p class="xs muted center" style="margin:0">We'll email you a link to verify your address before the account is created.</p>
      <div class="small center">Already registered? <a href="#/login">Log in</a></div>
    </form>`), { plain: true, title: 'Register' });

  const role = () => { const r = document.querySelector('input[name=role]:checked'); return r ? r.value : 'student'; };
  ctx.on.role = () => { const g = document.getElementById('google-btn'); if (g) g.href = googleHref('signup', role()); };
  ctx.on.register = async (form) => {
    const d = formData(form);
    showFieldErrors(form, {});
    setBusy(form, true, 'Create account');
    try {
      const r = await post('/auth/register', { name: d.name, email: d.email, password: d.password, role: role() });
      rememberPending(r.email);
      pendingDevLink = r.devLink || null;
      ctx.go('/check-email?from=register');
    } catch (err) {
      showFieldErrors(form, err.data.fields || {});
      alertBox(form, err.message);
      setBusy(form, false, 'Create account');
    }
  };
}

// ---------------------------------------------------------------- new Google user from the login page
// Route #/google-signup: the Google address has no account yet, so ask for the role before creating it.
export async function googleSignup(ctx) {
  let p = { pending: false };
  try { p = await get('/auth/google/pending'); } catch { /* treated as expired */ }
  if (!p.pending) {
    ctx.show(frame('Google sign-in expired', '', html`
      <div class="alert info">That Google sign-in took too long or was already used. Please try again.</div>
      <a class="btn primary lg" href="#/login">Back to log in</a>`), { plain: true, title: 'Google sign-in' });
    return;
  }
  ctx.show(frame('One more step', '', html`
    <p style="margin:0">There's no CampusQuest account for <b>${p.email}</b> yet. Create one now?</p>
    <form data-submit="google-complete" class="col" style="gap:16px" novalidate>
      <fieldset style="border:0;padding:0;margin:0" class="field"><legend class="label" style="padding:0;margin-bottom:6px">I am a</legend>
        <div class="pills"><label class="checkrow"><input type="radio" name="role" value="student" checked> Student</label>${p.allowInstructorSignup ? html`<label class="checkrow"><input type="radio" name="role" value="instructor"> Instructor</label>` : ''}</div>
      </fieldset>
      <button class="btn primary lg" type="submit">Create my account</button>
      <button class="btn lg" type="button" data-act="google-cancel">Cancel</button>
    </form>`), { plain: true, title: 'Create account' });

  ctx.on['google-complete'] = async (form) => {
    const role = (form.querySelector('input[name=role]:checked') || {}).value || 'student';
    setBusy(form, true, 'Create my account');
    try {
      const { user } = await post('/auth/google/complete', { role });
      toast('Welcome to CampusQuest!');
      signedIn(user);
    } catch (err) {
      alertBox(form, err.message);
      setBusy(form, false, 'Create my account');
    }
  };
  ctx.on['google-cancel'] = async () => {
    try { await post('/auth/google/cancel'); } catch { /* the cookie expires anyway */ }
    ctx.go('/login');
  };
}

// ---------------------------------------------------------------- email link landing page
export async function verify(ctx) {
  const token = ctx.query.token || '';
  ctx.show(frame('Verifying your email…', '', html`<div class="center muted">One moment…</div>`), { plain: true, title: 'Verify email' });
  try {
    const { user } = await post('/auth/verify-email', { token });
    toast('Email verified. Welcome to CampusQuest!');
    signedIn(user);
  } catch (err) {
    const taken = err.data && err.data.code === 'EMAIL_TAKEN';
    ctx.show(frame(taken ? 'Already verified' : "This link didn't work", '', html`
      <div class="alert ${taken ? 'info' : 'bad'}">${err.message}</div>
      ${taken ? '' : html`<form data-submit="resend-v" class="col" style="gap:12px" novalidate>
        <div class="field"><label for="email">Your email</label><input id="email" name="email" type="email" autocomplete="email" required></div>
        <button class="btn primary lg" type="submit">Send a new link</button></form><div id="devbox"></div>`}
      <div class="small center">${taken ? '' : html`<a href="#/check-email">Enter a code instead</a> · `}<a href="#/login">Go to log in</a></div>`), { plain: true, title: 'Verify email' });
    ctx.on['resend-v'] = async (form) => {
      const d = formData(form);
      setBusy(form, true, 'Send a new link');
      try {
        const r = await post('/auth/resend-verification', { email: d.email });
        alertBox(form, r.message, 'ok');
        if (r.devLink) document.getElementById('devbox').innerHTML = String(devLinkBox(r.devLink));
      } catch (e) { showFieldErrors(form, e.data.fields || {}); alertBox(form, e.message); }
      setBusy(form, false, 'Send a new link');
    };
  }
}

// ---------------------------------------------------------------- forgot / reset password
export async function forgot(ctx) {
  ctx.show(frame('Reset your password', "Enter your email and we'll send you a reset link.", html`
    <form data-submit="forgot" class="col" style="gap:16px" novalidate>
      <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required></div>
      <button class="btn primary lg" type="submit">Send reset link</button>
      <div class="small center"><a href="#/login">Back to log in</a></div>
    </form>
    <div id="devbox"></div>`), { plain: true, title: 'Reset password' });

  ctx.on.forgot = async (form) => {
    const d = formData(form);
    showFieldErrors(form, {});
    setBusy(form, true, 'Send reset link');
    try {
      const r = await post('/auth/forgot-password', { email: d.email });
      alertBox(form, r.message, 'ok');
      document.getElementById('devbox').innerHTML = String(devLinkBox(r.devLink));
    } catch (err) {
      showFieldErrors(form, err.data.fields || {});
      alertBox(form, err.message);
    }
    setBusy(form, false, 'Send reset link');
  };
}

export async function reset(ctx) {
  const token = ctx.query.token || '';
  let check = { valid: false };
  try { check = await get(`/auth/reset-password/check?token=${encodeURIComponent(token)}`); } catch { /* treated as invalid */ }
  if (!check.valid) {
    ctx.show(frame('This link has expired', '', html`
      <div class="alert bad">This link is invalid, has expired or was already used.</div>
      <a class="btn primary lg" href="#/forgot">Request a new link</a>
      <div class="small center"><a href="#/login">Back to log in</a></div>`), { plain: true, title: 'Link expired' });
    return;
  }
  const label = check.invite ? 'Activate account' : 'Update password';
  ctx.show(frame(check.invite ? 'Welcome! Set your password' : 'Choose a new password', check.email, html`
    <form data-submit="reset" class="col" style="gap:16px" novalidate>
      <input type="email" name="username" value="${check.email}" autocomplete="username" hidden>
      <div class="field"><label for="password">New password</label><input id="password" name="password" type="password" autocomplete="new-password" required aria-describedby="pwhelp"><div class="help" id="pwhelp">At least 8 characters with a letter and a number.</div></div>
      <button class="btn primary lg" type="submit">${label}</button>
      ${check.invite ? '' : html`<p class="xs muted center" style="margin:0">You'll be signed out on all other devices.</p>`}
    </form>`), { plain: true, title: check.invite ? 'Activate account' : 'New password' });

  ctx.on.reset = async (form) => {
    const d = formData(form);
    showFieldErrors(form, {});
    setBusy(form, true, label);
    try {
      const { user } = await post('/auth/reset-password', { token, password: d.password });
      toast(check.invite ? 'Account activated. Welcome!' : 'Password updated.');
      signedIn(user);
    } catch (err) {
      showFieldErrors(form, err.data.fields || {});
      alertBox(form, err.message);
      setBusy(form, false, label);
    }
  };
}
