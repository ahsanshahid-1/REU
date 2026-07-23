'use strict';

/*
 * Property 12: CSV export excludes the personal statement (Requirement 15.5).
 *
 * For any set of stored applications, the CSV export SHALL exclude the
 * `statement` column while including the other application fields, with every
 * value correctly escaped (each value wrapped in double quotes, embedded quotes
 * doubled). Parsing the CSV back SHALL recover exactly the original non-statement
 * values, confirming the escaping round-trips.
 *
 * `buildApplicationsCsv` is a pure function extracted into lib/core.js, so it is
 * imported and exercised directly without standing up the Express app.
 *
 * Validates: Requirements 15.5
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

const { buildApplicationsCsv } = require('../lib/core');

const NUM_RUNS = 200;

// An independent RFC-4180-style CSV parser. It handles fields wrapped in double
// quotes (with embedded quotes doubled), commas as field separators, and
// newlines that appear either between records or inside quoted fields. Because
// the data cells produced by the export are always quoted, values containing
// commas, quotes, and newlines round-trip through this parser only if they were
// escaped correctly.
function parseCsv(text) {
  const records = [];
  let record = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      record.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  record.push(field);
  records.push(record);
  return records;
}

// Column names: simple identifiers so the (unescaped) header line is
// unambiguous. `statement` is added separately to every row.
const colNameArb = fc
  .stringMatching(/^[a-z][a-z0-9_]{0,15}$/)
  .filter((s) => s.length > 0 && s !== 'statement');

// Values deliberately include the characters that require CSV escaping:
// double quotes, commas, and newlines, plus null/undefined and numbers.
const nastyStringArb = fc
  .array(fc.constantFrom('a', 'b', '"', ',', '\n', '\r', ' ', "'", ';', '0'), {
    maxLength: 12,
  })
  .map((chars) => chars.join(''));
const valueArb = fc.oneof(
  fc.string(),
  nastyStringArb,
  fc.constant(''),
  fc.constant(null),
  fc.constant(undefined),
  fc.integer(),
);

// A table of applications: a fixed set of non-statement columns shared by every
// row (as rows read from a single DB table would be), each row also carrying a
// `statement` field that must be dropped from the export.
const tableArb = fc
  .uniqueArray(colNameArb, { minLength: 1, maxLength: 6 })
  .chain((cols) =>
    fc
      .array(
        fc.record(
          Object.fromEntries(
            [...cols, 'statement'].map((c) => [c, valueArb]),
          ),
        ),
        { minLength: 1, maxLength: 8 },
      )
      .map((rows) => ({ cols, rows })),
  );

const norm = (v) => String(v == null ? '' : v);

test('Feature: reu-recruitment-site, Property 12: CSV export excludes the personal statement', () => {
  // Empty input yields an empty document (matches the endpoint's empty response).
  assert.equal(buildApplicationsCsv([]), '');

  // Anchor example: values with a quote, a comma, and a newline all escape and
  // round-trip; the statement column is dropped.
  {
    const rows = [
      {
        first_name: 'Ada',
        note: 'has "quote", a comma, and\na newline',
        statement: 'SECRET personal statement text',
      },
    ];
    const csv = buildApplicationsCsv(rows);
    assert.ok(!/(^|,)statement(,|$)/m.test(csv.split('\n')[0]));
    assert.ok(!csv.includes('SECRET personal statement text'));
    const parsed = parseCsv(csv);
    assert.deepEqual(parsed[0], ['first_name', 'note']);
    assert.deepEqual(parsed[1], [
      'Ada',
      'has "quote", a comma, and\na newline',
    ]);
  }

  fc.assert(
    fc.property(tableArb, ({ cols, rows }) => {
      const csv = buildApplicationsCsv(rows);
      const parsed = parseCsv(csv);

      // Columns come from the first row's keys, with `statement` removed.
      const expectedCols = Object.keys(rows[0]).filter((c) => c !== 'statement');

      // The header excludes `statement` and includes every other field.
      assert.deepEqual(parsed[0], expectedCols);
      assert.ok(!expectedCols.includes('statement'));
      assert.ok(!parsed[0].includes('statement'));

      // One header record plus one record per data row.
      assert.equal(parsed.length, rows.length + 1);

      // Every non-statement value round-trips exactly through the escaping, and
      // no statement content leaks into the export.
      rows.forEach((row, r) => {
        const dataRecord = parsed[r + 1];
        assert.equal(dataRecord.length, expectedCols.length);
        expectedCols.forEach((c, ci) => {
          assert.equal(dataRecord[ci], norm(row[c]));
        });
      });

      // Structural escaping check: every data cell is wrapped in double quotes
      // with embedded quotes doubled.
      const lines = csv.split('\n');
      let cursor = 1; // skip header
      rows.forEach((row) => {
        // Reconstruct the expected raw line for this row (a row may itself span
        // multiple physical lines when a value contains a newline).
        const expectedCells = expectedCols.map(
          (c) => '"' + norm(row[c]).replace(/"/g, '""') + '"',
        );
        const expectedLine = expectedCells.join(',');
        const physicalLineCount = expectedLine.split('\n').length;
        const actual = lines.slice(cursor, cursor + physicalLineCount).join('\n');
        assert.equal(actual, expectedLine);
        cursor += physicalLineCount;
      });
    }),
    { numRuns: NUM_RUNS },
  );
});
