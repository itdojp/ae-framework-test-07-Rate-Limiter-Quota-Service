export const SUBJECT_TYPES = ['USER', 'API_KEY', 'IP', 'TENANT'] as const;
export const RESOURCE_TYPES = ['ENDPOINT', 'ACTION'] as const;
export const POLICY_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

export type SubjectType = (typeof SUBJECT_TYPES)[number];
export type ResourceType = (typeof RESOURCE_TYPES)[number];
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

export interface Subject {
  type: SubjectType;
  id: string;
  attributes?: Record<string, unknown>;
}

export interface Resource {
  type: ResourceType;
  name: string;
}

export interface TokenBucketLimit {
  kind: 'TOKEN_BUCKET';
  capacity: number;
  refill_tokens_per_sec: number;
  initial_tokens?: number;
  max_cost?: number;
  behavior_on_denied: 'DENY';
}

export interface FixedWindowLimit {
  kind: 'FIXED_WINDOW';
  window_seconds: number;
  limit: number;
  counter_key_granularity?: 'WINDOW_START';
  behavior_on_denied: 'DENY';
}

export type Limit = TokenBucketLimit | FixedWindowLimit;

export interface Policy {
  policy_id: string;
  tenant_id: string;
  name: string;
  status: PolicyStatus;
  priority: number;
  scope: {
    subject_type: SubjectType;
    resource_type: ResourceType;
  };
  match: {
    resource_pattern: string;
    subject_filter?: Record<string, unknown>;
  };
  limits: Limit[];
  created_at: string;
  updated_at: string;
}

export interface LimitResult {
  kind: Limit['kind'];
  allowed: boolean;
  remaining: number | null;
  retry_after_ms: number | null;
  reset_at: string | null;
}

export interface Decision {
  allowed: boolean;
  policy_id: string | null;
  results: LimitResult[];
  retry_after_ms: number | null;
  remaining: number | null;
  reset_at: string | null;
}

export interface ConsumeRequest {
  tenant_id: string;
  request_id?: string;
  subject: Subject;
  resource: Resource;
  cost?: number;
  dry_run?: boolean;
  now?: string | Date;
}

export interface BucketState {
  tokens: number;
  last_refill_at_ms: number;
  updated_at_ms: number;
}

export interface WindowCounterState {
  window_start_ms: number;
  used: number;
  updated_at_ms: number;
}
