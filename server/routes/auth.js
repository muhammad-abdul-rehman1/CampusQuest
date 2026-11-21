const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const asyncHandler = require('../lib/asyncHandler');
const { z, parse, text } = require('../lib/validate');
const { HttpError, badRequest, unauthorized, forbidden, conflict } = require('../lib/errors');
const { User, AuthToken, StudentProfile, InstructorProfile } = require('../models');
const { authenticate, signToken, setAuthCookie, clearAuthCookie } = require('../middleware/auth');
const config = require('../config');
const settings = require('../services/settings');
const mailer = require('../services/mailer');
const tokens = require('../services/authTokens');
const { audit } = require('../services/audit');
const { publicUser } = require('../lib/serialize');

const router = express.Router();

// ---------------------------------------------------------------- throttling (NFR-012)
const limiter = (limit, windowMin) =>
  rateLimit({
    windowMs: windowMin * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => config.isTest,
    message: { error: 'Too many attempts. Please try again in a few minutes.' }
  });
const authLimiter = limiter(30, 15); // login / reset / verify
const mailLimiter = limiter(8, 60); // anything that sends an email

// ---------------------------------------------------------------- helpers
const emailRule = z.string().trim().toLowerCase().max(160, 'Email is too long.').pipe(z.email('Enter a valid email address.'));
const passwordRule = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(128, 'Password is too long.')
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must include a letter and a number.');

const domainAllowed = (email) => !config.allowedEmailDomains.length || config.allowedEmailDomains.includes(email.split('@')[1]);
const domainError = () => badRequest(`Use your college email address (${config.allowedEmailDomains.map((d) => '@' + d).join(', ')}).`, { fields: { email: 'This email domain is not allowed.' } });

// When SMTP isn't configured on a local development server, hand the link back so the UI can show it.
// Never happens in production (config.js refuses to start without SMTP) or on a non-localhost APP_URL.
const devLinksAllowed = !config.isProd && mailer.mode() === 'console' && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(config.appUrl);
const devExtra = (sent) => (devLinksAllowed && sent && sent.link ? { devLink: sent.link } : {});

async function sendOrFail(to, tpl) {
  try {
    return await mailer.send({ to, ...tpl });
  } catch (err) {
    console.error('[mail] failed to send to', to, '-', err.message);
    throw new HttpError(502, "We couldn't send the email right now. Please try again in a few minutes.");
  }
}

async function createAccount({ name, email, role, passwordHash, googleId }) {
  const cfg = await settings.get();
  let user;
  try {
    user = await User.create({ name, email, role, passwordHash, googleId, emailVerified: true, emailVerifiedAt: new Date() });
  } catch (err) {
    if (err.code === 11000) throw conflict('An account with this email already exists. Log in instead.', { code: 'EMAIL_TAKEN' });
    throw err;
  }
  if (role === 'student') await StudentProfile.create({ userId: user._id, leaderboardVisible: cfg.leaderboardDefaultVisible });
  else await InstructorProfile.create({ userId: user._id });
  return user;
}

async function startSession(res, user) {
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
  setAuthCookie(res, signToken(user));
}

// ---------------------------------------------------------------- public config for the login screens
router.get(
  '/config',
  asyncHandler(async (req, res) => {
    const cfg = await settings.get();
    res.json({
      google: Boolean(config.google.clientId && config.google.clientSecret),
      allowInstructorSignup: cfg.allowInstructorSignup,
      allowedEmailDomains: config.allowedEmailDomains,
      demoAccounts: config.showDemoAccounts
    });
  })
);

// ---------------------------------------------------------------- sign up (step 1: email a verification link)
// No account exists until the link is opened, so an unverified email can never log in.
const registerSchema = z.object({
  name: text(2, 80),
  email: emailRule,
  password: passwordRule,
  role: z.enum(['student', 'instructor']).default('student')
});

router.post(
  '/register',
  mailLimiter,
  asyncHandler(async (req, res) => {
    const data = parse(registerSchema, req.body);
    const cfg = await settings.get();
    if (data.role === 'instructor' && !cfg.allowInstructorSignup) throw forbidden('Instructor sign-up is disabled. Ask an administrator for an account.');
    if (!domainAllowed(data.email)) throw domainError();
    if (await User.exists({ email: data.email })) throw conflict('An account with this email already exists. Log in instead.', { code: 'EMAIL_TAKEN', fields: { email: 'This email is already registered.' } });

    const passwordHash = await bcrypt.hash(data.password, 12);
    const code = tokens.newCode();
    const raw = await tokens.create('signup', { email: data.email, signup: { name: data.name, passwordHash, role: data.role }, code }, config.tokens.signupHours);
    let sent;
    try {
      sent = await sendOrFail(data.email, mailer.templates.signup(data.name, tokens.link('verify', raw), code));
    } catch (err) {
      await tokens.revoke({ email: data.email, purpose: 'signup' });
      throw err;
    }
    res.status(202).json({ ok: true, email: data.email, message: `We sent a verification code and link to ${data.email}.`, ...devExtra(sent) });
  })
);

// ---------------------------------------------------------------- sign up (step 2) / verify email
// Both the emailed link and the 6-digit code end here once their token has been consumed.
async function completeVerification(req, res, t) {
  let user;
  if (t.purpose === 'signup') {
    const existing = await User.findOne({ email: t.email });
    if (existing && existing.emailVerified !== false) throw conflict('This email is already registered. Log in instead.', { code: 'EMAIL_TAKEN' });
    if (existing) {
      // A legacy unverified account with the same address: the person who controls the inbox decides.
      existing.set({ name: t.signup.name, passwordHash: t.signup.passwordHash, emailVerified: true, emailVerifiedAt: new Date(), tokenVersion: (existing.tokenVersion || 0) + 1 });
      await existing.save();
      user = existing;
    } else {
      const cfg = await settings.get();
      if (t.signup.role === 'instructor' && !cfg.allowInstructorSignup) throw forbidden('Instructor sign-up has been disabled. Ask an administrator for an account.');
      user = await createAccount({ name: t.signup.name, email: t.email, role: t.signup.role, passwordHash: t.signup.passwordHash });
    }
    await tokens.revoke({ email: t.email, purpose: 'signup' });
    req.user = user;
    await audit(req, 'auth.signup', 'user', user._id, { role: user.role, method: 'email' });
  } else {
    user = await User.findById(t.userId);
    if (!user || user.email !== t.email) throw badRequest('This verification link is no longer valid.', { code: 'TOKEN_INVALID' });
    user.emailVerified = true;
    user.emailVerifiedAt = new Date();
    await user.save();
    await tokens.revoke({ userId: user._id, purpose: 'verify_email' });
  }
  if (user.status !== 'active') throw forbidden('This account has been suspended or deactivated. Contact an administrator.');
  await startSession(res, user);
  res.json({ user: publicUser(user) });
}

router.post(
  '/verify-email',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { token } = parse(z.object({ token: z.string().min(1, 'Missing token.').max(200) }), req.body);
    const t = await tokens.consume(token, ['signup', 'verify_email']);
    if (!t) throw badRequest('This verification link is invalid, has expired or was already used. Request a new one.', { code: 'TOKEN_INVALID' });
    await completeVerification(req, res, t);
  })
);

// Same as the link, but by typing the 6-digit code from the email (works when the email is read on a phone).
router.post(
  '/verify-code',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email, code } = parse(
      z.object({ email: emailRule, code: z.string().trim().transform((c) => c.replace(/\s+/g, '')).pipe(z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from the email.')) }),
      req.body
    );
    const r = await tokens.consumeCode(email, code, ['signup', 'verify_email']);
    if (r.error === 'locked') throw badRequest('Too many wrong codes. Request a new email and use the newest code.', { code: 'CODE_LOCKED', fields: { code: 'Too many attempts.' } });
    if (r.error) {
      const hint = r.left ? ` ${r.left} ${r.left === 1 ? 'try' : 'tries'} left.` : '';
      throw badRequest(`That code is wrong or has expired.${hint}`, { code: 'CODE_INVALID', fields: { code: 'Wrong or expired code.' } });
    }
    await completeVerification(req, res, r.token);
  })
);

// Re-send a verification link. Same response whether or not anything was sent (no account enumeration).
router.post(
  '/resend-verification',
  mailLimiter,
  asyncHandler(async (req, res) => {
    const { email } = parse(z.object({ email: emailRule }), req.body);
    const body = { ok: true, message: `If ${email} is waiting for verification, we've sent a new code and link. Check your inbox and spam folder.` };
    if ((await tokens.secondsSinceLast(email, ['signup', 'verify_email'])) < 45) return res.json(body);

    let sent = null;
    const code = tokens.newCode();
    const user = await User.findOne({ email });
    if (user) {
      if (user.emailVerified === false && user.status === 'active') {
        const raw = await tokens.create('verify_email', { email, userId: user._id, code }, config.tokens.verifyHours);
        sent = await sendOrFail(email, mailer.templates.verify(user.name, tokens.link('verify', raw), code));
      }
    } else {
      const pending = await AuthToken.findOne({ email, purpose: 'signup', usedAt: null, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).lean();
      if (pending) {
        const raw = await tokens.create('signup', { email, signup: pending.signup, code }, config.tokens.signupHours);
        sent = await sendOrFail(email, mailer.templates.signup(pending.signup.name, tokens.link('verify', raw), code));
      }
    }
    res.json({ ...body, ...devExtra(sent) });
  })
);

// ---------------------------------------------------------------- log in / out
const loginSchema = z.object({ email: z.string().trim().toLowerCase().min(1, 'Enter your email.').max(160), password: z.string().min(1, 'Enter your password.').max(128) });

// A real bcrypt hash used to keep response time similar when the email doesn't exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-1', 10);
const notVerified = () => new HttpError(403, 'Please verify your email first. We can send you a new link.', { code: 'EMAIL_NOT_VERIFIED' });

router.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const user = await User.findOne({ email }).select('+passwordHash');
    const ok = await bcrypt.compare(password, user && user.passwordHash ? user.passwordHash : DUMMY_HASH);

    if (!user) {
      // Signed up but never opened the link? Only say so if the password matches that pending sign-up.
      const pending = await AuthToken.findOne({ email, purpose: 'signup', usedAt: null, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).lean();
      if (pending && (await bcrypt.compare(password, pending.signup.passwordHash))) throw notVerified();
      throw unauthorized('Incorrect email or password.');
    }
    if (!user.passwordHash || !ok) throw unauthorized('Incorrect email or password.');
    if (user.status !== 'active') throw forbidden('This account has been suspended or deactivated. Contact an administrator.');
    if (user.emailVerified === false) throw notVerified();
    await startSession(res, user);
    res.json({ user: publicUser(user) });
  })
);

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({ user: publicUser(req.user) });
  })
);

// ---------------------------------------------------------------- password reset (also used by admin invitations)
router.post(
  '/forgot-password',
  mailLimiter,
  asyncHandler(async (req, res) => {
    const { email } = parse(z.object({ email: emailRule }), req.body);
    const body = { ok: true, message: 'If an account exists for that email, we sent a link to reset the password. Check your inbox and spam folder.' };
    const user = await User.findOne({ email });
    let sent = null;
    if (user && user.status === 'active' && (await tokens.secondsSinceLast(email, ['reset_password'])) >= 45) {
      await tokens.revoke({ userId: user._id, purpose: 'reset_password' });
      const raw = await tokens.create('reset_password', { email, userId: user._id }, config.tokens.resetHours);
      sent = await sendOrFail(email, mailer.templates.reset(user.name, tokens.link('reset', raw)));
    }
    res.json({ ...body, ...devExtra(sent) }); // identical response whether or not the account exists
  })
);

router.get(
  '/reset-password/check',
  authLimiter,
  asyncHandler(async (req, res) => {
    const t = await tokens.peek(String(req.query.token || ''), ['reset_password']);
    res.json(t ? { valid: true, invite: Boolean(t.invite), email: t.email } : { valid: false });
  })
);

router.post(
  '/reset-password',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { token, password } = parse(z.object({ token: z.string().min(1).max(200), password: passwordRule }), req.body);
    const t = await tokens.consume(token, ['reset_password']);
    if (!t) throw badRequest('This link is invalid, has expired or was already used. Request a new one.', { code: 'TOKEN_INVALID' });
    const user = await User.findById(t.userId);
    if (!user || user.email !== t.email) throw badRequest('This link is no longer valid.', { code: 'TOKEN_INVALID' });
    if (user.status !== 'active') throw forbidden('This account has been suspended or deactivated. Contact an administrator.');

    user.passwordHash = await bcrypt.hash(password, 12);
    // Opening the emailed link proves the person controls the inbox.
    if (user.emailVerified !== true) user.emailVerifiedAt = new Date();
    user.emailVerified = true;
    user.tokenVersion = (user.tokenVersion || 0) + 1; // sign out every other session
    await user.save();
    await tokens.revoke({ userId: user._id, purpose: 'reset_password' });
    req.user = user;
    await audit(req, t.invite ? 'auth.invite_accepted' : 'auth.password_reset', 'user', user._id);
    await startSession(res, user);
    res.json({ user: publicUser(user) });
  })
);

// ---------------------------------------------------------------- Continue with Google (OAuth 2.0 + OIDC, PKCE)
// intent=login  (login page):   signs in to an existing account; a Google address with no account is NOT
//                               turned into one silently - the person is asked "Student or Instructor?" first.
// intent=signup (sign-up page): creates the account with the role chosen on that page.
const OAUTH_COOKIE = 'cq_oauth';
const PENDING_COOKIE = 'cq_google_signup';
const oauthCookieOpts = { httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/api/auth/google', maxAge: 10 * 60 * 1000 };
const pendingCookieOpts = { ...oauthCookieOpts, maxAge: 15 * 60 * 1000 };
const PENDING_AUDIENCE = 'campusquest:google-signup';
const googleEnabled = () => Boolean(config.google.clientId && config.google.clientSecret);
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const clearCookie = (res, name, opts) => res.clearCookie(name, { ...opts, maxAge: undefined });

router.get('/google', limiter(30, 15), (req, res) => {
  if (!googleEnabled()) return res.redirect('/#/login?error=google_disabled');
  const state = b64url(crypto.randomBytes(24));
  const nonce = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const intent = req.query.intent === 'signup' ? 'signup' : 'login';
  const role = req.query.role === 'instructor' ? 'instructor' : 'student';
  res.cookie(OAUTH_COOKIE, jwt.sign({ state, nonce, verifier, intent, role }, config.jwtSecret, { expiresIn: '10m', algorithm: 'HS256' }), oauthCookieOpts);
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account'
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

router.get(
  '/google/callback',
  limiter(30, 15),
  asyncHandler(async (req, res) => {
    const fail = (code) => {
      res.clearCookie(OAUTH_COOKIE, { ...oauthCookieOpts, maxAge: undefined });
      return res.redirect(`/#/login?error=${code}`);
    };
    if (!googleEnabled()) return fail('google_disabled');
    if (req.query.error) return fail('google_cancelled');

    let saved;
    try {
      saved = jwt.verify(req.cookies[OAUTH_COOKIE] || '', config.jwtSecret, { algorithms: ['HS256'] });
    } catch {
      return fail('google_expired');
    }
    if (!safeEqual(String(req.query.state || ''), saved.state) || typeof req.query.code !== 'string') return fail('google_expired');

    let claims;
    try {
      const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: req.query.code,
          client_id: config.google.clientId,
          client_secret: config.google.clientSecret,
          redirect_uri: config.google.redirectUri,
          grant_type: 'authorization_code',
          code_verifier: saved.verifier
        }),
        signal: AbortSignal.timeout(10000)
      });
      const data = await r.json();
      if (!r.ok || !data.id_token) throw new Error(data.error_description || data.error || `HTTP ${r.status}`);
      // The ID token came straight from Google's token endpoint over TLS (OIDC Core 3.1.3.7),
      // so its claims are validated here without fetching signing keys.
      claims = JSON.parse(Buffer.from(String(data.id_token).split('.')[1] || '', 'base64url').toString('utf8'));
    } catch (err) {
      console.error('[google] token exchange failed:', err.message);
      return fail('google_failed');
    }

    const now = Math.floor(Date.now() / 1000);
    const validIssuer = ['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss);
    const validAudience = claims.aud === config.google.clientId || (Array.isArray(claims.aud) && claims.aud.includes(config.google.clientId));
    if (!validIssuer || !validAudience || !(claims.exp > now) || !safeEqual(claims.nonce, saved.nonce) || !claims.sub) return fail('google_failed');
    if (claims.email_verified !== true || !claims.email) return fail('google_unverified');

    const email = String(claims.email).toLowerCase();
    const sub = String(claims.sub);
    let user = await User.findOne({ googleId: sub });
    if (!user) {
      user = await User.findOne({ email });
      if (user) {
        // Same verified email at Google: link it to the existing account.
        user.googleId = sub;
        if (user.emailVerified !== true) user.emailVerifiedAt = new Date();
        user.emailVerified = true;
        await user.save();
      } else {
        if (!domainAllowed(email)) return fail('domain_not_allowed');
        const rawName = String(claims.name || email.split('@')[0]).trim().slice(0, 80) || 'Learner';
        const name = rawName.length >= 2 ? rawName : `${rawName} user`;
        if (saved.intent !== 'signup') {
          // Login page, but this Google address has no account yet: ask for the role before creating one.
          clearCookie(res, OAUTH_COOKIE, oauthCookieOpts);
          res.cookie(PENDING_COOKIE, jwt.sign({ gsub: sub, email, name }, config.jwtSecret, { expiresIn: '15m', algorithm: 'HS256', audience: PENDING_AUDIENCE }), pendingCookieOpts);
          return res.redirect('/#/google-signup');
        }
        const cfg = await settings.get();
        const role = saved.role === 'instructor' && cfg.allowInstructorSignup ? 'instructor' : 'student';
        try {
          user = await createAccount({ name, email, role, googleId: sub });
        } catch (err) {
          console.error('[google] could not create account:', err.message);
          return fail('google_failed');
        }
        req.user = user;
        await audit(req, 'auth.signup', 'user', user._id, { role: user.role, method: 'google' });
      }
    }
    if (user.status !== 'active') return fail('account_suspended');

    clearCookie(res, OAUTH_COOKIE, oauthCookieOpts);
    await startSession(res, user);
    res.redirect('/#/');
  })
);

// ---- "Student or Instructor?" step for a new Google user who started from the login page
function readPending(req) {
  try {
    return jwt.verify(req.cookies[PENDING_COOKIE] || '', config.jwtSecret, { algorithms: ['HS256'], audience: PENDING_AUDIENCE });
  } catch {
    return null;
  }
}

router.get(
  '/google/pending',
  asyncHandler(async (req, res) => {
    const p = readPending(req);
    if (!p) return res.json({ pending: false });
    const cfg = await settings.get();
    res.json({ pending: true, email: p.email, name: p.name, allowInstructorSignup: cfg.allowInstructorSignup });
  })
);

router.post(
  '/google/complete',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { role } = parse(z.object({ role: z.enum(['student', 'instructor']) }), req.body);
    const p = readPending(req);
    if (!p) throw badRequest('This Google sign-in has expired. Please click "Continue with Google" again.', { code: 'GOOGLE_PENDING_EXPIRED' });
    const cfg = await settings.get();
    if (role === 'instructor' && !cfg.allowInstructorSignup) throw forbidden('Instructor sign-up is disabled. Ask an administrator for an account.');
    if (!domainAllowed(p.email)) throw domainError();

    // Someone may have created the account meanwhile (e.g. in another tab): just sign in to it.
    let user = (await User.findOne({ googleId: p.gsub }).select('+googleId')) || (await User.findOne({ email: p.email }).select('+googleId'));
    if (user) {
      if (user.googleId !== p.gsub || user.emailVerified !== true) {
        user.googleId = p.gsub; // Google verified this address, so link it (same as the callback does)
        if (user.emailVerified !== true) user.emailVerifiedAt = new Date();
        user.emailVerified = true;
        await user.save();
      }
    } else {
      user = await createAccount({ name: p.name, email: p.email, role, googleId: p.gsub });
      req.user = user;
      await audit(req, 'auth.signup', 'user', user._id, { role: user.role, method: 'google' });
    }
    if (user.status !== 'active') throw forbidden('This account has been suspended or deactivated. Contact an administrator.');
    clearCookie(res, PENDING_COOKIE, pendingCookieOpts);
    await startSession(res, user);
    res.json({ user: publicUser(user) });
  })
);

router.post('/google/cancel', (req, res) => {
  clearCookie(res, PENDING_COOKIE, pendingCookieOpts);
  res.json({ ok: true });
});

module.exports = router;
