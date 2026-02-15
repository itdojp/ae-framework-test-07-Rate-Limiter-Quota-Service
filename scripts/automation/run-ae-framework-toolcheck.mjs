#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(THIS_FILE), '..', '..');
const FRAMEWORK_ROOT = resolve(process.env.AE_FRAMEWORK_ROOT ?? '/tmp/ae-framework-20260215');
const SPEC_INPUT = process.env.SPEC_INPUT ?? 'spec/rate-limiter-quota-service.ae-spec.md';
const CONTEXT_PATH = resolve(PROJECT_ROOT, 'artifacts/ae/context.json');
const OUT_DIR = resolve(PROJECT_ROOT, 'artifacts/codex/toolcheck');
const SUMMARY_PATH = resolve(PROJECT_ROOT, 'artifacts/summary/ae-framework-toolcheck-summary.json');

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function parseLastJsonLine(value) {
  const lines = String(value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return null;
  try {
    return JSON.parse(lines[lines.length - 1]);
  } catch {
    return null;
  }
}

function runProbe(probe) {
  const stdoutPath = resolve(OUT_DIR, `${probe.id}.stdout.log`);
  const stderrPath = resolve(OUT_DIR, `${probe.id}.stderr.log`);

  let backupContext = null;
  let createdContext = false;
  if (probe.forceIncompatibleContext) {
    ensureDir(dirname(CONTEXT_PATH));
    if (existsSync(CONTEXT_PATH)) {
      backupContext = readFileSync(CONTEXT_PATH, 'utf8');
    } else {
      createdContext = true;
    }
    writeFileSync(
      CONTEXT_PATH,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          specInput: SPEC_INPUT,
          note: 'forced incompatible context for toolcheck',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }

  const startedAt = Date.now();
  let result;
  try {
    result = spawnSync(probe.command, probe.args, {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      input: probe.input ?? undefined,
      timeout: (probe.timeoutSec ?? 120) * 1000,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    result = {
      status: 1,
      stdout: '',
      stderr: String(error),
      error,
      signal: null,
    };
  }
  const elapsedMs = Date.now() - startedAt;

  if (probe.forceIncompatibleContext) {
    if (backupContext !== null) {
      writeFileSync(CONTEXT_PATH, backupContext, 'utf8');
    } else if (createdContext && existsSync(CONTEXT_PATH)) {
      unlinkSync(CONTEXT_PATH);
    }
  }

  writeFileSync(stdoutPath, result.stdout ?? '', 'utf8');
  writeFileSync(stderrPath, result.stderr ?? '', 'utf8');

  const timedOut = result.error && String(result.error).includes('ETIMEDOUT');
  const responseJson = parseLastJsonLine(result.stdout ?? '');
  const success = probe.requireJsonOk
    ? responseJson?.ok === true
    : (result.status ?? 1) === 0 && !timedOut;
  const expected = probe.expect ?? 'success';
  const expectationMatched =
    expected === 'either' ? true : expected === 'success' ? success : !success;

  return {
    id: probe.id,
    description: probe.description,
    expected,
    success,
    expectationMatched,
    exitCode: result.status ?? 1,
    signal: result.signal ?? null,
    timedOut,
    responseOk: responseJson?.ok ?? null,
    elapsedMs,
    command: [probe.command, ...(probe.args ?? [])].join(' '),
    artifacts: {
      stdout: relative(PROJECT_ROOT, stdoutPath),
      stderr: relative(PROJECT_ROOT, stderrPath),
    },
  };
}

function main() {
  ensureDir(OUT_DIR);
  ensureDir(resolve(PROJECT_ROOT, 'artifacts/summary'));

  const validateRequest = JSON.stringify({
    action: 'validate',
    args: {
      inputPath: SPEC_INPUT,
      relaxed: true,
      maxWarnings: 200,
    },
  });

  const probes = [
    {
      id: 'framework_spec_stdio_direct_validate',
      description: 'ae-framework標準 spec-stdio bridge を直接実行',
      command: 'node',
      args: [resolve(FRAMEWORK_ROOT, 'scripts/codex/spec-stdio.mjs')],
      input: `${validateRequest}\n`,
      requireJsonOk: true,
      expect: 'failure',
      timeoutSec: 60,
    },
    {
      id: 'local_codex_spec_stdio_proxy_validate',
      description: '本リポジトリの codex:spec:stdio proxy 経由で validate',
      command: 'pnpm',
      args: ['run', 'codex:spec:stdio'],
      input: `${validateRequest}\n`,
      requireJsonOk: true,
      expect: 'success',
      timeoutSec: 60,
    },
    {
      id: 'framework_spec_compiler_cli_validate',
      description: 'ae-framework spec-compiler CLI validate',
      command: 'node',
      args: [
        resolve(FRAMEWORK_ROOT, 'packages/spec-compiler/dist/cli.js'),
        'validate',
        '-i',
        SPEC_INPUT,
        '--max-errors',
        '0',
        '--max-warnings',
        '200',
        '--relaxed',
      ],
      expect: 'success',
      timeoutSec: 60,
    },
    {
      id: 'framework_ae_playbook_resume',
      description: 'ae-playbook resume モード（context互換性確認）',
      command: 'node',
      args: [
        resolve(FRAMEWORK_ROOT, 'scripts/codex/ae-playbook.mjs'),
        '--resume',
        '--skip=setup,qa,spec,sim,formal',
      ],
      forceIncompatibleContext: true,
      expect: 'failure',
      timeoutSec: 90,
    },
    {
      id: 'framework_ae_playbook_no_resume',
      description: 'ae-playbook 非resumeモード（最小スモーク）',
      command: 'node',
      args: [resolve(FRAMEWORK_ROOT, 'scripts/codex/ae-playbook.mjs'), '--skip=setup,qa,spec,sim,formal'],
      expect: 'success',
      timeoutSec: 90,
    },
  ];

  const results = probes.map(runProbe);
  const unexpectedFailures = results.filter((item) => item.expected === 'success' && !item.success);
  const unresolvedKnownIssues = results.filter((item) => item.expected === 'failure' && !item.success);
  const resolvedKnownIssues = results.filter((item) => item.expected === 'failure' && item.success);
  const unexpectedOutcomes = results.filter((item) => !item.expectationMatched);

  const status =
    unexpectedFailures.length > 0
      ? 'fail'
      : unresolvedKnownIssues.length > 0
        ? 'warn'
        : resolvedKnownIssues.length > 0
          ? 'improved'
          : 'pass';

  const summary = {
    generatedAt: new Date().toISOString(),
    status,
    frameworkRoot: FRAMEWORK_ROOT,
    specInput: SPEC_INPUT,
    counts: {
      total: results.length,
      success: results.filter((item) => item.success).length,
      failed: results.filter((item) => !item.success).length,
      unexpectedFailures: unexpectedFailures.length,
      unresolvedKnownIssues: unresolvedKnownIssues.length,
      resolvedKnownIssues: resolvedKnownIssues.length,
      unexpectedOutcomes: unexpectedOutcomes.length,
    },
    knownIssueCatalog: [
      {
        probeId: 'framework_spec_stdio_direct_validate',
        expected: 'failure',
        reason: 'spec-stdio が packages/spec-compiler/src/index.js を参照し、現行配布構成と不整合',
      },
      {
        probeId: 'framework_ae_playbook_resume',
        expected: 'failure',
        reason: '既存 context.json 形式に phases が無い場合、resume で TypeError が発生',
      },
    ],
    probes: results,
  };

  writeJson(SUMMARY_PATH, summary);
  process.stdout.write(`ae-framework-toolcheck: ${status}\n`);
  process.exit(0);
}

main();
