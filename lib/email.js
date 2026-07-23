'use strict';

/*
 * Email_Service (Requirement 13) — lib/email.js
 *
 * A thin abstraction over nodemailer with three modes selected purely from
 * environment configuration:
 *
 *   1. SMTP mode  — SMTP_HOST is set: build a nodemailer transport from the
 *                   environment and send real mail.
 *   2. dev-echo   — no transport configured and DEV_ECHO_CODES=1: resolve
 *                   without sending so the caller can surface the code locally
 *                   for testing (Req 13.4). No real email leaves the box.
 *   3. refuse     — no transport configured and not dev-echo: a required send
 *                   REJECTS (fail safe) so production cannot silently "succeed"
 *                   without a mail transport (Req 13.3).
 *
 * Public API (Promise-based; both send calls reject on delivery failure):
 *
 *   isTransportConfigured() -> boolean
 *   sendVerificationCode(email, code) -> Promise<{status}>
 *   sendConfirmation(email, confirmationNumber) -> Promise<{status}>
 *
 * All transport credentials and the sender address come from process.env only
 * (Req 13.5) — never hard-coded here. `nodemailer` is required lazily inside
 * the transport-building path so this module loads even where nodemailer is not
 * installed (e.g. dev-echo / refuse modes on a bare checkout).
 */

// The single program contact email (Req 18.5). Used ONLY as body/signature
// content — it is a published contact address, not a transport sender value or
// credential. The envelope sender is read from MAIL_FROM (see below).
const CONTACT_EMAIL = 'reu@ualr.edu';

/**
 * Build an SMTP transport configuration from the environment, or return null
 * when no transport is configured (SMTP_HOST absent/blank).
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {null | {host:string, port:number, secure:boolean, auth?:{user:string,pass:string}}}
 */
function smtpConfig(env) {
  const host = env.SMTP_HOST;
  if (!host || !String(host).trim()) return null;

  const port = Number(env.SMTP_PORT) || 587;
  const secure =
    env.SMTP_SECURE === '1' || String(env.SMTP_SECURE).toLowerCase() === 'true';

  // Only attach auth when at least one credential is provided; some relays
  // (e.g. an internal university MTA) accept unauthenticated submission.
  const auth =
    env.SMTP_USER || env.SMTP_PASS
      ? { user: env.SMTP_USER || '', pass: env.SMTP_PASS || '' }
      : undefined;

  return { host, port, secure, auth };
}

/**
 * True iff a mail transport is configured (SMTP_HOST present). Reflects the
 * current environment on every call so tests and runtime config changes are
 * observed without a restart.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function isTransportConfigured(env = process.env) {
  return smtpConfig(env) != null;
}

// ---------- message templates (plain-text + minimal HTML) ----------

function verificationMessage(code) {
  const subject = 'Your REU application verification code';
  const text = [
    'Welcome to the UA Little Rock NSF REU Site application.',
    '',
    `Your verification code is: ${code}`,
    '',
    'Enter this code on the account page to verify your email address.',
    'If you did not request this, you can ignore this message.',
    '',
    `— UA Little Rock REU Program (${CONTACT_EMAIL})`,
  ].join('\n');
  const html = [
    '<p>Welcome to the UA Little Rock NSF REU Site application.</p>',
    `<p>Your verification code is: <strong>${code}</strong></p>`,
    '<p>Enter this code on the account page to verify your email address.</p>',
    '<p>If you did not request this, you can ignore this message.</p>',
    `<p>&mdash; UA Little Rock REU Program (<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>)</p>`,
  ].join('\n');
  return { subject, text, html };
}

function confirmationMessage(confirmationNumber) {
  const subject = `REU application received — ${confirmationNumber}`;
  const text = [
    'Thank you for applying to the UA Little Rock NSF REU Site program.',
    '',
    `Your confirmation number is: ${confirmationNumber}`,
    '',
    'Please keep this number for your records. We will contact you with a',
    'decision by the notification date listed on the program site.',
    '',
    `— UA Little Rock REU Program (${CONTACT_EMAIL})`,
  ].join('\n');
  const html = [
    '<p>Thank you for applying to the UA Little Rock NSF REU Site program.</p>',
    `<p>Your confirmation number is: <strong>${confirmationNumber}</strong></p>`,
    '<p>Please keep this number for your records. We will contact you with a decision by the notification date listed on the program site.</p>',
    `<p>&mdash; UA Little Rock REU Program (<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>)</p>`,
  ].join('\n');
  return { subject, text, html };
}

/**
 * Core delivery routine implementing the three modes. Resolves with a status
 * describing what happened ('sent' | 'dev-echo'); rejects on delivery failure
 * or in refuse mode.
 *
 * @param {{env:NodeJS.ProcessEnv, kind:string, to:string,
 *          subject:string, text:string, html:string}} params
 * @returns {Promise<{status:'sent'|'dev-echo'}>}
 */
async function deliver({ env, to, subject, text, html }) {
  const cfg = smtpConfig(env);

  if (cfg) {
    // SMTP mode — lazily require nodemailer so this module loads without it.
    // eslint-disable-next-line global-require
    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport(cfg);
    // Sender comes strictly from the environment (Req 13.5); never hard-coded.
    const from = env.MAIL_FROM;
    await transport.sendMail({ from, to, subject, text, html });
    return { status: 'sent' };
  }

  // No transport configured.
  if (env.DEV_ECHO_CODES === '1') {
    // dev-echo mode: succeed without sending; the caller surfaces the code.
    return { status: 'dev-echo' };
  }

  // refuse mode: a required send fails safe so production cannot silently
  // succeed without a configured transport.
  const err = new Error('Email transport is not configured');
  err.code = 'EMAIL_NOT_CONFIGURED';
  throw err;
}

/**
 * Send a verification code to an account email address.
 * Rejects on delivery failure (SMTP mode) or in refuse mode; resolves in SMTP
 * (sent) and dev-echo modes.
 *
 * @param {string} email
 * @param {string|number} code
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<{status:'sent'|'dev-echo'}>}
 */
function sendVerificationCode(email, code, env = process.env) {
  const { subject, text, html } = verificationMessage(code);
  return deliver({ env, kind: 'verification', to: email, subject, text, html });
}

/**
 * Send an application confirmation number to an applicant's email address.
 * Rejects on delivery failure (SMTP mode) or in refuse mode; resolves in SMTP
 * (sent) and dev-echo modes.
 *
 * @param {string} email
 * @param {string} confirmationNumber
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<{status:'sent'|'dev-echo'}>}
 */
function sendConfirmation(email, confirmationNumber, env = process.env) {
  const { subject, text, html } = confirmationMessage(confirmationNumber);
  return deliver({ env, kind: 'confirmation', to: email, subject, text, html });
}

module.exports = {
  isTransportConfigured,
  sendVerificationCode,
  sendConfirmation,
  // Exported for unit tests / server wiring; not part of the required surface.
  CONTACT_EMAIL,
};
