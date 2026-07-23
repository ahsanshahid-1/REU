'use strict';

/*
 * Structural accessibility and theme-persistence tests (Requirement 17.2, 17.3, 17.4).
 *
 * These are static DOM assertions over the shipped public HTML plus a source
 * inspection of the progressive-enhancement script. A full browser DOM is not
 * available in this harness, so:
 *   - 17.2 (skip link + labeled landmark nav/main on every public page) and
 *     17.4 (every form control on apply.html has an associated label) are
 *     asserted directly against the parsed HTML.
 *   - 17.3 (theme toggle switches light/dark and the choice persists across
 *     pages) is asserted by (a) confirming every public page loads js/site.js,
 *     the single script that owns the toggle, and (b) inspecting site.js to
 *     confirm it toggles between 'light'/'dark' and reads+writes a persisted
 *     key so the choice carries across page loads.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('node-html-parser');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SITE_JS_PATH = path.join(PUBLIC_DIR, 'js', 'site.js');

// Every publicly reachable page the requirement covers.
const PUBLIC_PAGES = [
  'index.html',
  'research.html',
  'eligibility.html',
  'faq.html',
  'account.html',
  'apply.html',
  'showcase.html',
];

/** Parse a public page into a node-html-parser document. */
function loadPage(name) {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, name), 'utf8');
  return parse(html, { comment: false });
}

// ---------------------------------------------------------------------------
// Requirement 17.2 — skip-to-main link + labeled landmark nav/main on every page
// ---------------------------------------------------------------------------

for (const page of PUBLIC_PAGES) {
  test(`17.2 ${page}: has a skip-to-main link targeting a <main id="main">`, () => {
    const doc = loadPage(page);

    const skip = doc.querySelector('a[href="#main"]');
    assert.ok(skip, `${page} is missing a skip-to-main link (a[href="#main"])`);
    assert.ok(
      skip.text.trim().length > 0,
      `${page} skip link has no visible text`,
    );

    const main = doc.querySelector('main#main');
    assert.ok(main, `${page} is missing the skip-link target <main id="main">`);
    assert.equal(
      main.tagName,
      'MAIN',
      `${page} #main target must be a <main> landmark`,
    );
  });

  test(`17.2 ${page}: has a labeled landmark navigation`, () => {
    const doc = loadPage(page);

    const navs = doc.querySelectorAll('nav');
    assert.ok(navs.length > 0, `${page} has no <nav> landmark`);

    const labeled = navs.filter((nav) => {
      const label = (nav.getAttribute('aria-label') || '').trim();
      const labelledby = (nav.getAttribute('aria-labelledby') || '').trim();
      return label.length > 0 || labelledby.length > 0;
    });
    assert.ok(
      labeled.length > 0,
      `${page} has a <nav> but none carry an accessible label (aria-label / aria-labelledby)`,
    );
  });
}

// ---------------------------------------------------------------------------
// Requirement 17.4 — every form control on apply.html is associated with a label
// ---------------------------------------------------------------------------

test('17.4 apply.html: every input/select/textarea has an associated label', () => {
  const doc = loadPage('apply.html');

  // ids referenced by an explicit <label for="...">
  const forTargets = new Set(
    doc
      .querySelectorAll('label[for]')
      .map((l) => (l.getAttribute('for') || '').trim())
      .filter(Boolean),
  );

  const controls = doc.querySelectorAll('input, select, textarea');
  assert.ok(controls.length > 0, 'apply.html has no form controls to check');

  const unlabeled = [];
  let honeypotSeen = false;

  for (const el of controls) {
    // The anti-spam honeypot lives in an aria-hidden container and is not part
    // of the accessible form; it is legitimately exempt from label association.
    if (el.closest('[aria-hidden="true"]')) {
      honeypotSeen = true;
      continue;
    }

    const id = (el.getAttribute('id') || '').trim();
    const hasForLabel = id && forTargets.has(id);
    const hasWrappingLabel = Boolean(el.closest('label'));
    const hasAriaLabel = (el.getAttribute('aria-label') || '').trim().length > 0;
    const hasAriaLabelledby =
      (el.getAttribute('aria-labelledby') || '').trim().length > 0;

    if (!(hasForLabel || hasWrappingLabel || hasAriaLabel || hasAriaLabelledby)) {
      const name = el.getAttribute('name') || '';
      unlabeled.push(`<${el.tagName.toLowerCase()} id="${id}" name="${name}">`);
    }
  }

  assert.equal(
    unlabeled.length,
    0,
    `apply.html has unlabeled form controls: ${unlabeled.join(', ')}`,
  );
  assert.ok(
    honeypotSeen,
    'expected an aria-hidden honeypot field to be present and exempted',
  );
});

// ---------------------------------------------------------------------------
// Requirement 17.3 — theme toggle switches light/dark and persists across pages
// ---------------------------------------------------------------------------

test('17.3 every public page loads js/site.js (the toggle owner)', () => {
  for (const page of PUBLIC_PAGES) {
    const doc = loadPage(page);
    const scripts = doc
      .querySelectorAll('script[src]')
      .map((s) => s.getAttribute('src'));
    assert.ok(
      scripts.some((src) => /\/js\/site\.js(\?|$)/.test(src)),
      `${page} does not include /js/site.js, so the theme toggle would not work there`,
    );
  }
});

test('17.3 site.js toggles between light and dark themes', () => {
  const src = fs.readFileSync(SITE_JS_PATH, 'utf8');

  // The toggle is wired to the #theme-btn control.
  assert.match(
    src,
    /getElementById\(\s*['"]theme-btn['"]\s*\)/,
    'site.js does not wire up the #theme-btn theme toggle',
  );
  // It must apply both the light and the dark theme states.
  assert.ok(
    /['"]light['"]/.test(src) && /['"]dark['"]/.test(src),
    'site.js does not reference both light and dark theme states',
  );
  // It removes the prior theme class before applying the next, i.e. switches.
  assert.match(
    src,
    /classList\.remove\(\s*['"]light['"]\s*,\s*['"]dark['"]\s*\)/,
    'site.js does not switch between light and dark (expected classList.remove of both)',
  );
  assert.match(
    src,
    /classList\.add\(\s*next\s*\)/,
    'site.js does not apply the next theme on toggle',
  );
});

test('17.3 site.js persists the theme choice so it carries across pages', () => {
  const src = fs.readFileSync(SITE_JS_PATH, 'utf8');

  // Reads a persisted choice on load...
  assert.match(
    src,
    /localStorage\.getItem\(\s*['"]theme['"]\s*\)/,
    'site.js does not read a persisted theme key on load',
  );
  // ...and writes it back on toggle. Persisting to localStorage (a shared,
  // origin-scoped store) is what makes the choice survive navigation to
  // another page, satisfying "preserve the choice across pages".
  assert.match(
    src,
    /localStorage\.setItem\(\s*['"]theme['"]\s*,/,
    'site.js does not persist the chosen theme key',
  );
});
