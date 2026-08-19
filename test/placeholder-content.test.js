'use strict';

/*
 * Placeholder-state and contact-email content tests (Requirement 18).
 *
 * Task 8.4. These are content assertions (node:test + node-html-parser), not
 * property-based tests. They verify that the rendered public pages agree with
 * the placeholder register in CONTENT.md:
 *
 *   - withheld-until-award items render the EXACT consistent statement
 *     "Published upon NSF award notification." and carry
 *     data-state="withheld-until-award" (Req 18.3);
 *   - finalized items show their finalized value and are NOT replaced by a
 *     placeholder treatment (Req 18.2);
 *   - no stray bracketed "[...]" placeholder text remains in visible content
 *     for finalized/withheld keys (Req 18.2, 18.3);
 *   - exactly one program contact email (reu@ualr.edu) appears site-wide and no
 *     other contact email address appears (Req 18.5).
 *
 * The register below mirrors REU/CONTENT.md. If CONTENT.md changes, update this
 * table so the test stays the single-source-of-truth check the register
 * promises.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('node-html-parser');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// The exact consistent withheld statement defined in Task 8.2 / CONTENT.md (Req 18.3).
const WITHHELD_STATEMENT = 'Published upon NSF award notification.';

// The single program contact email, finalized site-wide (Req 18.5).
const CONTACT_EMAIL = 'reu@ualr.edu';

// Public pages under test.
const PAGES = [
  'index.html',
  'research.html',
  'eligibility.html',
  'faq.html',
  'account.html',
  'apply.html',
];

/**
 * The placeholder register, mirrored from CONTENT.md.
 *
 * - withheldKeys: data-placeholder keys that MUST render the consistent withheld
 *   statement (and carry data-state="withheld-until-award") wherever they appear.
 * - finalizedContent: finalized keys with the literal text that MUST appear on a
 *   given page (Req 18.2) — proving finalized content is shown, not a placeholder.
 */
const WITHHELD_KEYS = [
  'pi-direct-contact',
  'named-mentor-profiles',
  'research-project-details',
];

// finalized keys should NEVER carry a withheld data-state marker.
// (program-dates is now `intermediate` — tentative dates, applications via NSF ETAP.)
const FINALIZED_KEYS = [
  'program-contact-email',
  'program-phone',
  'research-fields',
  'common-intellectual-focus',
  'research-project-areas',
  'cohort-size',
  'stipend-amount',
];

// Finalized values that must be visibly rendered (Req 18.2). Keyed by page.
const FINALIZED_CONTENT = {
  'index.html': [
    '$700 / week',            // stipend-amount
    '10 per year',            // cohort-size
    'ten students',           // cohort-size
    'Artificial intelligence, cybersecurity, data science', // research-fields
    CONTACT_EMAIL,            // program-contact-email
    '(501) 916-3000',         // program-phone
  ],
  'faq.html': [
    CONTACT_EMAIL,
    '(501) 916-3000',
  ],
  'eligibility.html': [
    '$5,600',                 // stipend-amount (8-week total)
    '$700 per week',          // stipend-amount (rate)
    CONTACT_EMAIL,
  ],
};

// ---- helpers -------------------------------------------------------------

function readPage(name) {
  return fs.readFileSync(path.join(PUBLIC_DIR, name), 'utf8');
}

function parsePage(name) {
  return parse(readPage(name));
}

/**
 * Visible text of the document: strip <script>/<style>/<head> so that CSS and
 * JS attribute selectors (e.g. input[required]) are not mistaken for
 * bracketed placeholder text, then decode the couple of entities we use.
 */
function visibleText(root) {
  const clone = parse(root.toString());
  clone.querySelectorAll('script, style, head').forEach((el) => el.remove());
  return clone.text.replace(/&middot;/g, '·').replace(/&amp;/g, '&');
}

// Collect every literal email address in the raw HTML (mailto: + inline text).
// Resource URLs (nsf.gov, irs.gov, etap.nsf.gov) contain no "@" and are excluded
// by construction; this focuses on actual contact addresses (Req 18.5).
function emailsIn(html) {
  const matches = html.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  return matches;
}

// ---- Req 18.3: withheld-until-award consistent treatment ------------------

test('every data-state marker is withheld-until-award with the exact consistent statement', () => {
  let markerCount = 0;
  for (const page of PAGES) {
    const root = parsePage(page);
    const markers = root.querySelectorAll('[data-state]');
    for (const el of markers) {
      markerCount += 1;
      assert.equal(
        el.getAttribute('data-state'),
        'withheld-until-award',
        `${page}: unexpected data-state "${el.getAttribute('data-state')}"`,
      );
      assert.equal(
        el.text.trim(),
        WITHHELD_STATEMENT,
        `${page}: withheld marker text drifted from the consistent statement`,
      );
      // A withheld marker must always name a withheld-until-award key.
      const key = el.getAttribute('data-placeholder');
      assert.ok(
        WITHHELD_KEYS.includes(key),
        `${page}: withheld marker carries non-withheld key "${key}"`,
      );
    }
  }
  assert.ok(markerCount > 0, 'expected at least one withheld-until-award marker site-wide');
});

test('each withheld-until-award key renders the consistent statement on its declared page', () => {
  const expectations = [
    { key: 'pi-direct-contact', page: 'index.html' },
    { key: 'pi-direct-contact', page: 'faq.html' },
    // Research now publishes the finalized mentor roster and project pathways,
    // so its withheld markers were removed. The footer fine print still repeats
    // named-mentor-profiles on the remaining pages.
    { key: 'named-mentor-profiles', page: 'index.html' },
    { key: 'named-mentor-profiles', page: 'eligibility.html' },
    { key: 'named-mentor-profiles', page: 'faq.html' },
  ];
  for (const { key, page } of expectations) {
    const root = parsePage(page);
    const els = root.querySelectorAll(`[data-placeholder="${key}"][data-state]`);
    assert.ok(
      els.length > 0,
      `${page}: expected a withheld marker for "${key}"`,
    );
    for (const el of els) {
      assert.equal(el.text.trim(), WITHHELD_STATEMENT, `${page}: "${key}" statement drifted`);
      assert.equal(el.getAttribute('data-state'), 'withheld-until-award');
    }
  }
});

// ---- Req 18.2: finalized content is shown, not placeholdered ---------------

test('finalized values are rendered on their pages and not replaced by placeholder text', () => {
  for (const [page, values] of Object.entries(FINALIZED_CONTENT)) {
    const text = visibleText(parsePage(page));
    for (const value of values) {
      assert.ok(
        text.includes(value),
        `${page}: expected finalized value "${value}" to be visibly rendered`,
      );
    }
  }
});

test('finalized keys never carry a withheld data-state marker', () => {
  for (const page of PAGES) {
    const root = parsePage(page);
    for (const key of FINALIZED_KEYS) {
      const withheld = root.querySelectorAll(`[data-placeholder="${key}"][data-state="withheld-until-award"]`);
      assert.equal(
        withheld.length,
        0,
        `${page}: finalized key "${key}" must not be presented as withheld`,
      );
    }
  }
});

// ---- Req 18.2/18.3: no stray bracketed placeholder text --------------------

test('no stray bracketed "[...]" placeholder text remains in visible content', () => {
  // Matches a bracketed token beginning with a letter, e.g. "[PI name]",
  // "[TBD]", "[mentor]". CSS/JS attribute selectors live in <script>/<style>
  // and are excluded by visibleText().
  const bracketPlaceholder = /\[[A-Za-z][^\]]*\]/g;
  for (const page of PAGES) {
    const text = visibleText(parsePage(page));
    const found = text.match(bracketPlaceholder) || [];
    assert.deepEqual(
      found,
      [],
      `${page}: found stray bracketed placeholder text: ${JSON.stringify(found)}`,
    );
  }
});

// ---- Req 18.5: a single contact email site-wide ---------------------------

test('exactly one program contact email appears site-wide and no other address', () => {
  const distinct = new Set();
  for (const page of PAGES) {
    for (const email of emailsIn(readPage(page))) {
      distinct.add(email.toLowerCase());
    }
  }
  assert.deepEqual(
    [...distinct],
    [CONTACT_EMAIL],
    `expected only ${CONTACT_EMAIL} site-wide, found: ${[...distinct].join(', ')}`,
  );
});

test('the single contact email is reachable via a mailto: link', () => {
  let mailtoTargets = new Set();
  for (const page of PAGES) {
    const root = parsePage(page);
    for (const a of root.querySelectorAll('a[href^="mailto:"]')) {
      const target = a.getAttribute('href').replace(/^mailto:/, '').split('?')[0].toLowerCase();
      if (target) mailtoTargets.add(target);
    }
  }
  assert.deepEqual(
    [...mailtoTargets],
    [CONTACT_EMAIL],
    `expected all mailto: links to point at ${CONTACT_EMAIL}, found: ${[...mailtoTargets].join(', ')}`,
  );
});
