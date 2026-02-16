import { describe, expect, it } from 'vitest';
import { IdempotencyConflictError } from '../src/domain/errors.js';
import { RateLimiterEngine } from '../src/domain/rate-limiter-engine.js';

function createAuditEngine(): RateLimiterEngine {
  const engine = new RateLimiterEngine({
    now: () => new Date('2026-02-15T00:10:00.000Z'),
  });

  engine.upsertPolicy({
    policy_id: 'P-AUDIT',
    tenant_id: 'TENANT-AUDIT',
    name: 'audit policy',
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
        capacity: 1,
        refill_tokens_per_sec: 1,
        initial_tokens: 1,
        behavior_on_denied: 'DENY',
      },
    ],
  });

  return engine;
}

describe('Audit log coverage', () => {
  it('records policy change and major events for Issue #1 scope', async () => {
    const engine = createAuditEngine();

    engine.patchPolicy('P-AUDIT', {
      status: 'ACTIVE',
      priority: 101,
    });

    const allowed = await engine.consume({
      tenant_id: 'TENANT-AUDIT',
      request_id: 'audit-allow-1',
      subject: { type: 'USER', id: 'U-AUDIT' },
      resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
      cost: 1,
      now: '2026-02-15T00:10:00.000Z',
    });
    expect(allowed.allowed).toBe(true);

    const denied = await engine.consume({
      tenant_id: 'TENANT-AUDIT',
      request_id: 'audit-deny-1',
      subject: { type: 'USER', id: 'U-AUDIT' },
      resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
      cost: 1,
      now: '2026-02-15T00:10:00.000Z',
    });
    expect(denied.allowed).toBe(false);

    await engine.consume({
      tenant_id: 'TENANT-AUDIT',
      request_id: 'audit-idempotent-1',
      subject: { type: 'USER', id: 'U-IDEMP' },
      resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
      cost: 1,
      now: '2026-02-15T00:10:01.000Z',
    });

    await expect(
      engine.consume({
        tenant_id: 'TENANT-AUDIT',
        request_id: 'audit-idempotent-1',
        subject: { type: 'USER', id: 'U-IDEMP' },
        resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
        cost: 2,
        now: '2026-02-15T00:10:02.000Z',
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);

    const events = engine.listAuditEvents('TENANT-AUDIT', 50);
    const types = new Set(events.map((event) => event.type));
    expect(types.has('POLICY_UPSERT')).toBe(true);
    expect(types.has('POLICY_PATCH')).toBe(true);
    expect(types.has('REQUEST_DENIED')).toBe(true);
    expect(types.has('IDEMPOTENCY_CONFLICT')).toBe(true);
  });
});
