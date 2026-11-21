// Sends one test email using the SMTP settings in .env, and explains common failures.
// Usage: npm run mail:test -- you@example.com
const config = require('../config');
const mailer = require('../services/mailer');

async function main() {
  const to = process.argv[2];
  if (!to || !to.includes('@')) {
    console.log('Usage: npm run mail:test -- you@example.com');
    process.exit(1);
  }
  if (!config.mail.host) {
    console.log('SMTP_HOST is empty in .env, so CampusQuest cannot send email yet.');
    console.log('For Gmail set: SMTP_HOST=smtp.gmail.com  SMTP_PORT=465  SMTP_SECURE=true  SMTP_USER=<your gmail>  SMTP_PASS=<16-letter app password>');
    process.exit(1);
  }
  console.log(`Sending through ${config.mail.host}:${config.mail.port} (secure: ${config.mail.secure}) as ${config.mail.user || '(no login)'}...`);
  try {
    // Same code path (with retries) the app uses for real emails.
    const info = await mailer.sendRaw({
      from: config.mail.from,
      to,
      subject: 'CampusQuest test email',
      text: 'If you can read this, CampusQuest can send verification and password-reset emails.'
    });
    console.log(`Sent to ${to} (${info.response}). Check the inbox (and spam folder).`);
  } catch (err) {
    console.log(`\nFailed: ${err.message}\n`);
    if (/Invalid login|Username and Password not accepted|535/i.test(err.message)) {
      console.log('The username/password was rejected. For Gmail, SMTP_PASS must be an App password');
      console.log('(https://myaccount.google.com/apppasswords, needs 2-step verification), not your normal password.');
    } else if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|ESOCKET|Connection closed|timed out/i.test(`${err.code} ${err.message}`)) {
      console.log('The connection to the mail server keeps dropping. Common causes on Windows: an antivirus "mail shield"');
      console.log('(Avast, AVG, Kaspersky, ESET) scanning outgoing email, a VPN/proxy, or a slow network. Try again, or pause the mail shield.');
      console.log('Could not reach the mail server. Check SMTP_HOST/SMTP_PORT, and that your network or antivirus is not blocking it.');
      console.log('Gmail: port 465 with SMTP_SECURE=true, or port 587 with SMTP_SECURE=false.');
    } else if (/wrong version number|SSL/i.test(err.message)) {
      console.log('SSL mismatch: use SMTP_SECURE=true with port 465, or SMTP_SECURE=false with port 587.');
    }
    process.exit(1);
  }
}

main();
