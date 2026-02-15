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
