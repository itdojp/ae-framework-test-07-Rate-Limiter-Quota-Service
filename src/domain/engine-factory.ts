import { resolve } from 'node:path';
import { RateLimiterEngine } from './rate-limiter-engine.js';
import { createInMemoryEngineStorage, createJsonFileEngineStorage } from './storage.js';

export type StateBackend = 'memory' | 'file';

export function createEngineFromEnv(): RateLimiterEngine {
  const backend = (process.env.STATE_BACKEND ?? 'memory') as StateBackend;

  if (backend === 'file') {
    const filePath = resolve(process.env.STATE_FILE_PATH ?? 'artifacts/ae/runtime-state.json');
    return new RateLimiterEngine({
      storage: createJsonFileEngineStorage(filePath),
    });
  }

  return new RateLimiterEngine({
    storage: createInMemoryEngineStorage(),
  });
}
