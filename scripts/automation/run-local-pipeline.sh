#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT_DIR"

AE_FRAMEWORK_ROOT=${AE_FRAMEWORK_ROOT:-/tmp/ae-framework-20260215}
SPEC_INPUT=${SPEC_INPUT:-spec/rate-limiter-quota-service.ae-spec.md}
SPEC_IR=${SPEC_IR:-.ae/ae-ir.json}

mkdir -p artifacts/ae/spec artifacts/ae/test artifacts/ae/formal artifacts/summary .ae artifacts/hermetic-reports/formal

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

{
  echo "[step] run property tests"
  pnpm run test:property
} | tee artifacts/ae/test/property.log

cp artifacts/summary/property-summary.json artifacts/ae/test/property-summary.json

{
  echo "[step] run mbt tests"
  pnpm run test:mbt
} | tee artifacts/ae/test/mbt.log

cp artifacts/summary/mbt-summary.json artifacts/ae/test/mbt-summary.json

{
  echo "[step] run formal check"
  pnpm run formal:check
} | tee artifacts/ae/formal/formal.log

cp artifacts/hermetic-reports/formal/formal-summary.json artifacts/ae/formal/formal-summary.json
cp artifacts/hermetic-reports/formal/formal-summary.json artifacts/summary/formal-summary.json

node -e '
const fs = require("fs");
const path = require("path");
const summaryPath = path.resolve("artifacts/summary/vitest-summary.json");
const vitest = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
const acceptancePath = path.resolve("artifacts/summary/acceptance-summary.json");
const acceptance = JSON.parse(fs.readFileSync(acceptancePath, "utf8"));
const propertyPath = path.resolve("artifacts/summary/property-summary.json");
const property = JSON.parse(fs.readFileSync(propertyPath, "utf8"));
const mbtPath = path.resolve("artifacts/summary/mbt-summary.json");
const mbt = JSON.parse(fs.readFileSync(mbtPath, "utf8"));
const formalPath = path.resolve("artifacts/summary/formal-summary.json");
const formal = JSON.parse(fs.readFileSync(formalPath, "utf8"));
const out = {
  generatedAt: new Date().toISOString(),
  specInput: "spec/rate-limiter-quota-service.ae-spec.md",
  specIr: ".ae/ae-ir.json",
  testFiles: vitest.testResults ? vitest.testResults.length : null,
  numPassedTests: vitest.numPassedTests ?? null,
  numFailedTests: vitest.numFailedTests ?? null,
  success: vitest.success ?? null,
  acceptance: {
    suites: acceptance.numTotalTestSuites ?? null,
    passed: acceptance.numPassedTests ?? null,
    failed: acceptance.numFailedTests ?? null,
    success: acceptance.success ?? null
  },
  property: {
    suites: property.numTotalTestSuites ?? null,
    passed: property.numPassedTests ?? null,
    failed: property.numFailedTests ?? null,
    success: property.success ?? null
  },
  mbt: {
    suites: mbt.numTotalTestSuites ?? null,
    passed: mbt.numPassedTests ?? null,
    failed: mbt.numFailedTests ?? null,
    success: mbt.success ?? null
  },
  formal: {
    status: formal.status ?? "unknown",
    tool: formal.tool ?? null,
    exitCode: formal.exitCode ?? null
  }
};
fs.writeFileSync("artifacts/ae/context.json", JSON.stringify(out, null, 2));

const traceability = {
  generatedAt: new Date().toISOString(),
  items: [
    { ruleId: "RL-INV-001", status: property.success ? "pass" : "fail", evidence: "tests/property.spec.ts" },
    { ruleId: "RL-INV-002", status: property.success ? "pass" : "fail", evidence: "tests/property.spec.ts" },
    { ruleId: "RL-INV-003", status: mbt.success ? "pass" : "fail", evidence: "tests/mbt.spec.ts" },
    { ruleId: "RL-INV-004", status: mbt.success ? "pass" : "fail", evidence: "tests/mbt.spec.ts" },
    { ruleId: "RL-ACC-01", status: acceptance.success ? "pass" : "fail", evidence: "tests/acceptance.spec.ts" },
    { ruleId: "RL-ACC-02", status: acceptance.success ? "pass" : "fail", evidence: "tests/acceptance.spec.ts" },
    { ruleId: "RL-ACC-03", status: acceptance.success ? "pass" : "fail", evidence: "tests/acceptance.spec.ts" }
  ]
};
fs.writeFileSync("artifacts/summary/traceability-summary.json", JSON.stringify(traceability, null, 2));
'

{
  echo "[step] generate acceptance report"
  pnpm run report:acceptance
} | tee artifacts/ae/test/acceptance-report.log

echo "pipeline completed"
