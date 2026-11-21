// Brevo HTTPS email transport, with a fake fetch (nothing is really sent).
const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers'); // test environment variables
const config = require('../server/config');
const mailer = require('../server/services/mailer');

test('parseFrom understands "Name <email>" and bare addresses', () => {
  assert.deepEqual(mailer.parseFrom('CampusQuest <me@uni.test>'), { name: 'CampusQuest', email: 'me@uni.test' });
  assert.deepEqual(mailer.parseFrom('"Campus Quest" <me@uni.test>'), { name: 'Campus Quest', email: 'me@uni.test' });
  assert.deepEqual(mailer.parseFrom('me@uni.test'), { name: 'CampusQuest', email: 'me@uni.test' });
});

test('tests never really send email, whatever .env says', () => {
  assert.equal(mailer.mode(), 'console');
});

test('sendViaBrevo posts the right request and reports errors clearly', async () => {
  const realFetch = global.fetch;
  const savedKey = config.mail.brevoKey;
  config.mail.brevoKey = 'xkeysib-test';
  let seen = null;
  try {
    global.fetch = async (url, opts) => {
      seen = { url, headers: opts.headers, body: JSON.parse(opts.body) };
      return { ok: true, status: 201, json: async () => ({ messageId: '<abc@brevo>' }) };
    };
    const r = await mailer.sendViaBrevo({ from: 'CampusQuest <me@uni.test>', to: 'you@uni.test', subject: 'Hi', html: '<b>Hi</b>', text: 'Hi' });
    assert.equal(seen.url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(seen.headers['api-key'], 'xkeysib-test');
    assert.deepEqual(seen.body.sender, { name: 'CampusQuest', email: 'me@uni.test' });
    assert.deepEqual(seen.body.to, [{ email: 'you@uni.test' }]);
    assert.equal(seen.body.htmlContent, '<b>Hi</b>');
    assert.match(r.response, /abc@brevo/);

    global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ message: 'Key not found', code: 'unauthorized' }) });
    await assert.rejects(mailer.sendViaBrevo({ from: 'a@b.c', to: 'x@y.z', subject: 's', text: 't' }), (e) => e.status === 401 && e.code === 'EBREVO' && /Key not found/.test(e.message));

    global.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    await assert.rejects(mailer.sendViaBrevo({ from: 'a@b.c', to: 'x@y.z', subject: 's', text: 't' }), (e) => e.code === 'ETRANSIENT'); // retried by sendRaw
  } finally {
    global.fetch = realFetch;
    config.mail.brevoKey = savedKey;
  }
});
