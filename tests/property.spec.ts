import fc from 'fast-check';
import { describe, it } from 'vitest';
import { RateLimiterEngine } from '../src/domain/rate-limiter-engine.js';

function setupEngine(): RateLimiterEngine {
  const engine = new RateLimiterEngine({
    now: () => new Date('2026-02-15T00:00:00.000Z'),
  });

  engine.upsertPolicy({
    policy_id: 'P-PROPERTY',
    tenant_id: 'TENANT-PROPERTY',
    name: 'property policy',
    status: 'ACTIVE',
    priority: 100,
    scope: {
      subject_type: 'USER',
      resource_type: 'ENDPOINT',
    },
    match: {
      resource_pattern: '/api/v1/orders*',
    },
    limits: [
      {
        kind: 'TOKEN_BUCKET',
        capacity: 10,
        refill_tokens_per_sec: 1,
        initial_tokens: 10,
        behavior_on_denied: 'DENY',
      },
      {
        kind: 'FIXED_WINDOW',
        window_seconds: 60,
        limit: 20,
        behavior_on_denied: 'DENY',
      },
    ],
  });

  return engine;
}

describe('Property Tests', () => {
  it('RL-INV-001/002: remaining stays within bounds under randomized sequence', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            deltaMs: fc.integer({ min: 0, max: 1500 }),
            cost: fc.integer({ min: 1, max: 3 }),
          }),
          { minLength: 30, maxLength: 120 },
        ),
        async (operations) => {
          const engine = setupEngine();
          let nowMs = Date.parse('2026-02-15T00:00:00.000Z');

          for (let i = 0; i < operations.length; i += 1) {
            nowMs += operations[i].deltaMs;
            const decision = await engine.consume({
              tenant_id: 'TENANT-PROPERTY',
              request_id: `prop-seq-${i}`,
              subject: { type: 'USER', id: 'USER-PROP-1' },
              resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
              cost: operations[i].cost,
              now: new Date(nowMs).toISOString(),
            });

            for (const result of decision.results) {
              if (result.kind === 'TOKEN_BUCKET' && result.remaining !== null) {
                if (result.remaining < 0 || result.remaining > 10) {
                  throw new Error(`TOKEN_BUCKET remaining out of bounds: ${result.remaining}`);
                }
              }

              if (result.kind === 'FIXED_WINDOW' && result.remaining !== null) {
                if (result.remaining < 0 || result.remaining > 20) {
                  throw new Error(`FIXED_WINDOW remaining out of bounds: ${result.remaining}`);
                }
              }
            }

            if (decision.retry_after_ms !== null && decision.retry_after_ms < 0) {
              throw new Error(`retry_after_ms must be non-negative: ${decision.retry_after_ms}`);
            }
          }
        },
      ),
      { numRuns: 40 },
    );
  });

  it('RL-INV-003: parallel consume does not exceed theoretical upper bound', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 20, max: 120 }),
        fc.integer({ min: 1, max: 4 }),
        async (parallelCount, cost) => {
          const engine = setupEngine();
          const now = '2026-02-15T00:10:00.000Z';

          const jobs = Array.from({ length: parallelCount }, (_, index) =>
            engine.consume({
              tenant_id: 'TENANT-PROPERTY',
              request_id: `prop-par-${index}`,
              subject: { type: 'USER', id: 'USER-PROP-2' },
              resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
              cost,
              now,
            }),
          );

          const decisions = await Promise.all(jobs);
          const allowedCount = decisions.filter((item) => item.allowed).length;
          const expectedUpperBound = Math.min(Math.floor(10 / cost), Math.floor(20 / cost));

          if (allowedCount > expectedUpperBound) {
            throw new Error(`allowed=${allowedCount} exceeds upperBound=${expectedUpperBound} for cost=${cost}`);
          }
        },
      ),
      { numRuns: 25 },
    );
  });

  it('RL-INV-004: idempotent replay returns the same decision', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (cost) => {
        const engine = setupEngine();

        const first = await engine.consume({
          tenant_id: 'TENANT-PROPERTY',
          request_id: 'prop-idem',
          subject: { type: 'USER', id: 'USER-PROP-3' },
          resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
          cost,
          now: '2026-02-15T00:20:00.000Z',
        });

        const replay = await engine.consume({
          tenant_id: 'TENANT-PROPERTY',
          request_id: 'prop-idem',
          subject: { type: 'USER', id: 'USER-PROP-3' },
          resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
          cost,
          now: '2026-02-15T00:20:00.500Z',
        });

        if (JSON.stringify(first) !== JSON.stringify(replay)) {
          throw new Error('replay decision does not match first decision');
        }
      }),
      { numRuns: 30 },
    );
  });
});
