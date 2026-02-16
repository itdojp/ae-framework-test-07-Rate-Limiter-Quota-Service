# 開発計画（Rate Limiter / Quota Service）

## 1. 文書メタ
- 文書ID: `RL-DEV-PLAN-001`
- 版: `v0.1`
- 作成日: `2026-02-15`
- 前提仕様: Issue #1
- 実行環境ベースライン: Issue #2

## 2. 目的
Issue #1 の仕様を満たす Rate Limiter / Quota Service を、ae-framework の自動化フローを主体として実装・検証し、再現可能なエビデンスを GitHub 上に蓄積する。

## 3. スコープ
### 3.1 スコープ内
- Policy 管理、check/consume API、dry-run、idempotency の実装
- Token Bucket / Fixed Window の原子性検証
- MBT / Property / Mutation / 形式検証の実行
- 生成物（中間成果物含む）の恒久保存

### 3.2 スコープ外
- 分散トレーシングの本格統合
- 高度なBOT判定・行動分析

## 4. 成果物
- 実装コード（サービスモード + ライブラリモード）
- 仕様変換成果物（AE-Spec / AE-IR / OpenAPI）
- 検証成果物（verify-lite, property, mutation, formal）
- 運用ドキュメント（実行手順、失敗時復旧手順）

## 5. マイルストーン
1. M1: 仕様の機械可読化
- Issue #1 を AE-Spec/AE-IR 化し、入力不整合を解消。
- Exit条件: spec validate/compile が成功。

2. M2: 最小実装（Library + Service）
- `consume` / `check` の最小実装を作成。
- Exit条件: 基本単体テスト + APIスモーク成功。

3. M3: 競合制御・冪等性強化
- 同時実行下の上限超過防止、request_id 冪等性の実装。
- Exit条件: RL-INV-003/004 に対応するテストが成功。

4. M4: 検証拡張
- MBT / Property / Mutation / Formal を自動実行。
- Exit条件: 主要検証ジョブの実行結果が artifacts に保存。

5. M5: 受入基準達成
- RL-ACC-01/02/03 を満たす。
- Exit条件: 受入確認レポートを作成し、証跡を GitHub 保存。

6. M6: ae-framework ツール健全性評価
- `codex:spec:stdio` の実行結果を自動収集し、失敗時は fallback として `spec-compiler` CLI を実行。
- Exit条件: `artifacts/summary/ae-spec-stdio-summary.json` が毎回更新され、`pipeline:local` に統合される。

7. M7: ae-framework ツール群の互換性マトリクス運用
- bridge/cli/playbook を同一ジョブで評価し、既知不整合と回避結果を継続観測する。
- Exit条件: `artifacts/summary/ae-framework-toolcheck-summary.json` が毎回更新され、受入レポートに統合される。

8. M8: ae-framework 評価レポート統合
- 複数サマリ（spec-stdio/toolcheck/resume-safe/formal/acceptance）を統合し readiness を算出する。
- Exit条件: `artifacts/summary/ae-framework-readiness-summary.json` と `reports/AE-FRAMEWORK-EVAL-LATEST.md` が毎回更新される。

9. M9: ae-framework readiness ゲート化
- readiness と known issues を閾値で pass/fail 判定するゲートを自動実行する。
- Exit条件: `artifacts/summary/ae-framework-readiness-gate-summary.json` が毎回更新される。

10. M10: CI 並行実行と成果物アーカイブ
- GitHub Actions で quality/pipeline を並行実行し、ae-framework 評価フローを継続実行する。
- Exit条件: `.github/workflows/ae-framework-automation.yml` が `push/pull_request/schedule` で動作し、`.ae/**`, `artifacts/**`, `reports/**` を artifact 保存できる。

## 6. 実行方式（自動化優先）
- 原則: 手作業よりも ae-framework の CLI / スクリプト / CI を優先。
- フェーズ実行の起点: `ae-playbook` 相当フローを採用。
- 手動介入は「仕様解釈」「失敗分析」「修正判断」に限定。

## 7. 進捗管理
- Issue 管理単位: マイルストーンごとに Issue / PR を分離。
- 変更管理単位: 「実装」「検証」「生成物更新」を同一PRに含め、追跡可能性を維持。

## 8. リスクと対策
1. 形式検証ツール未導入
- 対策: ツール未導入時は `tool_not_available` として記録し、導入後に再実行。

2. 生成物の未コミット
- 対策: PR 作成前に `git status` で `artifacts/` と `reports/` の差分を必ず確認。

3. 仕様解釈差異
- 対策: Issue #1 の不変条件・受入基準に対する Traceability 表を維持。

## 9. 現在ステータス（2026-02-15）
- M1: 完了
  - AE-Spec: `spec/rate-limiter-quota-service.ae-spec.md`
  - AE-IR: `.ae/ae-ir.json`
- M2: 初版完了
  - ライブラリ: `src/domain/rate-limiter-engine.ts`
  - API: `src/server/app.ts`
  - テスト: `tests/engine.spec.ts`, `tests/api.spec.ts`
- M3: 完了
  - 同時実行制御: `KeyedMutex` による tenant 単位の直列化を実装
  - 冪等性: request_id + payload hash の再送判定を実装
  - json-file backend を追加し、再起動時に policy/state/idempotency が保持されることを `tests/persistence.spec.ts` で検証
- M4: 完了
  - Property: `tests/property.spec.ts`
  - MBT: `tests/mbt.spec.ts`
  - Formal: `spec/formal/RateLimiterQuota.tla` + `scripts/automation/run-formal-check.sh`
  - 自動化: `pipeline:local` で property/mbt/formal を一括実行
- M5: 完了
  - RL-ACC-01/02/03 テストを `tests/acceptance.spec.ts` で実装し、pass を確認
  - 受入レポートを `reports/ACCEPTANCE-REPORT-LATEST.md` と日付付きファイルへ自動生成
- M6: 完了
  - `test:ae:spec:stdio` を追加し、ae-framework の stdio bridge を評価
  - bridge失敗時に `spec-compiler/dist/cli.js` へ自動fallback
  - `pipeline:local` に統合し、`artifacts/summary/ae-spec-stdio-summary.json` を証跡化
- M7: 完了
  - `test:ae:toolcheck` を追加し、bridge/cli/playbook の健全性を定点観測
  - `ae-playbook --resume` と `--no-resume` の互換性差分を証跡化
  - `test:ae:playbook:resume-safe` を追加し、context 正規化付き resume 実行を自動化
  - 受入レポートと context に toolcheck 結果を統合
  - 既知課題ドキュメント `docs/spec/AE-FRAMEWORK-KNOWN-ISSUES.md` を追加
- M8: 完了
  - `report:ae:framework` を追加し、readiness 判定（green/yellow/red）を自動出力
  - `pipeline:local` に統合し、context へ readiness サマリを連携
- M9: 完了
  - `gate:ae:framework` を追加し、閾値ベースの pass/fail 判定を自動化
  - `pipeline:local` と各レポートに gate 結果を統合
- M10: 完了
  - `run-local-pipeline.sh` に ae-framework 自動clone/checkoutを追加（CI前提の非対話実行）
  - GitHub Actions ワークフロー `ae-framework-automation.yml` を追加し、quality/pipeline を並行実行
  - pipeline 実行成果物（`.ae/**`, `artifacts/**`, `reports/**`）を Actions artifact として保存
