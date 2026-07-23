'use strict';

/*
 * Property 14: Assistant mode selection is total and failure-safe.
 *
 * For any combination of credential configuration and upstream outcome, the
 * Assistant SHALL:
 *   - operate in retrieval-only mode when no language-model credential is
 *     configured,
 *   - use the upstream response when the credential is present and the request
 *     succeeds, and
 *   - return a retrieval-based fallback answer (never an error) when the
 *     credential is present but the upstream request fails.
 *
 * lib/chatbot.js reads HF_TOKEN once at module load and reaches the upstream
 * via global.fetch. To exercise the three modes we control (a) presence/absence
 * of the credential and (b) whether the mocked fetch succeeds or fails, and we
 * re-require the module with a fresh require cache per configuration using the
 * test harness helpers (purge / makeChatUpstreamMock / failingChatUpstreamMock).
 *
 * Validates: Requirements 16.4, 16.6
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

const {
  purge,
  makeChatUpstreamMock,
  failingChatUpstreamMock,
  paths,
} = require('./helpers');

const CHATBOT_PATH = paths.CHATBOT_PATH;
const NUM_RUNS = 100;

// Snapshot the process-level state this test mutates so it can be restored.
const ENV_SNAPSHOT = {
  HF_TOKEN: process.env.HF_TOKEN,
  HUGGINGFACE_API_KEY: process.env.HUGGINGFACE_API_KEY,
};
const ORIGINAL_FETCH = global.fetch;

/**
 * Load a FRESH copy of lib/chatbot.js under a given configuration. Because the
 * module captures HF_TOKEN and reads global.fetch at load time, we set the
 * credential + fetch mock BEFORE purging and re-requiring.
 *
 * @param {object} cfg
 * @param {string|undefined} cfg.token   HF credential; undefined => no credential.
 * @param {Function|undefined} cfg.fetchMock  global.fetch replacement.
 */
function loadChatbot({ token, fetchMock }) {
  if (token === undefined) {
    delete process.env.HF_TOKEN;
    delete process.env.HUGGINGFACE_API_KEY;
  } else {
    process.env.HF_TOKEN = token;
    delete process.env.HUGGINGFACE_API_KEY;
  }
  if (fetchMock) global.fetch = fetchMock;
  purge(CHATBOT_PATH);
  return require(CHATBOT_PATH);
}

function restoreGlobals() {
  global.fetch = ORIGINAL_FETCH;
  for (const key of Object.keys(ENV_SNAPSHOT)) {
    if (ENV_SNAPSHOT[key] === undefined) delete process.env[key];
    else process.env[key] = ENV_SNAPSHOT[key];
  }
  purge(CHATBOT_PATH);
}

// Topical vocabulary (drawn from the corpus) makes questions likely to retrieve
// chunks, so the retrieval-based fallback/retrieval-only arms have real content
// to return. Free text broadens the input space.
const TOPICAL_WORDS = [
  'stipend', 'housing', 'meals', 'eligibility', 'citizen', 'transfer',
  'apply', 'application', 'deadline', 'dates', 'transcript', 'references',
  'research', 'projects', 'funding', 'travel', 'taxes', 'gpa',
  'accommodations', 'disability', 'account', 'verify', 'mentor', 'contact',
];

const topicalQuestionArb = fc
  .array(fc.constantFrom(...TOPICAL_WORDS), { minLength: 1, maxLength: 5 })
  .map((words) => words.join(' '));
const freeTextQuestionArb = fc.string({ minLength: 1, maxLength: 120 });
const questionArb = fc.oneof(topicalQuestionArb, freeTextQuestionArb);

// Non-empty credential strings (presence is what matters, not the value).
const tokenArb = fc.stringMatching(/^[A-Za-z0-9_-]{1,40}$/);

test(
  'Feature: reu-recruitment-site, Property 14: Assistant mode selection is total and failure-safe',
  async () => {
    try {
      // ================================================================
      // Mode A: NO credential configured => retrieval-only, never errors.
      // ================================================================
      {
        let fetchCalls = 0;
        // If the retrieval-only path ever touched the network it would be a bug.
        const noNetwork = async () => {
          fetchCalls++;
          throw new Error('fetch must not be called in retrieval-only mode');
        };
        const bot = loadChatbot({ token: undefined, fetchMock: noNetwork });
        assert.equal(bot.isLLMEnabled(), false);

        // Anchor example.
        const anchor = await bot.answer('how much is the stipend', []);
        assert.equal(anchor.mode, 'retrieval-only');
        assert.equal(typeof anchor.answer, 'string');
        assert.ok(anchor.answer.length > 0);

        await fc.assert(
          fc.asyncProperty(questionArb, async (question) => {
            fc.pre(question.trim().length > 0);
            const res = await bot.answer(question, []);
            assert.equal(res.mode, 'retrieval-only');
            assert.equal(typeof res.answer, 'string');
            assert.ok(res.answer.length > 0);
            // Retrieval-only returns the best-matching knowledge content.
            const chunks = bot.retrieve(question, 3);
            if (chunks.length) assert.equal(res.answer, chunks[0].text);
          }),
          { numRuns: NUM_RUNS },
        );
        assert.equal(fetchCalls, 0, 'retrieval-only mode must not call fetch');
      }

      // ================================================================
      // Mode B: credential present + upstream SUCCESS => use upstream (rag).
      // ================================================================
      {
        // The mock responder returns whatever `currentResponse` holds, letting
        // us vary the upstream answer per generated input.
        let currentResponse = 'UPSTREAM::seed';
        const successMock = makeChatUpstreamMock(() => currentResponse);
        const bot = loadChatbot({ token: 'hf_test_token', fetchMock: successMock });
        assert.equal(bot.isLLMEnabled(), true);

        // Anchor example.
        currentResponse = 'UPSTREAM::anchor answer';
        const anchor = await bot.answer('tell me about research projects', []);
        assert.equal(anchor.mode, 'rag');
        assert.equal(anchor.answer, 'UPSTREAM::anchor answer');

        await fc.assert(
          fc.asyncProperty(
            questionArb,
            fc.string({ maxLength: 200 }),
            async (question, body) => {
              fc.pre(question.trim().length > 0);
              // Guarantee a non-empty completion (chatbot treats an empty
              // completion as a failure and falls back).
              const content = 'UPSTREAM::' + body;
              currentResponse = content;
              const res = await bot.answer(question, []);
              assert.equal(res.mode, 'rag');
              assert.equal(res.answer, content.trim());
            },
          ),
          { numRuns: NUM_RUNS },
        );
      }

      // ================================================================
      // Mode C: credential present + upstream FAILURE => retrieval fallback,
      //         never an error.
      // ================================================================
      {
        const failMock = failingChatUpstreamMock();
        const bot = loadChatbot({ token: 'hf_test_token', fetchMock: failMock });
        assert.equal(bot.isLLMEnabled(), true);

        // Silence the expected "HF call failed, using fallback" warnings.
        const originalWarn = console.warn;
        console.warn = () => {};
        try {
          // Anchor example.
          const anchor = await bot.answer('how much is the stipend', []);
          assert.equal(anchor.mode, 'fallback');
          assert.equal(typeof anchor.answer, 'string');
          assert.ok(anchor.answer.length > 0);

          await fc.assert(
            fc.asyncProperty(
              tokenArb, // presence of credential varies but stays truthy
              questionArb,
              async (_token, question) => {
                fc.pre(question.trim().length > 0);
                // answer() must resolve (never reject) despite upstream failure.
                const res = await bot.answer(question, []);
                assert.equal(res.mode, 'fallback');
                assert.equal(typeof res.answer, 'string');
                assert.ok(res.answer.length > 0);
                // The fallback is retrieval-based: best snippet when available.
                const chunks = bot.retrieve(question, 3);
                if (chunks.length) assert.equal(res.answer, chunks[0].text);
              },
            ),
            { numRuns: NUM_RUNS },
          );
        } finally {
          console.warn = originalWarn;
        }
      }
    } finally {
      restoreGlobals();
    }
  },
);
