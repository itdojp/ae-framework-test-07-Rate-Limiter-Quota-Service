#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

const specStdio = readJson('artifacts/summary/ae-spec-stdio-summary.json');
const toolcheck = readJson('artifacts/summary/ae-framework-toolcheck-summary.json');
const resumeSafe = readJson('artifacts/summary/ae-playbook-resume-safe-summary.json');
const gate = readJson('artifacts/summary/ae-framework-readiness-gate-summary.json', {
  status: 'unknown',
  checks: [],
});
const acceptance = readJson('artifacts/summary/acceptance-summary.json');
const formal = readJson('artifacts/summary/formal-summary.json');

const now = new Date();
const isoDate = now.toISOString().slice(0, 10);

const unresolvedKnownIssues = toolcheck.counts?.unresolvedKnownIssues ?? 0;
const unexpectedFailures = toolcheck.counts?.unexpectedFailures ?? 0;
const specStdioPass = specStdio.status === 'pass';
const resumeSafePass = resumeSafe.status === 'pass';
const acceptancePass = acceptance.success === true;
const formalPass = String(formal.status || '').toLowerCase() === 'pass';

let readinessGrade = 'green';
if (!specStdioPass || !resumeSafePass || unexpectedFailures > 0 || !acceptancePass || !formalPass) {
  readinessGrade = 'red';
} else if (unresolvedKnownIssues > 0 || String(toolcheck.status || '').toLowerCase() === 'warn') {
  readinessGrade = 'yellow';
}

const readinessStatus =
  readinessGrade === 'green'
    ? 'READY'
    : readinessGrade === 'yellow'
      ? 'CAUTION'
      : 'BLOCKED';

const knownIssueLines = (toolcheck.knownIssueCatalog || []).map((issue) => {
  const probe = (toolcheck.probes || []).find((p) => p.id === issue.probeId);
  const probeStatus = probe ? (probe.success ? 'resolved' : 'unresolved') : 'unknown';
  return `- ${issue.probeId}: ${probeStatus} (${issue.reason})`;
});

const summary = {
  generatedAt: now.toISOString(),
  readinessGrade,
  readinessStatus,
  checks: {
    specStdio: {
      status: specStdio.status ?? 'unknown',
      mode: specStdio.mode ?? null,
      parity: specStdio.irParity?.parity ?? null,
    },
    toolcheck: {
      status: toolcheck.status ?? 'unknown',
      total: toolcheck.counts?.total ?? null,
      success: toolcheck.counts?.success ?? null,
      failed: toolcheck.counts?.failed ?? null,
      unresolvedKnownIssues,
      unexpectedFailures,
    },
    playbookResumeSafe: {
      status: resumeSafe.status ?? 'unknown',
      normalized: resumeSafe.normalization?.normalized ?? null,
      reason: resumeSafe.normalization?.reason ?? null,
    },
    readinessGate: {
      status: gate.status ?? 'unknown',
      failedChecks: Array.isArray(gate.checks) ? gate.checks.filter((item) => !item.pass).map((item) => item.id) : [],
    },
    acceptance: {
      status: acceptancePass ? 'pass' : 'fail',
      passed: acceptance.numPassedTests ?? null,
      failed: acceptance.numFailedTests ?? null,
    },
    formal: {
      status: formal.status ?? 'unknown',
      tool: formal.tool ?? null,
    },
  },
  knownIssues: toolcheck.knownIssueCatalog || [],
};

mkdirSync(resolve('artifacts/summary'), { recursive: true });
writeFileSync(resolve('artifacts/summary/ae-framework-readiness-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

const lines = [
  `# ae-framework Evaluation Report (${isoDate})`,
  '',
  '## Readiness',
  `- grade: ${readinessGrade.toUpperCase()}`,
  `- status: ${readinessStatus}`,
  `- unresolved_known_issues: ${unresolvedKnownIssues}`,
  `- unexpected_failures: ${unexpectedFailures}`,
  '',
  '## Tool Results',
  `- ae-spec-stdio: ${String(specStdio.status || 'unknown').toUpperCase()} (mode=${specStdio.mode || 'n/a'}, parity=${String(specStdio.irParity?.parity ?? 'n/a')})`,
  `- ae-toolcheck: ${String(toolcheck.status || 'unknown').toUpperCase()} (${toolcheck.counts?.success ?? 0}/${toolcheck.counts?.total ?? 0})`,
  `- ae-playbook-resume-safe: ${String(resumeSafe.status || 'unknown').toUpperCase()} (normalized=${String(resumeSafe.normalization?.normalized ?? 'n/a')}, reason=${resumeSafe.normalization?.reason || 'n/a'})`,
  `- ae-readiness-gate: ${String(gate.status || 'unknown').toUpperCase()}`,
  `- acceptance: ${acceptancePass ? 'PASS' : 'FAIL'} (${acceptance.numPassedTests}/${acceptance.numTotalTests})`,
  `- formal: ${String(formal.status || 'unknown').toUpperCase()} (tool=${formal.tool || 'n/a'})`,
  '',
  '## Known Issues Snapshot',
  ...(knownIssueLines.length > 0 ? knownIssueLines : ['- none']),
  '',
  '## Evidence',
  '- artifacts/summary/ae-framework-readiness-summary.json',
  '- artifacts/summary/ae-framework-toolcheck-summary.json',
  '- artifacts/summary/ae-spec-stdio-summary.json',
  '- artifacts/summary/ae-playbook-resume-safe-summary.json',
  '- artifacts/summary/ae-framework-readiness-gate-summary.json',
  '- artifacts/codex/toolcheck/*',
  '- artifacts/codex/playbook-resume-safe/*',
  '',
  '## Notes',
  '- このレポートは scripts/automation/generate-ae-framework-eval-report.mjs により自動生成。',
  '- Readiness は本リポジトリの評価基準であり、ae-framework 本体の公式判定ではない。',
];

mkdirSync(resolve('reports'), { recursive: true });
const outputPath = resolve(`reports/AE-FRAMEWORK-EVAL-${isoDate}.md`);
writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
const latestPath = resolve('reports/AE-FRAMEWORK-EVAL-LATEST.md');
writeFileSync(latestPath, `${lines.join('\n')}\n`, 'utf8');

process.stdout.write(`generated: ${outputPath}\n`);
process.stdout.write(`generated: ${latestPath}\n`);
