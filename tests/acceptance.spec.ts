import { describe, expect, it } from 'vitest';
import { RateLimiterEngine } from '../src/domain/rate-limiter-engine.js';

function setupEngine(): RateLimiterEngine {
  const engine = new RateLimiterEngine({
    now: () => new Date('2026-02-15T00:00:00.000Z'),
  });

  engine.upsertPolicy({
    policy_id: 'P-ACC',
    tenant_id: 'TENANT-ACC',
    name: 'acceptance policy',
    status: 'ACTIVE',
    priority: 50,
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

describe('Acceptance Criteria', () => {
  it('RL-ACC-01: 100 parallel requests do not exceed theoretical upper bound', async () => {
    const engine = setupEngine();
    const now = '2026-02-15T00:00:10.000Z';

    const jobs = Array.from({ length: 100 }, (_, index) =>
      engine.consume({
        tenant_id: 'TENANT-ACC',
        request_id: `acc1-${index}`,
        subject: { type: 'USER', id: 'U-ACC-1' },
        resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
        cost: 1,
        now,
      }),
    );

    const results = await Promise.all(jobs);
    const allowed = results.filter((item) => item.allowed).length;

    // TOKEN_BUCKET capacity=10, FIXED_WINDOW limit=20 -> composite upper bound is min(10, 20) = 10
    expect(allowed).toBeLessThanOrEqual(10);
  });

  it('RL-ACC-02: same request_id converges to a single consumption', async () => {
    const engine = setupEngine();

    const first = await engine.consume({
      tenant_id: 'TENANT-ACC',
      request_id: 'acc2-req',
      subject: { type: 'USER', id: 'U-ACC-2' },
      resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
      cost: 2,
      now: '2026-02-15T00:00:20.000Z',
    });

    const replay = await engine.consume({
      tenant_id: 'TENANT-ACC',
      request_id: 'acc2-req',
      subject: { type: 'USER', id: 'U-ACC-2' },
      resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
      cost: 2,
      now: '2026-02-15T00:00:20.000Z',
    });

    const next = await engine.consume({
      tenant_id: 'TENANT-ACC',
      request_id: 'acc2-next',
      subject: { type: 'USER', id: 'U-ACC-2' },
      resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
      cost: 2,
      now: '2026-02-15T00:00:20.000Z',
    });

    expect(replay).toEqual(first);
    expect(next.allowed).toBe(true);
    expect((next.remaining ?? 0) < (first.remaining ?? 0)).toBe(true);
  });

  it('RL-ACC-03: retry_after_ms is returned within expected range on deny', async () => {
    const engine = setupEngine();

    await engine.consume({
      tenant_id: 'TENANT-ACC',
      request_id: 'acc3-full',
      subject: { type: 'USER', id: 'U-ACC-3' },
      resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
      cost: 10,
      now: '2026-02-15T00:00:30.000Z',
    });

    const denied = await engine.consume({
      tenant_id: 'TENANT-ACC',
      request_id: 'acc3-denied',
      subject: { type: 'USER', id: 'U-ACC-3' },
      resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
      cost: 1,
      now: '2026-02-15T00:00:30.000Z',
    });

    expect(denied.allowed).toBe(false);
    expect(denied.retry_after_ms).not.toBeNull();
    expect((denied.retry_after_ms ?? 0) >= 900).toBe(true);
    expect((denied.retry_after_ms ?? 0) <= 1000).toBe(true);
  });
});
