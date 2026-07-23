'use strict';

/*
 * Property 16: Showcase is never enabled while empty and hides internal-only data
 * (Requirements 19.2, 19.3, 19.4).
 *
 * For any cohort dataset, the Showcase_Section SHALL be enabled if and only if
 * participant data is present; and while enabled, each rendered participant
 * SHALL include home institution and academic year while excluding fields used
 * only for internal review.
 *
 * Two property arms are exercised against the pure `buildShowcase` /
 * `showcaseParticipant` functions extracted into lib/core.js, so no Express app
 * or database is required:
 *
 *   1. Gating (Req 19.3, 19.4): result.enabled is true IFF the flag is truthy
 *      AND the cohort has >= 1 record; otherwise the response is "forthcoming"
 *      with participants = [] and NO participant data exposed.
 *   2. Projection (Req 19.2): when enabled with data, each rendered participant
 *      has exactly the keys {institution, academicYear} and NONE of the
 *      internal-only fields, even when the source records carry them.
 *
 * Validates: Requirements 19.2, 19.3, 19.4
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

const { buildShowcase, showcaseParticipant } = require('../lib/core');

const NUM_RUNS = 200;

// Fields that exist only for internal review and MUST never appear in a public
// showcase projection, regardless of what a source record contains.
const INTERNAL_ONLY_FIELDS = [
  'statement',
  'ref1_name',
  'ref1_email',
  'ref2_name',
  'ref2_email',
  'email',
  'phone',
  'transcript_file',
  'first_name',
  'last_name',
  'confirmation',
  'id',
  'status',
];

// The only two keys a rendered participant is allowed to expose.
const PUBLIC_KEYS = ['institution', 'academicYear'];

// A cohort record that always carries the public source columns AND a full set
// of internal-only fields, so the projection is forced to actively drop them.
// The institution/year columns randomly use either the applications-table shape
// (`institution`/`year`) or the descriptive shape (`home_institution`/
// `academic_year`) to match `showcaseParticipant`'s tolerant mapping.
const recordArb = fc
  .record({
    useDescriptive: fc.boolean(),
    institution: fc.string(),
    year: fc.string(),
    home_institution: fc.string(),
    academic_year: fc.string(),
    statement: fc.string(),
    ref1_name: fc.string(),
    ref1_email: fc.string(),
    ref2_name: fc.string(),
    ref2_email: fc.string(),
    email: fc.string(),
    phone: fc.string(),
    transcript_file: fc.string(),
    first_name: fc.string(),
    last_name: fc.string(),
    confirmation: fc.string(),
    id: fc.integer(),
    status: fc.constantFrom('pending', 'accepted', 'rejected', 'review'),
  })
  .map((r) => {
    const rec = { ...r };
    if (rec.useDescriptive) {
      // Exercise the home_institution/academic_year source shape.
      delete rec.institution;
      delete rec.year;
    } else {
      delete rec.home_institution;
      delete rec.academic_year;
    }
    delete rec.useDescriptive;
    return rec;
  });

// A cohort is an array of such records (possibly empty).
const cohortArb = fc.array(recordArb, { maxLength: 8 });

// enabled flag intentionally includes truthy/falsy non-booleans, since the
// implementation coerces with Boolean(...).
const enabledArb = fc.oneof(
  fc.boolean(),
  fc.constantFrom(undefined, null, 0, 1, '', 'yes'),
);

test('Feature: reu-recruitment-site, Property 16: Showcase is never enabled while empty and hides internal-only data', () => {
  // --- Anchor examples -----------------------------------------------------

  // Flag on but empty cohort => never enabled while empty (Req 19.4).
  {
    const res = buildShowcase(true, []);
    assert.equal(res.enabled, false);
    assert.equal(res.forthcoming, true);
    assert.deepEqual(res.participants, []);
  }

  // Flag off with data => hidden/forthcoming, no data exposed (Req 19.3).
  {
    const res = buildShowcase(false, [{ institution: 'MIT', year: 'Junior' }]);
    assert.equal(res.enabled, false);
    assert.equal(res.forthcoming, true);
    assert.deepEqual(res.participants, []);
  }

  // Flag on with data => enabled, projected to public keys only (Req 19.2).
  {
    const res = buildShowcase(true, [
      {
        institution: 'State College',
        year: 'Sophomore',
        statement: 'SECRET internal statement',
        email: 'secret@example.com',
        id: 42,
      },
    ]);
    assert.equal(res.enabled, true);
    assert.equal(res.forthcoming, false);
    assert.deepEqual(res.participants, [
      { institution: 'State College', academicYear: 'Sophomore' },
    ]);
    const serialized = JSON.stringify(res);
    assert.ok(!serialized.includes('SECRET internal statement'));
    assert.ok(!serialized.includes('secret@example.com'));
  }

  // --- Arm 1: Gating (Req 19.3, 19.4) --------------------------------------
  fc.assert(
    fc.property(enabledArb, cohortArb, (enabledFlag, cohort) => {
      const res = buildShowcase(enabledFlag, cohort);
      const expectedEnabled = Boolean(enabledFlag) && cohort.length >= 1;

      // enabled IFF flag truthy AND at least one record.
      assert.equal(res.enabled, expectedEnabled);
      // forthcoming is exactly the negation of enabled.
      assert.equal(res.forthcoming, !expectedEnabled);

      if (!expectedEnabled) {
        // Not enabled => no participant data is exposed at all.
        assert.deepEqual(res.participants, []);
      } else {
        // Enabled => one projection per source record.
        assert.equal(res.participants.length, cohort.length);
      }
    }),
    { numRuns: NUM_RUNS },
  );

  // --- Arm 2: Projection hides internal-only fields (Req 19.2) --------------
  fc.assert(
    fc.property(fc.array(recordArb, { minLength: 1, maxLength: 8 }), (cohort) => {
      const res = buildShowcase(true, cohort);
      assert.equal(res.enabled, true);
      assert.equal(res.participants.length, cohort.length);

      res.participants.forEach((p, idx) => {
        // Exactly the two allowed public keys — no more, no less.
        assert.deepEqual(Object.keys(p).sort(), [...PUBLIC_KEYS].sort());

        // None of the internal-only field names appear as keys.
        for (const f of INTERNAL_ONLY_FIELDS) {
          assert.ok(
            !Object.prototype.hasOwnProperty.call(p, f),
            `projection leaked internal field key: ${f}`,
          );
        }

        // The projection matches the standalone projector for the same record.
        assert.deepEqual(p, showcaseParticipant(cohort[idx]));

        // Public values are strings (home institution + academic year).
        assert.equal(typeof p.institution, 'string');
        assert.equal(typeof p.academicYear, 'string');
      });

      // No internal-only VALUE leaks into the serialized payload either, using
      // sentinel values that could only originate from an internal field.
      const sentinelCohort = cohort.map((r, i) => ({
        institution: r.institution != null ? r.institution : r.home_institution,
        year: r.year != null ? r.year : r.academic_year,
        statement: `STMT_SENTINEL_${i}`,
        email: `EMAIL_SENTINEL_${i}@x.test`,
        ref1_email: `REF_SENTINEL_${i}@x.test`,
        transcript_file: `TRANSCRIPT_SENTINEL_${i}.pdf`,
        id: 900000 + i,
      }));
      const serialized = JSON.stringify(buildShowcase(true, sentinelCohort));
      for (let i = 0; i < sentinelCohort.length; i++) {
        assert.ok(!serialized.includes(`STMT_SENTINEL_${i}`));
        assert.ok(!serialized.includes(`EMAIL_SENTINEL_${i}`));
        assert.ok(!serialized.includes(`REF_SENTINEL_${i}`));
        assert.ok(!serialized.includes(`TRANSCRIPT_SENTINEL_${i}`));
      }
    }),
    { numRuns: NUM_RUNS },
  );
});
