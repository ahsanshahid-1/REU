'use strict';

/*
 * Content-presence tests for the Overview page (`public/index.html`).
 *
 * These assert that Requirement 1 content is actually present on the Overview
 * page. They are content-presence checks (not property tests): the page is
 * parsed once with node-html-parser and each Req 1 element is asserted to be
 * present as text or as structure.
 *
 * Covers Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('node-html-parser');

const INDEX_PATH = path.join(__dirname, '..', 'public', 'index.html');

const rawHtml = fs.readFileSync(INDEX_PATH, 'utf8');
const root = parse(rawHtml);

// Normalized, entity-decoded, lowercased full-text view of the page for
// text-presence assertions. Whitespace is collapsed so phrases split across
// line breaks in the source still match.
function normalize(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&middot;/g, '\u00b7')
    .replace(/&nbsp;/g, ' ')
    .replace(/&rarr;/g, '\u2192')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const pageText = normalize(root.text);

test('Req 1.1: states fully funded, eight-week, in-residence framing with a cohort of 10', () => {
  assert.match(pageText, /fully funded/, 'expected "fully funded" framing');
  assert.match(pageText, /eight-week|8[- ]week/, 'expected an eight-week duration statement');
  assert.match(pageText, /in[- ]residence/, 'expected "in-residence" framing');
  assert.match(
    pageText,
    /cohort of 10|10 students|ten students/,
    'expected the planned cohort size of 10 students',
  );
});

test('Req 1.2: states recruitment is national / open across the United States', () => {
  assert.match(
    pageText,
    /across the united states|institutions across the u/,
    'expected a national-recruitment statement',
  );
});

test('Req 1.3: presents a "program at a glance" summary with the required rows', () => {
  // Locate the glance card by its heading text.
  const headings = root.querySelectorAll('h2');
  const glanceHeading = headings.find((h) =>
    normalize(h.text).includes('program at a glance'),
  );
  assert.ok(glanceHeading, 'expected a "Program at a glance" heading');

  // The rows live in the same card as the heading.
  const card = glanceHeading.closest('.card');
  assert.ok(card, 'expected the glance heading to sit inside a card');

  const keyEls = card.querySelectorAll('.row .k');
  const keys = keyEls.map((el) => normalize(el.text));
  assert.ok(keys.length > 0, 'expected the glance card to have labeled rows');

  const hasKey = (re) => keys.some((k) => re.test(k));

  assert.ok(hasKey(/host/), 'glance must include a host institution row');
  assert.ok(hasKey(/field/), 'glance must include a research field(s) row');
  assert.ok(hasKey(/participant/), 'glance must include a number-of-participants row');
  assert.ok(hasKey(/format/), 'glance must include a format row');
  assert.ok(hasKey(/duration/), 'glance must include a duration row');
  assert.ok(hasKey(/stipend/), 'glance must include a stipend row');
  // "Support" is presented as the provided housing & meals (and travel) support.
  assert.ok(
    hasKey(/housing|meal|support|travel/),
    'glance must include a provided-support row (e.g. housing & meals)',
  );
});

test('Req 1.4: states no prior research experience is required and no application fee is charged', () => {
  assert.match(
    pageText,
    /no prior (research )?experience/,
    'expected a "no prior experience required" statement',
  );
  assert.match(
    pageText,
    /no application fee/,
    'expected a "no application fee" statement',
  );
});

test('Req 1.5: displays a pending-NSF-award status indicator', () => {
  assert.match(
    pageText,
    /pending nsf award/,
    'expected a "pending NSF award" status indicator',
  );
});

test('Req 1.6: provides navigation to Research, Eligibility, FAQ, Account, and Apply', () => {
  const hrefs = root
    .querySelectorAll('a')
    .map((a) => (a.getAttribute('href') || '').trim());

  const linksTo = (page) => hrefs.some((h) => h === page || h.endsWith(page));

  assert.ok(linksTo('/research.html'), 'expected a link to /research.html');
  assert.ok(linksTo('/eligibility.html'), 'expected a link to /eligibility.html');
  assert.ok(linksTo('/faq.html'), 'expected a link to /faq.html');
  assert.ok(linksTo('/account.html'), 'expected a link to /account.html');
  assert.ok(linksTo('/apply.html'), 'expected a link to /apply.html');
});
