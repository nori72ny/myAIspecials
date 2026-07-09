# ACOS 2.0 World-Class Engineering Standard Specification
## 〜 世界最高レベルの品質、保守性、拡張性、安全性を絶対保証する開発規格 〜
**Co-Authored by: Google Engineering Productivity & SRE, OpenAI Infrastructure, Anthropic Platform, Apple Software Engineering, and Microsoft Engineering Excellence Teams**

---

## 🌌 1. 開発原則とエンジニアリング憲章 (Engineering Philosophy)

ACOS 2.0 (AI Orchestration Operating System) は、人類の知的生産活動をシームレスに調律・自律実行する「知の最前面」です。
本システムが世界中の開発メンバー、その家族、そして将来的に何千万ものエンタープライズに「毎日、寸分の狂いもなく、完璧なレスポンスで愛用される」ためには、コードベース自体が「美しく整列した芸術品」であり、障害が自己治癒され、1ミリ秒の無駄な処理も存在しない極上のエンジニアリング品質を満たしていなければなりません。

私たちは、グローバルトップのテックジャイアント（Google, Apple, OpenAI, Anthropic, Microsoft）の知恵を集結し、ACOS 2.0が世界一に登り詰めるための**「Engineering Standard (開発技術規格)」**を定義・宣言します。

---

## 💻 2. Coding Standard & TypeScript Guidelines

### A. 型安全性の絶対順守 (Strict Type Safety)
* **`any` の完全排除**: `any` 型の使用は、いかなる場合もコンパイルエラー（Quality Gateでの差し戻し）とします。代わりに厳格な `unknown` または具体的なユニオン型、ジェネリクスを使用します。
* **暗黙の型キャストの禁止**: 型の強制キャスト `as MyType` は避け、Zod などのバリデーションライブラリを用いた「実行時型検証（Runtime Type Guard）」を必須とします。
* **イミュータビリティ（不変性）の優先**: 再代入可能な変数 `let` の使用を極力避け、原則 `const` をデフォルトとします。配列やオブジェクトは `Readonly<T>` または `readonly` 修飾子で保護します。

### B. React / Frontend Coding Rules (React 18+ / Vite)
* **無駄な再レンダリングの撲滅 (`useEffect` の排除)**: 
  - 状態変更に同期した状態の再計算は、コンポーネントレンダリング時のインライン計算、または `useMemo` でラップして解決します。
  - `useEffect` の依存配列（Dependency Array）には、オブジェクトや配列を直接含めず、必ずプリミティブ値（文字列、数値、真偽値）に分解して指定。
* **コンポーネントの単一責任原則 (Single Responsibility)**:
  - 1つのファイルに複数の関心（UIレンダリング、APIフェッチ、ビジネスロジック）を詰め込むことを禁止。
  - ビジネスロジックはカスタムフック（`useMissionWorkflow` 等）に抽出し、UIは完全にプレゼンテーション（Pure Component）に徹します。

---

## 🏛️ 3. Architecture Standard (クリーン・アーキテクチャ & DDD)

ACOS 2.0は、システム全体の境界を疎結合に保つため、**「ドメイン駆動設計 (Domain-Driven Design)」**および**「クリーンアーキテクチャ (Clean Architecture)」**をベースラインとします。

```text
+---------------------------------------------------------------------------------+
|                                 1. UI / API Layer                               |
|                     (React UI, Express Controllers, REST APIs)                  |
+---------------------------------------------------------------------------------+
                                         |
                                         v
+---------------------------------------------------------------------------------+
|                               2. Use Case Layer                                 |
|                         (AuditService, RoutingWorkflow)                         |
+---------------------------------------------------------------------------------+
                                         |
                                         v
+---------------------------------------------------------------------------------+
|                               3. Domain Layer                                   |
|                (Entities: Provider, Capability | ValueObjects)                  |
+---------------------------------------------------------------------------------+
                                         ^
                                         | (Dependency Inversion)
+---------------------------------------------------------------------------------+
|                             4. Infrastructure Layer                             |
|              (Cloud SQL PostgreSQL, Pinecone DB, external AI APIs)              |
+---------------------------------------------------------------------------------+
```

### A. 各レイヤーの独立性ルール
1. **Domain Layer (ドメイン層)**: 
   - 外部ライブラリ（Express, pg, Zodなど）に対する一切の依存関係（Import）を禁止。
   - 純粋なTypeScriptクラス、インターフェース、Value Objectのみで、ビジネスロジック（能力計算、クランプ、ヘルス状態遷移等）をカプセル化。
2. **Use Case Layer (ユースケース・サービス層)**:
   - アプリケーションのシナリオ（タスクの作成、品質監査の実行フロー）をオーケストレーション。
   - インフラの実装を知らず、ドメインモデルと「ポートインターフェース（Repository等のInterface）」を仲介。
3. **Infrastructure Layer (インフラ層)**:
   - データベース（PostgreSQL / Spanner）への接続、外部LLMプロバイダへのAPI通信、メモリ内EventBusの実体化など、技術的な「詳細」を実行。

---

## 📂 4. Folder & Naming Standards

物理的なフォルダ構造は、アーキテクチャの精神をそのまま映し出す鏡です。Figmaのオートレイアウトのように、一目で全体が美しく整合していることを保証します。

### A. Folder Tree Structure (8px グリッドのフォルダ配列)
```text
/src
  /components            # プレゼンテーションUI（ボタン、カード、トースト等のアトミックパーツ）
  /lib
    /capability-registry  # ドメインごとのコンテキスト（境界づけられたコンテキスト）
      /domain
        /entities        # Provider.ts, Capability.ts など
        /services        # RoutingService.ts など
      /usecases          # RegisterProviderUseCase.ts など
      /infrastructure    # Repository implementations, OpenRouter API adapter
    /truth-quality-engine # 監査ドメインコンテキスト
      /domain
      /usecases
      /infrastructure
  /types                 # グローバルな共有型定義
  /App.tsx               # メインアプリケーションのエントリー
  /main.tsx              # Reactマウントポイント
```

### B. Naming Conventions (命名規則の鉄則)
* **ファイル名 (Files)**:
  - コンポーネントおよびクラスファイル: `PascalCase`（例: `ProviderCard.tsx`, `AuditResult.ts`）
  - 通常ユーティリティ、ヘルパー: `kebab-case`（例: `date-formatter.ts`, `string-utils.ts`）
* **クラス・インターフェース (Classes & Interfaces)**:
  - `PascalCase`（例: `class CapabilityRegistryService`）
  - インターフェースの接頭辞 `I` の使用は原則禁止（GoやTypeScriptのベストプラクティスに準拠し、`ProviderRepository` のように具象クラス側を `SqlProviderRepository` とする）。
* **変数・メソッド (Variables & Methods)**:
  - `camelCase`（例: `const currentMetrics = ...`, `public updateMetrics()`）
* **定数・環境変数 (Constants & Env Vars)**:
  - `SCREAMING_SNAKE_CASE`（例: `const DEFAULT_PORT = 3000;`, `process.env.GEMINI_API_KEY`）

---

## 🔌 5. Plugin & Extension Rule (MCP 拡張規格)

ACOS 2.0が外部のエコシステム（ツール、カレンダー、データベース）とシームレスに結合し、世界をオーケストレーションするためのプラグイン規格。

* **MCP (Model Context Protocol) 準拠**:
  - すべてのプラグイン、外部API呼び出しアダプターは、Anthropicが提唱するMCPにネイティブ準拠。
  - 各プラグインは `executeTool(name, arguments)`、`listTools()`、`getPromptContext()` の3つの共通インターフェースを実装。
* **サンドボックス防御 (Strict Isolation)**:
  - 外部から読み込まれたプラグインコードは、メインコンテナのメモリ空間から完全に隔離された「軽量Sandboxスレッド（Web Worker等）」で動作。メインプロセスの環境変数や機密メモリへのアクセスを100%遮断。

---

## 🔒 6. Security & Leak-Prevention Standards (Apple/Microsoft 堅牢防御)

世界最高のAIシステムにおいて、APIキーやユーザーのプライベートデータの漏洩は、製品の「死」を意味します。

### A. 3大セキュリティ防壁
1. **APIキーのサーバーサイド完全隔離 (No Client-side Secrets)**:
   - Gemini, OpenAI, OpenRouter等のすべての秘密鍵（Secret Keys）は、ブラウザ側に絶対に送信、またはクライアントサイド環境変数（`VITE_`）として読み込ませてはなりません。
   - すべてのAPIリクエストは Express バックエンド（`/api/*`）を経由してプロキシ実行し、秘密鍵はサーバーコンテナのメモリ内でのみ参照します。
2. **機密情報のログ出力完全検閲 (No Secrets in Logs)**:
   - APIキー、セッショントークン、ユーザーのパスワードなどの機密データ（PII: Personally Identifiable Information）は、ロガー（Logger）がディスクやstdoutに吐き出す前に、自動正規表現パーサーで `[REDACTED]` に全件書き換えます。
3. **境界バリデーションの強制 (Boundary Sanitation)**:
   - 外部ユーザーインプット、およびモデルから戻ってきたJSON構造に対して、**Zod** スキマを用いた検閲を適用。不正なSQLインジェクション、XSS、プロンプトインジェクションコードがデータベースや画面に出力されるのを100%防止。

---

## 📝 7. Testing, Error Handling, & CI/CD Excellence

### A. Testing Standards (品質の数値化)
* **単体テスト (Unit Testing)**:
  - **Vitest** を使用。ビジネスロジックを含むドメインエンティティ（例: `Provider`, `Capability`）およびサービスユースケースのテストカバレッジは **100%** を絶対死守。
* **E2E / 統合テスト (Integration Testing)**:
  - **Playwright** を使用。主要なカスタマージャーニー（Goal入力 -> 自律Workflow生成 -> 監査合格 -> 納品）のハッピーパスを検証。

### B. Error Handling & Auto-Healing (自己治癒エラー構造)
* **エラーの階層化**:
  - `BaseError` を継承した `DomainError`, `InfrastructureError`, `RoutingError` などのカスタムエラークラスを定義。
* **自己治癒（自動フェイルオーバー）のルール**:
  - API通信エラー（503, 429等）が発生した場合、`RoutingService` はそれを例外（Exception）として画面に投げるのではなく、裏で即座に「ヘルスステータスの更新（Down判定）」と「予備プロバイダーへの自動フォイルオーバー（最大3回）」を実行。ユーザーには「何事もなかったかのように」滑らかに結果を届けます。

```typescript
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean = false
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
```

---

## 📊 8. Quality Gates (品質の絶対関門)

プロダクトが本番（Production / Cloud Run）にデプロイされる前に、以下の厳格なチェックポイント（品質門）を全てクリアしなければなりません。

```text
[Code Commit] -> [Quality Gate 1: Lint & Build] -> [Gate 2: Unit Test Cover > 95%] -> [Gate 3: Security Scan] -> [Release Deploy]
```

1. **Gate 1: Static Code Linting (ESLint/Prettier)**:
   - リンターエラー、型定義の抜け（implicit `any`）、未使用変数が1件でも存在する場合、ビルドを強制終了。
2. **Gate 2: Unit Test Coverage Check**:
   - カバレッジレポートを実行し、コアビジネスロジックのテストカバレッジが **95%** を下回る場合はコミット却下。
3. **Gate 3: Security Vulnerability Scan**:
   - `npm audit` などの依存脆弱性チェックを自動実行。深刻度「High」以上の脆弱性が検出された場合、デプロイプロセスを強制遮断。

---

## 💎 9. Definition of Ready & Done & Excellent

私たちは、「動けば良い」という妥協を許しません。すべてのタスク、プルリクエスト、そして完成品に対して、以下の3つの厳密な定義（Definition）を課します。

### L1. Definition of Ready (DoR) — 開発開始のための定義
タスク（Issue / Ticket）に着手するには、以下の情報が揃っていなければなりません。
* [ ] **ユーザーの意図の完全定義**: このタスクが、創設者、会社、家族の「どの課題」を解決するかが明記されていること。
* [ ] **入力/出力データの型定義**: 処理されるデータのスキーマ（I/O）が定義されていること。
* [ ] **UI/UXのアニメーション物理**: 変更を伴う場合、どのトランジション（イージング、スピード）を適用するかが決定していること（Apple Hi-Fi標準）。

### L2. Definition of Done (DoD) — 開発完了のための定義
タスクを「完了」とし、メインブランチへ統合するためには、以下を満たさなければなりません。
* [ ] **リンター・ビルドの通過**: `npm run lint` および `npm run build` が警告なしで完璧に完了していること。
* [ ] **カバレッジ保証**: 追加・変更したロジックに対して、Vitestのテストコードが書かれ、通過していること。
* [ ] **多言語・シニア対応検証**: 日本語として不自然な表現がなく、おもてなしのツールチップ、及び44px以上のタッチターゲットが保証されていること。

### L3. Definition of Excellent (DoE) — 世界最高プロダクトの定義
ACOS 2.0が世界一のOSであり続けるため、メインブランチ結合後、プロダクトレビューにおいて「Excellent」を獲得するための究極の基準。
* [ ] **Aha Moment (魔法の瞬間) の存在**: ユーザーがその機能を使った際、「おお！」と声が出るようなアニメーション演出、手応え（物理的な奥への沈み込み）、驚きが備わっているか。
* [ ] **Zero-Latency Feel (極上のレスポンス)**: プランニングやルーティングのオーバーヘッドが一切なく、脳の思考速度と同調してアプリが応答するか（思考速度のインターフェース）。
* [ ] **Zero-Vulnerability / 100% Self-Healing**: どのような接続エラーや不正なプロンプトが差し込まれても、システム全体が裏で優雅に「自動フォイルオーバー（迂回）」し、常に安心の笑顔（Healthy Status）を維持できているか。
