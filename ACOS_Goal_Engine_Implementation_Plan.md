# ACOS 2.0 Goal Engine & Routing 実装計画

## 1. 概要
現在のリポジトリ（`services/mission-engine` および `src/lib/` 以下のフロント/バックエンド共有ロジック）を前提に、最小限の変更で「Goal Engine」「Intent Analyzer」「Planner」「Capability Routing (v2)」を統合する現実的な実装計画を提案します。
段階的な移行（Strangler Fig Pattern）を適用し、既存のMission実行パスを壊さずにEvent-Drivenな上位レイヤーを被せる戦略をとります。

---

## 2. 実装の分類

### 🆕 新規追加 (New Additions)
1. **Goal Engine Core (`src/lib/goal-engine/`)**
   - `GoalManager`: Goalの受付とステート管理
   - `IntentAnalyzer`: RAGやコンテキストを用いてGoalをIntentに変換
   - `StrategyPlanner`: IntentをMissionのリストに分解
2. **Event Definitions (`src/lib/kernel/events/types.ts`)**
   - `GoalSubmitted`, `IntentClarified`, `MissionsProposed` イベント型の追加
3. **Plugin Implementations (`src/lib/plugins/`)**
   - `LLMIntentAnalyzerPlugin`: LLMを使ったIntent解析ロジック
   - `LLMStrategyPlannerPlugin`: LLMを使った戦略策定ロジック

### 🔄 既存修正 (Modifications)
1. **Mission Engine 連携 (`services/mission-engine/src/application/usecases/`)**
   - `MissionsProposed` イベントをListenし、既存の `PlanMissionUseCase` や `ExecuteMissionUseCase` へデータを流し込むアダプターの追加。
   - コントローラーからの直接呼び出しだけでなく、EventBus経由での発火をサポートする。
2. **TaskExecutor / AgentRuntime のルーティング対応**
   - 既存の `GeminiLLMClient` 固定処理を改修し、`RoutingEngine.route(request)` の結果（`primaryAI` 等）に基づいて、PluginRegistryから取得した `IAIProviderPlugin` (OpenRouter/Gemini等) を動的に呼び出すように変更。

### ♻️ リファクタリング (Refactoring)
1. **同期処理から非同期Event連携への移行**
   - `AgentRuntime.ts` などの内部で `await` して直接次工程を呼んでいた部分を、`EventBus.publish('ExecutionFinished')` の発行と購読モデルへ段階的に書き換え。
2. **PluginRegistry の DI (依存性注入)**
   - `initMissionEngine` などの初期化時 (`index.ts`) に、PluginRegistryを生成し、各種ProviderやPlannerをRegisterする処理を統合。

---

## 3. フェーズ別実装手順と依存関係

### フェーズ 1: 基盤統合 (Routing Engine & Plugin System)
- **依存**: なし
- **作業**:
  1. `PluginRegistry` のインスタンスをアプリケーションのルート（`index.ts` 等）で初期化。
  2. `RoutingEngine` と `PluginRegistry` を結びつけ、現在の `GeminiLLMClient` を `GeminiProviderPlugin` としてリファクタリングして登録。
  3. `TaskExecutor` が `RoutingEngine` を使って最適なプロバイダを選択し、タスクを実行するように変更。

### フェーズ 2: EventBus導入とMissionEngineの非同期化
- **依存**: フェーズ 1
- **作業**:
  1. `EventBus` をグローバルまたはDIで提供。
  2. Missionの作成時、完了時、タスク実行完了時にイベントを `publish` するよう既存ロジックにフックを追加。
  3. UI側（またはWebSocketモジュール）がこのイベントを購読し、画面更新できるか確認。

### フェーズ 3: Goal Engine の構築
- **依存**: フェーズ 2
- **作業**:
  1. `IntentAnalyzer` と `StrategyPlanner` のインターフェースと標準実装（LLMベース）を作成。
  2. `GoalSubmitted` イベントを契機に Intent Clarification -> Strategy Formulation が走るフローを実装。
  3. 最後に `MissionsProposed` イベントを発行。

### フェーズ 4: E2E結合
- **依存**: フェーズ 3
- **作業**:
  1. ユーザーが「売上を上げたい」とGoalを入力するUI/APIを作成。
  2. Goal Engine -> Mission Engine -> Task Executor (with Routing) の一連のフローをテスト。

---

## 4. 工数見積もり (Effort Estimation)
*※1人月=20営業日、アジャイルチーム(フロント1, バック1)を想定*

| コンポーネント | 内容 | 予定工数 |
| :--- | :--- | :--- |
| **Phase 1** | Routing Engineの既存組み込みとPlugin化 | 3〜5日 |
| **Phase 2** | EventBusの導入と既存Engineのフック | 3〜5日 |
| **Phase 3** | Goal Engine (Intent/Planner) の新規実装 | 5〜7日 |
| **Phase 4** | E2Eテスト、エラーハンドリング、UI結合 | 4〜5日 |
| **Total** | 最小構成（MVP）の稼働まで | **約3〜4週間** |

---

## 5. リスクと軽減策 (Risks & Mitigations)

| 🔴 リスク (Risk) | 🟢 軽減策 (Mitigation) |
| :--- | :--- |
| **イベントの迷子 (Lost Events)**<br>非同期化により、処理が途中で止まっても検知できなくなる。 | タイムアウト監視機能を設け、一定時間進捗がないイベントに対しては `ExecutionFailed` を強制発火し、DLQに送る。 |
| **プロンプトチェーンの肥大化**<br>Intent -> Planner -> Workflow のLLM呼び出しでレイテンシが大きくなる。 | Streaming APIを活用し、UIには思考過程（CoT）を逐次表示して体感速度を上げる。並列処理可能なタスクはDAGで同時発火する。 |
| **既存機能のデグレ**<br>Routing変更により、今まで動いていたAgentが意図しないモデルで動き失敗する。 | `RoutingEngine` に `forceModel` フラグや優先度（Priority）のテストを多角的に行い、最初は既存のGeminiをフォールバックに指定する。 |

---

## 6. テスト戦略 (Test Strategy)

1. **Unit Test (Vitest)**
   - `GoalManager`, `IntentAnalyzer`, `StrategyPlanner` は、外部APIを叩かずモック（Mock）で入出力のデータ変換のみをテスト。
   - `RoutingEngine` のテスト（既に実装済）の拡張。
2. **Integration Test**
   - In-Memory EventBus を用い、`GoalSubmitted` を発火させてから `MissionsProposed` が出力されるまでのイベントチェーンの疎通確認。
3. **E2E / System Test (Human-in-the-Loop)**
   - テスト用スクリプトを用意し、「提案資料を作りたい」という入力に対して、生成されたMissionとTaskの品質を目視（またはLLM as a Judge）で評価。
