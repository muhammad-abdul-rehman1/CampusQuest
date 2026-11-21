// Vercel entry point. Every /api/* request (plus the /verify and /reset email links) runs the Express app.
// Static files in public/ are served by Vercel's CDN. The database connection is opened once per
// warm instance and reused by later requests.
const app = require('../server/app');
const db = require('../server/db');
const { ensureDefaults } = require('../server/services/defaults');

let ready = null;
function init() {
  if (!ready) {
    ready = db
      .connect()
      .then(() => ensureDefaults())
      .catch((err) => {
        ready = null; // try again on the next request
        throw err;
      });
  }
  return ready;
}

module.exports = async (req, res) => {
  try {
    await init();
  } catch (err) {
    console.error('[startup] could not connect to the database:', err.message);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'The server could not reach the database. Please try again in a moment.' }));
    return;
  }
  return app(req, res);
};
