# ACOS 2.0 Goal Engine 実装完了 (Sprint 1)

ご指定の要件（DDD、Clean Architecture、Event Driven、Plugin Architecture対応、およびOpenRouter等の拡張性確保）に従い、ACOS 2.0の最上位レイヤーである `Goal Engine` を実装しました。

既存の `Mission Engine` を直接修正して壊すのではなく、EventBusを介した **Strangler Fig Pattern** を用いて疎結合に統合し、最小限の変更でアーキテクチャを進化させています。

---

## 1. ディレクトリ構成 (Directory Structure)

```text
src/lib/
 ├── goal-engine/
 │    ├── application/
 │    │    └── GoalEngine.ts          # ユースケース・イベントハンドリングのオーケストレーション
 │    ├── domain/
 │    │    ├── entities/
 │    │    │    ├── Goal.ts           # Goalエンティティ (ステート管理)
 │    │    │    ├── Intent.ts         # 明確化された意図
 │    │    │    └── ProposedMission.ts# 分解されたミッション提案
 │    │    └── services/              # (将来的なドメインロジック用)
 │    └── interfaces/
 │         └── types.ts               # Pluginとして注入するためのPort (IIntentAnalyzerPlugin 等)
 ├── kernel/
 │    ├── events/
 │    │    ├── EventBus.ts
 │    │    └── types.ts               # GoalEngine用のイベントを追加
 │    └── plugin/
 │         ├── PluginRegistry.ts
 │         └── types.ts
```

---

## 2. 追加ファイル (Added Files)

1. `src/lib/goal-engine/domain/entities/Goal.ts`
2. `src/lib/goal-engine/domain/entities/Intent.ts`
3. `src/lib/goal-engine/domain/entities/ProposedMission.ts`
4. `src/lib/goal-engine/interfaces/types.ts`
5. `src/lib/goal-engine/application/GoalEngine.ts`

*(※ 各モジュールはドメイン層とアプリケーション層に綺麗に分離され、外部API（LLM等）との通信はすべて `interfaces/types.ts` に定義されたインターフェース（Port）に依存しています)*

---

## 3. 変更ファイル (Modified Files)

1. `src/lib/kernel/events/types.ts`
   - Goal Engineが発行する新規イベント（後述）を `EventType` および `EventPayloadMap` に追加しました。
   - すべてのイベントが `BaseEventPayload` を継承するようにし、`missionId` をオプショナルに変更しました（Goal段階ではまだMissionが存在しないため）。

---

## 4. Event一覧 (Events)

Goal Engineが駆動するイベントフローです。これらは `Global Event Bus` を介して非同期に伝播します。

| イベント名 | 発行タイミング | ペイロード (主要項目) | 購読者 (想定) |
| :--- | :--- | :--- | :--- |
| **`GoalSubmitted`** | ユーザーが「売上を伸ばしたい」等の曖昧なゴールを入力した時 | `goalId`, `rawInput`, `userId` | GoalEngine |
| **`IntentClarified`** | Goalからコンテキストが補完され、明確な意図(Intent)が生成された時 | `goalId`, `intent` (objective, constraints等) | UI (承認用), Logger |
| **`MissionsProposed`** | Intentを達成するための具体的なMissionのリストが策定された時 | `goalId`, `proposedMissions` | MissionEngine |

*(※ この後、Mission Engine が `MissionsProposed` をリッスンし、既存の `WorkflowGenerated` -> `ExecutionStarted` へと自動的に移行します)*

---

## 5. Interface一覧 (Interfaces / Plugins)

100種類以上のAIモデル（OpenRouter, Gemini, Anthropic等）を将来的に差し替えてもCoreが破綻しないよう、すべての処理をInterface（Plugin Architecture）に切り出しています。

| インターフェース名 | 責務 (Goal Engineの各フェーズ) |
| :--- | :--- |
| **`IGoalParserPlugin`** | ユーザーの自然言語入力（生テキスト）を構文解析し、初期のタグ付けや構造化を行う |
| **`IGoalContextBuilderPlugin`** | ユーザーIDをもとに、VectorDBやRAGから過去の行動履歴や好みを抽出してContextを構築する |
| **`IIntentAnalyzerPlugin`** | 生のGoalとContextを掛け合わせ、LLMを用いてMECEかつ具体的な「Intent（意図）」に昇華させる |
| **`IGoalValidatorPlugin`** | 生成されたIntentがセキュリティポリシー違反やシステム制約を超えていないかを検証する |
| **`IGoalPlannerPlugin`** | 承認されたIntentを達成するため、並列・直列実行可能な複数の `ProposedMission` に分解する |

### 💡 設計のポイント (OpenRouter / Multi-AI 対応)
これらのPlugin実装（Adapter）の内部で、カーネルの `PluginRegistry` を呼び出し `RoutingEngine` に最適なAIを判定させます。
例えば `GoalPlannerPlugin` の内部では、推論能力が要求されるため `RoutingEngine` が自動的に `OpenRouter Auto` や `o1-preview` などの能力（Capabilities="Reasoning"）を持つプロバイダを選択して実行する構造となっています。
これにより、Goal Engine本体は「どのAIモデルが動いているか」を一切知る必要がなくなり、完全な依存性逆転（DIP）を実現しています。
