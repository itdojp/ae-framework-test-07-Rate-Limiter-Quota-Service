#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(THIS_FILE), '..', '..');
const FRAMEWORK_ROOT = resolve(process.env.AE_FRAMEWORK_ROOT ?? '/tmp/ae-framework-20260215');
const FRAMEWORK_SPEC_STDIO = resolve(FRAMEWORK_ROOT, 'scripts/codex/spec-stdio.mjs');
const FRAMEWORK_COMPILER_CLI = resolve(FRAMEWORK_ROOT, 'packages/spec-compiler/dist/cli.js');

async function readStdin() {
  return new Promise((resolveInput, reject) => {
    let buffer = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
    });
    process.stdin.on('end', () => resolveInput(buffer));
    process.stdin.on('error', reject);
  });
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

function parseSummaryFromCliOutput(text) {
  const errors = text.match(/Errors:\s+(\d+)/)?.[1];
  const warnings = text.match(/Warnings:\s+(\d+)/)?.[1];
  const info = text.match(/Info:\s+(\d+)/)?.[1];
  if (!errors && !warnings && !info) {
    return null;
  }
  return {
    errors: errors ? Number(errors) : 0,
    warnings: warnings ? Number(warnings) : 0,
    info: info ? Number(info) : 0,
  };
}

function runFallback(request) {
  if (!existsSync(FRAMEWORK_COMPILER_CLI)) {
    return {
      ok: false,
      error: `fallback compiler CLI was not found: ${FRAMEWORK_COMPILER_CLI}`,
    };
  }

  const args = request.args ?? {};
  if (request.action === 'validate') {
    const cmdArgs = ['validate', '-i', args.inputPath, '--max-errors', '0', '--max-warnings', String(args.maxWarnings ?? 200)];
    if (args.relaxed) cmdArgs.push('--relaxed');
    const result = spawnSync('node', [FRAMEWORK_COMPILER_CLI, ...cmdArgs], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
    });
    if ((result.status ?? 1) !== 0) {
      return {
        ok: false,
        error: `fallback validate failed (${result.status ?? 1})`,
      };
    }
    const summary = parseSummaryFromCliOutput(`${result.stdout ?? ''}${result.stderr ?? ''}`);
    return {
      ok: true,
      data: {
        passed: true,
        summary,
        fallback: 'spec-compiler/dist/cli.js',
      },
    };
  }

  if (request.action === 'compile') {
    const outputPath = args.outputPath ?? '.ae/ae-ir.json';
    const cmdArgs = ['compile', '-i', args.inputPath, '-o', outputPath];
    if (args.relaxed) cmdArgs.push('--relaxed');
    const result = spawnSync('node', [FRAMEWORK_COMPILER_CLI, ...cmdArgs], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
    });
    if ((result.status ?? 1) !== 0) {
      return {
        ok: false,
        error: `fallback compile failed (${result.status ?? 1})`,
      };
    }
    return {
      ok: true,
      data: {
        outputPath,
        fallback: 'spec-compiler/dist/cli.js',
      },
    };
  }

  return {
    ok: false,
    error: `fallback not supported for action: ${String(request.action ?? '')}`,
  };
}

async function main() {
  const input = await readStdin();
  const request = parseLastJsonLine(input);
  if (!request) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: 'invalid request json' })}\n`);
    process.exit(1);
  }

  if (!existsSync(FRAMEWORK_SPEC_STDIO)) {
    const fallback = runFallback(request);
    process.stdout.write(`${JSON.stringify(fallback)}\n`);
    process.exit(fallback.ok ? 0 : 1);
  }

  const result = spawnSync('node', [FRAMEWORK_SPEC_STDIO], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    input,
  });

  const response = parseLastJsonLine(result.stdout ?? '');
  const bridgeError = String(response?.error ?? '');
  const shouldFallback =
    response?.ok === false &&
    bridgeError.includes('Cannot find module') &&
    (request.action === 'validate' || request.action === 'compile');

  if (shouldFallback) {
    const fallback = runFallback(request);
    process.stdout.write(`${JSON.stringify(fallback)}\n`);
    process.exit(fallback.ok ? 0 : 1);
  }

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  process.exit(result.status ?? 1);
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: String(error) })}\n`);
  process.exit(1);
});
