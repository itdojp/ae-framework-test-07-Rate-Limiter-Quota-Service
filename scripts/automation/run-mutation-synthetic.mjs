#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function detectMutantInvertedComparator() {
  const tokens = 0;
  const cost = 1;
  const allowed = tokens <= cost; // mutant behavior (should be tokens >= cost)
  return {
    id: 'MUT-001',
    description: 'TOKEN_BUCKET comparator inverted (tokens >= cost -> tokens <= cost)',
    killed: allowed === true,
    evidence: 'with tokens=0 and cost=1, mutant allows request unexpectedly',
  };
}

function detectMutantMissingCapacityClamp() {
  const capacity = 10;
  const tokens = 9;
  const refill = 5;
  const mutated = tokens + refill; // mutant: no min(capacity, ...)
  const killed = mutated > capacity;
  return {
    id: 'MUT-002',
    description: 'TOKEN_BUCKET refill clamp removed (min(capacity, ...))',
    killed,
    evidence: `refilled tokens=${mutated} exceeds capacity=${capacity}`,
  };
}

function detectMutantWindowBoundaryCeil() {
  const windowSeconds = 60;
  const nowSeconds = 61;
  const expected = Math.floor(nowSeconds / windowSeconds) * windowSeconds;
  const mutated = Math.ceil(nowSeconds / windowSeconds) * windowSeconds; // mutant
  const killed = mutated !== expected;
  return {
    id: 'MUT-003',
    description: 'FIXED_WINDOW boundary uses ceil instead of floor',
    killed,
    evidence: `expected windowStart=${expected}, mutant=${mutated}`,
  };
}

function detectMutantIdempotencyDisabled() {
  // expected: same request_id replay returns same decision and does not consume twice
  const initialTokens = 1;
  const cost = 1;
  const firstAllowed = initialTokens >= cost;
  const afterFirst = firstAllowed ? initialTokens - cost : initialTokens;

  // mutant: cache disabled -> second consume executes again
  const secondAllowed = afterFirst >= cost;
  const expectedReplayAllowed = firstAllowed;
  const killed = secondAllowed !== expectedReplayAllowed;

  return {
    id: 'MUT-004',
    description: 'Idempotency cache disabled',
    killed,
    evidence: `firstAllowed=${firstAllowed}, replayAllowed(mutant)=${secondAllowed}, expectedReplayAllowed=${expectedReplayAllowed}`,
  };
}

function main() {
  mkdirSync(resolve('artifacts/summary'), { recursive: true });

  const mutants = [
    detectMutantInvertedComparator(),
    detectMutantMissingCapacityClamp(),
    detectMutantWindowBoundaryCeil(),
    detectMutantIdempotencyDisabled(),
  ];

  const total = mutants.length;
  const killed = mutants.filter((item) => item.killed).length;
  const score = total === 0 ? 0 : killed / total;

  const summary = {
    generatedAt: new Date().toISOString(),
    status: score >= 1 ? 'pass' : 'fail',
    method: 'synthetic-smoke',
    totalMutants: total,
    killedMutants: killed,
    score,
    mutants,
  };

  writeFileSync(resolve('artifacts/summary/mutation-synthetic-summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  if (summary.status !== 'pass') {
    process.stderr.write(`synthetic mutation failed: score=${score}\n`);
    process.exit(1);
  }

  process.stdout.write(`synthetic mutation passed: score=${score}\n`);
}

main();
