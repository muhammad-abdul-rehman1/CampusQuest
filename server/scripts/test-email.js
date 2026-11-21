// Sends one test email using the email settings in .env (Brevo API or SMTP), and explains common failures.
// Usage: npm run mail:test -- you@example.com
const config = require('../config');
const mailer = require('../services/mailer');

async function main() {
  const to = process.argv[2];
  if (!to || !to.includes('@')) {
    console.log('Usage: npm run mail:test -- you@example.com');
    process.exit(1);
  }
  const mode = mailer.mode();
  if (mode === 'console') {
    console.log('No email service is configured in .env, so CampusQuest cannot send email yet. Set either:');
    console.log('  BREVO_API_KEY=<key from Brevo > SMTP & API > API keys>   (works on Render and other hosts that block SMTP)');
    console.log('  or SMTP_HOST=smtp.gmail.com SMTP_PORT=465 SMTP_SECURE=true SMTP_USER=<gmail> SMTP_PASS=<16-letter app password>');
    process.exit(1);
  }
  console.log(mode === 'brevo' ? `Sending through the Brevo API as ${config.mail.from}...` : `Sending through ${config.mail.host}:${config.mail.port} (secure: ${config.mail.secure}) as ${config.mail.user || '(no login)'}...`);
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
    if (mode === 'brevo') {
      if (err.status === 401 && /IP/i.test(err.message)) {
        console.log('Brevo blocked a new IP address. In Brevo: Settings > Security > Authorised IPs, turn IP blocking off');
        console.log('(cloud hosts like Render change IP addresses, so the allow-list cannot be kept up to date).');
      } else if (err.status === 401) {
        console.log('The API key was rejected. Create a new key in Brevo (SMTP & API > API keys) and copy it into BREVO_API_KEY.');
      } else if (/sender/i.test(err.message)) {
        console.log('The sender address is not verified in Brevo. Add and verify the MAIL_FROM address under Senders, Domains & Dedicated IPs > Senders.');
      }
    } else if (/Invalid login|Username and Password not accepted|535/i.test(err.message)) {
      console.log('The username/password was rejected. For Gmail, SMTP_PASS must be an App password');
      console.log('(https://myaccount.google.com/apppasswords, needs 2-step verification), not your normal password.');
    } else if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|ESOCKET|Connection closed|timed out/i.test(`${err.code} ${err.message}`)) {
      console.log('The connection to the mail server keeps dropping. Common causes: an antivirus "mail shield"');
      console.log('(Avast, AVG, Kaspersky, ESET), a VPN/proxy, a slow network, or a host that blocks SMTP ports');
      console.log("(Render's free plan does - use BREVO_API_KEY there). Gmail: port 465 + SMTP_SECURE=true, or 587 + false.");
    } else if (/wrong version number|SSL/i.test(err.message)) {
      console.log('SSL mismatch: use SMTP_SECURE=true with port 465, or SMTP_SECURE=false with port 587.');
    }
    process.exit(1);
  }
}

main();
