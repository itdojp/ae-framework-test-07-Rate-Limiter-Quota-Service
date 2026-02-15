# Traceability Matrix

## 1. 文書メタ
- 文書ID: `RL-TRACE-001`
- 版: `v0.1`
- 作成日: `2026-02-15`
- 前提: Issue #1

## 2. ルール対応表
| Rule ID | 種別 | 検証方法 | 実装/テスト | 証跡ファイル |
| --- | --- | --- | --- | --- |
| RL-INV-001 | Invariant | Property Test | `tests/property.spec.ts` | `artifacts/summary/property-summary.json` |
| RL-INV-002 | Invariant | Property Test | `tests/property.spec.ts` | `artifacts/summary/property-summary.json` |
| RL-INV-003 | Invariant | MBT + Concurrency | `tests/mbt.spec.ts` | `artifacts/summary/mbt-summary.json` |
| RL-INV-004 | Invariant | MBT + Idempotency | `tests/mbt.spec.ts` | `artifacts/summary/mbt-summary.json` |
| RL-ACC-01 | Acceptance | 100並行受入テスト | `tests/acceptance.spec.ts` | `artifacts/summary/acceptance-summary.json` |
| RL-ACC-02 | Acceptance | 冪等受入テスト | `tests/acceptance.spec.ts` | `artifacts/summary/acceptance-summary.json` |
| RL-ACC-03 | Acceptance | retry_after受入テスト | `tests/acceptance.spec.ts` | `artifacts/summary/acceptance-summary.json` |
| RL-RULE-TIME-001 | Rule | MBTシナリオ | `tests/mbt.spec.ts` | `artifacts/summary/mbt-summary.json` |

## 3. Formal 対応
- 形式仕様: `spec/formal/RateLimiterQuota.tla`
- 設定: `spec/formal/RateLimiterQuota.cfg`
- 実行スクリプト: `scripts/automation/run-formal-check.sh`
- 出力: `artifacts/hermetic-reports/formal/formal-summary.json`

## 4. 自動生成サマリ
`pipeline:local` 実行時に以下を更新する。
- `artifacts/summary/traceability-summary.json`
- `artifacts/ae/context.json`
