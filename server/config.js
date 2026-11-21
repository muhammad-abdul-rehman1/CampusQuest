require('dotenv').config({ quiet: true });

const env = process.env;
// Vercel deployments count as production even if NODE_ENV was not set explicitly.
const isProd = env.NODE_ENV === 'production' || (env.VERCEL === '1' && env.NODE_ENV !== 'test');
const port = Number(env.PORT) || 3000;

if (isProd && (!env.JWT_SECRET || env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET must be set to a long random string in production.');
}
if (isProd && !env.SMTP_HOST && !env.BREVO_API_KEY) {
  throw new Error('Set BREVO_API_KEY (or SMTP_HOST + SMTP_USER + SMTP_PASS) and MAIL_FROM in production so verification emails can be sent.');
}
// Hosts provide the public address automatically: Render as RENDER_EXTERNAL_URL (https://...),
// Vercel as VERCEL_PROJECT_PRODUCTION_URL (domain only, e.g. campusquest.vercel.app).
const publicUrl = env.APP_URL || env.RENDER_EXTERNAL_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
if (isProd && !publicUrl) {
  throw new Error('APP_URL must be set in production (e.g. https://campusquest.example.edu). It is used in email links and the Google redirect.');
}

const appUrl = (publicUrl || `http://localhost:${port}`).replace(/\/+$/, '');

module.exports = {
  isProd,
  isTest: env.NODE_ENV === 'test',
  port,
  appUrl,
  mongoUri: env.MONGO_URI || 'mongodb://127.0.0.1:27017/campusquest',
  jwtSecret: env.JWT_SECRET || 'dev-only-insecure-secret-change-me',
  jwtExpiresIn: '7d',
  cookieName: 'cq_token',
  timezone: env.APP_TIMEZONE || 'Asia/Karachi',

  // Outgoing email. Without SMTP_HOST (development only) emails are printed to the server console.
  mail: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT) || 587,
    secure: env.SMTP_SECURE === 'true' || Number(env.SMTP_PORT) === 465,
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || 'CampusQuest <no-reply@campusquest.local>',
    brevoKey: env.BREVO_API_KEY || ''
  },

  // How many reverse proxies sit in front of the app (Render, Railway, Heroku: 1). Used for client IPs in rate limits.
  trustProxy: /^\d+$/.test(env.TRUST_PROXY || '') ? Number(env.TRUST_PROXY) : env.TRUST_PROXY === 'true' ? true : 1,

  // "Continue with Google" (OAuth 2.0 / OpenID Connect). Disabled unless both values are set.
  google: {
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: `${appUrl}/api/auth/google/callback`
  },

  // Optional: only allow sign-up from these email domains, e.g. "uni.edu.pk,student.uni.edu.pk". Empty = any domain.
  allowedEmailDomains: (env.ALLOWED_EMAIL_DOMAINS || '')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean),

  // Show the seeded demo accounts on the login page (never in production).
  showDemoAccounts: !isProd && env.SHOW_DEMO_ACCOUNTS === 'true',

  tokens: {
    signupHours: 24,
    verifyHours: 24,
    resetHours: 1,
    inviteHours: 72
  }
};
