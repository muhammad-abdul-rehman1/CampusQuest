// Minimal KEY=VALUE reader for .env-style files (comments and blank lines ignored, values trimmed).
const fs = require('fs');

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const key = t.slice(0, t.indexOf('=')).trim();
    let value = t.slice(t.indexOf('=') + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (/^[A-Z0-9_]+$/i.test(key)) out[key] = value;
  }
  return out;
}

module.exports = { readEnvFile };
