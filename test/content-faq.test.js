'use strict';

/*
 * Content-presence tests for the Dates & FAQ page (public/faq.html).
 *
 * These are example-based content assertions (not property tests): they parse
 * the shipped HTML with node-html-parser and confirm the page presents the
 * content required by Requirements 7 (key dates + application process) and
 * 8 (application route). They do not exercise runtime behavior.
 *
 * NOTE: Applications are now accepted ONLY through NSF ETAP (etap.nsf.gov).
 * There is no on-site application form, and program/application dates are
 * presented as tentative and subject to change (exact dates posted once
 * confirmed). These tests reflect that policy.
 *
 * Assertions normalize whitespace and match on case-insensitive substrings /
 * regexes so meaning-preserving wording tweaks do not cause false failures,
 * while still verifying the substantive claim each acceptance criterion needs.
 *
 * Covered:
 *   7.1 application timeline (tentative: open window, deadline, decisions,
 *       program dates) presented as subject to change
 *   7.2 required materials list
 *   7.3 FAQ topics
 *   7.4 applying routes applicants to the NSF ETAP application
 *   8.1 ETAP-only application-route statement
 *   8.2 link to the NSF ETAP application
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('node-html-parser');

const HTML_PATH = path.join(__dirname, '..', 'public', 'faq.html');

// Parse once; expose both the structured DOM and a normalized text blob.
const rawHtml = fs.readFileSync(HTML_PATH, 'utf8');
const root = parse(rawHtml);
const main = root.querySelector('#main') || root;
const text = normalize(main.text);

/** Collapse all runs of whitespace to single spaces for stable substring checks. */
function normalize(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

/** Assert the normalized page text contains `needle` (string=substring, RegExp=test). */
function assertContains(needle, message) {
  if (needle instanceof RegExp) {
    assert.ok(needle.test(text), message || `expected page text to match ${needle}`);
  } else {
    assert.ok(
      text.toLowerCase().includes(String(needle).toLowerCase()),
      message || `expected page text to contain: "${needle}"`,
    );
  }
}

/** True if an anchor's href points at the NSF ETAP route. */
function isEtapHref(href) {
  return /etap\.nsf\.gov/i.test(href || '');
}

/** True if an anchor's href points at the (removed) on-site Application_Form. */
function isApplyHref(href) {
  return /(^|\/)apply\.html(\?|#|$)/i.test(href || '');
}

// ---------------------------------------------------------------------------
// Requirement 7.1: Application timeline (tentative, subject to change)
// ---------------------------------------------------------------------------

test('7.1 presents the timeline as tentative and subject to change', () => {
  assertContains(/tentative/i, 'missing a "tentative" framing for the timeline');
  assertContains(/subject to change/i, 'missing a "subject to change" statement');
  assertContains(/posted (?:on this page|here)/i,
    'missing a statement that exact dates will be posted once confirmed');
});

test('7.1 presents the application OPEN milestone', () => {
  assertContains(/applications open/i, 'missing an "applications open" milestone');
});

test('7.1 presents the application DEADLINE milestone', () => {
  assertContains(/application deadline/i, 'missing an "application deadline" milestone');
});

test('7.1 presents the DECISION milestone', () => {
  assertContains(/decisions? (?:announced|notified|by)/i, 'missing a decision milestone');
});

test('7.1 presents the PROGRAM (in residence) milestone', () => {
  assertContains(/program in residence|in residence|program dates/i, 'missing a program-dates milestone');
  assertContains(/eight[\s-]?week|8[\s-]?week/i, 'missing the eight-week program duration');
});

// ---------------------------------------------------------------------------
// Requirement 7.2: Required application materials
// ---------------------------------------------------------------------------

test('7.2 lists eligibility confirmation', () => {
  assertContains(/confirmation of (?:nsf )?eligibility|confirm(?:ation)?.*eligib/i,
    'missing the eligibility-confirmation requirement');
});

test('7.2 lists institution and academic-year information', () => {
  assertContains(/institution/i, 'missing the institution requirement');
  assertContains(/academic year/i, 'missing the academic-year requirement');
});

test('7.2 lists ranked project-area choices', () => {
  assertContains(/ranked choice of the project areas|ranked.*project area/i,
    'missing the ranked project-area choice requirement');
});

test('7.2 lists a personal statement', () => {
  assertContains(/personal statement/i, 'missing the personal-statement requirement');
});

test('7.2 lists an unofficial transcript', () => {
  assertContains(/unofficial transcript/i, 'missing the unofficial-transcript requirement');
});

test('7.2 lists two references', () => {
  assertContains(/two references/i, 'missing the two-references requirement');
});

// ---------------------------------------------------------------------------
// Requirement 7.3: Frequently asked questions
// ---------------------------------------------------------------------------

test('7.3 answers the prior-experience question', () => {
  assertContains(/never done research|no prior research|prior research experience/i,
    'missing the prior-experience FAQ');
});

test('7.3 answers the GPA-policy question', () => {
  assertContains(/gpa cutoff|no gpa|gpa/i, 'missing the GPA-policy FAQ');
});

test('7.3 answers the community-college eligibility question', () => {
  assertContains(/community college/i, 'missing the community-college eligibility FAQ');
});

test('7.3 answers the transfer eligibility question', () => {
  assertContains(/transferring schools|transfer/i, 'missing the transfer-eligibility FAQ');
});

test('7.3 answers the international-student eligibility question', () => {
  assertContains(/international student/i, 'missing the international-student eligibility FAQ');
});

test('7.3 answers the stipend-nature question', () => {
  assertContains(/stipend a salary|research training experience.*stipend|stipend.*not.*salary/i,
    'missing the stipend-nature FAQ');
});

test('7.3 answers the academic-credit question', () => {
  assertContains(/academic credit/i, 'missing the academic-credit FAQ');
});

test('7.3 answers the accommodations question', () => {
  assertContains(/accommodations for a disability|accommodations for research and residential/i,
    'missing the accommodations FAQ');
});

// ---------------------------------------------------------------------------
// Requirement 7.4 / 8.2: Link to the NSF ETAP application (the only route)
// ---------------------------------------------------------------------------

test('7.4 / 8.2 provides a link to the NSF ETAP route (etap.nsf.gov)', () => {
  const links = main.querySelectorAll('a').filter((a) => isEtapHref(a.getAttribute('href')));
  assert.ok(links.length > 0, 'missing a link to the NSF ETAP application (etap.nsf.gov)');
});

test('7.4 no longer links to a removed on-site application form (/apply.html)', () => {
  const links = main.querySelectorAll('a').filter((a) => isApplyHref(a.getAttribute('href')));
  assert.equal(links.length, 0, 'the on-site application form has been removed; no /apply.html links expected');
});

// ---------------------------------------------------------------------------
// Requirement 8.1: ETAP-only application-route statement
// ---------------------------------------------------------------------------

test('8.1 states applications are accepted only through NSF ETAP', () => {
  assertContains(/only through nsf etap|accepted only through nsf etap|submitted only through nsf etap|through nsf etap/i,
    'missing the NSF-ETAP-only application-route statement');
});

// ---------------------------------------------------------------------------
// Requirement 7.5: The applying section exposes the ETAP route.
// ---------------------------------------------------------------------------

test('7.5 exposes the ETAP application link in the applying/dates section', () => {
  const datesSection = main.querySelector('#dates') || main;
  const sectionLinks = datesSection.querySelectorAll('a');
  const hasEtap = sectionLinks.some((a) => isEtapHref(a.getAttribute('href')));
  assert.ok(hasEtap, 'the applying section must expose the NSF ETAP (etap.nsf.gov) link');
});
