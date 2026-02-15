#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), 'utf8'));
}

const acceptance = readJson('artifacts/summary/acceptance-summary.json');
const property = readJson('artifacts/summary/property-summary.json');
const mbt = readJson('artifacts/summary/mbt-summary.json');
const persistence = readJson('artifacts/summary/persistence-summary.json');
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
