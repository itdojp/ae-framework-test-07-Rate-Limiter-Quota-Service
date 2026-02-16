# ae-framework Evaluation Report (2026-02-16)

## Readiness
- grade: YELLOW
- status: CAUTION
- unresolved_known_issues: 2
- unexpected_failures: 0

## Tool Results
- ae-spec-stdio: PASS (mode=fallback-cli, parity=true)
- ae-toolcheck: WARN (4/6)
- ae-playbook-resume-safe: PASS (normalized=false, reason=already_compatible)
- acceptance: PASS (3/3)
- formal: PASS (tool=java-tlc)

## Known Issues Snapshot
- framework_spec_stdio_direct_validate: unresolved (spec-stdio が packages/spec-compiler/src/index.js を参照し、現行配布構成と不整合)
- framework_ae_playbook_resume: unresolved (既存 context.json 形式に phases が無い場合、resume で TypeError が発生)

## Evidence
- artifacts/summary/ae-framework-readiness-summary.json
- artifacts/summary/ae-framework-toolcheck-summary.json
- artifacts/summary/ae-spec-stdio-summary.json
- artifacts/summary/ae-playbook-resume-safe-summary.json
- artifacts/codex/toolcheck/*
- artifacts/codex/playbook-resume-safe/*

## Notes
- このレポートは scripts/automation/generate-ae-framework-eval-report.mjs により自動生成。
- Readiness は本リポジトリの評価基準であり、ae-framework 本体の公式判定ではない。
