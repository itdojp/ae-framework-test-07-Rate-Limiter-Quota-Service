#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(THIS_FILE), '..', '..');

const FRAMEWORK_ROOT = resolve(process.env.AE_FRAMEWORK_ROOT ?? '/tmp/ae-framework-20260215');
const FRAMEWORK_SPEC_STDIO = resolve(FRAMEWORK_ROOT, 'scripts/codex/spec-stdio.mjs');
const FRAMEWORK_COMPILER_CLI = resolve(FRAMEWORK_ROOT, 'packages/spec-compiler/dist/cli.js');
const SPEC_INPUT = process.env.SPEC_INPUT ?? 'spec/rate-limiter-quota-service.ae-spec.md';
const SPEC_INPUT_PATH = resolve(PROJECT_ROOT, SPEC_INPUT);
const STDIO_IR_OUTPUT = process.env.SPEC_STDIO_OUTPUT ?? '.ae/ae-ir-stdio.json';
const STDIO_IR_OUTPUT_PATH = resolve(PROJECT_ROOT, STDIO_IR_OUTPUT);
const DEFAULT_IR_PATH = resolve(PROJECT_ROOT, '.ae/ae-ir.json');

const CODEX_DIR = resolve(PROJECT_ROOT, 'artifacts/codex/spec-stdio');
const SUMMARY_PATH = resolve(PROJECT_ROOT, 'artifacts/summary/ae-spec-stdio-summary.json');
const INSTALL_LOG_PATH = resolve(CODEX_DIR, 'install.log');

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256(path) {
  if (!existsSync(path)) {
    return null;
  }
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

function stableSort(value) {
  if (Array.isArray(value)) {
    return value.map(stableSort);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = stableSort(value[key]);
    }
    return out;
  }
  return value;
}

function normalizedIrHash(path) {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed.metadata && typeof parsed.metadata === 'object') {
      delete parsed.metadata.created;
      delete parsed.metadata.updated;
    }
    if (Array.isArray(parsed.invariants)) {
      parsed.invariants = parsed.invariants.map((item) => {
        if (!item || typeof item !== 'object') {
          return item;
        }
        const copy = { ...item };
        delete copy.id;
        return copy;
      });
    }
    const normalized = stableSort(parsed);
    const hash = createHash('sha256');
    hash.update(JSON.stringify(normalized));
    return hash.digest('hex');
  } catch {
    return null;
  }
}

function parseLastJsonLine(stdout) {
  const lines = String(stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const candidate = lines[lines.length - 1];
  if (!candidate) {
    return { ok: false, error: 'empty stdout' };
  }
  try {
    return JSON.parse(candidate);
  } catch (error) {
    return { ok: false, error: `invalid json response: ${String(error)}` };
  }
}

function runPnpmInstallIfNeeded() {
  const needsInstall = !existsSync(resolve(FRAMEWORK_ROOT, 'node_modules'));
  if (!needsInstall) {
    return { skipped: true, status: 0 };
  }

  const result = spawnSync('pnpm', ['--dir', FRAMEWORK_ROOT, 'install', '--no-frozen-lockfile'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
  });

  writeFileSync(INSTALL_LOG_PATH, `${result.stdout ?? ''}${result.stderr ?? ''}`, 'utf8');
  return { skipped: false, status: result.status ?? 1 };
}

function runSpecStdioStep(stepName, request) {
  const requestPath = resolve(CODEX_DIR, `${stepName}-request.json`);
  const responsePath = resolve(CODEX_DIR, `${stepName}-response.json`);
  const stdoutPath = resolve(CODEX_DIR, `${stepName}.stdout.log`);
  const stderrPath = resolve(CODEX_DIR, `${stepName}.stderr.log`);

  writeJson(requestPath, request);

  const result = spawnSync('node', [FRAMEWORK_SPEC_STDIO], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    input: `${JSON.stringify(request)}\n`,
  });

  writeFileSync(stdoutPath, result.stdout ?? '', 'utf8');
  writeFileSync(stderrPath, result.stderr ?? '', 'utf8');

  const response = parseLastJsonLine(result.stdout ?? '');
  writeJson(responsePath, response);

  return {
    exitCode: result.status ?? 1,
    requestPath: relative(PROJECT_ROOT, requestPath),
    responsePath: relative(PROJECT_ROOT, responsePath),
    stdoutPath: relative(PROJECT_ROOT, stdoutPath),
    stderrPath: relative(PROJECT_ROOT, stderrPath),
    response,
  };
}

function runFallbackCliStep(stepName, args) {
  const logPath = resolve(CODEX_DIR, `fallback-${stepName}.log`);
  const result = spawnSync('node', [FRAMEWORK_COMPILER_CLI, ...args], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
  });
  writeFileSync(logPath, `${result.stdout ?? ''}${result.stderr ?? ''}`, 'utf8');
  return {
    exitCode: result.status ?? 1,
    logPath: relative(PROJECT_ROOT, logPath),
  };
}

function writeSummaryAndExit(summary) {
  writeJson(SUMMARY_PATH, summary);
  process.stdout.write(`ae-spec-stdio: ${summary.status}\n`);
  process.exit(0);
}

function main() {
  ensureDir(resolve(PROJECT_ROOT, 'artifacts/summary'));
  ensureDir(CODEX_DIR);
  ensureDir(resolve(PROJECT_ROOT, '.ae'));

  if (!existsSync(FRAMEWORK_SPEC_STDIO)) {
    writeSummaryAndExit({
      generatedAt: new Date().toISOString(),
      status: 'tool_not_available',
      tool: 'codex:spec:stdio',
      frameworkRoot: FRAMEWORK_ROOT,
      message: 'ae-framework spec-stdio script was not found',
    });
  }

  if (!existsSync(SPEC_INPUT_PATH)) {
    writeSummaryAndExit({
      generatedAt: new Date().toISOString(),
      status: 'fail',
      tool: 'codex:spec:stdio',
      frameworkRoot: FRAMEWORK_ROOT,
      message: 'spec input was not found',
      specInput: SPEC_INPUT,
    });
  }

  const install = runPnpmInstallIfNeeded();
  if (install.status !== 0) {
    writeSummaryAndExit({
      generatedAt: new Date().toISOString(),
      status: 'install_failed',
      tool: 'codex:spec:stdio',
      frameworkRoot: FRAMEWORK_ROOT,
      message: 'failed to install ae-framework dependencies',
      installLog: relative(PROJECT_ROOT, INSTALL_LOG_PATH),
    });
  }

  const validateStep = runSpecStdioStep('validate', {
    action: 'validate',
    args: {
      inputPath: SPEC_INPUT,
      relaxed: true,
      maxWarnings: 200,
    },
  });

  const compileStep = runSpecStdioStep('compile', {
    action: 'compile',
    args: {
      inputPath: SPEC_INPUT,
      outputPath: STDIO_IR_OUTPUT,
      relaxed: true,
      validate: true,
    },
  });

  const stdioBridgeHealthy = validateStep.response?.ok === true && compileStep.response?.ok === true;
  let validatePassed = validateStep.response?.ok === true && validateStep.response?.data?.passed === true;
  let compilePassed = compileStep.response?.ok === true && compileStep.exitCode === 0 && existsSync(STDIO_IR_OUTPUT_PATH);
  let fallbackValidate = null;
  let fallbackCompile = null;

  if ((!validatePassed || !compilePassed) && existsSync(FRAMEWORK_COMPILER_CLI)) {
    fallbackValidate = runFallbackCliStep('validate', [
      'validate',
      '-i',
      SPEC_INPUT,
      '--max-errors',
      '0',
      '--max-warnings',
      '200',
      '--relaxed',
    ]);
    fallbackCompile = runFallbackCliStep('compile', ['compile', '-i', SPEC_INPUT, '-o', STDIO_IR_OUTPUT, '--relaxed']);
    validatePassed = fallbackValidate.exitCode === 0;
    compilePassed = fallbackCompile.exitCode === 0 && existsSync(STDIO_IR_OUTPUT_PATH);
  }

  const stdioHash = sha256(STDIO_IR_OUTPUT_PATH);
  const defaultHash = sha256(DEFAULT_IR_PATH);
  const stdioNormalizedHash = normalizedIrHash(STDIO_IR_OUTPUT_PATH);
  const defaultNormalizedHash = normalizedIrHash(DEFAULT_IR_PATH);
  const rawParity = stdioHash !== null && defaultHash !== null ? stdioHash === defaultHash : null;
  const semanticParity =
    stdioNormalizedHash !== null && defaultNormalizedHash !== null ? stdioNormalizedHash === defaultNormalizedHash : null;

  const summary = {
    generatedAt: new Date().toISOString(),
    status: validatePassed && compilePassed ? 'pass' : 'fail',
    tool: 'codex:spec:stdio',
    mode: stdioBridgeHealthy ? 'stdio' : fallbackValidate ? 'fallback-cli' : 'stdio-error',
    frameworkRoot: FRAMEWORK_ROOT,
    specInput: SPEC_INPUT,
    stdioIrOutput: STDIO_IR_OUTPUT,
    install: {
      skipped: install.skipped,
      log: install.skipped ? null : relative(PROJECT_ROOT, INSTALL_LOG_PATH),
    },
    validate: {
      exitCode: validateStep.exitCode,
      passed: validatePassed,
      summary: validateStep.response?.data?.summary ?? null,
      bridgeError: validateStep.response?.ok === false ? validateStep.response?.error ?? 'unknown error' : null,
      artifacts: {
        request: validateStep.requestPath,
        response: validateStep.responsePath,
        stdout: validateStep.stdoutPath,
        stderr: validateStep.stderrPath,
      },
      fallback: fallbackValidate,
    },
    compile: {
      exitCode: compileStep.exitCode,
      passed: compilePassed,
      summary: compileStep.response?.data?.summary ?? null,
      counts: compileStep.response?.data?.counts ?? null,
      bridgeError: compileStep.response?.ok === false ? compileStep.response?.error ?? 'unknown error' : null,
      artifacts: {
        request: compileStep.requestPath,
        response: compileStep.responsePath,
        stdout: compileStep.stdoutPath,
        stderr: compileStep.stderrPath,
      },
      fallback: fallbackCompile,
    },
    irParity: {
      comparedWith: '.ae/ae-ir.json',
      parity: semanticParity,
      rawParity,
      semanticParity,
      stdioIrSha256: stdioHash,
      defaultIrSha256: defaultHash,
      normalized: {
        stdioIrSha256: stdioNormalizedHash,
        defaultIrSha256: defaultNormalizedHash,
      },
    },
  };

  writeSummaryAndExit(summary);
}

main();
