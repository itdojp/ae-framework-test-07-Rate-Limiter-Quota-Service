import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AuditEvent, BucketState, Decision, Policy, WindowCounterState } from './models.js';

export interface IdempotencyEntry {
  payload_hash: string;
  decision: Decision;
  expires_at_ms: number;
}

export interface EngineStorage {
  policies: Map<string, Policy>;
  bucketStates: Map<string, BucketState>;
  windowStates: Map<string, WindowCounterState>;
  idempotencyStore: Map<string, IdempotencyEntry>;
  auditEvents: AuditEvent[];
  persist: () => void;
}

interface SerializedState {
  schemaVersion: 'v1';
  policies: Array<[string, Policy]>;
  bucketStates: Array<[string, BucketState]>;
  windowStates: Array<[string, WindowCounterState]>;
  idempotencyStore: Array<[string, IdempotencyEntry]>;
  auditEvents?: AuditEvent[];
}

function toSerialized(storage: Omit<EngineStorage, 'persist'>): SerializedState {
  return {
    schemaVersion: 'v1',
    policies: Array.from(storage.policies.entries()),
    bucketStates: Array.from(storage.bucketStates.entries()),
    windowStates: Array.from(storage.windowStates.entries()),
    idempotencyStore: Array.from(storage.idempotencyStore.entries()),
    auditEvents: storage.auditEvents.map((event) => ({ ...event })),
  };
}

function fromSerialized(raw: SerializedState): Omit<EngineStorage, 'persist'> {
  return {
    policies: new Map(raw.policies),
    bucketStates: new Map(raw.bucketStates),
    windowStates: new Map(raw.windowStates),
    idempotencyStore: new Map(raw.idempotencyStore),
    auditEvents: Array.isArray(raw.auditEvents) ? raw.auditEvents.map((event) => ({ ...event })) : [],
  };
}

export function createInMemoryEngineStorage(): EngineStorage {
  return {
    policies: new Map<string, Policy>(),
    bucketStates: new Map<string, BucketState>(),
    windowStates: new Map<string, WindowCounterState>(),
    idempotencyStore: new Map<string, IdempotencyEntry>(),
    auditEvents: [],
    persist: () => {
      // no-op for memory backend
    },
  };
}

export function createJsonFileEngineStorage(filePath: string): EngineStorage {
  const absolutePath = resolve(filePath);
  mkdirSync(dirname(absolutePath), { recursive: true });

  const loaded = loadSnapshot(absolutePath);
  const state = loaded ?? {
    policies: new Map<string, Policy>(),
    bucketStates: new Map<string, BucketState>(),
    windowStates: new Map<string, WindowCounterState>(),
    idempotencyStore: new Map<string, IdempotencyEntry>(),
    auditEvents: [],
  };

  const persist = () => {
    const payload = toSerialized(state);
    writeFileSync(absolutePath, JSON.stringify(payload, null, 2), 'utf8');
  };

  return {
    ...state,
    persist,
  };
}

function loadSnapshot(filePath: string): Omit<EngineStorage, 'persist'> | null {
  try {
    const text = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(text) as SerializedState;
    if (parsed.schemaVersion !== 'v1') {
      return null;
    }
    return fromSerialized(parsed);
  } catch {
    return null;
  }
}
