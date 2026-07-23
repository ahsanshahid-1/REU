'use strict';

/*
 * Property 15: Chat rate limiter enforces the cap and fails closed.
 *
 * *For any* single client, messages beyond the configured limit within the
 * rolling window SHALL be rejected with a rate-limit response (HTTP 429); and
 * if the rate-limit check cannot be evaluated, the message SHALL be rejected
 * rather than allowed through (fail closed).
 *
 * How the two arms are exercised:
 *
 *   Arm 1 — Cap enforcement (property, >=100 iterations).
 *     `/api/chat` uses an in-memory per-IP limiter (20 messages / rolling
 *     5 min). supertest requests all originate from the same loopback source,
 *     so `req.ip` is constant across a run: a single fresh app therefore models
 *     a single client. For a generated sequence of messages we drive real HTTP
 *     requests and assert the boundary is exactly the configured cap:
 *       - the i-th message with i <= CHAT_MAX is NOT rate-limited (status != 429),
 *       - the i-th message with i >  CHAT_MAX IS rate-limited (status == 429).
 *     The limiter increments before the empty-message check, so the boundary is
 *     purely positional and independent of message content — which is what the
 *     generated (arbitrary) messages probe. A fresh app per run resets the
 *     per-IP counter so each run is an independent single client.
 *
 *   Arm 2 — Fail closed.
 *     The limiter check in server.js is wrapped in try/catch: any exception
 *     while evaluating the rate limit yields a 429 rather than passing the
 *     request through to the chatbot. The only Date/clock call reached on the
 *     POST /api/chat path (json + cookie middleware do not call it) is
 *     `Date.now()` inside `chatRateLimited`. We drive the real fail-closed
 *     branch end-to-end by making `Date.now` throw for the duration of a single
 *     request: the wrapped check throws, the catch sets `limited = true`, and
 *     the endpoint returns 429. Date.now is restored immediately after each
 *     request. The chatbot is mocked to reject if ever reached, proving the
 *     request never passes through when the check cannot be evaluated.
 *
 * The chatbot is mocked (via buildTestApp's chatbotMock) so `/api/chat`
 * responds fast and deterministically without any network access.
 *
 * Validates: Requirements 16.5
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const request = require('supertest');

const { buildTestApp } = require('./helpers');

// Mirror the server's configured cap (server.js: CHAT_MAX = 20). The limiter
// rejects once the recorded hit count EXCEEDS this value, so message N is the
// first rejection when N === CHAT_MAX + 1.
const CHAT_MAX = 20;
const NUM_RUNS = 100;

// A chatbot mock that answers instantly. Used for the cap-enforcement arm so
// under-cap requests resolve as 200 without touching the network.
const okChatbotMock = {
  async answer() {
    return { mode: 'test', answer: 'ok', sources: [] };
  },
  // The endpoint only calls answer(); provide the rest of the surface as inert
  // no-ops so the injected module is a faithful stand-in.
  isLLMEnabled() { return false; },
  retrieve() { return []; },
};

// A chatbot mock that MUST NOT be reached. Used for the fail-closed arm: if the
// request ever gets past the (throwing) rate-limit check to the chatbot, this
// rejects and the test fails — proving the request was rejected, not passed
// through.
const forbiddenChatbotMock = {
  async answer() {
    throw new Error('chatbot.answer must not be reached when the rate-limit check fails closed');
  },
  isLLMEnabled() { return false; },
  retrieve() { return []; },
};

// Non-empty, printable messages. Content is irrelevant to the cap (the limiter
// counts before inspecting the body); varying it demonstrates that the boundary
// is positional, not content-dependent.
const messageArb = fc
  .string({ minLength: 1, maxLength: 40 })
  .map((s) => (s.trim() ? s : 'hello'));

test(
  'Feature: reu-recruitment-site, Property 15: Chat rate limiter enforces the cap and fails closed',
  async () => {
    // ================================================================
    // Arm 1: cap enforcement — under the cap is allowed, over is 429.
    // ================================================================
    await fc.assert(
      fc.asyncProperty(
        // A sequence spanning the boundary: always exceed the cap by a few so
        // every run observes at least one rejection.
        fc.array(messageArb, { minLength: CHAT_MAX + 1, maxLength: CHAT_MAX + 5 }),
        async (messages) => {
          const ctx = buildTestApp({ chatbotMock: okChatbotMock });
          try {
            for (let i = 1; i <= messages.length; i++) {
              const res = await request(ctx.app)
                .post('/api/chat')
                .send({ message: messages[i - 1] });

              if (i <= CHAT_MAX) {
                // Within the cap: must not be rate-limited.
                assert.notEqual(
                  res.status, 429,
                  `message ${i} (<= cap ${CHAT_MAX}) must not be rate-limited, got ${res.status}`,
                );
              } else {
                // Beyond the cap: must be rejected with 429 and report the limit.
                assert.equal(
                  res.status, 429,
                  `message ${i} (> cap ${CHAT_MAX}) must be rate-limited, got ${res.status}`,
                );
                assert.ok(
                  res.body && typeof res.body.error === 'string' && res.body.error.length > 0,
                  'a rate-limited response must report that the limit was reached',
                );
              }
            }
          } finally {
            ctx.cleanup();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );

    // Anchor example for Arm 1: exactly at and just over the boundary.
    {
      const ctx = buildTestApp({ chatbotMock: okChatbotMock });
      try {
        for (let i = 1; i <= CHAT_MAX; i++) {
          const res = await request(ctx.app).post('/api/chat').send({ message: 'q' + i });
          assert.notEqual(res.status, 429, `boundary: message ${i} should be allowed`);
        }
        const over = await request(ctx.app).post('/api/chat').send({ message: 'one too many' });
        assert.equal(over.status, 429, 'the (cap + 1)-th message must be rejected');
      } finally {
        ctx.cleanup();
      }
    }

    // ================================================================
    // Arm 2: fail closed — when the rate-limit check cannot be evaluated
    //        (its clock read throws), the request is rejected, not passed
    //        through to the chatbot.
    // ================================================================
    {
      const ctx = buildTestApp({ chatbotMock: forbiddenChatbotMock });
      const realDateNow = Date.now;
      const realConsoleError = console.error;
      try {
        // A few representative messages; each drives the real try/catch branch.
        const failClosedMessages = ['hi', 'stipend?', 'when is the deadline', 'x'];
        for (const message of failClosedMessages) {
          // Silence the expected "[chat] rate-limit check failed" log line.
          console.error = () => {};
          // Make the clock read inside chatRateLimited throw for exactly this
          // request; the surrounding try/catch must fail closed with a 429.
          Date.now = () => { throw new Error('simulated clock failure'); };
          let res;
          try {
            res = await request(ctx.app).post('/api/chat').send({ message });
          } finally {
            Date.now = realDateNow;
            console.error = realConsoleError;
          }
          assert.equal(
            res.status, 429,
            'when the rate-limit check cannot be evaluated, the request must be rejected (fail closed)',
          );
          assert.ok(
            res.body && typeof res.body.error === 'string' && res.body.error.length > 0,
            'the fail-closed response must report that the limit was reached',
          );
        }
      } finally {
        Date.now = realDateNow;
        console.error = realConsoleError;
        ctx.cleanup();
      }
    }
  },
);
