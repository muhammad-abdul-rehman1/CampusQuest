const jwt = require('jsonwebtoken');
const config = require('../config');
const { User } = require('../models');
const { unauthorized, forbidden } = require('../lib/errors');
const asyncHandler = require('../lib/asyncHandler');

function signToken(user) {
  return jwt.sign({ sub: String(user._id), ver: user.tokenVersion || 0 }, config.jwtSecret, { expiresIn: config.jwtExpiresIn, algorithm: 'HS256' });
}

function setAuthCookie(res, token) {
  res.cookie(config.cookieName, token, {
    httpOnly: true, // not readable by page scripts (NFR-015)
    sameSite: 'lax',
    secure: config.isProd, // HTTPS only in production (NFR-011)
    maxAge: 7 * 24 * 3600 * 1000,
    path: '/'
  });
}

function clearAuthCookie(res) {
  res.clearCookie(config.cookieName, { httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/' });
}

// Loads the user fresh from the DB on every request so suspensions and role changes apply immediately.
const authenticate = asyncHandler(async (req, res, next) => {
  if (req.user) return next(); // already authenticated by an earlier router in this request
  let token = req.cookies && req.cookies[config.cookieName];
  const header = req.headers.authorization;
  if (!token && header && header.startsWith('Bearer ')) token = header.slice(7);
  if (!token) throw unauthorized();

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    clearAuthCookie(res);
    throw unauthorized('Your session has expired. Please log in again.');
  }
  const user = await User.findById(payload.sub).lean();
  if (!user) throw unauthorized('Account not found.');
  // Sessions issued before a password change/reset are no longer valid.
  if ((payload.ver || 0) !== (user.tokenVersion || 0)) {
    clearAuthCookie(res);
    throw unauthorized('Your session has expired. Please log in again.');
  }
  if (user.emailVerified === false) {
    clearAuthCookie(res);
    throw unauthorized('Please verify your email address first.');
  }
  if (user.status !== 'active') {
    clearAuthCookie(res);
    throw forbidden('This account is not active. Contact an administrator.');
  }
  req.user = user;
  next();
});

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) return next(forbidden());
  next();
};

module.exports = { authenticate, requireRole, signToken, setAuthCookie, clearAuthCookie };
