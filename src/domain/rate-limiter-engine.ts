import {
  BucketState,
  ConsumeRequest,
  Decision,
  FixedWindowLimit,
  Limit,
  LimitResult,
  Policy,
  RESOURCE_TYPES,
  SUBJECT_TYPES,
  TokenBucketLimit,
  WindowCounterState,
} from './models.js';
import { IdempotencyConflictError, NotFoundError, ValidationError } from './errors.js';
import { stableHashPayload } from './hash.js';
import { KeyedMutex } from './mutex.js';
import { createInMemoryEngineStorage, EngineStorage, IdempotencyEntry } from './storage.js';

interface EngineOptions {
  idempotency_ttl_ms?: number;
  now?: () => Date;
  storage?: EngineStorage;
}

interface LimitEvaluation {
  result: LimitResult;
  apply: (() => void) | null;
}

const DEFAULT_IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

export class RateLimiterEngine {
  private readonly policies: Map<string, Policy>;
  private readonly bucketStates: Map<string, BucketState>;
  private readonly windowStates: Map<string, WindowCounterState>;
  private readonly idempotencyStore: Map<string, IdempotencyEntry>;
  private readonly mutex = new KeyedMutex();
  private readonly idempotencyTtlMs: number;
  private readonly nowFn: () => Date;
  private readonly persistStorage: () => void;

  constructor(options: EngineOptions = {}) {
    this.idempotencyTtlMs = options.idempotency_ttl_ms ?? DEFAULT_IDEMPOTENCY_TTL_MS;
    this.nowFn = options.now ?? (() => new Date());
    const storage = options.storage ?? createInMemoryEngineStorage();
    this.policies = storage.policies;
    this.bucketStates = storage.bucketStates;
    this.windowStates = storage.windowStates;
    this.idempotencyStore = storage.idempotencyStore;
    this.persistStorage = storage.persist;
  }

  upsertPolicy(input: Omit<Policy, 'created_at' | 'updated_at'>): Policy {
    this.validatePolicy(input);

    const now = this.nowFn().toISOString();
    const existing = this.policies.get(input.policy_id);
    const createdAt = existing?.created_at ?? now;
    const next: Policy = {
      ...input,
      created_at: createdAt,
      updated_at: now,
    };

    this.policies.set(next.policy_id, next);
    this.persistStorage();
    return structuredClone(next);
  }

  listPolicies(tenantId?: string): Policy[] {
    const values = Array.from(this.policies.values());
    return values
      .filter((policy) => (tenantId ? policy.tenant_id === tenantId : true))
      .sort((a, b) => b.priority - a.priority || a.policy_id.localeCompare(b.policy_id))
      .map((policy) => structuredClone(policy));
  }

  patchPolicy(policyId: string, patch: Partial<Omit<Policy, 'policy_id' | 'tenant_id' | 'created_at' | 'updated_at'>>): Policy {
    const policy = this.policies.get(policyId);
    if (!policy) {
      throw new NotFoundError(`policy not found: ${policyId}`);
    }

    const next: Policy = {
      ...policy,
      ...patch,
      policy_id: policy.policy_id,
      tenant_id: policy.tenant_id,
      created_at: policy.created_at,
      updated_at: this.nowFn().toISOString(),
    };

    this.validatePolicy(next);
    this.policies.set(policyId, next);
    this.persistStorage();
    return structuredClone(next);
  }

  async consume(request: ConsumeRequest): Promise<Decision> {
    return this.evaluate({ ...request, dry_run: request.dry_run ?? false });
  }

  async check(request: ConsumeRequest): Promise<Decision> {
    return this.evaluate({ ...request, dry_run: true });
  }

  private async evaluate(request: ConsumeRequest): Promise<Decision> {
    const nowDate = this.parseNow(request.now);
    this.validateRequest(request);
    const cost = request.cost ?? 1;
    const dryRun = request.dry_run ?? false;

    const tenantLockKey = `tenant:${request.tenant_id}`;
    return this.mutex.runExclusive(tenantLockKey, async () => {
      const nowMs = nowDate.getTime();
      this.cleanupIdempotency(nowMs);

      const idempotencyKey = request.request_id ? `${request.tenant_id}:${request.request_id}` : null;
      const payloadHash = idempotencyKey
        ? stableHashPayload({
            tenant_id: request.tenant_id,
            subject: request.subject,
            resource: request.resource,
            cost,
            dry_run: dryRun,
          })
        : null;

      if (idempotencyKey && payloadHash) {
        const cached = this.idempotencyStore.get(idempotencyKey);
        if (cached && cached.expires_at_ms > nowMs) {
          if (cached.payload_hash !== payloadHash) {
            throw new IdempotencyConflictError('IDEMPOTENCY_KEY_REUSE: payload mismatch for request_id');
          }
          return structuredClone(cached.decision);
        }
      }

      const policy = this.selectPolicy(request.tenant_id, request.subject, request.resource);
      if (!policy) {
        const decision: Decision = {
          allowed: true,
          policy_id: null,
          results: [],
          retry_after_ms: null,
          remaining: null,
          reset_at: null,
        };

        if (idempotencyKey && payloadHash) {
          this.idempotencyStore.set(idempotencyKey, {
            payload_hash: payloadHash,
            decision: structuredClone(decision),
            expires_at_ms: nowMs + this.idempotencyTtlMs,
          });
          this.persistStorage();
        }

        return decision;
      }

      const evaluations: LimitEvaluation[] = [];
      policy.limits.forEach((limit, index) => {
        if (limit.kind === 'TOKEN_BUCKET') {
          evaluations.push(this.evaluateTokenBucket(limit, policy, request, index, cost, nowMs, dryRun));
        } else {
          evaluations.push(this.evaluateFixedWindow(limit, policy, request, index, cost, nowMs, dryRun));
        }
      });

      const results = evaluations.map((item) => item.result);
      const denied = results.filter((result) => !result.allowed);
      const allowed = denied.length === 0;

      if (allowed && !dryRun) {
        evaluations.forEach((item) => {
          if (item.apply) {
            item.apply();
          }
        });
      }

      const retryAfterCandidates = denied
        .map((item) => item.retry_after_ms)
        .filter((value): value is number => value !== null && Number.isFinite(value));
      const retryAfterMs = retryAfterCandidates.length > 0 ? Math.min(...retryAfterCandidates) : null;

      const remainingCandidates = results
        .map((item) => item.remaining)
        .filter((value): value is number => value !== null && Number.isFinite(value));
      const remaining = allowed && remainingCandidates.length > 0 ? Math.min(...remainingCandidates) : null;

      const resetCandidates = results
        .map((item) => item.reset_at)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

      const decision: Decision = {
        allowed,
        policy_id: policy.policy_id,
        results,
        retry_after_ms: allowed ? null : retryAfterMs,
        remaining,
        reset_at: resetCandidates.length > 0 ? resetCandidates[0] : null,
      };

      if (idempotencyKey && payloadHash) {
        this.idempotencyStore.set(idempotencyKey, {
          payload_hash: payloadHash,
          decision: structuredClone(decision),
          expires_at_ms: nowMs + this.idempotencyTtlMs,
        });
        this.persistStorage();
      }

      return decision;
    });
  }

  private evaluateTokenBucket(
    limit: TokenBucketLimit,
    policy: Policy,
    request: ConsumeRequest,
    index: number,
    cost: number,
    nowMs: number,
    dryRun: boolean,
  ): LimitEvaluation {
    if (limit.max_cost !== undefined && cost > limit.max_cost) {
      throw new ValidationError(`cost exceeds max_cost for TOKEN_BUCKET: ${limit.max_cost}`);
    }

    const key = this.stateKey(policy, request, index, 'TOKEN_BUCKET');
    const existing = this.bucketStates.get(key);
    const initialTokens = limit.initial_tokens ?? limit.capacity;
    const baseState: BucketState = existing
      ? { ...existing }
      : {
          tokens: initialTokens,
          last_refill_at_ms: nowMs,
          updated_at_ms: nowMs,
        };

    const effectiveNowMs = Math.max(nowMs, baseState.last_refill_at_ms);
    const elapsedSeconds = (effectiveNowMs - baseState.last_refill_at_ms) / 1000;
    const refilledTokens = Math.min(limit.capacity, baseState.tokens + elapsedSeconds * limit.refill_tokens_per_sec);

    const allowed = refilledTokens >= cost;
    const nextTokens = allowed ? refilledTokens - cost : refilledTokens;
    const safeTokens = Math.max(0, Math.min(limit.capacity, nextTokens));

    const retryAfterMs = allowed
      ? null
      : Math.max(0, Math.ceil(((cost - refilledTokens) / limit.refill_tokens_per_sec) * 1000));

    const apply = allowed && !dryRun
      ? () => {
          this.bucketStates.set(key, {
            tokens: safeTokens,
            last_refill_at_ms: effectiveNowMs,
            updated_at_ms: effectiveNowMs,
          });
          this.persistStorage();
        }
      : null;

    return {
      result: {
        kind: 'TOKEN_BUCKET',
        allowed,
        remaining: Number(safeTokens.toFixed(6)),
        retry_after_ms: retryAfterMs,
        reset_at: null,
      },
      apply,
    };
  }

  private evaluateFixedWindow(
    limit: FixedWindowLimit,
    policy: Policy,
    request: ConsumeRequest,
    index: number,
    cost: number,
    nowMs: number,
    dryRun: boolean,
  ): LimitEvaluation {
    const key = this.stateKey(policy, request, index, 'FIXED_WINDOW');
    const windowMs = limit.window_seconds * 1000;
    const windowStartMs = Math.floor(nowMs / windowMs) * windowMs;
    const existing = this.windowStates.get(key);
    const baseUsed = existing && existing.window_start_ms === windowStartMs ? existing.used : 0;

    const candidateUsed = baseUsed + cost;
    const allowed = candidateUsed <= limit.limit;
    const usedAfterDecision = allowed ? candidateUsed : baseUsed;

    const resetAtMs = windowStartMs + windowMs;
    const apply = allowed && !dryRun
      ? () => {
          this.windowStates.set(key, {
            window_start_ms: windowStartMs,
            used: usedAfterDecision,
            updated_at_ms: nowMs,
          });
          this.persistStorage();
        }
      : null;

    return {
      result: {
        kind: 'FIXED_WINDOW',
        allowed,
        remaining: Math.max(0, Number((limit.limit - usedAfterDecision).toFixed(6))),
        retry_after_ms: allowed ? null : Math.max(0, resetAtMs - nowMs),
        reset_at: new Date(resetAtMs).toISOString(),
      },
      apply,
    };
  }

  private stateKey(policy: Policy, request: ConsumeRequest, limitIndex: number, kind: Limit['kind']): string {
    return [
      policy.tenant_id,
      policy.policy_id,
      request.subject.type,
      request.subject.id,
      request.resource.type,
      request.resource.name,
      kind,
      String(limitIndex),
    ].join(':');
  }

  private parseNow(raw: string | Date | undefined): Date {
    const now = raw ? new Date(raw) : this.nowFn();
    if (Number.isNaN(now.getTime())) {
      throw new ValidationError('invalid now parameter');
    }
    return now;
  }

  private cleanupIdempotency(nowMs: number): void {
    let mutated = false;
    for (const [key, value] of this.idempotencyStore.entries()) {
      if (value.expires_at_ms <= nowMs) {
        this.idempotencyStore.delete(key);
        mutated = true;
      }
    }
    if (mutated) {
      this.persistStorage();
    }
  }

  private validateRequest(request: ConsumeRequest): void {
    if (!request.tenant_id || request.tenant_id.trim().length === 0) {
      throw new ValidationError('tenant_id is required');
    }

    if (!SUBJECT_TYPES.includes(request.subject.type)) {
      throw new ValidationError(`invalid subject.type: ${request.subject.type}`);
    }

    if (!RESOURCE_TYPES.includes(request.resource.type)) {
      throw new ValidationError(`invalid resource.type: ${request.resource.type}`);
    }

    if (!request.subject.id || request.subject.id.trim().length === 0) {
      throw new ValidationError('subject.id is required');
    }

    if (!request.resource.name || request.resource.name.trim().length === 0) {
      throw new ValidationError('resource.name is required');
    }

    const cost = request.cost ?? 1;
    if (!Number.isFinite(cost) || cost <= 0) {
      throw new ValidationError('cost must be greater than 0');
    }
  }

  private validatePolicy(policy: Omit<Policy, 'created_at' | 'updated_at'> | Policy): void {
    if (!policy.policy_id.trim()) {
      throw new ValidationError('policy_id is required');
    }

    if (!policy.tenant_id.trim()) {
      throw new ValidationError('tenant_id is required');
    }

    if (!SUBJECT_TYPES.includes(policy.scope.subject_type)) {
      throw new ValidationError(`invalid subject_type: ${policy.scope.subject_type}`);
    }

    if (!RESOURCE_TYPES.includes(policy.scope.resource_type)) {
      throw new ValidationError(`invalid resource_type: ${policy.scope.resource_type}`);
    }

    if (!policy.match.resource_pattern || policy.match.resource_pattern.trim().length === 0) {
      throw new ValidationError('match.resource_pattern is required');
    }

    if (!Array.isArray(policy.limits) || policy.limits.length === 0) {
      throw new ValidationError('policy.limits must contain at least one limit');
    }

    for (const limit of policy.limits) {
      if (limit.kind === 'TOKEN_BUCKET') {
        if (limit.capacity <= 0) {
          throw new ValidationError('TOKEN_BUCKET.capacity must be greater than 0');
        }
        if (limit.refill_tokens_per_sec <= 0) {
          throw new ValidationError('TOKEN_BUCKET.refill_tokens_per_sec must be greater than 0');
        }
        if (limit.initial_tokens !== undefined && (limit.initial_tokens < 0 || limit.initial_tokens > limit.capacity)) {
          throw new ValidationError('TOKEN_BUCKET.initial_tokens must be in [0, capacity]');
        }
      }

      if (limit.kind === 'FIXED_WINDOW') {
        if (limit.window_seconds <= 0) {
          throw new ValidationError('FIXED_WINDOW.window_seconds must be greater than 0');
        }
        if (limit.limit <= 0) {
          throw new ValidationError('FIXED_WINDOW.limit must be greater than 0');
        }
      }
    }
  }

  private selectPolicy(tenantId: string, subject: ConsumeRequest['subject'], resource: ConsumeRequest['resource']): Policy | null {
    const candidates = Array.from(this.policies.values())
      .filter((policy) => policy.tenant_id === tenantId)
      .filter((policy) => policy.status === 'ACTIVE')
      .filter((policy) => policy.scope.subject_type === subject.type)
      .filter((policy) => policy.scope.resource_type === resource.type)
      .filter((policy) => this.matchPattern(policy.match.resource_pattern, resource.name))
      .filter((policy) => this.matchSubjectFilter(policy.match.subject_filter, subject))
      .sort((a, b) => b.priority - a.priority || a.policy_id.localeCompare(b.policy_id));

    return candidates[0] ?? null;
  }

  private matchPattern(pattern: string, value: string): boolean {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^${escaped.replace(/\*/g, '.*')}$`);
    return regex.test(value);
  }

  private matchSubjectFilter(filter: Record<string, unknown> | undefined, subject: ConsumeRequest['subject']): boolean {
    if (!filter) {
      return true;
    }

    const context: Record<string, unknown> = {
      id: subject.id,
      type: subject.type,
      ...(subject.attributes ?? {}),
    };

    return Object.entries(filter).every(([key, value]) => context[key] === value);
  }
}
