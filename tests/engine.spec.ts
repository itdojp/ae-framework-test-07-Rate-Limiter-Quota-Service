import { describe, expect, it } from 'vitest';
import { IdempotencyConflictError } from '../src/domain/errors.js';
import { RateLimiterEngine } from '../src/domain/rate-limiter-engine.js';

function createEngine(): RateLimiterEngine {
  const engine = new RateLimiterEngine({
    now: () => new Date('2026-02-15T00:00:00.000Z'),
  });

  engine.upsertPolicy({
    policy_id: 'P1',
    tenant_id: 'T1',
    name: 'orders limit',
    status: 'ACTIVE',
    priority: 10,
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

describe('RateLimiterEngine', () => {
  it('TOKEN_BUCKET: deny returns retry_after_ms and tokens stay in bounds', async () => {
    const engine = createEngine();

    const first = await engine.consume({
      tenant_id: 'T1',
      subject: { type: 'USER', id: 'U1' },
      resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
      cost: 10,
      now: '2026-02-15T00:00:00.000Z',
    });
    expect(first.allowed).toBe(true);

    const denied = await engine.consume({
      tenant_id: 'T1',
      subject: { type: 'USER', id: 'U1' },
      resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
      cost: 1,
      now: '2026-02-15T00:00:00.000Z',
    });
    expect(denied.allowed).toBe(false);
    expect(denied.retry_after_ms).not.toBeNull();
    expect(denied.results[0].remaining).toBeGreaterThanOrEqual(0);
    expect(denied.results[0].remaining).toBeLessThanOrEqual(10);
  });

  it('FIXED_WINDOW: allowed count does not exceed limit under concurrency', async () => {
    const engine = createEngine();

    const jobs = Array.from({ length: 100 }, (_, index) =>
      engine.consume({
        tenant_id: 'T1',
        request_id: `req-${index}`,
        subject: { type: 'USER', id: 'U2' },
        resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
        cost: 1,
        now: '2026-02-15T00:00:10.000Z',
      }),
    );

    const decisions = await Promise.all(jobs);
    const allowed = decisions.filter((item) => item.allowed).length;
    expect(allowed).toBeLessThanOrEqual(10);
  });

  it('dry_run does not consume quota', async () => {
    const engine = createEngine();

    const check = await engine.check({
      tenant_id: 'T1',
      subject: { type: 'USER', id: 'U3' },
      resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
      cost: 2,
      now: '2026-02-15T00:01:00.000Z',
    });

    expect(check.allowed).toBe(true);
    expect(check.results[0].remaining).toBe(8);

    const consume = await engine.consume({
      tenant_id: 'T1',
      subject: { type: 'USER', id: 'U3' },
      resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
      cost: 2,
      now: '2026-02-15T00:01:00.000Z',
    });

    expect(consume.allowed).toBe(true);
    expect(consume.results[0].remaining).toBe(8);
  });

  it('records audit logs for policy changes and denied decisions', async () => {
    const engine = createEngine();

    const patched = engine.patchPolicy('P1', {
      name: 'orders limit updated',
    });
    expect(patched.name).toBe('orders limit updated');

    const first = await engine.consume({
      tenant_id: 'T1',
      request_id: 'audit-seed-1',
      subject: { type: 'USER', id: 'U-AUDIT' },
      resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
      cost: 10,
      now: '2026-02-15T00:04:00.000Z',
    });
    expect(first.allowed).toBe(true);

    const denied = await engine.consume({
      tenant_id: 'T1',
      request_id: 'audit-seed-2',
      subject: { type: 'USER', id: 'U-AUDIT' },
      resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
      cost: 1,
      now: '2026-02-15T00:04:00.000Z',
    });
    expect(denied.allowed).toBe(false);

    const events = engine.listAuditEvents('T1', 20);
    expect(events.some((event) => event.type === 'POLICY_UPSERT')).toBe(true);
    expect(events.some((event) => event.type === 'POLICY_PATCH')).toBe(true);
    expect(events.some((event) => event.type === 'REQUEST_DENIED')).toBe(true);
  });

  it('idempotency key prevents double consume', async () => {
    const engine = createEngine();

    const first = await engine.consume({
      tenant_id: 'T1',
      request_id: 'same-req',
      subject: { type: 'USER', id: 'U4' },
      resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
      cost: 1,
      now: '2026-02-15T00:02:00.000Z',
    });

    const replay = await engine.consume({
      tenant_id: 'T1',
      request_id: 'same-req',
      subject: { type: 'USER', id: 'U4' },
      resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
      cost: 1,
      now: '2026-02-15T00:02:00.000Z',
    });

    expect(replay).toEqual(first);

    const next = await engine.consume({
      tenant_id: 'T1',
      request_id: 'next-req',
      subject: { type: 'USER', id: 'U4' },
      resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
      cost: 1,
      now: '2026-02-15T00:02:00.000Z',
    });

    expect(next.allowed).toBe(true);
    expect((next.remaining ?? 0) < (first.remaining ?? 0)).toBe(true);
  });

  it('idempotency mismatch returns conflict error', async () => {
    const engine = createEngine();

    await engine.consume({
      tenant_id: 'T1',
      request_id: 'conflict-req',
      subject: { type: 'USER', id: 'U5' },
      resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
      cost: 1,
      now: '2026-02-15T00:03:00.000Z',
    });

    await expect(
      engine.consume({
        tenant_id: 'T1',
        request_id: 'conflict-req',
        subject: { type: 'USER', id: 'U5' },
        resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
        cost: 2,
        now: '2026-02-15T00:03:01.000Z',
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);

    const events = engine.listAuditEvents('T1', 10);
    expect(events.some((event) => event.type === 'IDEMPOTENCY_CONFLICT')).toBe(true);
  });
});
