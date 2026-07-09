# ACOS 2.0 Technical Debt Register (技術負債一覧)

This register acts as the central ledger for tracking, auditing, and prioritizing technical debt within the **ACOS 2.0 AI Operating System**. It is maintained under the stewardship of the Principal AI Architect and Engineering Lead.

---

## 📊 Summary of Technical Debt by Urgency

| Debt ID | Title | Domain | Priority | Classification |
| :--- | :--- | :--- | :--- | :--- |
| **ACOS-DEBT-001** | Process-Bound Memory EventBus | Kernel (Events) | High | **Personal GA までは許容するが本番化で必須** |
| **ACOS-DEBT-002** | Transient In-Memory Capability Registry | Routing (Registry) | High | **Personal GA までは許容するが本番化で必須** |
| **ACOS-DEBT-003** | Lack of Input Rating Guardrails | Routing (Validation) | Medium | **今すぐ直すべきもの (Fix Now)** |
| **ACOS-DEBT-004** | Hardcoded/Static Adapter Metrics | Integration | Medium | **Personal GA までは許容するもの** |
| **ACOS-DEBT-005** | No Active Execution Feedback Loop | Routing (Observability) | Medium | **Personal GA までは許容するもの** |
| **ACOS-DEBT-006** | Non-Thread-Safe Registry Mutations | Infrastructure | High | **Enterpriseで対応すべきもの** |
| **ACOS-DEBT-007** | Lack of Authorization / RBAC on Registry | Security | High | **Enterpriseで対応すべきもの** |
| **ACOS-DEBT-008** | Magic Number Scoring Weights | Routing (Core) | Low | **将来的にも問題にならないもの** |

---

## 🔍 Detailed Debt Inventory & Strategic Recommendations

### 🔴 1. 今すぐ直すべきもの (Immediate Actions / Fix Now)

#### 【ACOS-DEBT-003】 Lack of Input Rating Guardrails (Provider能力値の検証不足)
* **Domain**: `capability-registry`
* **Context**: Provider登録時、自己申告能力スコア（1〜5点）をMapで受け入れます。
* **Limitation**: スコアの上限・下限の検証チェックがなく、不正なプログラムやバグによって「100点」や「マイナス値」が混入した場合、多次元スコアリング計算が大きく歪み、最適ルーティングを崩壊させる（Poisoning）恐れがあります。
* **Google Principal Engineer Recommendation**:
  - `Provider` エンティティのコンストラクタ及び能力値登録メソッドにバリデーション層を追加し、値が `1` から `5` の整数であることを厳密に制限。不正値入力時には明示的な例外（`ArgumentOutOfRangeException`）をスローするように修正します。

---

### 🟡 2. Personal GAまでは許容するもの (Permitted until Personal GA)

#### 【ACOS-DEBT-001】 Process-Bound Memory EventBus (プロセス境界に縛られたメモリ内EventBus)
* **Domain**: `kernel`
* **Context**: `EventBus` は Node.js プロセス内のメモリ（`Map` と `Set`）に購読情報を保持し、実行しています。
* **Limitation**: シングルインスタンス（単一ノード）でのローカル動作には問題ありませんが、サーバーレス環境（Cloud Runなど）やマルチインスタンス環境にスケールアウトした際、プロセス間を跨いだイベント伝播やタスク同期が不可能です。
* **Google Principal Engineer Recommendation**:
  - `IEventBusProvider` 抽象インターフェースを定義し、現在の `InMemoryEventBus` はローカル開発環境用の「Dev Adapter」として残しつつ、本番環境用に **GCP Pub/Sub** や **Redis Pub/Sub** 等の分散キューアダプターを差し替え可能な構造にリファクタリングします。

#### 【ACOS-DEBT-002】 Transient In-Memory Capability Registry (一時的なメモリ内能力レジストリ)
* **Domain**: `capability-registry`
* **Context**: `CapabilityRegistry` はすべての登録能力・Provider一覧・動的メトリクスをメモリ内の `Map` に保持しています。
* **Limitation**: プロセスの再起動に伴い、せっかく蓄積した各ProviderのHealth状態、遅延（Latency）、障害率（Failure Rate）などのライブステータス情報がすべて消滅し、初期状態にリセットされます。
* **Google Principal Engineer Recommendation**:
  - 個人向けGA（Personal GA）までに、軽量なローカルファイル永続化（JSON、SQLiteなど）またはサーバーレス用データベース（**Firestore**）への書き出し・読み込み機能をアダプター経由で接続し、再起動後も直近のレジストリ状態を引き継げるようにします。

#### 【ACOS-DEBT-004】 Hardcoded/Static Adapter Metrics (ハードコードされたプロバイダー特性値)
* **Domain**: `capability-registry` (OpenRouterAdapter)
* **Context**: `OpenRouterAdapter` 内で Claude や GPT, Gemini などの各モデルのコスト・レイテンシ・初期品質などが直接定義（ハードコード）されています。
* **Limitation**: LLMモデルの市場価格は頻繁に下がり、パフォーマンス特性も随時更新されるため、静的なハードコードは急速に陳腐化します。
* **Google Principal Engineer Recommendation**:
  - OpenRouterが公式提供している `/api/v1/models` エンドポイントを定期ポーリングして、モデル名やトークン価格、最新コンテキスト長を動的取得し、レジストリにマッピングする動的カタログ・クローラーにアップグレードします。

#### 【ACOS-DEBT-005】 No Active Execution Feedback Loop (アクティブな実行結果フィードバックループの欠如)
* **Domain**: `capability-registry` / `routing-engine`
* **Context**: Registryにはメトリクス更新 API（`updateProviderMetrics`）がありますが、実際のLLM呼出部（Agent Execution層）と接続されていません。
* **Limitation**: 実行失敗や遅延時間の実績値が自動的にレジストリへフィードバックされず、人間やモックプログラムによる明示的な更新に依存する「パッシブ（受動的）」な管理に留まっています。
* **Google Principal Engineer Recommendation**:
  - LLMクライアント実行部をインターセプト（またはミドルウェア化）し、実際の呼び出し時に計測した「所要時間」「HTTPステータス（エラーの有無）」「消費トークン数」を、自動的に `globalEventBus` へイベント（`ProviderCallCompleted`）として通知。レジストリ側でこれを購読し、指数移動平均（EMA）を用いてメトリクスを自動補正（動的学習）する自動フィードバックループを構築します。

---

### 🔵 3. Enterpriseで対応すべきもの (Enterprise Requirements)

#### 【ACOS-DEBT-006】 Non-Thread-Safe Registry Mutations (スレッドセーフでない動的更新)
* **Domain**: `capability-registry`
* **Context**: JS/TSはシングルスレッドですが、複数コンテナインスタンスが同時に動くエンタープライズマルチテナント環境では、共有DBまたは共有Redis上のレジストリに対して動的変更（Health変更、メトリクス更新）が重なり、競合（Race Conditions）やデータ不整合（Split-brain）が発生します。
* **Google Principal Engineer Recommendation**:
  - レジストリ状態の更新（Mutation）に、分散ロック（Redlockアルゴリズムなど）やオプティミスティックロック（楽観的ロック）を適用。書き込みトランザクションのACID特性をデータベースレイヤー（Cloud SQL PostgreSQL or Spanner）で保証します。

#### 【ACOS-DEBT-007】 Lack of Authorization / RBAC on Registry (レジストリ操作の権限ガードの欠如)
* **Domain**: `capability-registry`
* **Context**: 現在の設計では、`CapabilityRegistry` クラスの参照を取得、あるいは特定のイベントを発行すれば、誰でも自由にProviderの追加・削除や、Health・メトリクスの偽装変更が可能です。
* **Limitation**: 悪意のあるユーザーや暴走したエージェントが「すべての競合モデルをDownにし、特定の高額モデルにルーティングを全誘導する」といったセキュリティインシデント（ルーティングジャック）を許す脆弱性となります。
* **Google Principal Engineer Recommendation**:
  - レジストリ操作（特に登録・削除・ヘルス更新）に対して、厳格な役割ベースアクセス制御（RBAC）およびJWTなどの認証証明書検証レイヤーを強制します。

---

### 🟢 4. 将来的にも問題にならないもの (No Future Concerns / Non-issues)

#### 【ACOS-DEBT-008】 Magic Number Scoring Weights (スコアリング計算の静的なマジックナンバー)
* **Domain**: `capability-registry` (RoutingService)
* **Context**: ルーティング時の重み付け（優先度に応じた capability 重量 0.6 や 0.3、および健康状態デグレード時のマルチプライヤー 0.6）がハードコードされています。
* **Justification**:
  - これらの重みはシステム全体の「ポリシー」「振る舞い」を規定するビジネスルールであり、静的に固定していてもユニットテストで安定して振る舞いが追跡可能です。将来複雑な最適化が必要になったとしても、定義ファイル（`JSON`）に外出しする、あるいは強化学習モデルにパラメータを渡す設計へと段階的移行が極めて容易であるため、現時点でリファクタリングせずともアーキテクチャ上の害はありません。
