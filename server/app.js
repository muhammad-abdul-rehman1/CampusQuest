const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { HttpError } = require('./lib/errors');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'script-src': ["'self'"],
        'style-src': ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"], // inline style attributes are used for dynamic progress bars
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'frame-ancestors': ["'none'"],
        'upgrade-insecure-requests': config.isProd ? [] : null
      }
    },
    strictTransportSecurity: config.isProd
  })
);
app.use(express.json({ limit: '300kb' }));
app.use(cookieParser());

// Basic CSRF defence on top of SameSite cookies: browsers send Origin on cross-site writes.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      host = null;
    }
    if (host !== req.headers.host) return res.status(403).json({ error: 'Cross-site request blocked.' });
  }
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true, name: 'CampusQuest', time: new Date().toISOString() }));

// Daily deadline reminders when hosted on Vercel (its cron sends "Authorization: Bearer <CRON_SECRET>").
// On a normal server the in-process scheduler (services/scheduler.js) does this instead.
app.get('/api/cron/reminders', async (req, res) => {
  const secret = process.env.CRON_SECRET || '';
  const given = String(req.headers.authorization || '');
  const expected = `Bearer ${secret}`;
  const ok = secret.length >= 16 && given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return res.status(401).json({ error: 'Unauthorized.' });
  const created = await require('./services/scheduler').runDeadlineReminders();
  res.json({ ok: true, created });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/courses', require('./routes/courses'));
app.use('/api', require('./routes/content'));
app.use('/api', require('./routes/quizzes'));
app.use('/api/quests', require('./routes/quests'));
app.use('/api/gamification', require('./routes/gamification'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/instructor', require('./routes/instructor'));
app.use('/api/admin', require('./routes/admin'));

app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));

// Email links: /verify?token=... and /reset?token=... -> the matching page inside the app.
app.get(['/verify', '/reset'], (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  const token = String(req.query.token || '');
  const page = req.path.slice(1);
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) return res.redirect(`/#/${page}?token=invalid`);
  res.redirect(`/#/${page}?token=${token}`);
});

app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'], maxAge: config.isProd ? '1h' : 0 }));

// Central error handler: consistent JSON, no stack traces to clients (NFR-012).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON in request body.' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
  if (err && err.name === 'CastError') return res.status(400).json({ error: 'Invalid identifier.' });
  if (err && err.name === 'ValidationError') return res.status(400).json({ error: Object.values(err.errors)[0].message });
  if (err && err.code === 11000) return res.status(409).json({ error: 'That record already exists.' });
  console.error('[error]', req.method, req.originalUrl, err);
  res.status(500).json({ error: 'Something went wrong on our side. Your data was not changed.' });
});

module.exports = app;
