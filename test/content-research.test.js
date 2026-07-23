'use strict';

/*
 * Content-presence tests for the Research page (public/research.html).
 *
 * These are static content assertions (not property tests): they parse the
 * shipped HTML with node-html-parser and confirm the page presents the content
 * required by Requirements 2, 3, and 9. They do not exercise runtime behavior.
 *
 * Covers:
 *   Req 2.1-2.5  Research themes and student activities
 *   Req 3.1-3.4  Mentoring and mentor-training
 *   Req 9.1-9.4  Code of conduct, harassment policy, and orientation
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('node-html-parser');

const { paths } = require('./helpers');

const RESEARCH_HTML_PATH = path.join(paths.ROOT, 'public', 'research.html');

const html = fs.readFileSync(RESEARCH_HTML_PATH, 'utf8');
const root = parse(html);
const main = root.querySelector('#main');

// Normalized, lowercased text of the <main> content for substring assertions.
const text = main.structuredText.replace(/\s+/g, ' ').toLowerCase();

/** Assert every phrase in `phrases` is present in the page text. */
function assertAllPresent(phrases) {
  for (const phrase of phrases) {
    assert.ok(
      text.includes(phrase.toLowerCase()),
      `expected research.html to mention: "${phrase}"`,
    );
  }
}

// ---------------------------------------------------------------------------
// Requirement 2: Research themes and student activities
// ---------------------------------------------------------------------------

test('Req 2.1 - presents the set of research project areas, each with a description', () => {
  // The six project-area cards live in the activities section grid.
  const cards = main.querySelectorAll('#activities .grid .card');
  assert.ok(cards.length >= 6, `expected at least 6 project-area cards, found ${cards.length}`);

  const areaHeadings = [
    'Nanotechnology and advanced materials',
    'Nanomedicine and bioengineering',
    'Data science and analytics',
    'Immersive visualization and extended reality',
    'Cybersecurity and resilient computing',
    'Applied mathematics and computational modeling',
  ];
  assertAllPresent(areaHeadings);

  // Each area card carries a descriptive summary paragraph, not just a title.
  for (const card of cards) {
    const heading = card.querySelector('h3');
    const summary = card.querySelector('p');
    if (heading) {
      assert.ok(
        summary && summary.structuredText.trim().length > 20,
        `project area "${heading.structuredText.trim()}" is missing a descriptive summary`,
      );
    }
  }
});

test('Req 2.2 - describes the common intellectual focus enabling a shared cohort experience', () => {
  assertAllPresent(['common intellectual focus']);
  // Confirms the focus is tied to a shared/single-cohort experience.
  assert.ok(
    text.includes('cohort'),
    'expected the common focus to be framed as a shared cohort experience',
  );
});

test('Req 2.3 - week-by-week outline covers orientation, mentored research, professional development, symposium', () => {
  // The week-by-week list should exist.
  assert.ok(text.includes('week by week') || text.includes('week 1'), 'expected a week-by-week outline');
  assertAllPresent([
    'orientation',            // orientation
    'research with your mentor', // mentored research
    'professional development',  // professional development
    'final research symposium',  // final research symposium
  ]);
});

test('Req 2.4 - describes the research facilities and centers where students work', () => {
  assertAllPresent([
    'Center for Integrative Nanotechnology Sciences',
    'Emerging Analytics Center',
  ]);
  // A dedicated facilities block should be present.
  assert.ok(
    text.includes('facilities') || text.includes('centers'),
    'expected facilities/centers to be described',
  );
});

test('Req 2.5 - states mentoring continues during the academic year to the extent practicable', () => {
  assertAllPresent(['academic year', 'to the extent practicable']);
});

// ---------------------------------------------------------------------------
// Requirement 3: Mentoring and mentor-training
// ---------------------------------------------------------------------------

test('Req 3.1 - mentors selected for expertise and a documented history of mentoring undergraduates', () => {
  assertAllPresent(['selected for expertise']);
  assert.ok(
    text.includes('documented history of involving undergraduates') ||
      text.includes('documented history of mentoring') ||
      (text.includes('documented') && text.includes('mentoring undergraduates')) ||
      text.includes('track record of mentoring undergraduates'),
    'expected a documented history/track record of mentoring undergraduates',
  );
});

test('Req 3.2 - all mentors complete structured training before the summer', () => {
  assertAllPresent(['structured training', 'before the summer']);
});

test('Req 3.3 - program monitors mentoring quality through program-level check-ins', () => {
  assertAllPresent(['program-level check-ins']);
  assert.ok(
    text.includes('mentoring quality') || text.includes('monitor'),
    'expected mentoring-quality monitoring to be described',
  );
});

test('Req 3.4 - continued support: academic-year interaction, recommendation letters, publication support', () => {
  assertAllPresent([
    'recommendation letters',
  ]);
  assert.ok(
    text.includes('academic year'),
    'expected continued academic-year interaction to be described',
  );
  assert.ok(
    text.includes('publication') || text.includes('publish'),
    'expected publication support to be described',
  );
});

// ---------------------------------------------------------------------------
// Requirement 9: Code of conduct, harassment policy, and orientation
// ---------------------------------------------------------------------------

test('Req 9.1 - orientation covers safe, respectful, inclusive, harassment-free behavior', () => {
  assert.ok(text.includes('orientation'), 'expected an orientation to be described');
  assertAllPresent(['safe', 'respectful', 'inclusive', 'harassment-free']);
  assert.ok(
    text.includes('expectations of behavior') || text.includes('expectations of behaviour'),
    'expected orientation to cover expectations of behavior',
  );
});

test('Req 9.2 - orientation reviews sexual harassment, other harassment, sexual assault policy + reporting', () => {
  assertAllPresent([
    'sexual harassment',
    'sexual assault',
  ]);
  assert.ok(
    text.includes('other') && text.includes('harassment'),
    'expected other forms of harassment to be covered',
  );
  assert.ok(
    text.includes('reporting'),
    'expected reporting/complaint procedures to be described',
  );
});

test('Req 9.3 - links to NSF harassment policy (nsf.gov/od/oecr/harassment)', () => {
  const links = root.querySelectorAll('a[href]');
  const nsfHarassment = links.find((a) =>
    (a.getAttribute('href') || '').includes('nsf.gov/od/oecr/harassment'),
  );
  assert.ok(
    nsfHarassment,
    "expected a link to NSF's harassment policy at nsf.gov/od/oecr/harassment",
  );
});

test('Req 9.4 - certified safe-and-inclusive working-environment plan for off-site research', () => {
  assert.ok(
    text.includes('safe and inclusive working environment') ||
      text.includes('safe-and-inclusive-working-environment') ||
      (text.includes('safe') && text.includes('inclusive') && text.includes('working environment')),
    'expected a safe-and-inclusive-working-environment plan to be described',
  );
  assert.ok(
    text.includes('certif'),
    'expected the off-site plan to be described as certified',
  );
  assert.ok(
    text.includes('off site') || text.includes('off-site') ||
      text.includes('off campus') || text.includes('off-campus'),
    'expected the plan to apply to off-site/off-campus research',
  );
});
