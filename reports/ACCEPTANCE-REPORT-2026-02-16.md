# Acceptance Report (2026-02-16)

## Summary
- acceptance: PASS (3/3)
- property: PASS (3/3)
- mbt: PASS (2/2)
- persistence: PASS (2/2)
- e2e-restart: PASS (1/1)
- load: PASS (3 scenarios)
- mutation: PASS
- ae-spec-stdio: PASS (parity=true)
- ae-toolcheck: WARN (4/6)
- ae-playbook-resume-safe: PASS (normalized=false)
- ae-framework-readiness: YELLOW (CAUTION)
- ae-framework-gate: PASS
- formal: PASS (tool=java-tlc)

## Rule Status
- RL-INV-001: PASS (tests/property.spec.ts)
- RL-INV-002: PASS (tests/property.spec.ts)
- RL-INV-003: PASS (tests/mbt.spec.ts)
- RL-INV-004: PASS (tests/mbt.spec.ts, tests/persistence.spec.ts, tests/e2e-restart.spec.ts)
- RL-ACC-01: PASS (tests/acceptance.spec.ts, artifacts/summary/load-summary.json)
- RL-ACC-02: PASS (tests/acceptance.spec.ts, tests/e2e-restart.spec.ts)
- RL-ACC-03: PASS (tests/acceptance.spec.ts)

## Evidence
- artifacts/summary/acceptance-summary.json
- artifacts/summary/property-summary.json
- artifacts/summary/mbt-summary.json
- artifacts/summary/persistence-summary.json
- artifacts/summary/e2e-restart-summary.json
- artifacts/summary/load-summary.json
- artifacts/summary/mutation-summary.json
- artifacts/summary/ae-spec-stdio-summary.json
- artifacts/summary/ae-framework-toolcheck-summary.json
- artifacts/summary/ae-playbook-resume-safe-summary.json
- artifacts/summary/ae-framework-readiness-summary.json
- artifacts/summary/ae-framework-readiness-gate-summary.json
- artifacts/summary/formal-summary.json
- artifacts/summary/traceability-summary.json
- artifacts/hermetic-reports/formal/tlc.log

## Notes
- このレポートは scripts/automation/generate-acceptance-report.mjs により自動生成。
- 仕様起点: Issue #1
