const config = require('./config');
const db = require('./db');
require('./models');
const app = require('./app');
const { ensureDefaults } = require('./services/defaults');
const scheduler = require('./services/scheduler');

async function main() {
  await db.connect();
  await ensureDefaults();
  const server = app.listen(config.port, () => {
    console.log(`CampusQuest running at http://localhost:${config.port}  (${config.isProd ? 'production' : 'development'})`);
    console.log(
      config.mail.brevoKey
        ? `  Email:  sending through the Brevo API as ${config.mail.from}`
        : config.mail.host
          ? `  Email:  sending through ${config.mail.host}:${config.mail.port} as ${config.mail.from}`
          : '  Email:  NOT SENDING - set BREVO_API_KEY or SMTP_HOST in .env; until then emails are only printed here'
    );
    console.log(`  URL:    ${config.appUrl} (used in email links)`);
    console.log(
      config.google.clientId && config.google.clientSecret
        ? `  Google: enabled - redirect URI must be ${config.google.redirectUri}`
        : '  Google: disabled - set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env to show "Continue with Google"'
    );
  });
  scheduler.start();

  const shutdown = async () => {
    scheduler.stop();
    server.close();
    await db.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start CampusQuest:', err.message);
  process.exit(1);
});
