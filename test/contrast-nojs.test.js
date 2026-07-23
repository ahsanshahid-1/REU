'use strict';

/*
 * Contrast + no-JS readability tests (Requirements 17.1, 17.5).
 *
 * Two independent concerns, both verified against the shipped static assets:
 *
 *  1. COMPUTED CONTRAST (Req 17.1) — parse `public/styles/theme.css`, extract
 *     the documented semantic color tokens (each defined via `light-dark(a,b)`
 *     so both the light and dark resolved values are available), and compute
 *     the WCAG 2.1 relative-luminance contrast ratio for every documented text
 *     pairing. Each normal-text pairing must be >= 4.5:1 and each large-text
 *     pairing >= 3:1 in BOTH light and dark. A pairing below AA is a hard
 *     failure that names the offending pairing, mode, and computed ratio.
 *
 *  2. NO-JS READABILITY (Req 17.5) — read the raw HTML of the public
 *     informational pages and assert the core informational content lives in
 *     the static markup (inside the <main> landmark), so the pages remain
 *     readable with JavaScript disabled. Content injected only by JS would be
 *     absent from the raw source and fail these checks.
 *
 * NOTE: These are automated structural/computed checks. Full WCAG AA
 * conformance still requires manual assistive-technology review (see design.md
 * "Manual accessibility review").
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('node-html-parser');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const THEME_CSS_PATH = path.join(PUBLIC_DIR, 'styles', 'theme.css');

// ---------------------------------------------------------------------------
// WCAG contrast math (self-contained, no external color library).
// ---------------------------------------------------------------------------

// Parse a #RGB or #RRGGBB hex string to an [r, g, b] triple of 0..255 ints.
function hexToRgb(hex) {
  const h = hex.trim().replace(/^#/, '');
  let full;
  if (h.length === 3) {
    full = h.split('').map((c) => c + c).join('');
  } else if (h.length === 6) {
    full = h;
  } else {
    throw new Error(`Unsupported hex color: "${hex}"`);
  }
  const int = parseInt(full, 16);
  if (Number.isNaN(int)) throw new Error(`Invalid hex color: "${hex}"`);
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
}

// Convert an 8-bit sRGB channel to linear-light per WCAG 2.1.
function channelToLinear(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

// WCAG relative luminance of an sRGB hex color.
function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (
    0.2126 * channelToLinear(r) +
    0.7152 * channelToLinear(g) +
    0.0722 * channelToLinear(b)
  );
}

// WCAG contrast ratio between two hex colors (order-independent).
function contrastRatio(hexA, hexB) {
  const l1 = relativeLuminance(hexA);
  const l2 = relativeLuminance(hexB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// theme.css token extraction.
// ---------------------------------------------------------------------------

const themeCss = fs.readFileSync(THEME_CSS_PATH, 'utf8');

/*
 * Build a map of semantic token name -> { light, dark } hex values.
 *
 * The theme defines each semantic token twice: once as a plain light fallback
 * (for browsers without light-dark()) and once via `light-dark(light, dark)`.
 * The light-dark() form is authoritative because it carries BOTH modes, so it
 * overwrites any earlier plain-hex fallback.
 */
function extractTokens(css) {
  const tokens = {};

  // Plain fallback: `--name: #hex;` (captures single-color declarations only).
  const plainRe = /--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g;
  let m;
  while ((m = plainRe.exec(css)) !== null) {
    const [, name, hex] = m;
    tokens[name] = { light: hex, dark: hex };
  }

  // Authoritative: `--name: light-dark(#lightHex, #darkHex);`
  const ldRe =
    /--([\w-]+)\s*:\s*light-dark\(\s*(#[0-9a-fA-F]{3,8})\s*,\s*(#[0-9a-fA-F]{3,8})\s*\)/g;
  while ((m = ldRe.exec(css)) !== null) {
    const [, name, lightHex, darkHex] = m;
    tokens[name] = { light: lightHex, dark: darkHex };
  }

  return tokens;
}

const TOKENS = extractTokens(themeCss);

function tokenValue(name, mode) {
  const t = TOKENS[name];
  assert.ok(t, `theme.css is missing semantic token --${name}`);
  const v = t[mode];
  assert.ok(v, `token --${name} has no ${mode} value`);
  return v;
}

/*
 * Documented semantic text pairings (foreground token on background token).
 * These mirror the "WCAG 2.1 AA verified pairings" documented in theme.css
 * plus the other semantic fg/bg pairs the pages actually render as text.
 *
 * large: true relaxes the threshold to 3:1 (WCAG large-text rule); everything
 * else is treated as normal text at 4.5:1.
 */
const PAIRINGS = [
  { fg: 'fg-primary', bg: 'bg-canvas' },
  { fg: 'fg-primary', bg: 'bg-surface' },
  { fg: 'fg-primary', bg: 'bg-elevated' },
  { fg: 'fg-primary', bg: 'bg-inset' },
  { fg: 'fg-secondary', bg: 'bg-surface' },
  { fg: 'fg-muted', bg: 'bg-surface' },
  { fg: 'fg-inverse', bg: 'bg-inverse' },
  { fg: 'fg-inverse-muted', bg: 'bg-inverse' },
  { fg: 'link', bg: 'bg-surface' },
  { fg: 'link', bg: 'bg-canvas' },
  { fg: 'action-primary-fg', bg: 'action-primary-bg' },
  { fg: 'action-secondary-fg', bg: 'bg-surface' },
  { fg: 'accent-strong', bg: 'accent-subtle' },
  { fg: 'status-success-fg', bg: 'status-success-bg' },
  { fg: 'status-danger-fg', bg: 'status-danger-bg' },
  { fg: 'status-warn-fg', bg: 'status-warn-bg' },
];

const MODES = ['light', 'dark'];

for (const mode of MODES) {
  for (const pair of PAIRINGS) {
    const threshold = pair.large ? 3 : 4.5;
    const label = `Req 17.1: ${mode} contrast --${pair.fg} on --${pair.bg} >= ${threshold}:1`;
    test(label, () => {
      const fgHex = tokenValue(pair.fg, mode);
      const bgHex = tokenValue(pair.bg, mode);
      const ratio = contrastRatio(fgHex, bgHex);
      assert.ok(
        ratio >= threshold,
        `${mode} pairing --${pair.fg} (${fgHex}) on --${pair.bg} (${bgHex}) ` +
          `is ${ratio.toFixed(2)}:1, below WCAG AA ${threshold}:1`,
      );
    });
  }
}

test('Req 17.1: contrast harness self-check (known ratios)', () => {
  // Black on white is the canonical 21:1 maximum; identical colors are 1:1.
  assert.ok(Math.abs(contrastRatio('#000000', '#FFFFFF') - 21) < 0.1);
  assert.ok(Math.abs(contrastRatio('#FFFFFF', '#FFFFFF') - 1) < 0.001);
  // #767676 on white is the well-known ~4.54:1 AA boundary gray.
  const boundary = contrastRatio('#767676', '#FFFFFF');
  assert.ok(boundary >= 4.5 && boundary < 4.6, `expected ~4.54, got ${boundary.toFixed(2)}`);
});

// ---------------------------------------------------------------------------
// No-JS readability (Req 17.5).
// ---------------------------------------------------------------------------

function normalize(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&middot;/g, '\u00b7')
    .replace(/&nbsp;/g, ' ')
    .replace(/&rarr;/g, '\u2192')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Parse a public page from its raw source (not a running server or rendered
// DOM) so anything we read is guaranteed present without JavaScript. Returns
// the normalized full-page static text plus the <main> landmark's text.
function readStaticPage(fileName) {
  const raw = fs.readFileSync(path.join(PUBLIC_DIR, fileName), 'utf8');
  const root = parse(raw);
  const main = root.querySelector('main');
  assert.ok(main, `${fileName} must have a <main> landmark`);
  return { pageText: normalize(root.text), mainText: normalize(main.text) };
}

// Per-page core informational statements that must exist in the static markup.
const NO_JS_PAGES = [
  {
    file: 'index.html',
    label: 'Overview',
    phrases: [/fully funded/, /pending nsf award/, /(cohort of 10|10 students|ten students)/],
  },
  {
    file: 'research.html',
    label: 'Research',
    phrases: [/week by week/, /orientation/, /mentor/],
  },
  {
    file: 'eligibility.html',
    label: 'Eligibility & Funding',
    phrases: [/u\.s\. citizen/, /\$700 per week/, /accommodations/],
  },
  {
    file: 'faq.html',
    label: 'Dates & FAQ',
    phrases: [/application deadline/, /transcript|reference|personal statement/, /eligib/],
  },
];

for (const page of NO_JS_PAGES) {
  test(`Req 17.5: ${page.label} (${page.file}) core content is readable with JS disabled`, () => {
    const { pageText, mainText } = readStaticPage(page.file);
    // The main landmark should carry substantial static prose, not an empty
    // shell waiting on JS to populate it.
    assert.ok(
      mainText.length >= 200,
      `${page.file} <main> has only ${mainText.length} chars of static text; ` +
        `content may be JS-injected rather than server-rendered`,
    );
    // Core informational statements must exist in the raw static markup.
    for (const re of page.phrases) {
      assert.match(
        pageText,
        re,
        `${page.file} static markup must contain content matching ${re}`,
      );
    }
  });
}
