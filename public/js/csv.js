// CSV -> quiz questions. Runs in the browser; the server re-validates every question.

export const TEMPLATE = [
  'type,question,option_a,option_b,option_c,option_d,correct,explanation,points',
  'mcq,Which is a usability heuristic?,Visibility of system status,Random colours,Longer menus,Hidden buttons,A,Users should always know what the system is doing.,1',
  'mcq,"Which of these is NOT a stack operation?",push,pop,peek,enqueue,D,enqueue belongs to queues.,1',
  'tf,Good error messages should blame the user.,,,,,False,Good messages explain the problem and how to fix it.,1'
].join('\n');

export const AI_PROMPT = `Create 10 quiz questions about [YOUR TOPIC] as a CSV file with exactly this header:
type,question,option_a,option_b,option_c,option_d,correct,explanation,points
Rules:
- type is mcq (multiple choice) or tf (true/false).
- For mcq fill option_a to option_d (at least two) and put the correct letter (A, B, C or D) in "correct".
- For tf leave the option columns empty and put True or False in "correct".
- Add a one-sentence explanation. points is a whole number (use 1).
- Wrap any text that contains a comma in double quotes.
- Output only the CSV, with no extra commentary.`;

// RFC-4180-ish parser: quotes, escaped quotes (""), commas/semicolons/tabs, newlines inside quotes, BOM.
export function parseCsv(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const delim = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQ) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIAS = { type: 'type', questiontype: 'type', question: 'text', text: 'text', questiontext: 'text', correct: 'correct', correctanswer: 'correct', answer: 'correct', explanation: 'explanation', feedback: 'explanation', points: 'points', marks: 'points', score: 'points' };

// Returns { questions, errors } where errors are { row, message } (row = line number in the file).
export function toQuestions(rows) {
  const errors = [];
  const questions = [];
  if (rows.length < 2) return { questions, errors: [{ row: 1, message: 'The file needs a header row and at least one question.' }] };

  const col = {};
  const optCols = [];
  rows[0].forEach((h, i) => {
    const n = norm(h);
    const m = /^(?:option|choice)?([a-f])$/.exec(n) || /^(?:option|choice)([1-6])$/.exec(n);
    if (m && (n.startsWith('option') || n.startsWith('choice') || n.length === 1)) optCols[/\d/.test(m[1]) ? Number(m[1]) - 1 : 'abcdef'.indexOf(m[1])] = i;
    else if (ALIAS[n] && col[ALIAS[n]] === undefined) col[ALIAS[n]] = i;
  });
  if (col.text === undefined) return { questions, errors: [{ row: 1, message: 'Missing a "question" column in the header row.' }] };
  if (col.correct === undefined) return { questions, errors: [{ row: 1, message: 'Missing a "correct" column in the header row.' }] };

  const get = (r, i) => (i === undefined ? '' : String(r[i] ?? '').trim());
  rows.slice(1).forEach((r, idx) => {
    const row = idx + 2;
    const text = get(r, col.text);
    if (!text) { errors.push({ row, message: 'The question text is empty.' }); return; }
    const opts = [];
    optCols.forEach((ci, letterIdx) => { const v = get(r, ci); if (v) opts.push({ letter: 'ABCDEF'[letterIdx], text: v }); });
    const typeRaw = norm(get(r, col.type));
    const correctRaw = get(r, col.correct);
    const cn = norm(correctRaw);
    const isTf = /^(tf|truefalse|boolean|bool)$/.test(typeRaw) || (!typeRaw && opts.length === 0);
    const q = { text, explanation: get(r, col.explanation) };
    const pts = parseInt(get(r, col.points), 10);
    if (Number.isFinite(pts)) q.points = Math.max(1, Math.min(100, pts));

    if (isTf) {
      if (['true', 't', 'yes'].includes(cn)) q.correctAnswer = 0;
      else if (['false', 'f', 'no'].includes(cn)) q.correctAnswer = 1;
      else { errors.push({ row, message: `True/false questions need "correct" to be True or False (got "${correctRaw}").` }); return; }
      q.type = 'tf';
    } else {
      if (opts.length < 2) { errors.push({ row, message: 'Multiple-choice questions need at least 2 options.' }); return; }
      if (new Set(opts.map((o) => o.text.toLowerCase())).size !== opts.length) { errors.push({ row, message: 'Options must be different from each other.' }); return; }
      let idx = opts.findIndex((o) => o.letter.toLowerCase() === cn);
      if (idx < 0 && /^[1-6]$/.test(cn)) idx = Number(cn) - 1; // 1-based number
      if (idx < 0) idx = opts.findIndex((o) => norm(o.text) === cn); // full option text
      if (idx < 0 || idx >= opts.length) { errors.push({ row, message: `Could not match the correct answer "${correctRaw}" to an option (use A, B, C or D).` }); return; }
      q.type = 'mcq';
      q.options = opts.map((o) => o.text);
      q.correctAnswer = idx;
    }
    if (q.text.length > 600) { errors.push({ row, message: 'The question is longer than 600 characters.' }); return; }
    questions.push(q);
  });
  return { questions, errors };
}

export async function readQuestionsFile(file) {
  if (!file) return { questions: [], errors: [{ row: 0, message: 'Choose a CSV file first.' }] };
  if (file.size > 200 * 1024) return { questions: [], errors: [{ row: 0, message: 'That file is too large (max 200 KB).' }] };
  const result = toQuestions(parseCsv(await file.text()));
  if (result.questions.length > 100) { result.errors.push({ row: 0, message: 'A quiz import can hold at most 100 questions; only the first 100 will be used.' }); result.questions.length = 100; }
  return result;
}

export function downloadTemplate() {
  const blob = new Blob(['﻿' + TEMPLATE], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'campusquest-quiz-template.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
