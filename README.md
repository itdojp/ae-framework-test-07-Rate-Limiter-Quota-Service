# ae-framework-test-07 Rate Limiter / Quota Service

## 概要
`ae-framework` を活用し、Issue #1 の仕様に基づいて Rate Limiter / Quota Service（Token Bucket + Fixed Window）を開発・検証する。

## 参照Issue
- 仕様書: https://github.com/itdojp/ae-framework-test-07-Rate-Limiter-Quota-Service/issues/1
- 開発開始時点の実行環境ベースライン: https://github.com/itdojp/ae-framework-test-07-Rate-Limiter-Quota-Service/issues/2

## 計画・仕様
- 開発計画: `docs/plans/DEVELOPMENT-PLAN.md`
- ae-framework 活用仕様（自動化/生成物保存）: `docs/spec/AE-FRAMEWORK-AUTOMATION-SPEC.md`
- ae-framework 既知課題: `docs/spec/AE-FRAMEWORK-KNOWN-ISSUES.md`
- トレーサビリティ表: `docs/spec/TRACEABILITY-MATRIX.md`

## 実行方法
1. 依存導入
```bash
pnpm install
```

2. ローカルパイプライン（AE-Spec検証 + テスト + artifacts出力）
```bash
pnpm run pipeline:local
```

3. ae-framework `codex:spec:stdio` 評価（自動サマリ出力）
```bash
pnpm run test:ae:spec:stdio
```

4. ae-framework ツール健全性マトリクス評価
```bash
pnpm run test:ae:toolcheck
```

5. ae-playbook resume-safe 実行（context正規化付き）
```bash
pnpm run test:ae:playbook:resume-safe
```

6. Stdioブリッジを直接利用（JSONをstdinで投入）
```bash
echo '{"action":"validate","args":{"inputPath":"spec/rate-limiter-quota-service.ae-spec.md","relaxed":true,"maxWarnings":200}}' | pnpm run codex:spec:stdio
```

7. 受入基準テストのみ実行
```bash
pnpm run test:acceptance
```

8. Property/MBT テスト実行
```bash
pnpm run test:property
pnpm run test:mbt
```

9. 永続化テスト実行（json-file backend）
```bash
pnpm run test:persistence
```

10. E2E 再起動テスト実行
```bash
pnpm run test:e2e:restart
```

11. 負荷検証実行
```bash
pnpm run test:load
```

12. Mutation レポート生成（script 未定義時は report-only）
```bash
pnpm run test:mutation:report
```

13. Formal チェック実行（TLC未導入時は report-only）
```bash
pnpm run formal:check
```

14. 受入レポート生成
```bash
pnpm run report:acceptance
```

15. ae-framework 評価レポート生成
```bash
pnpm run report:ae:framework
```

16. ae-framework readiness ゲート実行
```bash
pnpm run gate:ae:framework
```

17. サービス起動
```bash
pnpm run dev
```

## 永続化バックエンド
- 既定: `STATE_BACKEND=memory`
- ファイル永続化: `STATE_BACKEND=file` と `STATE_FILE_PATH` を設定

例:
```bash
STATE_BACKEND=file STATE_FILE_PATH=artifacts/ae/runtime-state.json pnpm run dev
```

## 生成物管理ポリシー
評価用途のため、ae-framework 実行で生成された中間生成物は `artifacts/` および `reports/` 配下に保存し、GitHub にコミットする。
