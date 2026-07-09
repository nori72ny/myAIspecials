# ACOS 2.0 Meta-Registry Architecture Specification
## 〜 100万エンティティへスケールする超大規模自律エージェント基盤設計 〜

本仕様書は、GoogleのPrincipal AI Architect/Staff Engineerとして、現在の **Capability Registry** を包含し、将来的な **Skill Registry**, **Experience Registry**, **Learning Registry**, **Knowledge Registry** をシームレスに統合・拡張するための「**Meta-Registry (メタレジストリ) 統合基盤設計**」を定義します。

---

## 1. 概念設計: Unified Registry & Abstract Resource (メタレジストリ・パターン)

1000以上のProvider、10000以上のSkill、100万以上のKnowledgeにスケールさせるためには、各レジストリを個別にその場しのぎで実装するのではなく、すべてのレジストリ要素を「**Resource（資源）**」として一般化し、それらに対する「**Query（検索）**」と「**Selection/Ranking（選定・重み付け）**」の振る舞いを抽象化する**Unified Meta-Registry（メタレジストリ）**アーキテクチャを採用します。

```text
               +----------------------------------+
               |        IRegistryProvider         |  (プラグイン/プロバイダーインターフェース)
               +----------------------------------+
                                |
                                v
               +----------------------------------+
               |        IMetaRegistry<R, Q>       |  (メタレジストリ・コア)
               +----------------------------------+
                                |
        +-----------------------+-----------------------+
        |                       |                       |
        v                       v                       v
+---------------+       +---------------+       +---------------+
|  Capability   |       |     Skill     |       |   Knowledge   |  ... (各具象レジストリへの特化)
|   Registry    |       |   Registry    |       |   Registry    |
+---------------+       +---------------+       +---------------+
```

---

## 2. 普遍的抽象インターフェース群 (Domain Abstraction)

### A. 普遍的リソースの定義: `IResource`
すべての登録エンティティ（Capability, Skill, Experience, Knowledge, Provider）が満たすべき最小限のメタデータ。

```typescript
export interface IResource {
  readonly id: string;
  readonly name: string;
  readonly type: ResourceType; // "capability" | "skill" | "experience" | "learning" | "knowledge" | "provider"
  readonly metadata: Record<string, any>;
  readonly version: string;
  readonly tags: string[];
}

export type ResourceType = "capability" | "skill" | "experience" | "learning" | "knowledge" | "provider";
```

### B. 普遍的クエリの定義: `IResourceQuery`
あらゆる検索要件を標準化するための汎用クエリ構造。

```typescript
export interface IResourceQuery {
  readonly targetType: ResourceType;
  readonly criteria: Map<string, any>;
  readonly limit?: number;
  readonly offset?: number;
  readonly priority?: "performance" | "cost" | "relevance" | "balanced";
  readonly vectorEmbedding?: number[]; // セマンティック検索/RAG用
}
```

### C. メタ・レジストリ契約: `IMetaRegistry<R extends IResource, Q extends IResourceQuery>`
SOLID原則における Liskov Substitution Principle (LSP) および Interface Segregation Principle (ISP) に則り、全てのレジストリが満たすべき共通インターフェース。

```typescript
export interface IMetaRegistry<R extends IResource, Q extends IResourceQuery> {
  register(resource: R): Promise<void>;
  unregister(resourceId: string): Promise<void>;
  get(resourceId: string): Promise<R | undefined>;
  search(query: Q): Promise<R[]>;
  rank(resources: R[], query: Q): Promise<R[]>;
}
```

---

## 3. 将来的な4つのレジストリの拡張マッピング (Registry Extension Map)

本メタアーキテクチャにより、新レジストリは `IMetaRegistry` のジェネリクスを実装するだけで、ACOSカーネルのプラグインとして動的に追加されます。

```typescript
// 1. Skill Registry: 1万以上の自律アクション・ツール実行仕様
export interface ISkillResource extends IResource {
  readonly type: "skill";
  readonly inputSchema: Record<string, any>;
  readonly outputSchema: Record<string, any>;
  readonly executeFn: (args: any) => Promise<any>;
}

// 2. Experience Registry: 過去のタスク成功・失敗の軌跡 (エピソード)
export interface IExperienceResource extends IResource {
  readonly type: "experience";
  readonly contextState: Record<string, any>;
  readonly actionSequence: string[];
  readonly outcome: "success" | "failure";
  readonly reward: number;
}

// 3. Learning Registry: 意思決定ポリシー、ファインチューニング重み、適応パラメーター
export interface ILearningResource extends IResource {
  readonly type: "learning";
  readonly policyVersion: string;
  readonly lossHistory: number[];
  readonly parameters: Map<string, number>;
}

// 4. Knowledge Registry: 100万以上のドキュメント断片、RAGチャンク、Web検索結果キャッシュ
export interface IKnowledgeResource extends IResource {
  readonly type: "knowledge";
  readonly content: string;
  readonly sourceUrl?: string;
  readonly embedding: number[]; // 高次元ベクトルデータ
}
```

---

## 4. Googleスケール (100万エンティティ超) に対応するアーキテクチャ設計

インメモリでの全走査（ループ）は数千件が限界です。Google Borg / Google Searchのインデックス技術とリアルタイム性を両立させるため、以下の3つの戦略をバックエンドとアダプター層に適用します。

### A. 段階的ハイブリッド検索 (Multi-Stage Retrieval)
100万件のKnowledgeからミリ秒単位で最適な候補を選ぶため、**「Filter & Rank」二段階構成**を採用します。
1. **L1 Retrieval (フィルターフェーズ)**: 
   - `Elasticsearch` / `Spanner` の逆インデックスを用いたキーワード絞り込み、または `Pinecone` / `pgvector` を用いた **ベクトル近傍探索 (ANN: Approximate Nearest Neighbor)** により、100万件から上位50〜100件の候補リソースを高速に抽出。
2. **L2 Re-ranking (スコアリングフェーズ)**: 
   - 絞り込まれた100件に対し、本設計で実装した `RoutingService` のような多次元メトリクススコアリングや、LLM / クロスエンコーダーによる精密なランキングを行い、最終的な1〜5件の最適リソースを選定。

### B. 階層型キャッシュ層 (Hierarchical Caching)
- **L1 (Local In-Memory Cache)**: 各ACOSコンテナプロセスのメモリ（LRU Cache）に、頻出のSkillやCapabilityマッチング、およびホットナレッジをキャッシュ（TTL数秒〜数分）。
- **L2 (Distributed Cache)**: 高速アクセスが可能な Redis クラスタを配置。同一インスタンスで稼働する全ACOSコンテナが共有し、直近のエクスペリエンスやメタデータを維持（ミリ秒未満のレイテンシ）。
- **L3 (Persistent Store)**: Spanner、Cloud SQL (PostgreSQL/pgvector)、または Firestore などの高信頼・永続化層。

### C. CQRS (Command Query Responsibility Segregation: コマンドクエリ責務分離)
- **Command (書き込み)**: 登録（`register`）、削除（`unregister`）、Health変更などは、非同期で `EventBus` を介して永続データベースに書き込まれます。
- **Query (読み込み)**: 検索、スコアリング、ランキングなどは、データベースのリードレプリカや高速インデックス（ベクトルDB）から読み取られます。書き込みが読み込みのボトルネックにならないため、大規模トラフィック下でも極めて安定したパフォーマンス（スループット）を保証します。

---

## 5. 抽象化のメリット (Engineering Assessment)

1. **SOLIDの徹底**:
   - **Open/Closed Principle (OCP)**: 新しいRegistry（例: `KnowledgeRegistry`）を追加する際、既存の `GoalEngine` や `CapabilityRegistry` のソースコードを1行も修正することなく、プラグインのように新規アダプターとして追加できます。
2. **依存性逆転 (DIP) の極致**:
   - `GoalEngine` や `ExecutiveBrain` などの上位ユースケース層は、下位の具体的なDBや外部LLMAPI（OpenRouter等）に依存せず、常に `IMetaRegistry<IResource, IResourceQuery>` 抽象契約にのみ依存します。
3. **OpenRouterなど1000種類以上のAI接続容易性**:
   - 各AIモデルは `IResource` (具体的には `IProviderResource`) として登録され、特性変更は `IResourceQuery` の重み付けパラメータを変更するだけで動的に最適化されます。
