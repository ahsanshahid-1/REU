'use strict';

/*
 * Content-presence tests for the Eligibility & Funding page (public/eligibility.html).
 *
 * These are example-based assertions (not property tests): they parse the static
 * HTML and confirm each required compliance-facing statement is present. They
 * cover Requirements 4 (eligibility), 5 (non-discrimination + recruitment
 * commitments), 6 (funding/stipend/tax), 10 (accommodations), and 19.1 (future
 * showcase statement).
 *
 * Assertions normalize whitespace and match on case-insensitive substrings /
 * regexes so wording tweaks that preserve meaning do not cause false failures,
 * while still verifying the substantive claim each acceptance criterion requires.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('node-html-parser');

const HTML_PATH = path.join(__dirname, '..', 'public', 'eligibility.html');

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

// ---------------------------------------------------------------------------
// Requirement 4: Eligibility content
// ---------------------------------------------------------------------------

test('4.1 states citizenship: U.S. citizen, national, or permanent resident', () => {
  assertContains(/u\.?s\.?\s+citizen/i, 'missing U.S. citizen statement');
  assertContains(/u\.?s\.?\s+national/i, 'missing U.S. national statement');
  assertContains(/permanent resident/i, 'missing permanent resident statement');
});

test('4.2 states enrollment in a degree program (bachelor\'s or associate)', () => {
  assertContains(/enrolled in a degree program/i, 'missing degree-program enrollment statement');
  assertContains(/part[\s-]?time/i, 'missing part-time enrollment');
  assertContains(/full[\s-]?time/i, 'missing full-time enrollment');
  assertContains(/associate/i, 'missing associate degree reference');
});

test('4.3 states community college / associate-degree students are eligible', () => {
  assertContains(/community college/i, 'missing community college eligibility');
  assertContains(/associate degree students are fully eligible/i,
    'missing explicit associate-degree eligibility statement');
});

test('4.4 states transfer-between-institutions students are eligible', () => {
  assertContains(/transferring between institutions/i, 'missing transfer eligibility');
  assertContains(/enrolled at neither during the intervening summer/i,
    'missing the "enrolled at neither during the intervening summer" clause');
});

test('4.5 states HS graduates accepted but not yet enrolled are eligible', () => {
  assertContains(
    /high school graduate who has been accepted at an undergraduate institution but has not yet started/i,
    'missing high-school-graduate-accepted-not-yet-enrolled eligibility',
  );
});

test('4.6 states holders of a bachelor\'s no longer enrolled are NOT eligible', () => {
  // Confirm the "not eligible" heading/section exists and calls out bachelor's holders.
  assertContains(/not eligible/i, 'missing a "not eligible" section');
  assertContains(
    /received your bachelor'?s degree and are no longer enrolled/i,
    'missing the already-holds-bachelor\'s ineligibility statement',
  );
});

// ---------------------------------------------------------------------------
// Requirement 5: Non-discrimination and recruitment-commitment content
// ---------------------------------------------------------------------------

test('5.1 states at least half from limited-research (incl. two-year) institutions', () => {
  assertContains(/at least half/i, 'missing the "at least half" recruitment commitment');
  assertContains(/research opportunities in stem are limited|opportunities in stem are limited|research opportunities .* limited/i,
    'missing the limited-research-opportunity institution language');
  assertContains(/two year colleges|two-year colleges/i, 'missing two-year-college inclusion');
});

test('5.2 states an external-participation floor with no upper cap', () => {
  assertContains(/from outside/i, 'missing the "from outside the host" commitment');
  assertContains(/minimum commitment, not a cap/i, 'missing the floor-not-cap framing');
  assertContains(/no upper limit/i, 'missing the "no upper limit" statement');
  assertContains(/entirely of students from other institutions would fully satisfy/i,
    'missing the all-external-cohort-satisfies statement');
});

test('5.3 states protected classes are not eligibility criteria + Federal/NSF statutes', () => {
  assertContains(/non-discrimination/i, 'missing non-discrimination heading/statement');
  assertContains(/race, ethnicity, sex, age, and disability/i,
    'missing the enumerated protected characteristics');
  assertContains(/never used as eligibility criteria|not.*eligibility criteria/i,
    'missing the "not used as eligibility criteria" statement');
  assertContains(/federal and nsf non-discrimination statutes/i,
    'missing the Federal and NSF non-discrimination statutes compliance statement');
});

test('5.4 describes outreach to CC partners, MSIs, and EPSCoR networks', () => {
  assertContains(/outreach/i, 'missing outreach language');
  assertContains(/community college partners/i, 'missing community college partners');
  assertContains(/minority serving institutions|minority-serving institutions/i,
    'missing minority-serving institutions');
  assertContains(/epscor/i, 'missing EPSCoR networks');
});

// ---------------------------------------------------------------------------
// Requirement 6: Funding, stipend, housing, travel, tax content
// ---------------------------------------------------------------------------

test('6.1 states the stipend as ~$700/week for the eight-week program', () => {
  assertContains(/\$700 per week/i, 'missing $700 per week stipend rate');
  assertContains(/8 weeks|eight[\s-]?week/i, 'missing eight-week duration');
  assertContains(/\$5,600/i, 'missing the $5,600 total stipend');
});

test('6.2 states participant support costs cover housing/meals/travel/lab fees', () => {
  assertContains(/participant support costs/i, 'missing participant-support-costs framing');
  assertContains(/housing/i, 'missing housing');
  assertContains(/meals/i, 'missing meals');
  assertContains(/travel to the host institution/i, 'missing travel to host institution');
  assertContains(/laboratory use fees/i, 'missing laboratory use fees');
});

test('6.3 states no application fee, no required tuition, no charge for common facilities', () => {
  assertContains(/application fee/i, 'missing application-fee statement');
  assertContains(/prohibits reu sites from charging|forbids charging|no application fee/i,
    'missing the no-application-fee prohibition');
  assertContains(/tuition/i, 'missing tuition statement');
  assertContains(/never required for participation|never charged tuition|no required tuition/i,
    'missing the no-required-tuition statement');
});

test('6.4 states the REU experience is a research-training stipend, not salary', () => {
  assertContains(/research training experience/i, 'missing research-training-experience framing');
  assertContains(/stipend, not employment|not employment paid with a salary|not a salary|rather than employment/i,
    'missing the stipend-not-salary/employment distinction');
});

// ---------------------------------------------------------------------------
// Requirement 10: Accommodations and accessibility support content
// ---------------------------------------------------------------------------

test('10.1 states accommodations are provided for research and residential life', () => {
  assertContains(/accommodations for research and residential life/i,
    'missing accommodations-for-research-and-residential-life statement');
});

test('10.2 states NSF\'s FASED mechanism can fund special assistance or equipment', () => {
  assertContains(/fased/i, 'missing FASED mechanism reference');
  assertContains(/special assistance or equipment/i,
    'missing the FASED special-assistance/equipment funding statement');
});

test('10.3 instructs applicants to request accommodations early with a contact route', () => {
  assertContains(/request accommodations early/i, 'missing the request-early instruction');
  const contactLink = main.querySelectorAll('a').find((a) =>
    /^mailto:/i.test(a.getAttribute('href') || ''));
  assert.ok(contactLink, 'missing a mailto: contact route for requesting accommodations');
});

// ---------------------------------------------------------------------------
// Requirement 19.1: Future participant showcase statement
// ---------------------------------------------------------------------------

test('19.1 states the site will expand after the program begins to showcase the cohort', () => {
  assertContains(/showcase the cohort|showcase participants|expands to.*showcase/i,
    'missing the future-showcase statement');
  assertContains(/participants/i, 'showcase statement should mention participants');
  assertContains(/projects/i, 'showcase statement should mention projects');
  assertContains(/presentations|symposium presentations/i,
    'showcase statement should mention presentations');
  assertContains(/publications/i, 'showcase statement should mention publications');
  assertContains(/outcomes/i, 'showcase statement should mention outcomes');
});
