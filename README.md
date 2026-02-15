# ae-framework-test-07 Rate Limiter / Quota Service

## 概要
`ae-framework` を活用し、Issue #1 の仕様に基づいて Rate Limiter / Quota Service（Token Bucket + Fixed Window）を開発・検証する。

## 参照Issue
- 仕様書: https://github.com/itdojp/ae-framework-test-07-Rate-Limiter-Quota-Service/issues/1
- 開発開始時点の実行環境ベースライン: https://github.com/itdojp/ae-framework-test-07-Rate-Limiter-Quota-Service/issues/2

## 計画・仕様
- 開発計画: `docs/plans/DEVELOPMENT-PLAN.md`
- ae-framework 活用仕様（自動化/生成物保存）: `docs/spec/AE-FRAMEWORK-AUTOMATION-SPEC.md`

## 実行方法
1. 依存導入
```bash
pnpm install
```

2. ローカルパイプライン（AE-Spec検証 + テスト + artifacts出力）
```bash
pnpm run pipeline:local
```

3. サービス起動
```bash
pnpm run dev
```

## 生成物管理ポリシー
評価用途のため、ae-framework 実行で生成された中間生成物は `artifacts/` および `reports/` 配下に保存し、GitHub にコミットする。
