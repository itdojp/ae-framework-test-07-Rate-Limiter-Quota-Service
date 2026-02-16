#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(resolve(path), 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT' && fallback !== undefined) {
      return fallback;
    }
    throw error;
  }
}

function safeGit(command, fallback = null) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return fallback;
  }
}

function readHistory(path) {
  if (!existsSync(path)) {
    return [];
  }
  const raw = readFileSync(path, 'utf8');
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const out = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // ignore malformed line and continue.
    }
  }
  return out;
}

function countBy(values) {
  const out = {};
  for (const value of values) {
    const key = value || 'unknown';
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function formatCounts(counts) {
  const entries = Object.entries(counts);
  if (entries.length === 0) {
    return 'none';
  }
  return entries
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
}

const readiness = readJson('artifacts/summary/ae-framework-readiness-summary.json');
const gate = readJson('artifacts/summary/ae-framework-readiness-gate-summary.json');
const toolcheck = readJson('artifacts/summary/ae-framework-toolcheck-summary.json');
const specStdio = readJson('artifacts/summary/ae-spec-stdio-summary.json');
const resumeSafe = readJson('artifacts/summary/ae-playbook-resume-safe-summary.json');
const formal = readJson('artifacts/summary/formal-summary.json');
const acceptance = readJson('artifacts/summary/acceptance-summary.json');

const now = new Date();
const isoDate = now.toISOString().slice(0, 10);

const commit = process.env.GITHUB_SHA || safeGit('git rev-parse HEAD');
const shortCommit = commit ? commit.slice(0, 12) : safeGit('git rev-parse --short=12 HEAD');
const branch = process.env.GITHUB_REF_NAME || safeGit('git rev-parse --abbrev-ref HEAD');
const runId = process.env.GITHUB_RUN_ID ?? null;
const runAttempt = process.env.GITHUB_RUN_ATTEMPT ?? null;

const snapshot = {
  generatedAt: now.toISOString(),
  date: isoDate,
  commit,
  shortCommit,
  branch,
  executionContext: process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local',
  ci: {
    runId,
    runAttempt,
    workflow: process.env.GITHUB_WORKFLOW ?? null,
    eventName: process.env.GITHUB_EVENT_NAME ?? null,
  },
  readinessGrade: readiness.readinessGrade ?? 'unknown',
  readinessStatus: readiness.readinessStatus ?? 'unknown',
  gateStatus: gate.status ?? 'unknown',
  gateFailedChecks: Array.isArray(gate.checks) ? gate.checks.filter((check) => !check.pass).map((check) => check.id) : [],
  unresolvedKnownIssues: readiness.checks?.toolcheck?.unresolvedKnownIssues ?? null,
  unexpectedFailures: readiness.checks?.toolcheck?.unexpectedFailures ?? null,
  toolcheckStatus: toolcheck.status ?? 'unknown',
  toolcheckSuccess: toolcheck.counts?.success ?? null,
  toolcheckTotal: toolcheck.counts?.total ?? null,
  specStdioStatus: specStdio.status ?? 'unknown',
  specStdioMode: specStdio.mode ?? null,
  resumeSafeStatus: resumeSafe.status ?? 'unknown',
  formalStatus: formal.status ?? 'unknown',
  acceptanceStatus: acceptance.success === true ? 'pass' : 'fail',
  acceptancePassed: acceptance.numPassedTests ?? null,
  acceptanceTotal: acceptance.numTotalTests ?? null,
};

mkdirSync(resolve('artifacts/history'), { recursive: true });
mkdirSync(resolve('artifacts/summary'), { recursive: true });
mkdirSync(resolve('reports'), { recursive: true });

const historyPath = resolve('artifacts/history/ae-framework-readiness-history.jsonl');
const history = readHistory(historyPath);
history.push(snapshot);
writeFileSync(historyPath, `${history.map((item) => JSON.stringify(item)).join('\n')}\n`, 'utf8');

const recentWindowSize = 20;
const recent = history.slice(-recentWindowSize);
const previous = history.length >= 2 ? history[history.length - 2] : null;

const summary = {
  generatedAt: now.toISOString(),
  historyPath: 'artifacts/history/ae-framework-readiness-history.jsonl',
  totalRuns: history.length,
  windowSize: recent.length,
  latest: snapshot,
  previous,
  windowStats: {
    readinessGrade: countBy(recent.map((item) => item.readinessGrade)),
    readinessStatus: countBy(recent.map((item) => item.readinessStatus)),
    gateStatus: countBy(recent.map((item) => item.gateStatus)),
    formalStatus: countBy(recent.map((item) => item.formalStatus)),
    executionContext: countBy(recent.map((item) => item.executionContext)),
  },
  recentRuns: recent.map((item) => ({
    generatedAt: item.generatedAt,
    shortCommit: item.shortCommit,
    readinessGrade: item.readinessGrade,
    gateStatus: item.gateStatus,
    unresolvedKnownIssues: item.unresolvedKnownIssues,
    unexpectedFailures: item.unexpectedFailures,
    formalStatus: item.formalStatus,
    executionContext: item.executionContext,
  })),
};

writeFileSync(resolve('artifacts/summary/ae-framework-trend-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

const lines = [
  `# ae-framework Trend Report (${isoDate})`,
  '',
  '## Latest Snapshot',
  `- generated_at: ${snapshot.generatedAt}`,
  `- execution_context: ${snapshot.executionContext}`,
  `- commit: ${snapshot.shortCommit || 'n/a'} (${snapshot.branch || 'n/a'})`,
  `- readiness: ${String(snapshot.readinessGrade || 'unknown').toUpperCase()} (${snapshot.readinessStatus || 'n/a'})`,
  `- gate: ${String(snapshot.gateStatus || 'unknown').toUpperCase()}`,
  `- unresolved_known_issues: ${snapshot.unresolvedKnownIssues ?? 'n/a'}`,
  `- unexpected_failures: ${snapshot.unexpectedFailures ?? 'n/a'}`,
  `- formal: ${String(snapshot.formalStatus || 'unknown').toUpperCase()}`,
  '',
  `## Window Stats (last ${recentWindowSize} runs)`,
  `- total_runs: ${history.length}`,
  `- readiness_grade_counts: ${formatCounts(summary.windowStats.readinessGrade)}`,
  `- gate_status_counts: ${formatCounts(summary.windowStats.gateStatus)}`,
  `- formal_status_counts: ${formatCounts(summary.windowStats.formalStatus)}`,
  `- execution_context_counts: ${formatCounts(summary.windowStats.executionContext)}`,
  '',
  '## Recent Runs',
  '| generatedAt | commit | readiness | gate | known issues | unexpected failures | formal | context |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ...summary.recentRuns
    .slice()
    .reverse()
    .map((item) => `| ${item.generatedAt} | ${item.shortCommit || 'n/a'} | ${String(item.readinessGrade || 'unknown').toUpperCase()} | ${String(item.gateStatus || 'unknown').toUpperCase()} | ${item.unresolvedKnownIssues ?? 'n/a'} | ${item.unexpectedFailures ?? 'n/a'} | ${String(item.formalStatus || 'unknown').toUpperCase()} | ${item.executionContext || 'n/a'} |`),
  '',
  '## Evidence',
  '- artifacts/history/ae-framework-readiness-history.jsonl',
  '- artifacts/summary/ae-framework-trend-summary.json',
  '- artifacts/summary/ae-framework-readiness-summary.json',
  '- artifacts/summary/ae-framework-readiness-gate-summary.json',
];

const datedReportPath = resolve(`reports/AE-FRAMEWORK-TREND-${isoDate}.md`);
const latestReportPath = resolve('reports/AE-FRAMEWORK-TREND-LATEST.md');
writeFileSync(datedReportPath, `${lines.join('\n')}\n`, 'utf8');
writeFileSync(latestReportPath, `${lines.join('\n')}\n`, 'utf8');

process.stdout.write(`generated: ${datedReportPath}\n`);
process.stdout.write(`generated: ${latestReportPath}\n`);
