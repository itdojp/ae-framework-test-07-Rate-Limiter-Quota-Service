# ae-framework 既知課題（本リポジトリ観測）

## 1. 文書メタ
- 文書ID: `RL-AE-KNOWN-ISSUES-001`
- 作成日: `2026-02-15`
- 対象 ae-framework: `/tmp/ae-framework-20260215`（参照コミット: `546b9d21daeda171f47924f02195d9e4bd81a3c8`）
- 観測ジョブ: `pnpm run test:ae:toolcheck`

## 2. 課題一覧

### AE-KNOWN-001: `scripts/codex/spec-stdio.mjs` direct 実行で `ok:false`
- 事象:
  - direct bridge の戻り値が `{"ok":false,...}` になる。
- 再現:
  - `echo '{"action":"validate","args":{"inputPath":"spec/rate-limiter-quota-service.ae-spec.md","relaxed":true,"maxWarnings":200}}' | node /tmp/ae-framework-20260215/scripts/codex/spec-stdio.mjs`
- 影響:
  - stdio bridge を直接採用した場合、AE-Spec 検証が継続不能。
- 回避策:
  - `scripts/automation/ae-spec-stdio-proxy.mjs` で fallback（`spec-compiler/dist/cli.js`）を実行。
- 証跡:
  - `artifacts/codex/toolcheck/framework_spec_stdio_direct_validate.stdout.log`
  - `artifacts/summary/ae-framework-toolcheck-summary.json`

### AE-KNOWN-002: `scripts/codex/ae-playbook.mjs --resume` が context 形式差異で失敗
- 事象:
  - `artifacts/ae/context.json` に `phases` が存在しない形式で `--resume` 実行すると TypeError。
- 再現:
  - `node /tmp/ae-framework-20260215/scripts/codex/ae-playbook.mjs --resume --skip=setup,qa,spec,sim,formal`
- 影響:
  - 既存 context を引き継ぐ再開運用が不安定。
- 回避策:
  - `--resume` を使わない playbook 実行を採用、または context 正規化を挟む。
  - 本リポジトリでは `test:ae:toolcheck` で resume/no-resume を毎回観測。
- 証跡:
  - `artifacts/codex/toolcheck/framework_ae_playbook_resume.stderr.log`
  - `artifacts/summary/ae-framework-toolcheck-summary.json`

## 3. 運用方針
- `pipeline:local` 実行ごとに `ae-framework-toolcheck-summary.json` を更新し、状態変化（warn→improved→pass）を追跡する。
- 既知課題の解消が観測された場合は、回避ロジック（fallback）を段階的に縮退して再評価する。
