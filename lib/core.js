/* Pure, stateless core logic for the REU recruitment site.

   These functions were previously defined inline in server.js. They are
   extracted here — with behavior kept byte-for-byte identical — so they can be
   unit- and property-tested in isolation without standing up an Express app or
   a database. server.js imports them back so its runtime behavior is unchanged.

   Everything in this module is a pure function of its inputs (no I/O, no
   per-request or per-app state):
     - affiliationOf(email)            — Requirement 11.1 (affiliation derivation)
     - applicationFieldErrors(body)    — Requirement 14.3, 14.5 (validation oracle)
     - buildApplicationsCsv(rows)      — Requirement 15.5 (CSV column selection + escaping)
     - buildShowcase(enabled, cohort)  — Requirement 19.2, 19.3, 19.4 (showcase gating + projection)
   plus the shared constants/helpers they rely on (clean, EMAIL_RE, CITIZENSHIP,
   UALR_DOMAINS).
*/

'use strict';

// UA Little Rock email domains; membership determines internal affiliation.
const UALR_DOMAINS = ['ualr.edu', 'trojans.ualr.edu'];
// Pragmatic email shape check used for accounts and reference emails.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Allowed citizenship values on the application.
const CITIZENSHIP = ['us_citizen', 'us_national', 'permanent_resident', 'other'];

/**
 * Trim a value to a string and clamp its length. Non-strings become ''.
 * @param {*} v
 * @param {number} [max=300]
 * @returns {string}
 */
const clean = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Derive affiliation from an email address' domain.
 * Returns 'ualr' iff the domain equals or is a subdomain of a UALR domain,
 * otherwise 'external'.
 * @param {string} email
 * @returns {'ualr'|'external'}
 */
const affiliationOf = (email) => {
  const domain = email.split('@')[1] || '';
  return UALR_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d)) ? 'ualr' : 'external';
};

/**
 * Applicant-eligibility email gate.
 *
 * The REU is an academic program, so an applicant ACCOUNT may only be created
 * with an educational (`.edu`) email address — i.e. the email's domain ends
 * with `.edu` (this also covers institutional subdomains such as
 * `cs.university.edu` and the UALR domains `ualr.edu` / `trojans.ualr.edu`).
 * The check is case-insensitive and tolerant of non-string input.
 *
 * Scope: this gate applies ONLY to the account email at registration. The two
 * reference emails on the application are validated for shape (EMAIL_RE) but
 * NOT constrained to `.edu`, since a recommender's address may be non-academic.
 *
 * @param {string} email
 * @returns {boolean} true iff the email's domain ends with `.edu`.
 */
const isEduEmail = (email) => {
  const domain = (String(email).split('@')[1] || '').toLowerCase();
  return /\.edu$/.test(domain);
};

/**
 * Application field-validation oracle (Req 14.3, 14.5).
 *
 * Given a submission body, return the list of human-readable field-error
 * strings, exactly as the intake endpoint produces them. This intentionally
 * covers ONLY the required-field/format checks (names, institution,
 * institution type, major, year, first-choice theme, two reference names with
 * regex-valid emails, citizenship in the allowed set, statement ≥ 1200 chars).
 * The honeypot and transcript checks are handled separately by the endpoint and
 * are NOT part of this oracle, matching the original inline logic.
 *
 * @param {object} body  The request body (form fields).
 * @returns {string[]}   Field-error messages ([] when all fields are valid).
 */
function applicationFieldErrors(body) {
  const b = body || {};
  const errors = [];
  const need = (k, label) => { if (!clean(b[k])) errors.push(label + ' is required'); };
  need('first_name', 'First name'); need('last_name', 'Last name');
  need('institution', 'Institution'); need('institution_type', 'Institution type');
  need('major', 'Major'); need('year', 'Year'); need('theme1', 'First choice theme');
  need('ref1_name', 'Reference 1 name'); need('ref2_name', 'Reference 2 name');
  if (!EMAIL_RE.test(clean(b.ref1_email))) errors.push('Reference 1 email is invalid');
  if (!EMAIL_RE.test(clean(b.ref2_email))) errors.push('Reference 2 email is invalid');
  if (!CITIZENSHIP.includes(b.citizenship)) errors.push('Citizenship status is required');
  if (clean(b.statement, 20000).length < 1200)
    errors.push('Personal statement must be at least 300 words');
  return errors;
}

/**
 * CSV builder for the admin export (Req 15.5).
 *
 * Replicates the endpoint's column selection and escaping: columns are the keys
 * of the first row with the `statement` column excluded, every value is wrapped
 * in double quotes with embedded quotes doubled, and rows are joined with '\n'.
 * Returns '' for an empty row set (matching the endpoint's empty-body response).
 *
 * @param {Array<object>} rows  Application rows (as read from the database).
 * @returns {string}            CSV text.
 */
function buildApplicationsCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]).filter((c) => c !== 'statement');
  const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  return [cols.join(',')]
    .concat(rows.map((r) => cols.map((c) => esc(r[c])).join(',')))
    .join('\n');
}

/**
 * Read-only participant projection for the public Showcase_Section (Req 19.2).
 *
 * Given ONE curated cohort record, return a projection that includes ONLY the
 * two fields the showcase is allowed to present publicly — home institution and
 * academic year — and NOTHING else. Every field used only for internal review
 * (personal statement, references, contact/email, phone, transcript, status,
 * confirmation, names, ids, …) is structurally excluded because this function
 * copies exactly two keys and ignores all others. It is a whitelist, not a
 * blacklist, so adding new internal fields to a record can never leak them.
 *
 * Field mapping is tolerant of a couple of source shapes: a curated cohort
 * record may store the columns as `institution`/`year` (matching the
 * applications table) or as the more descriptive `home_institution`/
 * `academic_year`; either is mapped onto the public shape.
 *
 * @param {object} record  A single cohort record (curated).
 * @returns {{institution: string, academicYear: string}}
 */
function showcaseParticipant(record) {
  const r = record || {};
  const institution = clean(r.institution != null ? r.institution : r.home_institution);
  const academicYear = clean(r.year != null ? r.year : r.academic_year);
  return { institution, academicYear };
}

/**
 * Build the Showcase_Section response, enforcing the gating rules (Req 19).
 *
 * The Showcase_Section is considered enabled for display IF AND ONLY IF it has
 * been switched on (`enabled`) AND curated cohort data is actually present
 * (Req 19.4 — never enabled while empty). In every other case (flag off, or
 * flag on but no data) the response is a "forthcoming" empty state that exposes
 * NO participant data (Req 19.3). When enabled with data, each participant is
 * reduced to the read-only projection (home institution + academic year only),
 * excluding all internal-review fields (Req 19.2).
 *
 * @param {boolean} enabled       The SHOWCASE_ENABLED flag.
 * @param {Array<object>} cohort  Curated cohort records (may be empty/missing).
 * @returns {{enabled: boolean, forthcoming: boolean,
 *            participants: Array<{institution: string, academicYear: string}>}}
 */
function buildShowcase(enabled, cohort) {
  const records = Array.isArray(cohort) ? cohort : [];
  const hasData = records.length > 0;
  const on = Boolean(enabled) && hasData;
  return {
    enabled: on,
    forthcoming: !on,
    participants: on ? records.map(showcaseParticipant) : [],
  };
}

module.exports = {
  UALR_DOMAINS,
  EMAIL_RE,
  CITIZENSHIP,
  clean,
  affiliationOf,
  isEduEmail,
  applicationFieldErrors,
  buildApplicationsCsv,
  showcaseParticipant,
  buildShowcase,
};
