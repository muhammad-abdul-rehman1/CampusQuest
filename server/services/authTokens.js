// One-time email links (sign-up verification, email verification, password reset / invitation).
// The raw token only ever exists in the email; the database keeps a SHA-256 hash.
// Verification emails also carry a 6-digit code, stored as an HMAC and limited to a few attempts.
const crypto = require('crypto');
const config = require('../config');
const { AuthToken } = require('../models');

const MAX_CODE_ATTEMPTS = 5;

const hash = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');
const codeHash = (email, code) => crypto.createHmac('sha256', config.jwtSecret).update(`${email}:${code}`).digest('hex');
const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

async function create(purpose, { email, userId, signup, invite = false, code }, hours) {
  const raw = crypto.randomBytes(32).toString('base64url');
  await AuthToken.create({
    purpose,
    tokenHash: hash(raw),
    email,
    userId,
    signup,
    invite,
    codeHash: code ? codeHash(email, code) : undefined,
    expiresAt: new Date(Date.now() + hours * 3600 * 1000)
  });
  return raw;
}

const liveFilter = (purposes) => ({ purpose: { $in: purposes }, usedAt: null, expiresAt: { $gt: new Date() } });

// Atomically marks the token used, so a link can never be redeemed twice (even by parallel requests).
async function consume(raw, purposes) {
  if (typeof raw !== 'string' || raw.length < 20 || raw.length > 200) return null;
  return AuthToken.findOneAndUpdate({ tokenHash: hash(raw), ...liveFilter(purposes) }, { $set: { usedAt: new Date() } }, { new: true }).lean();
}

// Redeem by email + 6-digit code. Every wrong guess counts against all of that address's live codes.
// Returns { token } on success, or { error: 'invalid' | 'locked' }.
async function consumeCode(email, code, purposes) {
  const live = await AuthToken.find({ email, codeHash: { $exists: true }, ...liveFilter(purposes) }).lean();
  const usable = live.filter((t) => t.attempts < MAX_CODE_ATTEMPTS);
  if (!usable.length) return { error: live.length ? 'locked' : 'invalid' };
  const want = Buffer.from(codeHash(email, code));
  const match = usable.find((t) => crypto.timingSafeEqual(Buffer.from(t.codeHash), want));
  if (!match) {
    await AuthToken.updateMany({ _id: { $in: usable.map((t) => t._id) } }, { $inc: { attempts: 1 } });
    const left = MAX_CODE_ATTEMPTS - (Math.max(...usable.map((t) => t.attempts)) + 1);
    return { error: left > 0 ? 'invalid' : 'locked', left };
  }
  const token = await AuthToken.findOneAndUpdate({ _id: match._id, usedAt: null }, { $set: { usedAt: new Date() } }, { new: true }).lean();
  return token ? { token } : { error: 'invalid' };
}

// Look up without consuming (to show "this link has expired" before the user types a password).
async function peek(raw, purposes) {
  if (typeof raw !== 'string' || raw.length < 20 || raw.length > 200) return null;
  return AuthToken.findOne({ tokenHash: hash(raw), ...liveFilter(purposes) }).lean();
}

async function revoke(filter) {
  await AuthToken.updateMany({ ...filter, usedAt: null }, { $set: { usedAt: new Date() } });
}

// Seconds since the most recent link of this kind was sent to the address (for resend throttling).
async function secondsSinceLast(email, purposes) {
  const last = await AuthToken.findOne({ email, purpose: { $in: purposes } }).sort({ createdAt: -1 }).lean();
  return last ? (Date.now() - last.createdAt.getTime()) / 1000 : Infinity;
}

// Plain paths (no "#") survive email clients that rewrite or strip URL fragments; app.js redirects
// them into the single-page app. Opening the link only redirects - the token is spent by a POST.
const link = (page, raw) => `${config.appUrl}/${page}?token=${raw}`;

module.exports = { create, consume, consumeCode, peek, revoke, secondsSinceLast, link, newCode, MAX_CODE_ATTEMPTS };
