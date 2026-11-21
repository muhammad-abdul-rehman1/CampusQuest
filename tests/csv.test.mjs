import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toQuestions, TEMPLATE } from '../public/js/csv.js';

test('template parses into 3 valid questions', () => {
  const r = toQuestions(parseCsv(TEMPLATE));
  assert.equal(r.errors.length, 0);
  assert.equal(r.questions.length, 3);
  assert.equal(r.questions[0].correctAnswer, 0);
  assert.equal(r.questions[1].correctAnswer, 3);
  assert.equal(r.questions[2].type, 'tf');
  assert.equal(r.questions[2].correctAnswer, 1);
});

test('handles quotes, commas, newlines in cells, BOM, CRLF and semicolons', () => {
  const csv = '﻿Question;Option A;Option B;Correct\r\n"Pick, one; ""now""";Yes;No;B\r\n';
  const r = toQuestions(parseCsv(csv));
  assert.equal(r.errors.length, 0);
  assert.equal(r.questions[0].text, 'Pick, one; "now"');
  assert.deepEqual(r.questions[0].options, ['Yes', 'No']);
  assert.equal(r.questions[0].correctAnswer, 1);
});

test('reports bad rows but keeps good ones', () => {
  const csv = 'type,question,option_a,option_b,correct\nmcq,Q1,a,b,C\nmcq,Q2,a,b,A\ntf,Q3,,,maybe\nmcq,,a,b,A';
  const r = toQuestions(parseCsv(csv));
  assert.equal(r.questions.length, 1);
  assert.deepEqual(r.errors.map((e) => e.row), [2, 4, 5]);
});

test('missing columns give a clear error', () => {
  assert.match(toQuestions(parseCsv('foo,bar\n1,2')).errors[0].message, /question/);
});
