import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';

describe('RateLimiter API', () => {
  it('supports policy create/list and consume/check', async () => {
    const app = createApp();

    const create = await app.inject({
      method: 'POST',
      url: '/ratelimit/policies',
      payload: {
        policy_id: 'P-API',
        tenant_id: 'TENANT-API',
        name: 'api policy',
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
            capacity: 5,
            refill_tokens_per_sec: 1,
            initial_tokens: 5,
            behavior_on_denied: 'DENY',
          },
        ],
      },
    });

    expect(create.statusCode).toBe(201);

    const list = await app.inject({
      method: 'GET',
      url: '/ratelimit/policies?tenant_id=TENANT-API',
    });

    expect(list.statusCode).toBe(200);
    const listBody = list.json() as { items: Array<{ policy_id: string }> };
    expect(listBody.items[0]?.policy_id).toBe('P-API');

    const check = await app.inject({
      method: 'POST',
      url: '/ratelimit/check',
      payload: {
        tenant_id: 'TENANT-API',
        subject: { type: 'USER', id: 'U1' },
        resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
        cost: 1,
      },
    });
    expect(check.statusCode).toBe(200);
    const checkBody = check.json() as { allowed: boolean };
    expect(checkBody.allowed).toBe(true);

    const consume = await app.inject({
      method: 'POST',
      url: '/ratelimit/consume',
      payload: {
        tenant_id: 'TENANT-API',
        request_id: 'api-req-1',
        subject: { type: 'USER', id: 'U1' },
        resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
        cost: 1,
      },
    });
    expect(consume.statusCode).toBe(200);

    await app.close();
  });

  it('supports policy patch and audit event retrieval', async () => {
    const app = createApp();

    const create = await app.inject({
      method: 'POST',
      url: '/ratelimit/policies',
      payload: {
        policy_id: 'P-API-AUDIT',
        tenant_id: 'TENANT-API-AUDIT',
        name: 'api audit policy',
        status: 'ACTIVE',
        priority: 1,
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
      },
    });
    expect(create.statusCode).toBe(201);

    const patch = await app.inject({
      method: 'PATCH',
      url: '/ratelimit/policies/P-API-AUDIT',
      payload: {
        status: 'INACTIVE',
      },
    });
    expect(patch.statusCode).toBe(200);
    const patchBody = patch.json() as { status: string };
    expect(patchBody.status).toBe('INACTIVE');

    const consumeAfterInactive = await app.inject({
      method: 'POST',
      url: '/ratelimit/consume',
      payload: {
        tenant_id: 'TENANT-API-AUDIT',
        request_id: 'audit-req-1',
        subject: { type: 'USER', id: 'U-AUDIT-1' },
        resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
        cost: 1,
      },
    });
    expect(consumeAfterInactive.statusCode).toBe(200);
    const consumeBody = consumeAfterInactive.json() as { policy_id: string | null; allowed: boolean };
    expect(consumeBody.allowed).toBe(true);
    expect(consumeBody.policy_id).toBeNull();

    const audit = await app.inject({
      method: 'GET',
      url: '/ratelimit/audit-events?tenant_id=TENANT-API-AUDIT&limit=10',
    });
    expect(audit.statusCode).toBe(200);
    const auditBody = audit.json() as { items: Array<{ type: string }> };
    expect(auditBody.items.some((item) => item.type === 'POLICY_UPSERT')).toBe(true);
    expect(auditBody.items.some((item) => item.type === 'POLICY_PATCH')).toBe(true);

    await app.close();
  });

  it('returns 409 when same request_id uses different payload', async () => {
    const app = createApp();

    await app.inject({
      method: 'POST',
      url: '/ratelimit/policies',
      payload: {
        policy_id: 'P-API-2',
        tenant_id: 'TENANT-API-2',
        name: 'api policy 2',
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
        ],
      },
    });

    const first = await app.inject({
      method: 'POST',
      url: '/ratelimit/consume',
      payload: {
        tenant_id: 'TENANT-API-2',
        request_id: 'idem-1',
        subject: { type: 'USER', id: 'U1' },
        resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
        cost: 1,
      },
    });
    expect(first.statusCode).toBe(200);

    const conflict = await app.inject({
      method: 'POST',
      url: '/ratelimit/consume',
      payload: {
        tenant_id: 'TENANT-API-2',
        request_id: 'idem-1',
        subject: { type: 'USER', id: 'U1' },
        resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
        cost: 2,
      },
    });

    expect(conflict.statusCode).toBe(409);
    await app.close();
  });
});
