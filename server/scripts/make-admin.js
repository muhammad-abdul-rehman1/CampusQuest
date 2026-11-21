// Gives an existing, verified account the admin role.
//   npm run make-admin -- you@example.com           -> local database (MONGO_URI in .env)
//   npm run make-admin -- you@example.com --prod    -> live database (MONGO_URI in .env.production)
// Sign up on the site first; this only changes the role of an account that already exists.
const path = require('path');
const { readEnvFile } = require('./envfile');

const args = process.argv.slice(2);
const prod = args.includes('--prod');
const email = (args.find((a) => a.includes('@')) || '').trim().toLowerCase();

if (prod) {
  const p = readEnvFile(path.join(__dirname, '..', '..', '.env.production'));
  if (!p.MONGO_URI) {
    console.log('MONGO_URI is empty in .env.production. Paste your MongoDB Atlas connection string there first.');
    process.exit(1);
  }
  process.env.MONGO_URI = p.MONGO_URI; // set before config.js loads .env, so it wins
}

const config = require('../config');
const db = require('../db');
const { User, AuditLog } = require('../models');

async function main() {
  if (!email) {
    console.log('Usage: npm run make-admin -- you@example.com [--prod]');
    process.exit(1);
  }
  await db.mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 15000 });
  console.log(`Connected to the ${prod ? 'LIVE' : 'local'} database "${db.mongoose.connection.name}".`);
  const user = await User.findOne({ email });
  if (!user) {
    console.log(`No account uses ${email} yet. Sign up on the site with that email (and verify it), then run this again.`);
  } else if (user.role === 'admin') {
    console.log(`${user.name} <${email}> is already an admin.`);
  } else {
    const from = user.role;
    user.role = 'admin';
    await user.save();
    await AuditLog.create({ actorName: 'make-admin script', action: 'user.update', targetType: 'user', targetId: String(user._id), details: { role: { from, to: 'admin' } } });
    console.log(`${user.name} <${email}> is now an admin (was ${from}). Log out and in again to see the admin screens.`);
  }
  await db.disconnect();
}

main().catch(async (err) => {
  console.error('Failed:', err.message);
  try { await db.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
