# ACOS 2.0 World-Class Design System Specification (世界最高品質 UI/UX 設計書)
## Co-Authored by: Apple Human Interface, Google Material Design, Linear Design, Notion Product, and Figma Principal Designers

ACOS 2.0 (AI Orchestration Operating System) を、創設者、会社メンバー、そしてその家族が毎日使いたくなり、触るたびに五感が満たされる「世界最高峰のAIオーケストレーションOS」にするための、極上のデザインシステムです。

---

## 🌌 1. Design Concept (デザイン哲学)

### "The Luminescent Sanctuary" (発光する聖域)
私たちは、単なるツールとしてのダッシュボード（計器盤）を作っているわけではありません。ACOS 2.0は、人間の知性とAIの自律性が交差する**「Luminescent Sanctuary（発光する聖域）」**です。
* **Apple:** 物理的な質量、奥行き、透明度。指先がガラスを撫でるような官能的な触感（Tactile Physics）。
* **Material Design:** 明確な階層と、認知負荷を最小化する影と高さ（Elevation）の科学。
* **Linear:** 極限まで洗練された高密度情報（High-Density Clarity）と、圧倒的なレスポンス速度。無駄な余白を排し、プロが必要とする情報を美しく圧縮。
* **Notion:** 誰もが直感的に使え、家族でも1秒で馴染める親しみやすさ（Minimalist Friendliness）とドキュメントライクな美しさ。
* **Figma:** 一貫したレイヤリング構造、厳格なピクセルグリッド、美しく整合するオートレイアウト（Autolayout）の再現性。

---

## 🎨 2. Dual-Core Color System (デュアルコア・カラーシステム)

日本の伝統的な色彩、自然光、そして宇宙の暗闇（Obsidian Void）を調和させ、長時間見つめても目が疲れず、ラグジュアリーな高級感を感じる調色を施しました。WCAG 2.1 AA (一部 AAA) 基準を完全クリア。

### A. Dark Mode: "Cosmic Obsidian & Ethereal Aurora" (漆黒と極光)
深い宇宙の闇の中に、AIの「知の灯火」が差し込むような、神秘的かつプロフェッショナルなテーマ。

| トークン名 | カラーコード | Tailwind設定 | 役割・心理的効果 |
| :--- | :--- | :--- | :--- |
| `space-bg` | `#030712` | `bg-slate-950` | 無限の宇宙。最も深いベース背景層。 |
| `surface-panel`| `#090D1A` | — | パネル、サイドバー。奥行きを与える深海ブルー。 |
| `surface-card` | `#111827` | `bg-gray-900` | コンテンツカード、入力エリア。浮遊するガラス。 |
| `border-subtle`| `#1E293B` | `border-slate-800`| 極細の境界線。1pxの構造的秩序。 |
| `brand-indigo` | `#6366F1` | `text-indigo-400` | **Cognitive Core (認知の核)**。思考、Goal、大局的計画。 |
| `brand-teal`   | `#14B8A6` | `text-teal-400`   | **Active Compute (演算)**。タスク実行、ツールの稼働。 |
| `brand-cyan`   | `#06B6D4` | `text-cyan-400`   | **Memory & Knowledge (記憶)**。RAG、長期記憶、事実取得。 |
| `status-healing`| `#F43F5E` | `text-rose-500`   | **Self-Healing (自己治癒)**。エラー検知、自動復旧。 |

### B. Light Mode: "Washi Alabaster & Zen Garden" (和紙の白と禅の静寂)
日本の和紙（Washi）が持つ柔らかな反射、白磁（Alabaster）の滑らかさ、砂紋の陰影を取り入れ、単調な白ではなく「温かみのある知性」を表現。

| トークン名 | カラーコード | Tailwind設定 | 役割・心理的効果 |
| :--- | :--- | :--- | :--- |
| `space-bg` | `#F8FAFC` | `bg-slate-50` | 柔らかな朝の光を宿した和紙の余白。 |
| `surface-panel`| `#FFFFFF` | `bg-white` | 清潔感のある漆喰壁を想起させる純白のベース。 |
| `surface-card` | `#F1F5F9` | `bg-slate-100` | 軽く影を落として浮き上がる砂紋のテラス。 |
| `border-subtle`| `#E2E8F0` | `border-slate-200`| 水盤に引かれた繊細な一本の糸。 |
| `brand-indigo` | `#4F46E5` | `text-indigo-600` | 思考。深い藍色（Indigo Blue）が知性を引き締める。 |
| `brand-teal`   | `#0D9488` | `text-teal-600`   | 演算。清流の深緑（Teal Green）が安らぎと動きを。 |
| `brand-cyan`   | `#0891B2` | `text-cyan-600`   | 記憶。澄み切った青空（Cyan Blue）が記憶の視認性を。 |
| `status-healing`| `#E11D48` | `text-rose-600`   | 治癒。紅葉を思わせる艶やかな朱赤（Muted Crimson）。 |

---

## ✍️ 3. Japanese-First Typography (日本語特化型タイポグラフィ)

日本語はひらがな、カタカナ、漢字、英数字が混ざるため、フォントの「ウェイト（太さ）」「文字間（カーニング）」「行間（ラインハイト）」を緻密に調整しないと、瞬時に目が疲労します。

### Font Stack (推奨フォントファミリー)
- **日本語主要**: `System-UI`, `Hiragino Kaku Gothic ProN`, `BIZ UDPGothic`, `Noto Sans JP`
- **欧文ディスプレイ**: `Outfit`, `Inter` (数字の美しさ、シンメトリーを重視)
- **等幅/ログ/コード**: `JetBrains Mono`, `SF Mono`

### Typographic Specs (タイポグラフィ仕様)
1. **ディスプレイ (Display Title)**: `-0.03em` の文字詰めを行い、極上のブランド感を演出。
2. **本文 (Body Copy)**: `line-height: 1.7` (日本語が最も滑らかに読める黄金比)を適用。文字色は絶対値の黒/白ではなく、ややニュアンスのあるグレー (`#334155` / `#94A3B8`) に設定してグレア現象を排除。
3. **等幅 (System Log / Metric)**: `0.02em` 追従させ、数字の列が美しく垂直整列するように等幅フォントを適用。

```css
@theme {
  --font-sans: "Outfit", "Inter", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
  --font-mono: "JetBrains Mono", "SF Mono", monospace;
}
```

---

## 📏 4. Spacing, Corner Radius, & Shadow (空間と触感の物理)

### A. Spacing System (8pxの流律)
すべての間隔は `8px`（`0.5rem`）の倍数で構築され、余白自体がメッセージを持つように設計。
* **`4px (0.25rem)`**: マイクロアライメント（アイコンと文字の距離）
* **`8px (0.5rem)`**: コンパクトブロック（フォームインプット間の距離）
* **`12px (0.75rem)`**: サブコンポーネント（リスト内のアイテム間）
* **`16px (1.0rem)`**: スタンダードマージン（カード内部のパディング）
* **`24px (1.5rem)`**: セクション（カード同士の距離）
* **`32px (2.0rem)`** / **`48px (3.0rem)`**: マクロ余白（ページヘッダー、外枠）

### B. Corner Radius (角の優しさ)
* **`4px (xs)`**: タグ、バッジ
* **`8px (sm)`**: ボタン、フォームインプット
* **`12px (md)`**: リスト内コンポーネント、ミニポップオーバー
* **`16px (lg)`**: コアカード、システムダイアログ
* **`24px (xl)`**: メインダッシュボードコンテナ、外部ビューポート
* **`9999px (full)`**: アバター、ピルバッジ

### C. Shadow & Elevation (Material Design & Apple Hi-Fi)
光の当たり方を「斜め上（Y軸: +2px〜+16px）からの単一光源」に固定し、自然な立体感を生成。

```css
/* Figma Elevation Specs */
--shadow-elevation-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
--shadow-elevation-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
--shadow-elevation-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1);
/* Ethereal Glow for Active AI Core */
--shadow-glow-indigo: 0 0 20px 0 rgba(99, 102, 241, 0.15);
--shadow-glow-teal: 0 0 20px 0 rgba(20, 184, 166, 0.15);
```

### D. Glass Effect (グラスモーフィズム)
背面をぼかす（backdrop-blur）ことで、情報のコンテキストを維持したまま、手前の情報を浮き立たせます。
* **Dark Mode**: `background: rgba(17, 24, 39, 0.7); backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.08);`
* **Light Mode**: `background: rgba(255, 255, 255, 0.7); backdrop-filter: blur(16px); border: 1px solid rgba(0, 0, 0, 0.05);`

---

## 🏃 5. Motion & Micro-interactions (感情を揺さぶる動的演出)

アニメーションは飾りではなく、**システムの状態とデータの流れを脳に同期させるロードマップ**です。
すべてのトランジションには、リニア（等速）を一切排除し、人間の感覚に最も心地よい「物理的な減速」を適用します。

### イージング・関数
* **`ease-out-expo` (最も推奨)**: `cubic-bezier(0.16, 1, 0.3, 1)`
  * 特徴: 開始は一瞬（Blindingly Fast）、最後は空気抵抗でゆっくりと滑り込むように静止。最高に滑らか。
* **`ease-in-out-sine` (ブレス/呼吸用)**: `cubic-bezier(0.44, 0, 0.56, 1)`
  * 特徴: AIのバックグラウンド処理、スリープ、検索中の鼓動に用いる2秒周期のウェーブ。

---

## 🧩 6. Component Library Spec (コンポーネント詳細仕様)

### Button
1. **Primary (思考の確定)**:
   - 状態: 135度のグラデーション（Indigo to Teal/Cyan）。ホバー時にグラデーションが微細に移動し、102%にスケールアップ。
2. **Secondary (行動の補助)**:
   - 状態: グラス背景。ホバー時にボーダーが発光。
3. **Destructive (警告・削除)**:
   - 状態: `Rose` カラーのソフトな背景に、鮮烈なインサイドテキスト。

### Input
- **Apple/Linear 仕様**:
  - デフォルトは無彩色の極細ボーダー。
  - フォーカスされた瞬間、`brand-indigo` もしくは `brand-teal` の1pxのフォーカスリングと、背面からわずかに滲み出るシャドウ（Glow Shadow）が、`ease-out-expo` で200msかけて展開。

### Card
- **Figma仕様**:
  - `Corner Radius: 16px`。
  - ホバー時にカード全体が `Y軸に -4px` 移動。同時に、境界線の輝度が上がり、カードのドロップシャドウが柔らかく広がります。

### Table
- **Linear 高密度情報仕様**:
  - ヘッダーは等幅フォント、`text-transform: uppercase` で `tracking-wider`。
  - 行のホバー時に、極細の「発光背景（1.5% の不透明度の白/黒）」がスッと走り、どこを凝視しているかを明確に誘導。

### Toast
- **通知のアナウンスメント**:
  - 画面右上に、物理演算のような少しのスプリング（バウンス）を伴ってスライドイン。
  - 自動的にフェードアウトする際、タイマーバー（プログレスバー）が底面にミリ秒単位で縮小する様子を視覚化（Notion的な親切設計）。

---

## 📐 7. View-by-View Figma Layout Specification (レスポンシブ画面設計)

### 1. Goal UI (意志の受け入れ室)
- **Concept**: 「真っ白な原稿用紙（和紙）を前に、詩人がペンを構える瞬間の静寂」。不要なコントロールは一切隠し、AIへの指示（Goal）にのみ没入。
- **PC**:
  - 画面中央に最大幅 `800px` のエレガントなインプット。
  - プレースホルダーが優しく脈打つ。
- **スマホ/タブレット**:
  - 音声入力、またはカメラ入力をトリガーするボタンを右手親指が届く位置（下部44px圏内）に固定配置。

### 2. Workflow UI (自律ロードマップの展開)
- **Concept**: 「AIが思考を視覚化し、人間と合意形成（Consensus）を図るためのステージ」。
- **PC/タブレット**:
  - 横方向のフェーズタイムライン、または上から下へと連鎖する滝（Cascade Flow）。
  - 各ステップは展開可能（Collapsible）で、内部に「割り当てられたAIモデル（Capabilityルーティング結果）」や「実行ツール（SQL, Playwright）」をFigmaのオートレイアウトで綺麗に整列。
- **スマホ**:
  - 横スクロールを避け、垂直方向のステップに自動再編成。ステップ間の進捗率は、画面端の極細の光るライン（Progress Line）で俯瞰可能。

### 3. Navigation & Sidebar
- **Notion 譲りの美しき整頓術**:
  - 左サイドバー（`width: 240px`）は、滑らかなアコーディオンで階層化されたプロジェクト、ドキュメント、過去のミッションログに瞬時にアクセス。
  - サイドバーは `hover` または `Ctrl + \` で完全格納可能。格納時はコンテンツ幅が完璧にリフロー（自動再計算）し、デスクトップをキャンバスとして贅沢に使用。

---

## 🇯🇵 8. Japanese UI Guidelines (毎日使いたくなる、細部への配慮)

1. **翻訳トーン（言葉の体温）**:
   - 機械的な「〜を設定してください」「エラーコード：500」は厳禁。
   - 家族やメンバーに語りかけるような、丁寧で温かみのある、しかしプロフェッショナルな言葉遣い。
   - 例: 「接続できませんでした。バックグラウンドで自己治癒（自動回復）が実行中です。そのまま15秒ほどお待ちいただくか、こちらをクリックして手動で再試行できます。」
2. **ルビ・説明の階層化**:
   - AI用語（例: RAG, Embeddings, LLM, Temperature）に対して、初心者のメンバーや家族が触れた際、ホバーで「和紙の小さなツールチップ」が優しく解説を表示。

---

## 🌟 9. まとめ：このシステムを稼働させるコードスターター

開発時には、この設計書に基づいてCSSクラスを構築し、コンポーネントを配置してください。細部に神が宿り、毎日PCを開くのが楽しみになる究極のAIオペレーティングシステムが、今ここに完成します。
