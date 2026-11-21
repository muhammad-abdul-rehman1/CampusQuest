// Email verification, invitations, session revocation and "Continue with Google".
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

test.before(() => h.start());
test.after(() => h.stop());

test('sign-up: no account and no login until the email link is opened', async () => {
  await h.reset();
  const email = 'pending@uni.test';
  const reg = await h.request(h.app).post('/api/auth/register').send({ name: 'Pending Person', email, password: 'Secret123' });
  assert.equal(reg.status, 202);
  const first = h.lastEmailToken(email);

  // Correct password -> told to verify; wrong password -> generic error (no leak about pending sign-ups).
  const early = await h.request(h.app).post('/api/auth/login').send({ email, password: 'Secret123' });
  assert.equal(early.status, 403);
  assert.equal(early.body.code, 'EMAIL_NOT_VERIFIED');
  assert.equal((await h.request(h.app).post('/api/auth/login').send({ email, password: 'Wrong1234' })).status, 401);

  // Resend issues a fresh link (the throttle is skipped by back-dating the first one).
  await h.M.AuthToken.collection.updateMany({ email }, { $set: { createdAt: new Date(Date.now() - 120000) } });
  const resent = await h.request(h.app).post('/api/auth/resend-verification').send({ email });
  assert.equal(resent.status, 200);
  const second = h.lastEmailToken(email);
  assert.notEqual(first, second);

  const a = h.request.agent(h.app);
  const ok = await a.post('/api/auth/verify-email').send({ token: second });
  assert.equal(ok.status, 200);
  assert.equal((await a.get('/api/auth/me')).body.user.email, email);
  // Every link is single use, and older links for the same sign-up die too.
  assert.equal((await h.request(h.app).post('/api/auth/verify-email').send({ token: second })).status, 400);
  assert.equal((await h.request(h.app).post('/api/auth/verify-email').send({ token: first })).status, 400);
  assert.equal((await h.request(h.app).post('/api/auth/verify-email').send({ token: 'not-a-real-token-but-long-enough' })).status, 400);
  // Normal login now works; registering the same address again is refused.
  assert.equal((await h.request(h.app).post('/api/auth/login').send({ email, password: 'Secret123' })).status, 200);
  assert.equal((await h.request(h.app).post('/api/auth/register').send({ name: 'Again', email, password: 'Secret123' })).status, 409);
  assert.equal(await h.M.StudentProfile.countDocuments(), 1);
});

test('email links use plain paths and only redirect into the app (opening them spends nothing)', async () => {
  await h.reset();
  await h.request(h.app).post('/api/auth/register').send({ name: 'Link Clicker', email: 'link@uni.test', password: 'Secret123' });
  const mail = h.outbox.filter((m) => m.to === 'link@uni.test').pop();
  assert.match(mail.link, /^http:\/\/localhost:3000\/verify\?token=[A-Za-z0-9_-]+$/);
  const token = h.lastEmailToken('link@uni.test');
  const open = await h.request(h.app).get(`/verify?token=${token}`);
  assert.equal(open.status, 302);
  assert.equal(open.headers.location, `/#/verify?token=${token}`);
  assert.equal(open.headers['cache-control'], 'no-store');
  assert.equal(await h.M.AuthToken.countDocuments({ usedAt: { $ne: null } }), 0); // a link scanner GET does not consume it
  assert.equal((await h.request(h.app).get('/reset?token=<script>')).headers.location, '/#/reset?token=invalid');
  assert.equal((await h.request(h.app).post('/api/auth/verify-email').send({ token })).status, 200);
});

test('6-digit code: verifies on another device, single use, locks after 5 wrong tries', async () => {
  await h.reset();
  const email = 'phone@uni.test';
  await h.request(h.app).post('/api/auth/register').send({ name: 'Phone Reader', email, password: 'Secret123' });
  const mail = h.outbox.filter((m) => m.to === email).pop();
  assert.match(mail.code, /^\d{6}$/);
  assert.ok(mail.text.includes(mail.code));
  assert.equal((await h.M.AuthToken.findOne({ email }).lean()).codeHash.includes(mail.code), false); // stored hashed

  const wrong = mail.code === '000000' ? '111111' : '000000';
  const bad = await h.request(h.app).post('/api/auth/verify-code').send({ email, code: wrong });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'CODE_INVALID');
  assert.equal((await h.request(h.app).post('/api/auth/verify-code').send({ email, code: '12ab' })).status, 400);
  assert.equal((await h.request(h.app).post('/api/auth/verify-code').send({ email: 'other@uni.test', code: mail.code })).status, 400); // code is bound to the address

  const a = h.request.agent(h.app);
  const ok = await a.post('/api/auth/verify-code').send({ email, code: `${mail.code.slice(0, 3)} ${mail.code.slice(3)}` }); // spaces tolerated
  assert.equal(ok.status, 200);
  assert.equal((await a.get('/api/auth/me')).body.user.email, email);
  assert.equal((await h.request(h.app).post('/api/auth/verify-code').send({ email, code: mail.code })).status, 400); // single use

  // Brute force protection
  const email2 = 'guess@uni.test';
  await h.request(h.app).post('/api/auth/register').send({ name: 'Guess Target', email: email2, password: 'Secret123' });
  const real = h.outbox.filter((m) => m.to === email2).pop().code;
  const notIt = real === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) await h.request(h.app).post('/api/auth/verify-code').send({ email: email2, code: notIt });
  const locked = await h.request(h.app).post('/api/auth/verify-code').send({ email: email2, code: real });
  assert.equal(locked.status, 400);
  assert.equal(locked.body.code, 'CODE_LOCKED'); // even the right code no longer works
  assert.equal(await h.M.User.countDocuments({ email: email2 }), 0);
});

test('resend never reveals whether an address exists', async () => {
  await h.reset();
  const u = await h.makeUser('student', 'Known');
  const a = await h.request(h.app).post('/api/auth/resend-verification').send({ email: u.email });
  const b = await h.request(h.app).post('/api/auth/resend-verification').send({ email: 'nobody@uni.test' });
  assert.equal(a.status, 200);
  assert.equal(a.body.message.replace(u.email, ''), b.body.message.replace('nobody@uni.test', ''));
  assert.equal(h.outbox.filter((m) => m.to === u.email || m.to === 'nobody@uni.test').length, 0); // nothing to send to either
});

test('an unverified existing account must verify before logging in', async () => {
  await h.reset();
  const u = await h.makeUser('student', 'Legacy');
  await h.M.User.updateOne({ _id: u._id }, { emailVerified: false });
  const r = await h.request(h.app).post('/api/auth/login').send({ email: u.email, password: 'Passw0rdTest' });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'EMAIL_NOT_VERIFIED');
  await h.request(h.app).post('/api/auth/resend-verification').send({ email: u.email });
  const v = await h.request(h.app).post('/api/auth/verify-email').send({ token: h.lastEmailToken(u.email) });
  assert.equal(v.status, 200);
  assert.equal((await h.request(h.app).post('/api/auth/login').send({ email: u.email, password: 'Passw0rdTest' })).status, 200);
});

test('admin invitations: the user sets their own password from the email', async () => {
  await h.reset();
  const admin = await h.login(await h.makeUser('admin', 'Root'));
  const c = await admin.post('/api/admin/users').send({ name: 'Invited Teacher', email: 'teach@uni.test', role: 'instructor' });
  assert.equal(c.status, 201);
  assert.equal(c.body.emailVerified, false);
  assert.equal((await admin.post('/api/admin/users').send({ name: 'X', email: 'teach@uni.test', role: 'student', password: 'whatever1' })).status, 400);

  // No password yet -> can't log in.
  assert.equal((await h.request(h.app).post('/api/auth/login').send({ email: 'teach@uni.test', password: 'anything1' })).status, 401);
  const token = h.lastEmailToken('teach@uni.test');
  const check = await h.request(h.app).get(`/api/auth/reset-password/check?token=${token}`);
  assert.deepEqual(check.body, { valid: true, invite: true, email: 'teach@uni.test' });

  const t = h.request.agent(h.app);
  const done = await t.post('/api/auth/reset-password').send({ token, password: 'MyOwnPass9' });
  assert.equal(done.status, 200);
  assert.equal(done.body.user.role, 'instructor');
  assert.equal(done.body.user.emailVerified, true);
  assert.equal((await t.get('/api/instructor/courses')).status, 200);
  assert.equal((await admin.post(`/api/admin/users/${c.body.id}/invite`)).status, 400); // already active
  assert.ok(await h.M.AuditLog.exists({ action: 'auth.invite_accepted' }));
});

test('changing the password signs out other sessions but keeps this one', async () => {
  await h.reset();
  const u = await h.makeUser('student', 'Two Devices');
  const phone = await h.login(u);
  const laptop = await h.login(u);
  const ch = await laptop.post('/api/users/password').send({ currentPassword: 'Passw0rdTest', newPassword: 'Brandnew99' });
  assert.equal(ch.status, 200);
  assert.equal((await laptop.get('/api/auth/me')).status, 200);
  assert.equal((await phone.get('/api/auth/me')).status, 401);
  assert.equal((await laptop.post('/api/users/password').send({ newPassword: 'Another99' })).status, 400); // current password required
});

// ---------------------------------------------------------------- Google
const fakeIdToken = (claims) => ['eyJhbGciOiJSUzI1NiJ9', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');

// intent 'signup' = the sign-up page's button, 'login' = the login page's button.
async function googleRound(agent, claimsFor, { role, intent = 'signup' } = {}) {
  const start = await agent.get(`/api/auth/google?intent=${intent}${role ? `&role=${role}` : ''}`);
  assert.equal(start.status, 302);
  const url = new URL(start.headers.location);
  assert.equal(url.host, 'accounts.google.com');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:3000/api/auth/google/callback');
  const state = url.searchParams.get('state');
  const nonce = url.searchParams.get('nonce');

  const realFetch = global.fetch;
  let sentBody = null;
  global.fetch = async (u, opts) => {
    sentBody = new URLSearchParams(String(opts.body));
    return { ok: true, status: 200, json: async () => ({ id_token: fakeIdToken(claimsFor(nonce)) }) };
  };
  try {
    const cb = await agent.get(`/api/auth/google/callback?code=abc&state=${state}`);
    return { cb, sentBody };
  } finally {
    global.fetch = realFetch;
  }
}

const claims = (over = {}) => (nonce) => ({
  iss: 'https://accounts.google.com',
  aud: 'test-client.apps.googleusercontent.com',
  exp: Math.floor(Date.now() / 1000) + 300,
  sub: 'google-123',
  email: 'Ali.Khan@Gmail.com',
  email_verified: true,
  name: 'Ali Khan',
  nonce,
  ...over
});

test('Google: first sign-in creates a verified student; later sign-ins reuse it', async () => {
  await h.reset();
  const a = h.request.agent(h.app);
  const { cb, sentBody } = await googleRound(a, claims());
  assert.equal(cb.status, 302);
  assert.equal(cb.headers.location, '/#/');
  assert.ok(sentBody.get('code_verifier')); // PKCE verifier sent to Google
  const me = await a.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, 'ali.khan@gmail.com');
  assert.equal(me.body.user.role, 'student');
  assert.equal(me.body.user.emailVerified, true);

  const b = h.request.agent(h.app);
  await googleRound(b, claims());
  assert.equal(await h.M.User.countDocuments(), 1);
  const profile = await b.get('/api/users/profile');
  assert.deepEqual(profile.body.security, { hasPassword: false, google: true });
  // A Google-only account can add a password without a "current password".
  assert.equal((await b.post('/api/users/password').send({ newPassword: 'NowIHave1' })).status, 200);
});

test('Google from the login page: existing accounts sign in; new addresses choose a role first', async () => {
  await h.reset();
  // Existing instructor signs in with the login-page button and keeps their role.
  await h.makeUser('instructor', 'Dr Existing', 'existing@uni.test');
  const a = h.request.agent(h.app);
  const { cb: ok } = await googleRound(a, claims({ sub: 'g-existing', email: 'existing@uni.test' }), { intent: 'login' });
  assert.equal(ok.headers.location, '/#/');
  assert.equal((await a.get('/api/auth/me')).body.user.role, 'instructor');

  // Unknown Google address: no account is created yet; the person is sent to the role step.
  const b = h.request.agent(h.app);
  const { cb } = await googleRound(b, claims({ sub: 'g-new', email: 'New.Teacher@Gmail.com', name: 'New Teacher' }), { intent: 'login' });
  assert.equal(cb.headers.location, '/#/google-signup');
  assert.equal(await h.M.User.countDocuments({ email: 'new.teacher@gmail.com' }), 0);
  assert.equal((await b.get('/api/auth/me')).status, 401);
  const pending = await b.get('/api/auth/google/pending');
  assert.deepEqual(pending.body, { pending: true, email: 'new.teacher@gmail.com', name: 'New Teacher', allowInstructorSignup: true });
  assert.equal((await b.post('/api/auth/google/complete').send({ role: 'admin' })).status, 400); // only student/instructor
  const done = await b.post('/api/auth/google/complete').send({ role: 'instructor' });
  assert.equal(done.status, 200);
  assert.equal(done.body.user.role, 'instructor');
  assert.equal(done.body.user.emailVerified, true);
  assert.equal((await b.get('/api/auth/me')).body.user.email, 'new.teacher@gmail.com');
  const stored = await h.M.User.findOne({ email: 'new.teacher@gmail.com' }).select('+googleId');
  assert.equal(stored.googleId, 'g-new');
  assert.equal((await b.get('/api/auth/google/pending')).body.pending, false); // single use
  assert.equal((await b.post('/api/auth/google/complete').send({ role: 'student' })).status, 400);

  // No pending Google sign-in at all (or a forged cookie) -> refused.
  assert.equal((await h.request(h.app).post('/api/auth/google/complete').send({ role: 'student' })).status, 400);
  const forged = await h.request(h.app).post('/api/auth/google/complete').set('Cookie', 'cq_google_signup=not.a.jwt').send({ role: 'student' });
  assert.equal(forged.status, 400);

  // Instructor sign-up switched off: the role step only allows student.
  const settings = require('../server/services/settings');
  await settings.update({ allowInstructorSignup: false });
  const c = h.request.agent(h.app);
  await googleRound(c, claims({ sub: 'g-late', email: 'late@uni.test', name: 'Late Comer' }), { intent: 'login' });
  assert.equal((await c.get('/api/auth/google/pending')).body.allowInstructorSignup, false);
  assert.equal((await c.post('/api/auth/google/complete').send({ role: 'instructor' })).status, 403);
  const asStudent = await c.post('/api/auth/google/complete').send({ role: 'student' });
  assert.equal(asStudent.body.user.role, 'student');
});

test('Google: links to an existing account with the same email', async () => {
  await h.reset();
  const u = await h.makeUser('instructor', 'Dr Same', 'same@uni.test');
  const a = h.request.agent(h.app);
  await googleRound(a, claims({ sub: 'g-same', email: 'same@uni.test' }));
  assert.equal((await a.get('/api/auth/me')).body.user.id, String(u._id));
  const stored = await h.M.User.findById(u._id).select('+googleId');
  assert.equal(stored.googleId, 'g-same');
});

test('Google: instructor role only when instructor sign-up is allowed', async () => {
  await h.reset();
  const a = h.request.agent(h.app);
  await googleRound(a, claims({ sub: 'g-teach', email: 'teach@uni.test' }), { role: 'instructor' });
  assert.equal((await a.get('/api/auth/me')).body.user.role, 'instructor');

  const settings = require('../server/services/settings');
  await settings.update({ allowInstructorSignup: false });
  const b = h.request.agent(h.app);
  await googleRound(b, claims({ sub: 'g-sneaky', email: 'sneaky@uni.test' }), { role: 'instructor' });
  assert.equal((await b.get('/api/auth/me')).body.user.role, 'student');
});

test('Google: rejects bad state, wrong audience, wrong nonce, unverified email, suspended users', async () => {
  await h.reset();
  const bad = async (over, expected) => {
    const a = h.request.agent(h.app);
    const { cb } = await googleRound(a, claims(over));
    assert.equal(cb.headers.location, `/#/login?error=${expected}`);
    assert.equal((await a.get('/api/auth/me')).status, 401);
  };
  await bad({ aud: 'someone-else' }, 'google_failed');
  await bad({ iss: 'https://evil.example' }, 'google_failed');
  await bad({ exp: Math.floor(Date.now() / 1000) - 10 }, 'google_failed');
  await bad({ email_verified: false }, 'google_unverified');
  // nonce from a different login attempt
  const a = h.request.agent(h.app);
  const { cb } = await googleRound(a, () => claims()('some-other-nonce'));
  assert.equal(cb.headers.location, '/#/login?error=google_failed');

  // state that doesn't match the cookie (CSRF / login-fixation attempt)
  const c = h.request.agent(h.app);
  await c.get('/api/auth/google');
  const forged = await c.get('/api/auth/google/callback?code=abc&state=forged');
  assert.equal(forged.headers.location, '/#/login?error=google_expired');
  // no cookie at all
  const d = await h.request(h.app).get('/api/auth/google/callback?code=abc&state=x');
  assert.equal(d.headers.location, '/#/login?error=google_expired');

  const u = await h.makeUser('student', 'Banned', 'banned@uni.test');
  await h.M.User.updateOne({ _id: u._id }, { status: 'suspended' });
  await bad({ sub: 'g-banned', email: 'banned@uni.test' }, 'account_suspended');
  assert.equal(await h.M.User.countDocuments({ email: 'ali.khan@gmail.com' }), 0);
});
