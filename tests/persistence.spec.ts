import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IdempotencyConflictError } from '../src/domain/errors.js';
import { RateLimiterEngine } from '../src/domain/rate-limiter-engine.js';
import { createJsonFileEngineStorage } from '../src/domain/storage.js';

function createPolicy() {
  return {
    policy_id: 'P-PERSIST',
    tenant_id: 'TENANT-PERSIST',
    name: 'persist policy',
    status: 'ACTIVE' as const,
    priority: 10,
    scope: {
      subject_type: 'USER' as const,
      resource_type: 'ENDPOINT' as const,
    },
    match: {
      resource_pattern: '/api/v1/orders*',
    },
    limits: [
      {
        kind: 'TOKEN_BUCKET' as const,
        capacity: 10,
        refill_tokens_per_sec: 1,
        initial_tokens: 10,
        behavior_on_denied: 'DENY' as const,
      },
      {
        kind: 'FIXED_WINDOW' as const,
        window_seconds: 60,
        limit: 20,
        behavior_on_denied: 'DENY' as const,
      },
    ],
  };
}

describe('File-backed storage', () => {
  it('persists policy and limiter states across engine restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rl-persist-'));
    const stateFile = join(dir, 'runtime-state.json');

    try {
      const engine1 = new RateLimiterEngine({
        storage: createJsonFileEngineStorage(stateFile),
        now: () => new Date('2026-02-15T00:00:00.000Z'),
      });
      engine1.upsertPolicy(createPolicy());

      const first = await engine1.consume({
        tenant_id: 'TENANT-PERSIST',
        request_id: 'persist-1',
        subject: { type: 'USER', id: 'U1' },
        resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
        cost: 3,
        now: '2026-02-15T00:00:00.000Z',
      });
      expect(first.allowed).toBe(true);
      expect(first.remaining).toBe(7);

      const engine2 = new RateLimiterEngine({
        storage: createJsonFileEngineStorage(stateFile),
        now: () => new Date('2026-02-15T00:00:00.000Z'),
      });

      const policies = engine2.listPolicies('TENANT-PERSIST');
      expect(policies.length).toBe(1);
      expect(policies[0].policy_id).toBe('P-PERSIST');

      const second = await engine2.consume({
        tenant_id: 'TENANT-PERSIST',
        request_id: 'persist-2',
        subject: { type: 'USER', id: 'U1' },
        resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
        cost: 1,
        now: '2026-02-15T00:00:00.000Z',
      });

      expect(second.allowed).toBe(true);
      expect(second.remaining).toBe(6);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persists idempotency entries across engine restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rl-idem-persist-'));
    const stateFile = join(dir, 'runtime-state.json');

    try {
      const engine1 = new RateLimiterEngine({
        storage: createJsonFileEngineStorage(stateFile),
        now: () => new Date('2026-02-15T00:01:00.000Z'),
      });
      engine1.upsertPolicy(createPolicy());

      const first = await engine1.consume({
        tenant_id: 'TENANT-PERSIST',
        request_id: 'idem-persist-1',
        subject: { type: 'USER', id: 'U2' },
        resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
        cost: 2,
        now: '2026-02-15T00:01:00.000Z',
      });

      const engine2 = new RateLimiterEngine({
        storage: createJsonFileEngineStorage(stateFile),
        now: () => new Date('2026-02-15T00:01:01.000Z'),
      });

      const replay = await engine2.consume({
        tenant_id: 'TENANT-PERSIST',
        request_id: 'idem-persist-1',
        subject: { type: 'USER', id: 'U2' },
        resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
        cost: 2,
        now: '2026-02-15T00:01:01.000Z',
      });

      expect(replay).toEqual(first);

      await expect(
        engine2.consume({
          tenant_id: 'TENANT-PERSIST',
          request_id: 'idem-persist-1',
          subject: { type: 'USER', id: 'U2' },
          resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
          cost: 3,
          now: '2026-02-15T00:01:01.000Z',
        }),
      ).rejects.toBeInstanceOf(IdempotencyConflictError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persists audit events across engine restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rl-audit-persist-'));
    const stateFile = join(dir, 'runtime-state.json');

    try {
      const engine1 = new RateLimiterEngine({
        storage: createJsonFileEngineStorage(stateFile),
        now: () => new Date('2026-02-15T00:02:00.000Z'),
      });
      engine1.upsertPolicy(createPolicy());
      engine1.patchPolicy('P-PERSIST', { priority: 20 });

      await engine1.consume({
        tenant_id: 'TENANT-PERSIST',
        request_id: 'audit-persist-1',
        subject: { type: 'USER', id: 'U-AUDIT-PERSIST' },
        resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
        cost: 10,
        now: '2026-02-15T00:02:00.000Z',
      });
      await engine1.consume({
        tenant_id: 'TENANT-PERSIST',
        request_id: 'audit-persist-2',
        subject: { type: 'USER', id: 'U-AUDIT-PERSIST' },
        resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
        cost: 1,
        now: '2026-02-15T00:02:00.000Z',
      });

      const engine2 = new RateLimiterEngine({
        storage: createJsonFileEngineStorage(stateFile),
        now: () => new Date('2026-02-15T00:02:01.000Z'),
      });
      const events = engine2.listAuditEvents('TENANT-PERSIST', 20);
      const types = new Set(events.map((event) => event.type));

      expect(types.has('POLICY_UPSERT')).toBe(true);
      expect(types.has('POLICY_PATCH')).toBe(true);
      expect(types.has('REQUEST_DENIED')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
