# ae-framework 活用仕様（自動化・生成物保存）

## 1. 文書メタ
- 文書ID: `RL-AE-SPEC-001`
- 版: `v0.2`
- 作成日: `2026-02-15`
- 対象リポジトリ: `itdojp/ae-framework-test-07-Rate-Limiter-Quota-Service`
- 参照 ae-framework: `546b9d21daeda171f47924f02195d9e4bd81a3c8`（2026-02-15時点）

## 2. 前提バージョン
- Codex CLI: `0.101.0`（Issue #2）
- Node.js: `v22.19.0`
- pnpm: `10.17.1`
- ae-framework 要件: Node `>=20.11 <23`, pnpm `10`

## 3. 利用ツール選定
1. `scripts/codex/ae-playbook.mjs`（`pnpm run codex:run`）
- 用途: 本リポジトリでは `pnpm run pipeline:local` を `codex:run` として運用。
- 理由: 仕様検証・テスト・負荷・mutation・formal・受入レポートまでを1コマンドで再現できるため。

2. `pnpm run codex:spec:stdio`
- 用途: `scripts/automation/ae-spec-stdio-proxy.mjs` 経由で ae-framework の stdio bridge を呼び出す。
- 理由: エージェント連携時の機械可読性が高く、入出力をそのまま証跡化できる。

3. `pnpm run verify:lite`
- 用途: 日次の軽量品質ゲート（lint/type/unit 等）。
- 理由: fail-fast で回帰を早期検知できる。

4. `pnpm run test:property`
- 用途: ランダム入力で不変条件（RL-INV-001/002/003/004）を継続検証。
- 理由: 回帰時に境界条件の崩れを早期発見できる。

5. `pnpm run test:mbt`
- 用途: 状態遷移（consume/check/time_advance/retry）をモデル比較で検証。
- 理由: 同時実行制御と時刻ルールの仕様整合性を検証できる。

6. `pnpm run formal:check`
- 用途: TLA+ 形式仕様の検査（TLC未導入時は `tool_not_available` を証跡化）。
- 理由: Formal 実行可否を含めた再現可能な証跡を残せる。

7. `pnpm run test:persistence`
- 用途: json-file backend で再起動後の状態保持を検証。
- 理由: 実運用に近い構成で idempotency/state 維持を検証できる。

8. `pnpm run test:e2e:restart`
- 用途: APIプロセス再起動を伴う E2E 検証。
- 理由: 実プロセス境界で persistence/idempotency の継続性を確認できる。

9. `pnpm run test:load`
- 用途: 並行バースト/継続負荷の上限超過有無を検証。
- 理由: RL-ACC-01 の負荷観点証跡を自動生成できる。

10. `pnpm run test:mutation:report`
- 用途: mutation 実行可否と結果の証跡を report-only で記録。
- 理由: ツール未設定でも品質評価の欠落状態を可視化できる。
- 補足: 現行実装は `scripts/automation/run-mutation-synthetic.mjs` による synthetic-smoke を既定採用。

11. `pnpm run pipelines:mutation:quick`
- 用途: ミューテーションテストによるテスト有効性確認。
- 理由: 不変条件テストの強度を定量評価できる。

12. `pnpm run verify:formal`（必要に応じて個別 verify を併用）
- 用途: TLA+/Alloy/SMT/CSP などの形式検証。
- 理由: RL-INV-003/004（同時実行・冪等性）の安全性エビデンスを補強できる。

13. `pnpm run test:ae:spec:stdio`
- 用途: `codex:spec:stdio` の実行可否を評価し、fallback を含む要約を生成。
- 理由: ae-framework ツールの実効性を定量化し、再現可能な比較証跡を残せる。

14. `pnpm run test:ae:toolcheck`
- 用途: ae-framework ツール群（bridge/cli/playbook）の健全性をマトリクス評価する。
- 理由: 既知不整合と回避策を同一フォーマットで継続観測できる。

15. `pnpm run test:ae:playbook:resume-safe`
- 用途: `ae-playbook --resume` 実行前に context を正規化し、互換性を維持して実行する。
- 理由: 既知課題（AE-KNOWN-002）の実運用回避策を自動化できる。

16. `pnpm run report:ae:framework`
- 用途: ae-framework 由来の評価結果を統合し、readiness 判定を出力する。
- 理由: 継続評価の比較軸を1ファイルに固定し、改善判定を容易にする。

17. `pnpm run gate:ae:framework`
- 用途: readiness 判定を閾値ベースで pass/fail 判定する。
- 理由: CI/運用ゲートへ直接接続できる評価結果を自動生成できる。

18. `.github/workflows/ae-framework-automation.yml`
- 用途: `quality` と `pipeline` を並行実行し、評価フローを定期・PR・main push で自動化する。
- 理由: 手動実行依存を下げ、ae-framework 評価の継続観測を標準化できる。

## 4. 自動化設定
### 4.1 基本方針
- `--resume` を既定使用し、途中失敗後も継続可能な実行形態とする。
- `--enable-formal` を有効化し、形式検証は可能な限り自動実行する。
- 失敗方針は以下を採用。
  - fail-fast: setup / qa / verify-lite
  - warn-and-continue: formal / adapters / coverage（未導入時を許容）

### 4.2 推奨環境変数
- `CODEX_ARTIFACTS_DIR=artifacts/codex`
- `CODEX_RUN_FORMAL=1`
- `CODEX_TOLERANT=0`
- `CODEX_SKIP_QUALITY=0`
- `FORMAL_TIMEOUT_SEC=60`
- `TLA_TOOLS_JAR=<path/to/tla2tools.jar>`（任意）
- `STATE_BACKEND=memory|file`
- `STATE_FILE_PATH=artifacts/ae/runtime-state.json`（`STATE_BACKEND=file` 時）
- `AE_FRAMEWORK_ROOT=/tmp/ae-framework-20260215`（ローカル既定）
- `AE_FRAMEWORK_REPO_URL=https://github.com/itdojp/ae-framework.git`
- `AE_FRAMEWORK_REF=546b9d21daeda171f47924f02195d9e4bd81a3c8`
- `AE_FRAMEWORK_FALLBACK_REF=main`

### 4.3 CI 自動実行
- Workflow: `.github/workflows/ae-framework-automation.yml`
- trigger: `push(main)`, `pull_request`, `schedule(daily)`, `workflow_dispatch`
- 並行ジョブ:
  - `quality`: `test` / `typecheck` / `build`
  - `pipeline`: `pnpm run pipeline:local`
- 保存: `pipeline` ジョブで `.ae/**`, `artifacts/**`, `reports/**` を GitHub Actions artifact として保存。

## 5. 生成物保存仕様（GitHub保存必須）
### 5.1 保存対象ディレクトリ
- `artifacts/ae/**`
- `artifacts/codex/**`
- `artifacts/hermetic-reports/**`
- `artifacts/summary/**`
- `reports/**`
- `.ae/**`（仕様中間生成物）
- `spec/formal/**`（形式仕様）

### 5.2 保存ルール
1. ae-framework 実行後、上記パスの差分は全てコミット対象とする。
2. 生成物のみ更新のコミットを許容し、履歴の欠落を防止する。
3. 中間生成物の削除は、再現性を損なう場合は実施しない。
4. CI 実行時は GitHub Actions artifact にも成果物を保存し、実行履歴と証跡を追跡可能にする。

### 5.3 実行・保存の標準手順
1. ae-framework の対象コマンドを実行。
2. `git status` で生成物差分を確認。
3. `git add artifacts reports .ae` を実行。
4. 生成内容を要約したコミットを作成。
5. GitHub へ push し、Issue/PR に証跡パスを記載。

推奨コマンド:
```bash
pnpm run pipeline:local
```

## 6. トレーサビリティ方針
- Issue #1 の規則ID（`RL-INV-*`, `RL-ACC-*`）を、テスト名・レポート名・PR説明に明記する。
- 最低限、以下を紐づける。
  - RL-INV-001/002: Property / Unit
  - RL-INV-003: Concurrency test + Formal
  - RL-INV-004: Idempotency test + Formal
  - RL-ACC-01/02/03: 受入試験レポート
- 対応表は `docs/spec/TRACEABILITY-MATRIX.md` を正本とする。
- 実行時サマリは `artifacts/summary/traceability-summary.json` に出力する。

## 7. 未確定事項
- 実行モデル（ライブラリ優先かサービス優先か）の最終順序。
- 形式検証で採用する主ツール（TLC中心かApalache併用か）。
上記は実装初期のベンチ結果を確認後に確定する。

## 8. ツール健全性メモ（2026-02-15）
- `codex:spec:stdio`（ae-framework本体）は `packages/spec-compiler/src/index.js` 参照で失敗する場合がある。
- 本リポジトリでは `scripts/automation/run-ae-spec-stdio-check.mjs` が自動で fallback（`spec-compiler/dist/cli.js`）を実行し、`artifacts/summary/ae-spec-stdio-summary.json` に結果を保存する。
- `scripts/codex/ae-playbook.mjs --resume` は context 形式差異により失敗する場合がある。
- 本リポジトリでは `scripts/automation/run-ae-framework-toolcheck.mjs` が `resume` / `no_resume` の両モードを監視し、`artifacts/summary/ae-framework-toolcheck-summary.json` に結果を保存する。
- `scripts/automation/generate-ae-framework-eval-report.mjs` が readiness（green/yellow/red）を算出し、`artifacts/summary/ae-framework-readiness-summary.json` と `reports/AE-FRAMEWORK-EVAL-LATEST.md` を生成する。
- readiness 判定では `formal.status` が `tool_not_available` / `no_spec` の場合を `yellow`（CAUTION）として扱い、`fail` / `timeout` を `red`（BLOCKED）とする。
- `scripts/automation/check-ae-framework-readiness-gate.mjs` が readiness/known issues を閾値判定し、`artifacts/summary/ae-framework-readiness-gate-summary.json` を生成する。

## 9. 既知課題トラッキング
- 既知課題の正本は `docs/spec/AE-FRAMEWORK-KNOWN-ISSUES.md` とする。
- 既知課題は `AE-KNOWN-*` ID で管理し、Issue/コミット/証跡パスを相互参照する。
