# RateLimiterQuotaServiceSpec

Rate limiter and quota service specification for concurrent-safe API protection.

## Glossary

- **Subject**: 制限対象（USER/API_KEY/IP/TENANT）
- **Resource**: 制限対象操作（ENDPOINT/ACTION）
- **Policy**: 制限ルールと適用範囲を保持する定義
- **Limit**: Token Bucket または Fixed Window の制限ルール定義
- **Decision**: consume/check の評価結果と補助情報
- **Idempotency Key**: 再送時の重複消費防止キー

## Domain

### Policy
- **policy_id** (string, required) - Unique policy identifier
- **tenant_id** (string, required) - Tenant scope for policy
- **name** (string, required) - Policy display name
- **status** (string, required) - ACTIVE or INACTIVE
- **priority** (number, required) - Larger value has higher precedence
- **scope_subject_type** (string, required) - USER/API_KEY/IP/TENANT
- **scope_resource_type** (string, required) - ENDPOINT/ACTION
- **match_resource_pattern** (string, required) - Path pattern such as /api/v1/orders/*
- **match_subject_filter** (json) - Optional subject filter attributes
- **limits** (array, required) - One or multiple limit definitions

### TokenBucketLimit
- **kind** (string, required) - TOKEN_BUCKET
- **capacity** (number, required) - Maximum token capacity
- **refill_tokens_per_sec** (number, required) - Refill rate per second
- **initial_tokens** (number) - Initial token count
- **max_cost** (number) - Max accepted cost per request
- **behavior_on_denied** (string, required) - Behavior when request is denied

### FixedWindowLimit
- **kind** (string, required) - Limit kind FIXED_WINDOW
- **window_seconds** (number, required) - Fixed window length in seconds
- **limit** (number, required) - Allowed usage in one window
- **counter_key_granularity** (string) - Counter key granularity WINDOW_START
- **behavior_on_denied** (string, required) - Deny request when usage exceeds limit

### Decision
- **allowed** (boolean, required) - Decision allow flag
- **policy_id** (string) - Applied policy identifier
- **retry_after_ms** (number) - Retry hint milliseconds on deny
- **remaining** (number) - Remaining budget on allow
- **reset_at** (date) - Window reset datetime for quota
- **results** (array, required) - Per-limit results

## Invariants

- RL-INV-001: TokenBucket の tokens は 0 <= tokens <= capacity
- RL-INV-002: FixedWindow の used は allow 時に limit を超えない
- RL-INV-003: 同一 key の同時 consume でも上限超過しない
- RL-INV-004: 同一 request_id の再送で二重消費しない
- RL-RULE-TIME-001: now < last_refill_at の場合は last_refill_at に丸める
- RL-BR-POLICY-001: Policy は ACTIVE 時に limits を1件以上保持する
- RL-BR-DECISION-001: Decision が deny の場合は retry_after_ms を返す

## Use Cases

### Create Policy
- 管理者がポリシーを作成する
- システムはバリデーションを行う
- システムはポリシーを保存する

### Consume Request
- クライアントが consume を呼び出す
- システムは対象ポリシーを選択する
- システムは全 limit を原子的に評価する
- 全て allow の場合のみ状態を更新する

### Check Request
- クライアントが check を呼び出す
- システムは consume 相当の判定を行う
- システムは状態更新を行わない

### Idempotent Retry
- クライアントが同一 request_id を再送する
- システムは同一 payload を検証する
- 一致時は同一 decision を返し不一致時は conflict を返す

## API

- POST /ratelimit/policies - Create policy
- GET /ratelimit/policies - List policies
- PATCH /ratelimit/policies/:policy_id - Update policy
- POST /ratelimit/consume - Check and consume atomically
- POST /ratelimit/check - Check only without consume

## UI Requirements

### Admin Policy Console
- ポリシー一覧表示
- ポリシー作成・更新
- ステータス切替

### Operation Dashboard
- deny 率と retry_after_ms の可視化
- policy ごとの利用量可視化

## Non-Functional Requirements

### Performance
- consume/check API は p95 50ms 以下
- 100 並行リクエストでも上限超過しない

### Reliability
- idempotency TTL 中は再送を再現可能
- 判定と消費は key 単位で原子的

### Security
- 管理 API は認証済みクライアントのみ利用可能
- request_id の再利用衝突は 409 を返す
