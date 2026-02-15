#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(THIS_FILE), '..', '..');
const FRAMEWORK_ROOT = resolve(process.env.AE_FRAMEWORK_ROOT ?? '/tmp/ae-framework-20260215');
const PLAYBOOK_PATH = resolve(FRAMEWORK_ROOT, 'scripts/codex/ae-playbook.mjs');
const CONTEXT_PATH = resolve(PROJECT_ROOT, 'artifacts/ae/context.json');
const OUT_DIR = resolve(PROJECT_ROOT, 'artifacts/codex/playbook-resume-safe');
const SUMMARY_PATH = resolve(PROJECT_ROOT, 'artifacts/summary/ae-playbook-resume-safe-summary.json');
const DEFAULT_SKIP = process.env.AE_PLAYBOOK_SKIP ?? 'setup,qa,spec,sim,formal';

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function normalizeContext() {
  ensureDir(dirname(CONTEXT_PATH));
  if (!existsSync(CONTEXT_PATH)) {
    const seed = {
      generatedAt: new Date().toISOString(),
      phases: {},
      note: 'seeded for ae-playbook --resume compatibility',
    };
    writeJson(CONTEXT_PATH, seed);
    return { seeded: true, normalized: true, reason: 'context_not_found' };
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(CONTEXT_PATH, 'utf8'));
  } catch (error) {
    const repaired = {
      generatedAt: new Date().toISOString(),
      phases: {},
      note: `repaired invalid context json: ${String(error)}`,
    };
    writeJson(CONTEXT_PATH, repaired);
    return { seeded: false, normalized: true, reason: 'context_invalid_json' };
  }

  if (parsed && typeof parsed === 'object' && parsed.phases && typeof parsed.phases === 'object') {
    return { seeded: false, normalized: false, reason: 'already_compatible' };
  }

  const normalizedContext = {
    ...parsed,
    phases: {},
    legacyContext: parsed,
    normalizedAt: new Date().toISOString(),
  };
  writeJson(CONTEXT_PATH, normalizedContext);
  return { seeded: false, normalized: true, reason: 'missing_phases' };
}

function main() {
  ensureDir(OUT_DIR);
  ensureDir(resolve(PROJECT_ROOT, 'artifacts/summary'));

  if (!existsSync(PLAYBOOK_PATH)) {
    const summary = {
      generatedAt: new Date().toISOString(),
      status: 'tool_not_available',
      frameworkRoot: FRAMEWORK_ROOT,
      playbookPath: PLAYBOOK_PATH,
      message: 'ae-playbook script not found',
    };
    writeJson(SUMMARY_PATH, summary);
    process.stdout.write('ae-playbook-resume-safe: tool_not_available\n');
    process.exit(0);
  }

  const normalization = normalizeContext();
  const args = [PLAYBOOK_PATH, '--resume', `--skip=${DEFAULT_SKIP}`];
  const result = spawnSync('node', args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    timeout: 120 * 1000,
    maxBuffer: 10 * 1024 * 1024,
  });

  const stdoutPath = resolve(OUT_DIR, 'playbook.stdout.log');
  const stderrPath = resolve(OUT_DIR, 'playbook.stderr.log');
  writeFileSync(stdoutPath, result.stdout ?? '', 'utf8');
  writeFileSync(stderrPath, result.stderr ?? '', 'utf8');

  const timedOut = result.error && String(result.error).includes('ETIMEDOUT');
  const success = (result.status ?? 1) === 0 && !timedOut;
  const status = success ? 'pass' : timedOut ? 'timeout' : 'fail';

  const summary = {
    generatedAt: new Date().toISOString(),
    status,
    frameworkRoot: FRAMEWORK_ROOT,
    playbookPath: PLAYBOOK_PATH,
    resume: true,
    skip: DEFAULT_SKIP,
    normalization,
    exitCode: result.status ?? 1,
    signal: result.signal ?? null,
    timedOut,
    artifacts: {
      stdout: relative(PROJECT_ROOT, stdoutPath),
      stderr: relative(PROJECT_ROOT, stderrPath),
    },
  };

  writeJson(SUMMARY_PATH, summary);
  process.stdout.write(`ae-playbook-resume-safe: ${status}\n`);
  process.exit(0);
}

main();
