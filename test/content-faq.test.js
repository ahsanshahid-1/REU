'use strict';

/*
 * Content-presence tests for the Dates & FAQ page (public/faq.html).
 *
 * These are example-based content assertions (not property tests): they parse
 * the shipped HTML with node-html-parser and confirm the page presents the
 * content required by Requirements 7 (key dates + application process) and
 * 8 (dual application routes). They do not exercise runtime behavior.
 *
 * Assertions normalize whitespace and match on case-insensitive substrings /
 * regexes so meaning-preserving wording tweaks do not cause false failures,
 * while still verifying the substantive claim each acceptance criterion needs.
 *
 * Covered:
 *   7.1 application timeline (open date, deadline WITH time zone,
 *       decision-notification date, program dates)
 *   7.2 required materials list
 *   7.3 FAQ topics
 *   7.4 "choose to apply" links to the Application_Form and to ETAP
 *   7.5 both links available wherever the application-process content is shown
 *   8.1 dual-route statement (site + NSF ETAP)
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

/** True if an anchor's href points at the on-site Application_Form. */
function isApplyHref(href) {
  return /(^|\/)apply\.html(\?|#|$)/i.test(href || '');
}

/** True if an anchor's href points at the NSF ETAP route. */
function isEtapHref(href) {
  return /etap\.nsf\.gov/i.test(href || '');
}

// ---------------------------------------------------------------------------
// Requirement 7.1: Application timeline
// ---------------------------------------------------------------------------

test('7.1 presents the application OPEN date', () => {
  assertContains(/applications open/i, 'missing an "applications open" milestone');
  assertContains(/nov\w*\.?\s*1,?\s*2026/i, 'missing the application open date (Nov 1, 2026)');
});

test('7.1 presents the application DEADLINE with a time zone', () => {
  assertContains(/application deadline/i, 'missing an "application deadline" milestone');
  assertContains(/feb\w*\.?\s*15,?\s*2027/i, 'missing the application deadline date (Feb 15, 2027)');
  // The deadline must carry an explicit clock time AND an explicit time zone
  // (e.g. "11:59 p.m. CT" / Central Time), not just a bare date.
  assert.ok(
    /\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?)\s*(?:C(?:entral)?\.?\s*T(?:ime)?|central time)/i.test(text),
    'application deadline is missing an explicit clock time with a time zone (e.g. 11:59 p.m. CT / Central Time)',
  );
});

test('7.1 presents the DECISION-notification date', () => {
  assertContains(/decisions? (?:announced|notified|by)/i, 'missing a decision-notification milestone');
  assertContains(/mar\w*\.?\s*20,?\s*2027/i, 'missing the decision-notification date (Mar 20, 2027)');
});

test('7.1 presents the PROGRAM dates', () => {
  assertContains(/program in residence|in residence|program dates/i, 'missing a program-dates milestone');
  assertContains(/jun\w*\.?\s*1\s*(?:to|-|–|—)\s*jul\w*\.?\s*24,?\s*2027/i,
    'missing the eight-week program dates (Jun 1 to Jul 24, 2027)');
});

// ---------------------------------------------------------------------------
// Requirement 7.2: Required application materials
// ---------------------------------------------------------------------------

test('7.2 lists account + verified email', () => {
  assertContains(/account with a verified email|verified email/i,
    'missing the account + verified-email requirement');
});

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
// Requirement 7.4 / 8.2: Links to the Application_Form and the ETAP route
// ---------------------------------------------------------------------------

test('7.4 provides a link to the on-site Application_Form (/apply.html)', () => {
  const links = main.querySelectorAll('a').filter((a) => isApplyHref(a.getAttribute('href')));
  assert.ok(links.length > 0, 'missing a link to the Application_Form (/apply.html)');
});

test('7.4 / 8.2 provides a link to the NSF ETAP route (etap.nsf.gov)', () => {
  const links = main.querySelectorAll('a').filter((a) => isEtapHref(a.getAttribute('href')));
  assert.ok(links.length > 0, 'missing a link to the NSF ETAP application (etap.nsf.gov)');
});

// ---------------------------------------------------------------------------
// Requirement 8.1: Dual-route statement (site + NSF ETAP)
// ---------------------------------------------------------------------------

test('8.1 states applications are accepted through the site and via NSF ETAP', () => {
  assertContains(/apply through this site or via nsf etap|through this site.*etap|site.*and.*etap/i,
    'missing the dual-route (site + NSF ETAP) statement');
});

// ---------------------------------------------------------------------------
// Requirement 7.5: Both routes available wherever the "choose to apply"
// application-process content is presented.
// ---------------------------------------------------------------------------

test('7.5 exposes BOTH the Application_Form and ETAP links in the applying section', () => {
  // The "choose to apply" content lives in the Key-dates / Applying section.
  const datesSection = main.querySelector('#dates') || main;
  const sectionLinks = datesSection.querySelectorAll('a');
  const hasApply = sectionLinks.some((a) => isApplyHref(a.getAttribute('href')));
  const hasEtap = sectionLinks.some((a) => isEtapHref(a.getAttribute('href')));
  assert.ok(hasApply, 'the applying section must expose the Application_Form (/apply.html) link');
  assert.ok(hasEtap, 'the applying section must expose the NSF ETAP (etap.nsf.gov) link');
});

test('7.5 never presents the apply CTA without an ETAP route also available on the page', () => {
  // If any "apply" CTA is present, an ETAP route must be present too, so the
  // "choose to apply" path is never shown without both options.
  const applyLinks = main.querySelectorAll('a').filter((a) => isApplyHref(a.getAttribute('href')));
  const etapLinks = main.querySelectorAll('a').filter((a) => isEtapHref(a.getAttribute('href')));
  if (applyLinks.length > 0) {
    assert.ok(
      etapLinks.length > 0,
      'an apply CTA is present but no ETAP route is available on the same page',
    );
  }
});
