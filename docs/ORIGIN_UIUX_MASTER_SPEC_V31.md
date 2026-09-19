# ORIGIN UI/UX 統合サマリー（4つのAI回答の統合版）

ChatGPT系・Perplexity系・別AI（文書11）・Claude（このセッション）の4つの回答を突き合わせ、重複を整理し、矛盾点には注釈をつけた上で、ORIGINに実装可能な形に統合した。

---

## 1. 4回答すべてが一致していた結論

- 「会話が主役、複雑さは隠す」がトップAI共通の大原則。空の入力欄＋ストリーミング＋必要時だけ出るパネル、という骨格は全社共通
- **回答（チャット）と成果物（コード/文書/表/Web）を画面上で分離する**（Claude Artifacts / ChatGPT Canvas相当）ことは、4回答すべてが「必須」と明記
- **フォント16px・行間1.5〜1.75・本文幅を制限**（650〜860px程度、1行45〜80文字）は数値の細部が多少ズレるだけで全回答一致
- **タッチターゲット44px前後**、**主要操作は1画面1 Primaryボタン**、状態を色だけに頼らずラベルでも示す、という点も共通
- エージェントが自律実行中は「今何をしているか」を可視化し、**いつでも停止・介入できるボタンを常設**すべき、という点も4回答すべてが強調

## 2. 各回答が特に強調していた視点（違い）

| 観点 | ChatGPT系(文書9) | 別AI詳細版(文書11) | 総合比較版(文書10) | Claude(このセッション) |
|---|---|---|---|---|
| 最重視ポイント | TTFT・知覚速度、モード切替の直感性 | **Mode/Model/Tool/Agentを階層として混同しない**設計原則 | 各社の実UI構造を横断比較し取捨選択 | アクセシビリティ実測値（WCAGコントラスト計算）とトークン設計の実装可能性 |
| 独自の強い提案 | 入力欄一体型のモード選択、赤/グレーの中断ボタン | 「Claude CodeとGPT-6 Astraを同じプルダウンに入れてはいけない」という概念分離、ORIGIN Auto中心設計 | Command Palette(Ctrl+K)、Slash Command併用 | 状態変化は「暗く」する方向で統一、design-token-lockの除外リスト問題という自社固有の技術的負債への言及 |
| やや異なる／注意点 | — | Groqは「UIでなく速度感」と明言（他2つも同旨） | Perplexityの配色をダーク基調/クリームと両論併記 | 実装コード例（CSS）まで踏み込んで提示 |

補足：文書11が挙げる「GPT-6 Astra」や、私が前の回答で触れたChatGPT Atlasの現状については、2026年内に位置付けが変わったという報道もあり流動的です。個別モデル名・製品名は変わりうる前提で、**構造上の設計原則**の部分を採用するのが安全です。

## 3. 統合アーキテクチャ（最も具体的だった文書11の階層モデルを軸に統合）

4回答を重ねると、ORIGINのUIは次の7層に分けて設計するのが最も矛盾がないという結論になる。

| 層 | 役割 | ORIGINでの実装イメージ |
|---|---|---|
| Workspace | プロジェクト・履歴・ファイル | ORIGIN Project |
| Mode | 何をさせるか | Chat / Research / Work / Code / Create |
| Model | どの頭脳を使うか | ORIGIN Auto / Fast / Deep / Premium（詳細は「その他」に格納） |
| Tools | 何を操作できるか | Web / GitHub / Browser / Files |
| Agent | 自律実行するか | 通常応答 / Agent |
| Artifact | 成果物 | 文書 / コード / 表 / スライド / Web |
| Progress・Approval | 進行状況と人間の承認 | 計画→実行→検証→完了、実行前承認 |

**重要な原則（全回答が示唆、文書11が明言）**：この7層を1つのプルダウンや1つのボタン列に混在させない。「Claude Code」（開発環境）と「Sonnet」（モデル）と「Research」（実行モード）は概念が違うため、別々のUI階層に置く。前回提案した「エージェント切り替えUI」（6-1〜6-4）は、この階層モデルにおける**Mode切替**の部分に相当する。今後は同じ発想で**Model切替**（モデル選択）と**Tool切替**（接続ツール）も別コンポーネントとして分離設計するとよい。

## 4. レイアウト（4回答の合意点）

**PC：**
```
┌─────────────────────────────────────────────┐
│ ☰ ORIGIN  Project名      Mode▾  Model▾   ●  │
├────────────┬──────────────────────────────────┤
│ Sidebar    │                                  │
│ (履歴/     │         Conversation             │
│  Project)  │                                  │
│            ├──────────────────────────────────┤
│            │  Artifact / Sources / Progress   │
│            │  （成果物が出た時だけ表示）        │
├────────────┴──────────────────────────────────┤
│  +  Ask ORIGIN...              Mode▾    ↑    │
└─────────────────────────────────────────────┘
```
- 3ペイン常時表示にはしない。Artifact/Sources/Progressパネルは**成果物が生まれた時だけ**出す（4回答共通）
- Modeによって右パネルの中身を動的に変える：Research→Sources、Code→Files/Diff/Terminal、Work→Task progress、Create→Preview

**モバイル：** サイドバーもArtifactパネルも常設せず、「会話⇄成果物」をタブ切替。Agent実行中は下部に進捗バー＋Stopボタンを固定表示。

## 5. コンポーネント仕様（統合版・前回ドキュメントへの追加分）

- **状態ラベル**：Idle/Planning/Searching/Reading/Editing/Running/Testing/Waiting for approval/Paused/Completed/Failed の統一語彙を持ち、色だけでなくテキストラベルで示す
- **進捗表示**：内部の思考過程を延々と見せるのではなく、「Plan→Search→Read→Compare→Edit→Test→Verify」という**行動ベース**の表示にする（Reasoning UIでなくAction UI、という文書11の指摘は理にかなっている）
- **差分・変更内容の可視化**：「4 files changed +126 -38」のような具体数値＋ファイル一覧を、コード修正系のAgentタスクでは必須にする
- **チェックポイント／Undo**：Agentic Codingでは特に重要。時刻付きの巻き戻しポイントをリスト表示
- **承認フロー**：「毎回確認 / 重要操作だけ確認 / 完全自律」の3段階permissionを持たせ、本番反映など重要操作だけ明示的な承認モーダルを出す
- **アイコンのみのボタンを乱用しない**：頻用（Copy/Like）以外は「アイコン＋ラベル」を基本にする

## 6. 優先実装順位（4回答を統合した推奨順）

1. 共通Design System（Typography・Spacing・Color・Button・Input・Status）の確定 ※前回提出のDESIGN v3.1がこの土台
2. Mode階層の整理（Chat/Research/Work/Code/Createを同一階層に、Model/Toolと混同しない）
3. Artifact/成果物パネルの分離実装
4. Agent進捗UI（Plan→Execute→Test→Verify→Deliver）と停止・承認ボタン
5. Coding Workspace（Files/Diff/Terminal/Tests/Checkpoint）
6. Research Sources UI（引用・出典パネル）
7. Project Workspace（Chat/Files/Tasks/Artifacts/Sourcesの統合）
8. モバイルUX（PC版の縮小ではなくタブ/ボトムシート中心）
9. アクセシビリティ（WCAG 2.2 AA、既知のコントラスト不合格の解消）
10. 最後にアニメーション・マイクロインタラクションなどの装飾仕上げ

---

前回作成した `ORIGIN-DESIGN-v3.1-proposal.md`（カラートークン修正・design-token-lock修正・エージェント切替ボタンの実装コード）は、このマスター仕様の中の「1. Design System」と「2. Mode切替」に該当する部分の具体化版として、そのまま接続できる。
