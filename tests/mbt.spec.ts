import { describe, expect, it } from 'vitest';
import { IdempotencyConflictError } from '../src/domain/errors.js';
import { RateLimiterEngine } from '../src/domain/rate-limiter-engine.js';

interface ModelState {
  tokens: number;
  lastRefillAtMs: number;
  windowStartMs: number;
  used: number;
  cache: Map<string, { payloadHash: string; decision: ModelDecision }>;
}

interface ModelDecision {
  allowed: boolean;
  retryAfterMs: number | null;
  remaining: number | null;
}

const CAPACITY = 10;
const REFILL_PER_SEC = 1;
const WINDOW_SECONDS = 60;
const WINDOW_LIMIT = 20;
const WINDOW_MS = WINDOW_SECONDS * 1000;

function setupEngine(): RateLimiterEngine {
  const engine = new RateLimiterEngine({
    now: () => new Date('2026-02-15T00:00:00.000Z'),
  });

  engine.upsertPolicy({
    policy_id: 'P-MBT',
    tenant_id: 'TENANT-MBT',
    name: 'mbt policy',
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
        capacity: CAPACITY,
        refill_tokens_per_sec: REFILL_PER_SEC,
        initial_tokens: CAPACITY,
        behavior_on_denied: 'DENY',
      },
      {
        kind: 'FIXED_WINDOW',
        window_seconds: WINDOW_SECONDS,
        limit: WINDOW_LIMIT,
        behavior_on_denied: 'DENY',
      },
    ],
  });

  return engine;
}

function setupModel(): ModelState {
  return {
    tokens: CAPACITY,
    lastRefillAtMs: Date.parse('2026-02-15T00:00:00.000Z'),
    windowStartMs: Date.parse('2026-02-15T00:00:00.000Z'),
    used: 0,
    cache: new Map<string, { payloadHash: string; decision: ModelDecision }>(),
  };
}

function payloadHash(cost: number, dryRun: boolean): string {
  return JSON.stringify({
    tenant_id: 'TENANT-MBT',
    subject: { type: 'USER', id: 'USER-MBT-1' },
    resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
    cost,
    dry_run: dryRun,
  });
}

function evaluateModel(
  state: ModelState,
  input: { requestId: string; cost: number; nowMs: number; dryRun: boolean },
): ModelDecision {
  const hash = payloadHash(input.cost, input.dryRun);
  const cached = state.cache.get(input.requestId);

  if (cached) {
    if (cached.payloadHash !== hash) {
      throw new IdempotencyConflictError('IDEMPOTENCY_KEY_REUSE: payload mismatch for request_id');
    }
    return cached.decision;
  }

  const effectiveNowMs = Math.max(input.nowMs, state.lastRefillAtMs);
  const elapsedSec = (effectiveNowMs - state.lastRefillAtMs) / 1000;
  const refilled = Math.min(CAPACITY, state.tokens + elapsedSec * REFILL_PER_SEC);
  const tokenAllowed = refilled >= input.cost;
  const tokenAfter = tokenAllowed ? refilled - input.cost : refilled;

  const windowStartMs = Math.floor(input.nowMs / WINDOW_MS) * WINDOW_MS;
  const baseUsed = state.windowStartMs === windowStartMs ? state.used : 0;
  const candidateUsed = baseUsed + input.cost;
  const windowAllowed = candidateUsed <= WINDOW_LIMIT;
  const usedAfter = windowAllowed ? candidateUsed : baseUsed;

  const allowed = tokenAllowed && windowAllowed;

  const tokenRetry = tokenAllowed ? null : Math.ceil(((input.cost - refilled) / REFILL_PER_SEC) * 1000);
  const windowRetry = windowAllowed ? null : Math.max(0, windowStartMs + WINDOW_MS - input.nowMs);
  const retryCandidates = [tokenRetry, windowRetry].filter((value): value is number => value !== null);

  const decision: ModelDecision = {
    allowed,
    retryAfterMs: allowed ? null : Math.min(...retryCandidates),
    remaining: allowed ? Math.min(Number(tokenAfter.toFixed(6)), WINDOW_LIMIT - usedAfter) : null,
  };

  if (allowed && !input.dryRun) {
    state.tokens = Number(tokenAfter.toFixed(6));
    state.lastRefillAtMs = effectiveNowMs;
    state.windowStartMs = windowStartMs;
    state.used = usedAfter;
  }

  state.cache.set(input.requestId, {
    payloadHash: hash,
    decision,
  });

  return decision;
}

describe('MBT-style state machine tests', () => {
  it('matches reference model for consume/check/time_advance/retry sequence', async () => {
    const engine = setupEngine();
    const model = setupModel();

    const sequence = [
      { type: 'consume', requestId: 'mbt-1', cost: 5, nowMs: Date.parse('2026-02-15T00:00:00.000Z') },
      { type: 'check', requestId: 'mbt-2', cost: 3, nowMs: Date.parse('2026-02-15T00:00:00.000Z') },
      { type: 'consume', requestId: 'mbt-3', cost: 3, nowMs: Date.parse('2026-02-15T00:00:00.000Z') },
      // RL-RULE-TIME-001: now going backward should be clamped
      { type: 'consume', requestId: 'mbt-4', cost: 3, nowMs: Date.parse('2026-02-14T23:59:59.700Z') },
      { type: 'consume', requestId: 'mbt-5', cost: 2, nowMs: Date.parse('2026-02-15T00:00:02.000Z') },
      { type: 'consume', requestId: 'mbt-6', cost: 8, nowMs: Date.parse('2026-02-15T00:00:02.000Z') },
      { type: 'consume', requestId: 'mbt-5', cost: 2, nowMs: Date.parse('2026-02-15T00:00:02.500Z') },
    ] as const;

    for (const step of sequence) {
      const dryRun = step.type === 'check';

      const sutDecision =
        step.type === 'check'
          ? await engine.check({
              tenant_id: 'TENANT-MBT',
              request_id: step.requestId,
              subject: { type: 'USER', id: 'USER-MBT-1' },
              resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
              cost: step.cost,
              now: new Date(step.nowMs).toISOString(),
            })
          : await engine.consume({
              tenant_id: 'TENANT-MBT',
              request_id: step.requestId,
              subject: { type: 'USER', id: 'USER-MBT-1' },
              resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
              cost: step.cost,
              now: new Date(step.nowMs).toISOString(),
            });

      const modelDecision = evaluateModel(model, {
        requestId: step.requestId,
        cost: step.cost,
        nowMs: step.nowMs,
        dryRun,
      });

      expect(sutDecision.allowed).toBe(modelDecision.allowed);
      expect(sutDecision.retry_after_ms).toBe(modelDecision.retryAfterMs);

      if (sutDecision.remaining === null || modelDecision.remaining === null) {
        expect(sutDecision.remaining).toBe(modelDecision.remaining);
      } else {
        expect(Math.abs(sutDecision.remaining - modelDecision.remaining) < 0.000001).toBe(true);
      }
    }
  });

  it('returns conflict on idempotency payload mismatch', async () => {
    const engine = setupEngine();

    await engine.consume({
      tenant_id: 'TENANT-MBT',
      request_id: 'mbt-conflict',
      subject: { type: 'USER', id: 'USER-MBT-2' },
      resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
      cost: 1,
      now: '2026-02-15T00:01:00.000Z',
    });

    await expect(
      engine.consume({
        tenant_id: 'TENANT-MBT',
        request_id: 'mbt-conflict',
        subject: { type: 'USER', id: 'USER-MBT-2' },
        resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
        cost: 2,
        now: '2026-02-15T00:01:00.000Z',
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });
});
