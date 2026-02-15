#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT_DIR"

AE_FRAMEWORK_ROOT=${AE_FRAMEWORK_ROOT:-/tmp/ae-framework-20260215}
SPEC_INPUT=${SPEC_INPUT:-spec/rate-limiter-quota-service.ae-spec.md}
SPEC_IR=${SPEC_IR:-.ae/ae-ir.json}

mkdir -p artifacts/ae/spec artifacts/ae/test artifacts/summary .ae

if [[ ! -f "$AE_FRAMEWORK_ROOT/packages/spec-compiler/dist/cli.js" ]]; then
  pnpm --dir "$AE_FRAMEWORK_ROOT" install --filter @ae-framework/spec-compiler... --no-frozen-lockfile
  pnpm --dir "$AE_FRAMEWORK_ROOT" --filter @ae-framework/spec-compiler build
fi

{
  echo "[step] validate spec"
  node "$AE_FRAMEWORK_ROOT/packages/spec-compiler/dist/cli.js" validate -i "$SPEC_INPUT" --max-errors 0 --max-warnings 200 --relaxed
} | tee artifacts/ae/spec/validate.log

{
  echo "[step] compile spec -> IR"
  node "$AE_FRAMEWORK_ROOT/packages/spec-compiler/dist/cli.js" compile -i "$SPEC_INPUT" -o "$SPEC_IR" --relaxed
} | tee artifacts/ae/spec/compile.log

{
  echo "[step] lint IR"
  node "$AE_FRAMEWORK_ROOT/packages/spec-compiler/dist/cli.js" lint -i "$SPEC_IR" --max-errors 0 --max-warnings 200
} | tee artifacts/ae/spec/lint.log

{
  echo "[step] run tests with json artifacts"
  pnpm run test:artifacts
} | tee artifacts/ae/test/vitest.log

cp artifacts/summary/vitest-summary.json artifacts/ae/test/vitest-summary.json

{
  echo "[step] run acceptance tests"
  pnpm run test:acceptance
} | tee artifacts/ae/test/acceptance.log

cp artifacts/summary/acceptance-summary.json artifacts/ae/test/acceptance-summary.json

node -e '
const fs = require("fs");
const path = require("path");
const summaryPath = path.resolve("artifacts/summary/vitest-summary.json");
const vitest = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
const acceptancePath = path.resolve("artifacts/summary/acceptance-summary.json");
const acceptance = JSON.parse(fs.readFileSync(acceptancePath, "utf8"));
const out = {
  generatedAt: new Date().toISOString(),
  specInput: "spec/rate-limiter-quota-service.ae-spec.md",
  specIr: ".ae/ae-ir.json",
  testFiles: vitest.testResults ? vitest.testResults.length : 0,
  numPassedTests: vitest.numPassedTests ?? null,
  numFailedTests: vitest.numFailedTests ?? null,
  success: vitest.success ?? null,
  acceptance: {
    suites: acceptance.numTotalTestSuites ?? null,
    passed: acceptance.numPassedTests ?? null,
    failed: acceptance.numFailedTests ?? null,
    success: acceptance.success ?? null
  }
};
fs.writeFileSync("artifacts/ae/context.json", JSON.stringify(out, null, 2));
'

echo "pipeline completed"
