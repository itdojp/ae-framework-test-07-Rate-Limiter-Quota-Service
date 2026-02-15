#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT_DIR"

AE_FRAMEWORK_ROOT=${AE_FRAMEWORK_ROOT:-/tmp/ae-framework-20260215}
SPEC_INPUT=${SPEC_INPUT:-spec/rate-limiter-quota-service.ae-spec.md}
SPEC_IR=${SPEC_IR:-.ae/ae-ir.json}

mkdir -p artifacts/ae/spec artifacts/ae/test artifacts/ae/formal artifacts/summary artifacts/codex/spec-stdio artifacts/codex/toolcheck artifacts/codex/playbook-resume-safe .ae artifacts/hermetic-reports/formal

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
  echo "[step] run ae-framework codex:spec:stdio check"
  pnpm run test:ae:spec:stdio
} | tee artifacts/ae/spec/ae-spec-stdio.log

cp artifacts/summary/ae-spec-stdio-summary.json artifacts/ae/spec/ae-spec-stdio-summary.json

{
  echo "[step] run ae-framework toolcheck matrix"
  pnpm run test:ae:toolcheck
} | tee artifacts/ae/spec/ae-framework-toolcheck.log

cp artifacts/summary/ae-framework-toolcheck-summary.json artifacts/ae/spec/ae-framework-toolcheck-summary.json

{
  echo "[step] run ae-playbook resume-safe wrapper"
  pnpm run test:ae:playbook:resume-safe
} | tee artifacts/ae/spec/ae-playbook-resume-safe.log

cp artifacts/summary/ae-playbook-resume-safe-summary.json artifacts/ae/spec/ae-playbook-resume-safe-summary.json

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
  echo "[step] run persistence tests"
  pnpm run test:persistence
} | tee artifacts/ae/test/persistence.log

cp artifacts/summary/persistence-summary.json artifacts/ae/test/persistence-summary.json

{
  echo "[step] run e2e restart tests"
  pnpm run test:e2e:restart
} | tee artifacts/ae/test/e2e-restart.log

cp artifacts/summary/e2e-restart-summary.json artifacts/ae/test/e2e-restart-summary.json

{
  echo "[step] run load check"
  pnpm run test:load
} | tee artifacts/ae/test/load.log

cp artifacts/summary/load-summary.json artifacts/ae/test/load-summary.json

{
  echo "[step] run mutation report (report-only)"
  pnpm run test:mutation:report
} | tee artifacts/ae/test/mutation.log

cp artifacts/summary/mutation-summary.json artifacts/ae/test/mutation-summary.json

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
const persistencePath = path.resolve("artifacts/summary/persistence-summary.json");
const persistence = JSON.parse(fs.readFileSync(persistencePath, "utf8"));
const e2eRestartPath = path.resolve("artifacts/summary/e2e-restart-summary.json");
const e2eRestart = JSON.parse(fs.readFileSync(e2eRestartPath, "utf8"));
const loadPath = path.resolve("artifacts/summary/load-summary.json");
const load = JSON.parse(fs.readFileSync(loadPath, "utf8"));
const mutationPath = path.resolve("artifacts/summary/mutation-summary.json");
const mutation = JSON.parse(fs.readFileSync(mutationPath, "utf8"));
const aeSpecStdioPath = path.resolve("artifacts/summary/ae-spec-stdio-summary.json");
const aeSpecStdio = JSON.parse(fs.readFileSync(aeSpecStdioPath, "utf8"));
const aeToolcheckPath = path.resolve("artifacts/summary/ae-framework-toolcheck-summary.json");
const aeToolcheck = JSON.parse(fs.readFileSync(aeToolcheckPath, "utf8"));
const aePlaybookResumeSafePath = path.resolve("artifacts/summary/ae-playbook-resume-safe-summary.json");
const aePlaybookResumeSafe = JSON.parse(fs.readFileSync(aePlaybookResumeSafePath, "utf8"));
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
  persistence: {
    suites: persistence.numTotalTestSuites ?? null,
    passed: persistence.numPassedTests ?? null,
    failed: persistence.numFailedTests ?? null,
    success: persistence.success ?? null
  },
  e2eRestart: {
    suites: e2eRestart.numTotalTestSuites ?? null,
    passed: e2eRestart.numPassedTests ?? null,
    failed: e2eRestart.numFailedTests ?? null,
    success: e2eRestart.success ?? null
  },
  load: {
    status: load.status ?? null,
    scenarios: Array.isArray(load.scenarios) ? load.scenarios.length : null
  },
  mutation: {
    status: mutation.status ?? null,
    score: mutation.score ?? null
  },
  aeSpecStdio: {
    status: aeSpecStdio.status ?? null,
    validatePassed: aeSpecStdio.validate ? aeSpecStdio.validate.passed : null,
    compilePassed: aeSpecStdio.compile ? aeSpecStdio.compile.passed : null,
    irParity: aeSpecStdio.irParity ? aeSpecStdio.irParity.parity : null
  },
  aeFrameworkToolcheck: {
    status: aeToolcheck.status ?? null,
    total: aeToolcheck.counts ? aeToolcheck.counts.total : null,
    success: aeToolcheck.counts ? aeToolcheck.counts.success : null,
    failed: aeToolcheck.counts ? aeToolcheck.counts.failed : null,
    unexpectedFailures: aeToolcheck.counts ? aeToolcheck.counts.unexpectedFailures : null
  },
  aePlaybookResumeSafe: {
    status: aePlaybookResumeSafe.status ?? null,
    normalized: aePlaybookResumeSafe.normalization ? aePlaybookResumeSafe.normalization.normalized : null,
    reason: aePlaybookResumeSafe.normalization ? aePlaybookResumeSafe.normalization.reason : null
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
    { ruleId: "RL-INV-004", status: (mbt.success && persistence.success && e2eRestart.success) ? "pass" : "fail", evidence: "tests/mbt.spec.ts, tests/persistence.spec.ts, tests/e2e-restart.spec.ts" },
    { ruleId: "RL-ACC-01", status: (acceptance.success && load.status === "pass") ? "pass" : "fail", evidence: "tests/acceptance.spec.ts, artifacts/summary/load-summary.json" },
    { ruleId: "RL-ACC-02", status: (acceptance.success && e2eRestart.success) ? "pass" : "fail", evidence: "tests/acceptance.spec.ts, tests/e2e-restart.spec.ts" },
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
