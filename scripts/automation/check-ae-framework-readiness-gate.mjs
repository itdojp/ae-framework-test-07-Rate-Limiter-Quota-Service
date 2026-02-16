#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), 'utf8'));
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const readiness = readJson('artifacts/summary/ae-framework-readiness-summary.json');
const toolcheck = readJson('artifacts/summary/ae-framework-toolcheck-summary.json');

const maxUnresolvedKnownIssues = toNumber(process.env.AE_GATE_MAX_UNRESOLVED_KNOWN_ISSUES, 2);
const maxUnexpectedFailures = toNumber(process.env.AE_GATE_MAX_UNEXPECTED_FAILURES, 0);
const allowedGradesRaw = process.env.AE_GATE_ALLOWED_GRADES ?? 'green,yellow';
const allowedGrades = allowedGradesRaw
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

const grade = String(readiness.readinessGrade || 'unknown').toLowerCase();
const unresolvedKnownIssues = toNumber(readiness.checks?.toolcheck?.unresolvedKnownIssues, null);
const unexpectedFailures = toNumber(readiness.checks?.toolcheck?.unexpectedFailures, null);
const toolcheckStatus = String(toolcheck.status || 'unknown').toLowerCase();

const checks = [
  {
    id: 'grade_allowed',
    pass: allowedGrades.includes(grade),
    detail: `grade=${grade}, allowed=[${allowedGrades.join(',')}]`,
  },
  {
    id: 'unresolved_known_issues',
    pass: unresolvedKnownIssues !== null && unresolvedKnownIssues <= maxUnresolvedKnownIssues,
    detail: `unresolvedKnownIssues=${unresolvedKnownIssues}, max=${maxUnresolvedKnownIssues}`,
  },
  {
    id: 'unexpected_failures',
    pass: unexpectedFailures !== null && unexpectedFailures <= maxUnexpectedFailures,
    detail: `unexpectedFailures=${unexpectedFailures}, max=${maxUnexpectedFailures}`,
  },
  {
    id: 'toolcheck_status_not_fail',
    pass: toolcheckStatus !== 'fail',
    detail: `toolcheckStatus=${toolcheckStatus}`,
  },
];

const failedChecks = checks.filter((check) => !check.pass);
const status = failedChecks.length === 0 ? 'pass' : 'fail';

const summary = {
  generatedAt: new Date().toISOString(),
  status,
  config: {
    maxUnresolvedKnownIssues,
    maxUnexpectedFailures,
    allowedGrades,
  },
  metrics: {
    grade,
    unresolvedKnownIssues,
    unexpectedFailures,
    toolcheckStatus,
  },
  checks,
};

mkdirSync(resolve('artifacts/summary'), { recursive: true });
writeFileSync(resolve('artifacts/summary/ae-framework-readiness-gate-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

if (status === 'pass') {
  process.stdout.write('ae-framework-readiness-gate: pass\n');
  process.exit(0);
}

process.stderr.write(
  `ae-framework-readiness-gate: fail (${failedChecks.map((check) => check.id).join(', ')})\n`,
);
process.exit(1);
