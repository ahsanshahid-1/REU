'use strict';

/*
 * Property 1: Affiliation is derived from the email domain (Requirement 11.1).
 *
 * For any email address, the derived affiliation SHALL be `ualr` if and only if
 * the email's domain equals or is a subdomain of a UALR domain
 * (`ualr.edu`, `trojans.ualr.edu`), and SHALL be `external` for every other
 * domain.
 *
 * `affiliationOf` is a pure function extracted into lib/core.js, so it is
 * imported and exercised directly without standing up the Express app.
 *
 * Validates: Requirements 11.1
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

const { affiliationOf, UALR_DOMAINS } = require('../lib/core');

const NUM_RUNS = 100;

// An independent oracle for the expected classification. This mirrors the
// specification ("equals or is a subdomain of a UALR domain") rather than the
// implementation, so the test genuinely checks the derivation rule.
function expectedAffiliation(email) {
  const domain = email.split('@')[1] || '';
  const isUalr = UALR_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d));
  return isUalr ? 'ualr' : 'external';
}

// A DNS label: starts/ends alphanumeric, may contain hyphens internally.
const labelArb = fc
  .stringMatching(/^[a-z0-9](?:[a-z0-9-]{0,20}[a-z0-9])?$/)
  .filter((s) => s.length > 0);

// A local-part with no whitespace or '@' so the address is well-formed enough
// to split on '@'.
const localPartArb = fc
  .stringMatching(/^[a-z0-9._%+-]+$/)
  .filter((s) => s.length > 0);

// A generic (usually external) domain: one or more labels joined by dots.
const genericDomainArb = fc
  .array(labelArb, { minLength: 1, maxLength: 4 })
  .map((labels) => labels.join('.'));

// A domain that is a UALR domain or a subdomain of one.
const ualrDomainArb = fc
  .tuple(
    fc.array(labelArb, { minLength: 0, maxLength: 3 }),
    fc.constantFrom(...UALR_DOMAINS),
  )
  .map(([sub, base]) => (sub.length ? sub.join('.') + '.' + base : base));

test('Feature: reu-recruitment-site, Property 1: Affiliation is derived from the email domain', () => {
  // Explicit anchor examples pinning the rule at its boundaries.
  assert.equal(affiliationOf('a@ualr.edu'), 'ualr');
  assert.equal(affiliationOf('a@trojans.ualr.edu'), 'ualr');
  assert.equal(affiliationOf('a@cs.ualr.edu'), 'ualr');
  assert.equal(affiliationOf('a@deep.sub.trojans.ualr.edu'), 'ualr');
  assert.equal(affiliationOf('a@gmail.com'), 'external');
  assert.equal(affiliationOf('a@notualr.edu'), 'external'); // suffix, not subdomain
  assert.equal(affiliationOf('a@ualr.edu.evil.com'), 'external');

  // For any generated email, affiliationOf agrees with the specification oracle
  // and only ever yields one of the two allowed labels.
  fc.assert(
    fc.property(
      localPartArb,
      fc.oneof(ualrDomainArb, genericDomainArb),
      (local, domain) => {
        const email = `${local}@${domain}`;
        const result = affiliationOf(email);
        assert.ok(result === 'ualr' || result === 'external');
        assert.equal(result, expectedAffiliation(email));
      },
    ),
    { numRuns: NUM_RUNS },
  );

  // Targeted arm: every UALR domain / subdomain must classify as `ualr`.
  fc.assert(
    fc.property(localPartArb, ualrDomainArb, (local, domain) => {
      assert.equal(affiliationOf(`${local}@${domain}`), 'ualr');
    }),
    { numRuns: NUM_RUNS },
  );

  // Targeted arm: domains that neither equal nor are subdomains of a UALR
  // domain must classify as `external`.
  fc.assert(
    fc.property(
      localPartArb,
      genericDomainArb.filter(
        (domain) =>
          !UALR_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d)),
      ),
      (local, domain) => {
        assert.equal(affiliationOf(`${local}@${domain}`), 'external');
      },
    ),
    { numRuns: NUM_RUNS },
  );
});
