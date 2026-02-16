#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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

const acceptance = readJson('artifacts/summary/acceptance-summary.json');
const property = readJson('artifacts/summary/property-summary.json');
const mbt = readJson('artifacts/summary/mbt-summary.json');
const persistence = readJson('artifacts/summary/persistence-summary.json');
const e2eRestart = readJson('artifacts/summary/e2e-restart-summary.json');
const load = readJson('artifacts/summary/load-summary.json');
const mutation = readJson('artifacts/summary/mutation-summary.json');
const aeSpecStdio = readJson('artifacts/summary/ae-spec-stdio-summary.json');
const aeToolcheck = readJson('artifacts/summary/ae-framework-toolcheck-summary.json');
const aePlaybookResumeSafe = readJson('artifacts/summary/ae-playbook-resume-safe-summary.json');
const aeFrameworkReadiness = readJson('artifacts/summary/ae-framework-readiness-summary.json');
const aeFrameworkGate = readJson('artifacts/summary/ae-framework-readiness-gate-summary.json', {
  status: 'unknown',
});
const aeFrameworkTrend = readJson('artifacts/summary/ae-framework-trend-summary.json', {
  totalRuns: null,
  latest: null,
});
const formal = readJson('artifacts/summary/formal-summary.json');
const traceability = readJson('artifacts/summary/traceability-summary.json');

const now = new Date();
const isoDate = now.toISOString().slice(0, 10);

const lines = [
  `# Acceptance Report (${isoDate})`,
  '',
  '## Summary',
  `- acceptance: ${acceptance.success ? 'PASS' : 'FAIL'} (${acceptance.numPassedTests}/${acceptance.numTotalTests})`,
  `- property: ${property.success ? 'PASS' : 'FAIL'} (${property.numPassedTests}/${property.numTotalTests})`,
  `- mbt: ${mbt.success ? 'PASS' : 'FAIL'} (${mbt.numPassedTests}/${mbt.numTotalTests})`,
  `- persistence: ${persistence.success ? 'PASS' : 'FAIL'} (${persistence.numPassedTests}/${persistence.numTotalTests})`,
  `- e2e-restart: ${e2eRestart.success ? 'PASS' : 'FAIL'} (${e2eRestart.numPassedTests}/${e2eRestart.numTotalTests})`,
  `- load: ${String(load.status || 'unknown').toUpperCase()} (${Array.isArray(load.scenarios) ? load.scenarios.length : 0} scenarios)`,
  `- mutation: ${String(mutation.status || 'unknown').toUpperCase()}`,
  `- ae-spec-stdio: ${String(aeSpecStdio.status || 'unknown').toUpperCase()} (parity=${String(aeSpecStdio.irParity?.parity ?? 'n/a')})`,
  `- ae-toolcheck: ${String(aeToolcheck.status || 'unknown').toUpperCase()} (${aeToolcheck.counts?.success ?? 0}/${aeToolcheck.counts?.total ?? 0})`,
  `- ae-playbook-resume-safe: ${String(aePlaybookResumeSafe.status || 'unknown').toUpperCase()} (normalized=${String(aePlaybookResumeSafe.normalization?.normalized ?? 'n/a')})`,
  `- ae-framework-readiness: ${String(aeFrameworkReadiness.readinessGrade || 'unknown').toUpperCase()} (${String(aeFrameworkReadiness.readinessStatus || 'n/a')})`,
  `- ae-framework-gate: ${String(aeFrameworkGate.status || 'unknown').toUpperCase()}`,
  `- ae-framework-trend: total_runs=${aeFrameworkTrend.totalRuns ?? 'n/a'} (latest=${aeFrameworkTrend.latest?.generatedAt ?? 'n/a'})`,
  `- formal: ${String(formal.status || 'unknown').toUpperCase()} (tool=${formal.tool || 'n/a'})`,
  '',
  '## Rule Status',
  ...traceability.items.map((item) => `- ${item.ruleId}: ${String(item.status).toUpperCase()} (${item.evidence})`),
  '',
  '## Evidence',
  '- artifacts/summary/acceptance-summary.json',
  '- artifacts/summary/property-summary.json',
  '- artifacts/summary/mbt-summary.json',
  '- artifacts/summary/persistence-summary.json',
  '- artifacts/summary/e2e-restart-summary.json',
  '- artifacts/summary/load-summary.json',
  '- artifacts/summary/mutation-summary.json',
  '- artifacts/summary/ae-spec-stdio-summary.json',
  '- artifacts/summary/ae-framework-toolcheck-summary.json',
  '- artifacts/summary/ae-playbook-resume-safe-summary.json',
  '- artifacts/summary/ae-framework-readiness-summary.json',
  '- artifacts/summary/ae-framework-readiness-gate-summary.json',
  '- artifacts/summary/ae-framework-trend-summary.json',
  '- artifacts/history/ae-framework-readiness-history.jsonl',
  '- artifacts/summary/formal-summary.json',
  '- artifacts/summary/traceability-summary.json',
  '- artifacts/hermetic-reports/formal/tlc.log',
  '',
  '## Notes',
  '- このレポートは scripts/automation/generate-acceptance-report.mjs により自動生成。',
  '- 仕様起点: Issue #1',
];

mkdirSync(resolve('reports'), { recursive: true });
const outputPath = resolve(`reports/ACCEPTANCE-REPORT-${isoDate}.md`);
writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');

const latestPath = resolve('reports/ACCEPTANCE-REPORT-LATEST.md');
writeFileSync(latestPath, `${lines.join('\n')}\n`, 'utf8');

console.log(`generated: ${outputPath}`);
console.log(`generated: ${latestPath}`);
