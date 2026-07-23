'use strict';

/*
 * Property 13: Assistant answers cite exactly the retrieved sources and fall
 * back to the program email when nothing matches.
 *
 * For any question, the sources returned by the Assistant SHALL be exactly the
 * {title, url} of the retrieved knowledge chunks; and for any question that
 * retrieves no matching chunk, the answer SHALL express uncertainty and direct
 * the applicant to reu@ualr.edu.
 *
 * The Assistant pipeline (answer, retrieve) is imported directly from
 * lib/chatbot.js. We run in retrieval-only mode by ensuring no Hugging Face
 * credential is configured, so answer() resolves synchronously from the local
 * corpus with no network dependency. The credentials MUST be cleared BEFORE the
 * module is required, because chatbot.js reads them once at load time.
 *
 * Validates: Requirements 16.2, 16.3
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

// Retrieval-only mode: no language-model credential configured.
delete process.env.HF_TOKEN;
delete process.env.HUGGINGFACE_API_KEY;

const { answer, retrieve } = require('../lib/chatbot');

const NUM_RUNS = 100;
const PROGRAM_EMAIL = 'reu@ualr.edu';
// Uncertainty phrasing produced when nothing relevant is retrieved.
const UNCERTAINTY_RE = /don't have|not sure|can't answer/i;

// Independent oracle: the citations the Assistant SHOULD return are exactly the
// title/url pairs of the chunks that retrieval selects for that question.
function expectedSources(question) {
  return retrieve(question, 3).map((c) => ({ title: c.title, url: c.url }));
}

// Topical words drawn from the corpus's own vocabulary. Questions built from
// these are likely to retrieve one or more chunks, exercising the citation arm.
const TOPICAL_WORDS = [
  'stipend', 'housing', 'meals', 'eligibility', 'citizen', 'transfer',
  'apply', 'application', 'deadline', 'dates', 'transcript', 'references',
  'research', 'projects', 'nanotechnology', 'cybersecurity', 'visualization',
  'funding', 'travel', 'taxes', 'gpa', 'accommodations', 'disability',
  'account', 'verify', 'password', 'symposium', 'mentor', 'contact', 'email',
];

// A natural-ish question assembled from topical words (plus optional filler).
const topicalQuestionArb = fc
  .array(fc.constantFrom(...TOPICAL_WORDS), { minLength: 1, maxLength: 5 })
  .map((words) => words.join(' '));

// Arbitrary free-text questions (may or may not retrieve anything). Combined
// with topical questions this exercises the citation property across the full
// input space, since sources must always equal the retrieved chunks.
const freeTextQuestionArb = fc.string({ minLength: 0, maxLength: 120 });

const anyQuestionArb = fc.oneof(topicalQuestionArb, freeTextQuestionArb);

// Gibberish tokens engineered to retrieve nothing: consonant-only clusters of
// length >= 6 that do not appear in the corpus vocabulary. A precondition still
// guards the (extremely unlikely) accidental match.
const gibberishTokenArb = fc.stringMatching(/^[bcdfghjklmnpqrstvwxz]{6,14}$/);
const gibberishQuestionArb = fc
  .array(gibberishTokenArb, { minLength: 1, maxLength: 5 })
  .map((tokens) => tokens.join(' '));

test(
  'Feature: reu-recruitment-site, Property 13: Assistant answers cite exactly the retrieved sources and fall back to the program email when nothing matches',
  async () => {
    // --- Anchor examples ---

    // A topical question retrieves chunks and cites exactly those chunks.
    const stipend = await answer('how much is the stipend', []);
    assert.deepEqual(stipend.sources, expectedSources('how much is the stipend'));
    assert.ok(stipend.sources.length > 0);
    for (const s of stipend.sources) {
      assert.equal(typeof s.title, 'string');
      assert.equal(typeof s.url, 'string');
    }

    // A question with no matching content expresses uncertainty and points to
    // the program email, with no fabricated citations.
    const nomatch = await answer('zxqwvbn plmnkjh gfdswqz', []);
    assert.deepEqual(nomatch.sources, []);
    assert.ok(nomatch.answer.includes(PROGRAM_EMAIL));
    assert.match(nomatch.answer, UNCERTAINTY_RE);

    // --- Citation arm: sources are exactly the retrieved chunks' title/url ---
    await fc.assert(
      fc.asyncProperty(anyQuestionArb, async (question) => {
        const { sources } = await answer(question, []);
        assert.deepEqual(sources, expectedSources(question));
      }),
      { numRuns: NUM_RUNS },
    );

    // --- No-match fallback arm: uncertainty + program email, empty sources ---
    await fc.assert(
      fc.asyncProperty(gibberishQuestionArb, async (question) => {
        // Only consider questions that genuinely retrieve nothing.
        fc.pre(retrieve(question, 3).length === 0);
        const { answer: text, sources } = await answer(question, []);
        assert.deepEqual(sources, []);
        assert.ok(
          text.includes(PROGRAM_EMAIL),
          `expected answer to direct to ${PROGRAM_EMAIL}: ${text}`,
        );
        assert.match(text, UNCERTAINTY_RE);
      }),
      { numRuns: NUM_RUNS },
    );
  },
);
