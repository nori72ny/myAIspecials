# ORIGIN OS - Version 1 Architecture Specification

> **Status:** READY FOR IMPLEMENTATION
> **Version:** 1.0 (Q5 Quality Standard)
> **Objective:** V1実装に向けた、過剰設計を排除し即座に実装・稼働可能なClean Architecture / DDDベースの設計定義。Event Sourcing, Temporal, Kafka, Actor Model等の複雑な分散アーキテクチャはV3へ延期し、V1は「堅牢なモジュラーモノリス（または軽量なマイクロサービス）」として構築します。

---

## 1. ディレクトリ構成 ＆ Clean Architecture依存関係

既存の巨大な `server.ts` を解体し、各サービス（今回は主軸となる `mission-engine` を例に）をクリーンアーキテクチャの原則（依存性の矢印は常に内側のDomainへ向かう）に従って分割します。

```bash
services/mission-engine/
├── src/
│   ├── domain/             # [依存ゼロ] コアビジネスロジック、Entity、Repository IF
│   │   ├── models/         # Mission, Task, Agent等のEntity / Value Object
│   │   └── repositories/   # IMissionRepository等のインターフェース
│   │
│   ├── application/        # [Domainに依存] ユースケース、アプリケーションロジック
│   │   ├── usecases/       # CreateMissionUseCase, ExecuteMissionUseCase
│   │   └── dto/            # Input/Output Data Transfer Objects
│   │
│   ├── infrastructure/     # [Domain, Applicationに依存] 外部技術の具象実装
│   │   ├── database/       # DB接続、Repository具象クラス (Postgres/Prisma等)
│   │   ├── ai/             # Gemini APIクライアントの実装
│   │   └── registry/       # Agent Registryの具象実装
│   │
│   ├── presentation/       # [Applicationに依存] Webフレームワーク (Express/Next.js API)
│   │   ├── controllers/    # HTTPリクエストのハンドリング、UseCaseの呼び出し
│   │   ├── routes/         # Express Router定義
│   │   └── middlewares/    # エラーハンドリング、認証等
│   │
│   └── index.ts            # エントリーポイント (Express Appの初期化・DIの注入)
```

---

## 2. Domain Layer 設計

ドメイン層はフレームワークやデータベースから完全に独立させます。

### 主要 Entities
- **`Mission` (ミッション)**
  - プロパティ: `id`, `objective` (目標), `status` (PENDING, IN_PROGRESS, COMPLETED, FAILED), `tasks` (タスクリスト)
  - 振る舞い: `addTask()`, `updateStatus()`, `isComplete()`
- **`Task` (タスク)**
  - プロパティ: `id`, `description`, `assigneeRole` (担当エージェントの役割), `status`, `result`
- **`Agent` (エージェント概念)**
  - プロパティ: `id`, `role`, `systemPrompt`, `modelName`

### Repository Interfaces (Port)
```typescript
interface IMissionRepository {
  save(mission: Mission): Promise<void>;
  findById(id: string): Promise<Mission | null>;
  update(mission: Mission): Promise<void>;
}
```

---

## 3. Application Layer 設計

ユースケースは「システムが何ができるか」を定義します。トランザクションの境界（Transaction Boundary）は原則としてこの層（UseCase単位）で張ります。

### 必須 UseCases (V1)
1. **`PlanMissionUseCase`**
   - **Input**: ユーザーの自然言語による目標 (Objective)
   - **Process**: LLM（Orchestrator Agent）を呼び出し、Missionを達成するためのTaskリストを生成。Mission Entityを生成してDBに保存。
   - **Output**: 生成されたMission IDとTaskのリスト
2. **`ExecuteTaskUseCase`**
   - **Input**: Mission ID, Task ID
   - **Process**: Taskの `assigneeRole` に基づいてAgent Registryから適切なAgentを取得し、LLMにタスクを実行させる。結果をDBに保存。
   - **Output**: 実行結果テキストとステータス

---

## 4. Infrastructure Layer 設計

### データベース (Repository具象)
- V1では過剰なORMを避け、軽量なクエリビルダ（Kysely等）やシンプルなPrismaを採用し、`IMissionRepository` を実装します。
- `save()` 時点でのアトミックな保存を担保。

### AI 統合 (Gemini API)
- `@google/genai` SDKを使用し、`IAiProvider` インターフェースを実装。
- エラーハンドリング、リトライロジックをここにカプセル化。

---

## 5. Agent Registry 設計 (V1仕様)

複雑な動的エージェント生成はV3に回し、V1では**静的（またはDB管理）なRole-based Registry**を採用します。

```typescript
// infrastructure/registry/StaticAgentRegistry.ts
export const AgentRegistry = {
  getAgentByRole(role: string): AgentConfig {
    const agents = {
      "ARCHITECT": {
        model: "gemini-3.5-flash",
        systemPrompt: "あなたは熟練のアーキテクトです。与えられた要件からシステム構造を設計してください。"
      },
      "RESEARCHER": {
        model: "gemini-3.5-flash",
        systemPrompt: "あなたはリサーチャーです。必要な情報を検索・分析し、結論をまとめてください。"
      }
    };
    return agents[role] || agents["GENERAL"];
  }
}
```

---

## 6. Mission Engine 設計

V1のMission Engineは、非同期メッセージング（Kafka等）ではなく、**シンプルな同期的/直列的なポーリング・ループ**で実装します。

1. `PlanMissionUseCase` でタスクリストを構築。
2. コントローラー側、またはバックグラウンドジョブ（シンプルな `setInterval` や `Agenda` 等）が、`IN_PROGRESS` な Missionの未実行Taskを順番に `ExecuteTaskUseCase` へ渡す。
3. すべてのタスクが完了したら Mission を `COMPLETED` に更新。

---

## 7. 各サービス間 API (RESTful)

V1では gRPC や GraphQL は見送り、シンプルでテスト容易な REST API とします。

| メソッド | エンドポイント | 責務 (UseCase呼び出し) |
|---|---|---|
| POST | `/api/v1/missions` | 新規ミッションの登録と計画生成 (`PlanMissionUseCase`) |
| GET | `/api/v1/missions/:id` | ミッションの現在のステータスとタスク結果の取得 |
| POST | `/api/v1/missions/:id/execute` | ミッションのタスク実行をトリガー（同期または非同期開始） |

---

## 8. 実装順序 (Implementation Sequence)

手戻りを防ぎ、確実に動作するコードを積み上げるためのフェーズ分けです。

*   **Phase 1: 基礎ドメインとレジストリ**
    *   Entity (`Mission`, `Task`) と インターフェース (`IMissionRepository`) の実装。
    *   `AgentRegistry` の静的実装。
*   **Phase 2: インフラとAI連携**
    *   インメモリまたは軽量DB（SQLite/Postgres）を用いた Repository の具象実装。
    *   Gemini APIクライアントの実装（モックを使ったテスト込み）。
*   **Phase 3: ユースケース層 (Core Logic)**
    *   `PlanMissionUseCase` (要件からタスク分解するAI処理の実装)。
    *   `ExecuteTaskUseCase` (タスクごとのAI処理の実装)。
*   **Phase 4: プレゼンテーション層 (API & Web)**
    *   Express/Next.js APIルートの実装 (`server.ts` の分割作業)。
    *   Dependency Injection (DI) の設定。
*   **Phase 5: クライアント接続とE2Eテスト**
    *   フロントエンドからの呼び出し。
    *   Playwright / Vitest による通しテスト。

---

## 総評
この設計により、**CQRSやEvent Sourcingといった認知負荷の高いパターンを回避しつつ、ビジネスロジックの純粋性（Clean Architecture / DDD）を保ち、将来のV3（分散・イベント駆動）への移行パスを閉ざさない**、完璧なバランスのV1が実現できます。直ちに実装フェーズ（Phase 1）へ移行可能です。
