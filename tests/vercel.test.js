// The Vercel entry point (api/index.js) and the cron endpoint, exercised like Vercel would call them.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

test.before(() => h.start());
test.after(() => h.stop());

test('api/index.js serves the API through one handler (DB connected on first request)', async () => {
  const handler = require('../api/index');
  const health = await h.request(handler).get('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  const cfg = await h.request(handler).get('/api/auth/config');
  assert.equal(cfg.status, 200);
  const reg = await h.request(handler).post('/api/auth/register').send({ name: 'Vercel User', email: 'vercel@uni.test', password: 'Secret123' });
  assert.equal(reg.status, 202);
  const link = await h.request(handler).get('/verify?token=abcdefghijklmnopqrstuvwxyz');
  assert.equal(link.status, 302);
});

test('cron endpoint needs the CRON_SECRET bearer token', async () => {
  const saved = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'cron-secret-for-tests-123456';
  try {
    assert.equal((await h.request(h.app).get('/api/cron/reminders')).status, 401);
    assert.equal((await h.request(h.app).get('/api/cron/reminders').set('Authorization', 'Bearer wrong')).status, 401);
    const ok = await h.request(h.app).get('/api/cron/reminders').set('Authorization', 'Bearer cron-secret-for-tests-123456');
    assert.equal(ok.status, 200);
    assert.equal(ok.body.ok, true);
    delete process.env.CRON_SECRET;
    assert.equal((await h.request(h.app).get('/api/cron/reminders').set('Authorization', 'Bearer ')).status, 401); // no secret configured = always refused
  } finally {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  }
});
