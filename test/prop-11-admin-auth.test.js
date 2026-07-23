'use strict';

/*
 * Feature: reu-recruitment-site, Property 11: Admin endpoints authorize only the correct token
 *
 * Property 11 (design.md):
 *   For any admin endpoint and any provided bearer token, access SHALL be
 *   granted if and only if the token equals the configured ADMIN_TOKEN;
 *   otherwise the request SHALL be rejected as unauthorized.
 *
 * Validates: Requirements 15.1
 *
 * We drive the four admin endpoints guarded by requireAdmin:
 *   - GET /api/admin/applications
 *   - GET /api/admin/applications/:id
 *   - GET /api/admin/transcript/:id
 *   - GET /api/admin/applications.csv
 * For an arbitrary bearer token we assert the response is 401 (unauthorized)
 * iff the token is NOT exactly the configured ADMIN_TOKEN, and is anything
 * other than 401 (i.e. authorization granted, request reaches the handler)
 * when the token exactly equals ADMIN_TOKEN.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fc = require('fast-check');

const { makeFactoryApp } = require('./helpers');

const ADMIN_ENDPOINTS = [
  '/api/admin/applications',
  '/api/admin/applications/1',
  '/api/admin/transcript/1',
  '/api/admin/applications.csv',
];

test(
  'Feature: reu-recruitment-site, Property 11: Admin endpoints authorize only the correct token',
  async () => {
    const ctx = makeFactoryApp();
    const { app } = ctx;
    const adminToken = app.locals.ADMIN_TOKEN;

    try {
      await fc.assert(
        fc.asyncProperty(
          // Arbitrary bearer token. We include the real admin token as one of
          // the frequently-generated values so both branches of the iff are
          // exercised, alongside arbitrary strings that should be rejected.
          fc.oneof(
            { weight: 1, arbitrary: fc.constant(adminToken) },
            // Header-safe token characters (no CR/LF/control chars that would
            // make supertest reject the Authorization header before sending).
            {
              weight: 4,
              arbitrary: fc
                .string({
                  unit: fc.constantFrom(
                    ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'.split(''),
                  ),
                })
                .filter((t) => t !== adminToken),
            },
          ),
          fc.constantFrom(...ADMIN_ENDPOINTS),
          async (token, endpoint) => {
            const res = await request(app)
              .get(endpoint)
              .set('Authorization', 'Bearer ' + token);

            const authorized = res.status !== 401;
            const isCorrectToken = token === adminToken;

            assert.equal(
              authorized,
              isCorrectToken,
              `access granted (status ${res.status}) must hold iff the bearer ` +
                `token equals ADMIN_TOKEN (endpoint ${endpoint})`,
            );
          },
        ),
        { numRuns: 100 },
      );

      // Also confirm a request with no Authorization header at all is rejected.
      for (const endpoint of ADMIN_ENDPOINTS) {
        const res = await request(app).get(endpoint);
        assert.equal(res.status, 401, `missing token must be unauthorized (${endpoint})`);
      }
    } finally {
      ctx.cleanup();
    }
  },
);
