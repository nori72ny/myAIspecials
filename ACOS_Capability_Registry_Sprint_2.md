# ACOS 2.0 Capability Registry 実装完了 (Sprint 2)

ACOS 2.0の次世代ルーティング基盤として、モデル名直接指定のルーティングから「**Capability（能力）**」による多次元スコアリング型ダイナミックルーティングを実現する **Capability Registry** を完全実装しました。

---

## 1. ディレクトリ構成 (Directory Structure)

DDD (Domain-Driven Design) および Clean Architecture の原則に基づき、以下の階層構造で実装されています。

```text
src/lib/
 └── capability-registry/
      ├── domain/
      │    ├── entities/
      │    │    ├── Capability.ts       # Capabilityエンティティ (名前、カテゴリ、説明)
      │    │    └── Provider.ts         # Providerエンティティ (自己申告能力、リアルタイムメトリクス、Health状態、Routing Hint)
      │    └── services/
      │         └── RoutingService.ts   # 最適Providerの多次元スコアリング/ランキングを行うドメインサービス (DDD Core)
      ├── application/
      │    └── CapabilityRegistry.ts    # ユースケースの調整、CRUD、およびEventBus連携を担うアプリケーションサービス
      └── interfaces/
           ├── types.ts                 # 外部連携、検索クエリ、ルーティング決定、レジストリ契約の抽象インターフェース (Ports)
           └── OpenRouterAdapter.ts     # OpenRouter経由の複数Provider (Claude, GPT, Gemini等) を自己申告情報と共に一括登録するAdapter
```

---

## 2. 追加ファイル (Added Files)

1. **`src/lib/capability-registry/domain/entities/Capability.ts`**
   - 能力の定義を管理。カテゴリ（Reasoning, Utilityなど）や説明を保持します。
2. **`src/lib/capability-registry/domain/entities/Provider.ts`**
   - 各モデル（Provider）のステートを管理。自己申告による能力評価（1〜5点）と、動的に変動する運用メトリクス（Cost、Latency、Quality、Failure Rate）およびRouting Hintをカプセル化。
3. **`src/lib/capability-registry/domain/services/RoutingService.ts`**
   - 要求された能力群、優先度（品質重視、コスト重視、速度重視など）、およびヘルスのステータスを総合評価する「多次元スコアリング・ランキングアルゴリズム」を実装。
4. **`src/lib/capability-registry/application/CapabilityRegistry.ts`**
   - コアのインメモリレジストリ。Providerの追加・削除、状態の動的変化、Capabilityに基づいた検索及びイベントの発行（Event Driven）を担当。
5. **`src/lib/capability-registry/interfaces/types.ts`**
   - `ICapabilityRegistry`（Port）、`SearchQuery`（検索用データ構造）、`RoutingDecision`（選択結果）、および `IProviderAdapter`（Adapter規約）を定義。
6. **`src/lib/capability-registry/interfaces/OpenRouterAdapter.ts`**
   - OpenRouterを擬した集約Adapter。複数の主要プロバイダー（Claude-3.5-Sonnet, GPT-4o, Gemini-1.5-Pro, DeepSeek-Coder, Grok-2等）をそれぞれの特性メトリクスやルーティングヒントと共に一括生成。
7. **`src/lib/capability-registry/__tests__/CapabilityRegistry.test.ts`**
   - 各種ルーティング優先度（Quality優先 vs Cost優先）、Healthフィルタリング、Routing Hintによるブースト（加点）、EventBus連動、OpenRouterAdapter連携を網羅する100%パスするVitestユニットテスト。

---

## 3. 変更ファイル (Modified Files)

1. **`src/lib/kernel/events/types.ts`**
   - イベント駆動アーキテクチャ（Event-Driven Architecture）を強化するため、Capability Registry関連のライフサイクルイベントを新規追加。
     - `ProviderRegistered`（Provider登録時）
     - `ProviderUnregistered`（Provider解除時）
     - `ProviderHealthChanged`（障害検知によるHealth状態変化時）
     - `ProviderMetricsUpdated`（Latency/FailureRate等の最新メトリクス更新時）
     - `CapabilityRouted`（Capabilityベースの最適ルーティング実行完了時）

---

## 4. Interface一覧 (Interfaces)

1000種類以上のProvider追加に耐えうる拡張性・プラグイン容易性を担保するため、以下のクリーンなインターフェース群を策定しています。

### `ICapabilityRegistry` (アプリケーション境界)
```typescript
export interface ICapabilityRegistry {
  registerCapability(capability: Capability): void;
  registerProvider(provider: Provider): void;
  unregisterProvider(providerId: string): void;
  getProvider(providerId: string): Provider | undefined;
  getProvidersByCapability(capability: string): Provider[];
  searchAndRank(query: SearchQuery): RoutingDecision;
  updateProviderHealth(providerId: string, health: ProviderHealth): void;
  updateProviderMetrics(providerId: string, metrics: Partial<ProviderMetrics>): void;
}
```

### `IProviderAdapter` (プラグイン拡張用)
```typescript
export interface IProviderAdapter {
  id: string; // 例: "OpenRouter", "Local", "AWS"
  getSelfDeclaredProviders(): Promise<Provider[]>;
}
```

---

## 5. Event一覧 (Event Sourcing / Event Driven)

グローバルな `EventBus` を介して非同期に他コンポーネント（Monitoring, Billing, UI, Logger等）に配信可能なイベントスキーマです。

| イベント名 | 発行タイミング | ペイロード項目 (主要部) | 主な受取側・用途 |
| :--- | :--- | :--- | :--- |
| **`ProviderRegistered`** | 新しいAIプロバイダーが動的に追加された際 | `providerId`, `name`, `capabilities` | UI表示更新, Monitoring |
| **`ProviderUnregistered`** | プロバイダーがレジストリから離脱した際 | `providerId` | Routingキャッシュ削除, UI |
| **`ProviderHealthChanged`** | 外部ヘルスチェックや例外処理により、Healthy / Degraded / Down 状態が変化した際 | `providerId`, `oldHealth`, `newHealth` | ルーティング再調整、アラート、Slack通知等 |
| **`ProviderMetricsUpdated`** | コスト/レイテンシ/エラー率などの最新統計情報が反映された際 | `providerId`, `metrics` | スコア計算重みの動的最適化、Billing/統計ログ |
| **`CapabilityRouted`** | 特定のタスク能力要件に対して最適なプロバイダーがマッチングされた際 | `requestedCapabilities`, `priority`, `selectedProviderId`, `score` | トレーサビリティの確保、A/Bテスト分析、Audit |

---

## 6. Vitest追加内容 (Vitest unit tests)

`src/lib/capability-registry/__tests__/CapabilityRegistry.test.ts` において以下の全検証ケースを実行しています。

- **`should successfully register capabilities and providers`**
  - 新規Capability定義およびProviderの追加、及びcapabilityによる部分引き当て（インデックス検索）の正確性を保証。
- **`should rank providers properly with different priorities (Quality vs Cost)`**
  - 高品質だが高額なモデル（Premium GPT）と、低価格でそこそこのモデル（Cheap Llama）に対して、優先度が `quality` の場合はPremium、`cost` の場合はCheapが自動的にマッチングされる多次元意思決定を検証。
- **`should filter out Down providers from active routing decisions`**
  - 障害が発生して `down` になった高精度モデルをスキップし、セカンドベストなHealthyモデルへとフェイルオーバー（自動迂回）する耐障害性を証明。
- **`should apply routing hints bonus points correctly`**
  - `agentic-orchestration` などのRouting Hint要件が一致したProviderにボーナス加点される、きめ細やかな調整機能を検証。
- **`should emit events via EventBus during provider lifecycle & queries`**
  - 各種状態変化およびルーティング意思決定時に、`globalEventBus` に正確な型定義とペイロードを持ったイベントが正しくpublishされるかを監視。
- **`should load self-declared providers through OpenRouterAdapter correctly`**
  - 1000種類以上の拡張容易性をデモするため、OpenRouterAdapterを実稼働させてClaude 3.5 SonnetやGemini 1.5 Proなどを一挙ロード・登録し、`Vision` と `Search` が要求されたときにGemini 1.5 Proがバシッと選択されるエンドツーエンドの挙動を保証。

---

## 7. Playwright追加内容 (Playwright E2E Integration)

E2Eテストスイート（`tests/e2e/acos.spec.ts` など）への機能統合に向けたPlaywright追加実装の設計は以下の通りです。

1. **Capability Routing Mock Verification**:
   - `playwright` テスト内で画面操作（ミッションの実行）を行った際、バックエンドで `CapabilityRouted` イベントが発行されたことをインラインでリッスン、または画面のデバッグパネルに表示される「マッチングされたProvider名（例: Claude 3.5 Sonnet (OpenRouter)）」のDOM要素を取得し、モデル直接指名ではなくCapabilityエンジンが正常にバックエンドで機能したことを検証するアサーションを追加。
2. **Provider Health Degrade Fallback Test**:
   - APIリクエストをモックして `ProviderHealthChanged` イベントをトリガーさせ、UI上で「現在稼働中の最適モデル」がGeminiやGPTに動的にシフトすることをブラウザ上でアサーション。
3. **Accessibility Integration**:
   - Capability情報を表示するUIコンポーネントにおけるコントラスト比や、セマンティックHTML（スクリーンリーダー用の `aria-live` による最適モデル変更アナウンスなど）がWCAG 2.1AA（Axe-core）を満たしていることを自動検証。
