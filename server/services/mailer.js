// Outgoing email.
//  - SMTP_HOST set   -> real delivery through SMTP (Gmail, Brevo, SendGrid, Mailgun, Resend, Office 365, ...)
//  - not set (dev)   -> the email is printed to the server console so you can click the link
//  - tests           -> captured in `outbox` (also in dev console mode, for convenience)
const nodemailer = require('nodemailer');
const config = require('../config');

const outbox = [];
let transport = null;

// Tests always use the in-memory outbox, even if a real SMTP server is configured in .env.
const mode = () => (config.mail.host && !config.isTest ? 'smtp' : 'console');

function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
      connectionTimeout: 20000,
      greetingTimeout: 15000,
      socketTimeout: 30000
    });
  }
  return transport;
}

// Network hiccups (dropped connection, timeout, slow DNS) are retried; wrong passwords etc. are not.
const TRANSIENT = /Connection closed|ECONNRESET|ETIMEDOUT|ESOCKET|ECONNECTION|EDNS|timed out|ECONNREFUSED|EPIPE/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sendRaw(message, attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      return await getTransport().sendMail(message);
    } catch (err) {
      const transient = TRANSIENT.test(`${err.code || ''} ${err.message}`);
      if (!transient || i >= attempts) throw err;
      console.warn(`[mail] attempt ${i} failed (${err.message}), retrying...`);
      await sleep(1500 * i);
    }
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Simple, widely compatible HTML email with a plain-text alternative.
function layout({ heading, intro, button, link, outro, code }) {
  const codeHtml = code
    ? `<tr><td style="font-size:14px;color:#6b6a7b;padding-bottom:6px">Your verification code</td></tr>
      <tr><td style="padding-bottom:20px"><div style="display:inline-block;font-size:30px;font-weight:700;letter-spacing:8px;background:#f0eefe;color:#1c1b29;padding:10px 18px;border-radius:10px;font-family:Consolas,Menlo,monospace">${escapeHtml(code)}</div></td></tr>
      <tr><td style="font-size:14px;color:#6b6a7b;padding-bottom:12px">Type this code on the CampusQuest screen, or open the link on the device you signed up from:</td></tr>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f8;font-family:Segoe UI,Arial,sans-serif;color:#1c1b29">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;padding:32px">
      <tr><td style="font-size:20px;font-weight:700;color:#5b4fe0;padding-bottom:20px">&#9889; CampusQuest</td></tr>
      <tr><td style="font-size:22px;font-weight:700;padding-bottom:12px">${escapeHtml(heading)}</td></tr>
      <tr><td style="font-size:15px;line-height:1.6;padding-bottom:24px">${escapeHtml(intro)}</td></tr>
      ${codeHtml}
      <tr><td style="padding-bottom:24px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#5b4fe0;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px">${escapeHtml(button)}</a></td></tr>
      <tr><td style="font-size:13px;line-height:1.6;color:#6b6a7b;padding-bottom:8px">If the button doesn't work, copy this link into your browser:<br><span style="word-break:break-all">${escapeHtml(link)}</span></td></tr>
      <tr><td style="font-size:13px;line-height:1.6;color:#6b6a7b">${escapeHtml(outro)}</td></tr>
    </table>
  </td></tr></table></body></html>`;
  const text = `${heading}\n\n${intro}\n\n${code ? `Your verification code: ${code}\n\n` : ''}${button}: ${link}\n\n${outro}\n\n- CampusQuest`;
  return { html, text };
}

async function send({ to, subject, heading, intro, button, link, outro, code }) {
  const { html, text } = layout({ heading, intro, button, link, outro, code });
  const message = { from: config.mail.from, to, subject, html, text };
  if (mode() === 'smtp') {
    await sendRaw(message);
    return { delivered: true };
  }
  outbox.push({ to, subject, text, link, code, at: new Date() });
  if (outbox.length > 50) outbox.shift();
  if (!config.isTest) console.log(`\n[email -> ${to}] ${subject}\n  ${link}${code ? `\n  code: ${code}` : ''}\n  (SMTP is not configured, so this email was only printed here.)\n`);
  return { delivered: false, link };
}

const templates = {
  signup: (name, link, code) => ({
    subject: `${code} is your CampusQuest verification code`,
    heading: `Welcome, ${name}!`,
    intro: 'Confirm this is your email address to create your CampusQuest account. The code and link work once and expire in 24 hours.',
    button: 'Verify email and create account',
    link,
    code,
    outro: "If you didn't try to sign up, ignore this email and no account will be created. Never share this code with anyone."
  }),
  verify: (name, link, code) => ({
    subject: `${code} is your CampusQuest verification code`,
    heading: `Hi ${name},`,
    intro: 'Please confirm your email address to finish setting up your CampusQuest account. The code and link expire in 24 hours.',
    button: 'Verify email',
    link,
    code,
    outro: "If you didn't request this, you can ignore this email. Never share this code with anyone."
  }),
  reset: (name, link) => ({
    subject: 'Reset your CampusQuest password',
    heading: `Hi ${name},`,
    intro: 'We received a request to reset your password. The link works once and expires in 1 hour.',
    button: 'Choose a new password',
    link,
    outro: "If you didn't ask for this, ignore this email - your password stays the same."
  }),
  invite: (name, link, role) => ({
    subject: "You've been invited to CampusQuest",
    heading: `Hi ${name},`,
    intro: `An administrator created a CampusQuest ${role} account for you. Choose a password to activate it. The link expires in 72 hours.`,
    button: 'Set your password',
    link,
    outro: "If you weren't expecting this, you can ignore this email."
  })
};

module.exports = { send, sendRaw, templates, outbox, mode };
