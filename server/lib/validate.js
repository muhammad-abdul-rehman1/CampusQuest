const { z } = require('zod');
const mongoose = require('mongoose');
const { badRequest } = require('./errors');

const objectId = z.string().refine((v) => mongoose.isValidObjectId(v) && String(v).length === 24, 'Invalid id');

// Parse + validate. On failure throws a 400 with per-field messages (FR-009, NFR-010).
function parse(schema, data) {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const fields = {};
    for (const issue of r.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    const first = Object.values(fields)[0];
    throw badRequest(first || 'Invalid input.', { fields });
  }
  return r.data;
}

function validId(id) {
  return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id);
}

// Strip whitespace + control characters from free text. Output is also escaped by the client.
const text = (min, max) =>
  z
    .string()
    .trim()
    .min(min, min === 1 ? 'This field is required.' : `Must be at least ${min} characters.`)
    .max(max, `Must be at most ${max} characters.`);

module.exports = { z, parse, objectId, validId, text };
