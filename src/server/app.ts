import Fastify, { FastifyInstance } from 'fastify';
import { IdempotencyConflictError, NotFoundError, ValidationError } from '../domain/errors.js';
import { Policy } from '../domain/models.js';
import { RateLimiterEngine } from '../domain/rate-limiter-engine.js';

export function createApp(engine?: RateLimiterEngine): FastifyInstance {
  const limiter = engine ?? new RateLimiterEngine();
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({ status: 'ok' }));

  app.post('/ratelimit/policies', async (request, reply) => {
    try {
      const body = request.body as Omit<Policy, 'created_at' | 'updated_at'>;
      const created = limiter.upsertPolicy(body);
      return reply.code(201).send(created);
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.get('/ratelimit/policies', async (request, reply) => {
    const query = request.query as { tenant_id?: string };
    const items = limiter.listPolicies(query.tenant_id);
    return reply.code(200).send({ items });
  });

  app.patch('/ratelimit/policies/:policy_id', async (request, reply) => {
    try {
      const params = request.params as { policy_id: string };
      const patch = request.body as Partial<Policy>;
      const updated = limiter.patchPolicy(params.policy_id, patch);
      return reply.code(200).send(updated);
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.get('/ratelimit/audit-events', async (request, reply) => {
    const query = request.query as { tenant_id?: string; limit?: string | number };
    const parsedLimit = query.limit !== undefined ? Number(query.limit) : undefined;
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : undefined;
    const items = limiter.listAuditEvents(query.tenant_id, limit);
    return reply.code(200).send({ items });
  });

  app.post('/ratelimit/consume', async (request, reply) => {
    try {
      const body = request.body as {
        tenant_id: string;
        request_id?: string;
        subject: { type: 'USER' | 'API_KEY' | 'IP' | 'TENANT'; id: string; attributes?: Record<string, unknown> };
        resource: { type: 'ENDPOINT' | 'ACTION'; name: string };
        cost?: number;
        dry_run?: boolean;
      };

      const decision = await limiter.consume(body);
      return reply.code(200).send(decision);
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.post('/ratelimit/check', async (request, reply) => {
    try {
      const body = request.body as {
        tenant_id: string;
        request_id?: string;
        subject: { type: 'USER' | 'API_KEY' | 'IP' | 'TENANT'; id: string; attributes?: Record<string, unknown> };
        resource: { type: 'ENDPOINT' | 'ACTION'; name: string };
        cost?: number;
      };

      const decision = await limiter.check({ ...body, dry_run: true });
      return reply.code(200).send(decision);
    } catch (error) {
      return handleError(reply, error);
    }
  });

  return app;
}

function handleError(reply: { code: (status: number) => { send: (payload: unknown) => unknown } }, error: unknown) {
  if (error instanceof ValidationError) {
    return reply.code(400).send({ error: 'BAD_REQUEST', message: error.message });
  }

  if (error instanceof IdempotencyConflictError) {
    return reply.code(409).send({ error: 'IDEMPOTENCY_KEY_REUSE', message: error.message });
  }

  if (error instanceof NotFoundError) {
    return reply.code(404).send({ error: 'NOT_FOUND', message: error.message });
  }

  return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'unexpected error' });
}
