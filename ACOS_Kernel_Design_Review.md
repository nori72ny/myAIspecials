# ACOS 2.0 Agent Runtime (Kernel) - Architecture Design Review

## 【目的】
世界最高のAIオーケストレーションOSを目指し、Phase1として「毎日自分が使いたくなるAI OS」を完成させるため、ACOS 2.0 Agent Runtime (Kernel) の設計レビューとプラグインアーキテクチャへの移行方針を策定しました。

## 1. Kernelの責務分離
**現状の課題**: `MissionEngine` や `AgentRuntime` に「実行処理」「状態管理」「プロバイダ連携」が密結合になりやすい傾向があります。
**改善案**:
Kernel本体は「ライフサイクル管理」「プラグインのレジストリ」「Event Busを通じたメッセージング」のみに専念させます。
Google/OpenAIクラスの設計では、Kernelは完全に"無知（Agnostic）"であり、具体的な処理（LLMへの通信、DB保存など）は一切持たず、すべてDI（依存性の注入）またはプラグイン経由で実行します。

## 2. Control PlaneとExecution Planeの境界
**現状の課題**: AIのルーティングやタスク分割のロジック（Control Plane）と、実際のタスク実行やAPI呼び出し（Execution Plane）が混在しがちです。
**改善案**:
- **Control Plane**: ワークフローの計画、AIモデルの動的選定（ルーティング）、セキュリティポリシーの適用、プラグインの管理。
- **Execution Plane**: コンテナ内でのサンドボックス実行、実際のLLM APIリクエスト、ツール（関数）の実行。
これらは明確なインターフェース（gRPCやEvent Bus等）で分離し、Execution PlaneがクラッシュしてもControl Planeがリカバリできる設計とします。

## 3. AI Provider Adapter設計 (プラグイン化)
**現状**: `GeminiLLMClient` など特定のプロバイダに依存した構造が見られます。
**改善案 (100種類以上のAI追加に耐える構造)**:
`IAIProviderPlugin` インターフェースを定義し、OpenRouter, Anthropic, OpenAIなどの追加をCoreコードの変更なしで行えるようにします（Open/Closed Principle）。
能力定義（Capabilities）、コスト、速度などをマニフェスト（JSON等）で自己申告させることで、100種類以上のAIが追加されてもRouting Engineが自動的に最適なモデルを選択できます。

## 4. Memory設計
**現状の課題**: 短期記憶（Session）と長期記憶（DB）の境界が曖昧になりがちです。
**改善案**:
`IMemoryPlugin` インターフェースを定義。
- `ShortTermMemory`: Redisやオンメモリ。
- `LongTermMemory`: PostgreSQL/Vector DB。
Memory Managerが統一インターフェースでアクセスし、裏側のDB技術（Firebase, Supabase, Redis等）に依存しない構造にします。

## 5. Workflow Engine設計
**現状の課題**: タスクの順次実行がハードコードされている場合があります。
**改善案**:
`IWorkflowPlugin` を導入。DAG（有向非巡回グラフ）ベースのタスクオーケストレーションを採用し、並列実行・条件分岐・リトライをPlugin側で処理します。Coreはステータス（Ready, Running, Completed, Failed）の遷移イベントをリッスンするのみ。

## 6. Scheduler設計
**現状**: タスクの即時実行が基本となっています。
**改善案**:
優先度付きキュー（Priority Queue）と公平なリソース割り当て（Fair Scheduling）を持つ `ISchedulerPlugin` を定義。APIレートリミットを考慮した実行制御（Throttling）を行います。

## 7. Event Bus設計
**現状の課題**: コンポーネント間の直接呼び出し（同期処理）が多い。
**改善案**:
全ての状態変化、ツール実行、AI応答を `IEventBusPlugin` 経由の非同期メッセージング（Pub/Sub）にします。これにより、UI側（WebSocket）やログシステムがCoreに依存せずイベントを購読できます。

## 8. State Machine設計
**現状**: `status` フィールドによる単純な状態管理。
**改善案**:
厳密な有限状態オートマトン（FSM）を導入。不正な状態遷移（例：Failed -> Running）をカーネルレベルで弾く設計にします。

## 9. Plugin Architecture (プラグインアーキテクチャの導入)
すべての機能をプラグイン化します。依存方向（Dependency Direction）は **「すべて内側（Core/Interface）に向かう」** ようにします（Clean Architecture）。Coreは一切外部パッケージに依存しません。

### 依存方向のレビュー（Dependency Direction）
- ❌ Bad: `Core` -> `OpenRouterClient` (Coreが実装を知っている)
- ✅ Good: `OpenRouterPlugin` -> `IAIProviderPlugin (Core Interface)` (プラグインがCoreの規格に合わせて実装する)

## 10. 将来100種類以上のAIを追加しても破綻しない構造か
破綻しない設計の要は「能力ベースのルーティング（Capability-based Routing）」と「動的ディスカバリ」です。
AIモデルのリストをコードにハードコードせず、起動時に各プラグインが持つマニフェスト（対応可能なタスク、制限、速度、コスト）をRegistryに登録し、Routing EngineはRegistryから要件に合うモデルをクエリする方式とします。これにより、モデル数が増えてもCoreの計算量は増えず、保守性も維持されます。
