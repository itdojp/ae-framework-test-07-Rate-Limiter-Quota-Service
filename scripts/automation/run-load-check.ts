import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RateLimiterEngine } from '../../src/domain/rate-limiter-engine.js';

interface ScenarioResult {
  name: string;
  passed: boolean;
  allowed: number;
  total: number;
  expectedUpperBound: number;
  elapsedMs: number;
  detail?: string;
}

function createEngine() {
  const engine = new RateLimiterEngine({
    now: () => new Date('2026-02-15T00:00:00.000Z'),
  });

  engine.upsertPolicy({
    policy_id: 'P-LOAD',
    tenant_id: 'TENANT-LOAD',
    name: 'load policy',
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

async function scenarioParallelBurst(): Promise<ScenarioResult> {
  const engine = createEngine();
  const total = 100;
  const expectedUpperBound = 10;

  const started = Date.now();
  const jobs = Array.from({ length: total }, (_, index) =>
    engine.consume({
      tenant_id: 'TENANT-LOAD',
      request_id: `load-burst-${index}`,
      subject: { type: 'USER', id: 'U-BURST' },
      resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
      cost: 1,
      now: '2026-02-15T00:00:10.000Z',
    }),
  );
  const results = await Promise.all(jobs);
  const elapsedMs = Date.now() - started;

  const allowed = results.filter((item) => item.allowed).length;
  const passed = allowed <= expectedUpperBound;

  return {
    name: 'parallel-burst-100',
    passed,
    allowed,
    total,
    expectedUpperBound,
    elapsedMs,
  };
}

async function scenarioSustained30s(): Promise<ScenarioResult> {
  const engine = createEngine();
  const total = 300;
  const expectedUpperBound = 20;

  const started = Date.now();
  const jobs = Array.from({ length: total }, (_, index) => {
    const nowMs = Date.parse('2026-02-15T00:00:00.000Z') + index * 100;
    return engine.consume({
      tenant_id: 'TENANT-LOAD',
      request_id: `load-sustain-${index}`,
      subject: { type: 'USER', id: 'U-SUSTAIN' },
      resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
      cost: 1,
      now: new Date(nowMs).toISOString(),
    });
  });
  const results = await Promise.all(jobs);
  const elapsedMs = Date.now() - started;

  const allowed = results.filter((item) => item.allowed).length;
  const passed = allowed <= expectedUpperBound;

  return {
    name: 'sustained-30s-300req',
    passed,
    allowed,
    total,
    expectedUpperBound,
    elapsedMs,
    detail: 'window limit(20/min) is dominant for 30s period',
  };
}

async function scenarioMultiSubject(): Promise<ScenarioResult> {
  const engine = createEngine();
  const subjects = ['U-S1', 'U-S2', 'U-S3'];
  const perSubject = 40;
  const total = subjects.length * perSubject;
  const expectedUpperBound = subjects.length * 10;

  const started = Date.now();
  const jobs = subjects.flatMap((subject) =>
    Array.from({ length: perSubject }, (_, index) =>
      engine.consume({
        tenant_id: 'TENANT-LOAD',
        request_id: `load-multi-${subject}-${index}`,
        subject: { type: 'USER', id: subject },
        resource: { type: 'ENDPOINT', name: '/api/v1/orders' },
        cost: 1,
        now: '2026-02-15T00:00:20.000Z',
      }),
    ),
  );
  const results = await Promise.all(jobs);
  const elapsedMs = Date.now() - started;

  const allowed = results.filter((item) => item.allowed).length;
  const passed = allowed <= expectedUpperBound;

  return {
    name: 'multi-subject-burst',
    passed,
    allowed,
    total,
    expectedUpperBound,
    elapsedMs,
  };
}

async function main() {
  mkdirSync(resolve('artifacts/summary'), { recursive: true });

  const scenarios = await Promise.all([
    scenarioParallelBurst(),
    scenarioSustained30s(),
    scenarioMultiSubject(),
  ]);

  const failed = scenarios.filter((item) => !item.passed);
  const summary = {
    generatedAt: new Date().toISOString(),
    status: failed.length === 0 ? 'pass' : 'fail',
    scenarios,
  };

  writeFileSync(resolve('artifacts/summary/load-summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  if (failed.length > 0) {
    process.stderr.write(`load check failed: ${failed.map((item) => item.name).join(', ')}\n`);
    process.exit(1);
  }

  process.stdout.write('load check passed\n');
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
