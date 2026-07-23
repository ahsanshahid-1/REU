'use strict';

/*
 * Widget-presence example test for the accessible chat Assistant.
 *
 * Requirement 16.1: THE Assistant SHALL present an accessible chat widget on
 * all public pages. The chat widget self-injects its DOM at runtime from
 * `public/js/chat.js`, so the observable, verifiable guarantee is that every
 * public page includes that script. If the script is present, the accessible
 * widget renders site-wide.
 *
 * This is an example test (not a property test): it enumerates the known set
 * of public pages and asserts each one includes a <script src="/js/chat.js">
 * tag, parsed with node-html-parser.
 *
 * Covers Requirement 16.1.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('node-html-parser');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// The complete set of publicly accessible pages. The admin panel is staff-only
// and intentionally excluded from the public-page contract.
const PUBLIC_PAGES = [
  'index.html',
  'research.html',
  'eligibility.html',
  'faq.html',
  'account.html',
  'apply.html',
  'showcase.html',
];

// The expected chat widget include, as referenced from the served site root.
const CHAT_SCRIPT_SRC = '/js/chat.js';

function pageIncludesChatScript(fileName) {
  const filePath = path.join(PUBLIC_DIR, fileName);
  const rawHtml = fs.readFileSync(filePath, 'utf8');
  const root = parse(rawHtml);
  const scripts = root.querySelectorAll('script');
  return scripts.some((s) => {
    const src = (s.getAttribute('src') || '').trim();
    return src === CHAT_SCRIPT_SRC;
  });
}

for (const page of PUBLIC_PAGES) {
  test(`Req 16.1: ${page} includes the chat widget script (${CHAT_SCRIPT_SRC})`, () => {
    assert.ok(
      pageIncludesChatScript(page),
      `expected ${page} to include <script src="${CHAT_SCRIPT_SRC}"> so the accessible chat widget renders site-wide`,
    );
  });
}
