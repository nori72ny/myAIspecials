# ORIGIN（ACOS 2.0）

ORIGIN Personalは、会話を中心にResearch、実ファイル成果物、Web/Application Builder、Agentic Coding等の実行境界を安全に統合するAIオーケストレーション製品です。

## 現行コードの原則

- **$0 / free-only**: 有料fallback・自動課金を行いません。
- **Fail-Closed**: 価格、モデル、権限、証拠、provider状態を検証できない場合は成功扱いせず停止します。
- **Evidence before completion**: Codingはtypecheck → lint → test → buildを通過するまで完了報告できません。
- **Approval-bound external effects**: merge、Production deploy、破壊的操作、権限拡大はOwner承認と別ゲートです。
- **Server-side secrets**: 現行Personal/MCPの秘密値はブラウザーstorageへ保存する設計にしません。

このREADMEはGitHubの現行実装境界だけを説明します。ルートやdocs内にあるVision、旧ACOS画面、Enterprise構想、過去Release Noteは、存在するだけでは現行Personalで利用可能・Production反映済みであることを意味しません。

現在の実装・検証・未完了を区別した状態表は [docs/ORIGIN_COMPLETION_STATUS.md](docs/ORIGIN_COMPLETION_STATUS.md)、制約は [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)、セキュリティ境界は [SECURITY.md](SECURITY.md) を参照してください。
