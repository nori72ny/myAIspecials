import { IntelligenceDNA } from "./EvolutionTypes";

export function generateIntelligenceDNA(missionId: string, success: boolean, score: number): IntelligenceDNA {
  const isMsn = missionId.startsWith("MSN-");
  const objective = isMsn
    ? `ミッション ID ${missionId} に設定された、ユーザーの個別業務ニーズ（タスク自動化、システム比較、意思決定用データ作成など）に対し、10名のエージェント合意のもと最高レベルの品質で成果物を作成・検証すること。`
    : `ACOS-OSにおけるミッション「${missionId}」を完了し、その実行プロセスを自己分析して自律的に組織知能（Intelligence DNA）へと昇華すること。`;

  const result = success 
    ? `ミッション「${missionId}」は、合意形成プロセスにおいて全ての専門エージェントから100%の承認を得て、無事完了しました。品質評価スコアは ${score.toFixed(1)}% となり、非常に高い水準で目標を達成しました。`
    : `ミッション「${missionId}」の実行において一部のエディット、またはレビュー監査で不合格が検知され、合意形成のボトルネックが発生しました。品質評価スコアは ${score.toFixed(1)}% となりました。`;

  const successRate = success ? Math.round(score) : Math.max(50, Math.round(score - 10));

  return {
    missionId,
    timestamp: new Date().toISOString(),
    summary: {
      objective,
      result,
      successRate
    },
    lessonsLearned: {
      successFactors: success ? [
        "10名のエージェント間での並行ディベートによる多角的レビューが機能したこと",
        "Google Search Groundingによるファクト検証の自動化とハルシネーション防御",
        "CEOエージェントによる合意形成UQI監査ゲートの適切な統率"
      ] : [
        "事前チェックの一部がパスされていたこと",
        "合意形成における特定スレッドのコンフリクト解決自動化"
      ],
      failureFactors: success ? [
        "初期プロンプトにおける解釈の不確実性がわずかに残っていた点（結果的にはエージェント合意で吸収）"
      ] : [
        "依存モジュール間のポート競合、または同期ラグの発生",
        "リサーチャーによるWebグラウンディングデータの抽出遅延"
      ],
      improvementPoints: [
        "プロンプト長が長い分析タスクでのコンテキスト分割プロセスの導入",
        "各AI Workerの得意領域に応じたプロバイダー(Gemini 3.5 Flash vs Pro)割り当てルールの動的アップデート",
        "合意投票のラウンド制におけるしきい値(UQIスコア)の最適化"
      ]
    },
    reusableKnowledge: {
      reusableConcepts: [
        "合意形成型 Swarm アーキテクチャの対話パターン、およびCEOによる投票仲介モデル",
        "UQI (Universal Quality Index) 監査を用いた非妥協セーフティチェックライン",
        "マルチモデルハイブリッド（Claude + Gemini + GPT）による、並列推論・コーディングタスクの実行フレームワーク"
      ],
      templates: [
        "ACOS-OS 標準役員会議スレッド対話テンプレート",
        "事実確認（Fact-Check）自動化プロンプトおよびGrounding確認メタ構造",
        "提出防止ロック（Completion Judge Guard）のしきい値ルール"
      ],
      workflows: [
        "ユーザー要請受領 ➔ 各エージェントへの自動タスク分解 ➔ ピアレビュー ➔ 合意投票（多数決） ➔ 最終出荷判定(Completion Judge) ➔ 永続化保存",
        "エージェント間競合時における「CEOによる再仲介（Consensus Round）」ワークフロー"
      ]
    },
    userPreference: {
      inferredTendency: [
        "プロンプトは構造化されており、ファクト重視型（Fact-Critical）の決定を好む傾向",
        "インターフェースは無駄なシステムログ（AI slop）を嫌い、洗練されたApple流のデザインシステムを高く評価する傾向",
        "実行スピードと成果物の正確性において、正確性（Consensus UQI）へ高い優先度を置く傾向"
      ],
      nextTimeImprovements: [
        "次回ミッション立ち上げ時に、ユーザー嗜好性に合致した『Fact-Critical』または『Analytical-Focus』を自動デフォルト設定する",
        "不要なシステムノイズ(ポート番号や実行ログ等)を排除し、磨き上げられたサマリーとフローチャートのみを提示する"
      ]
    },
    systemImprovement: {
      aiRoutingImprovement: "論理的かつ厳格なアーキテクチャ監査には Claude 3.5 Sonnet を、リアルタイムのスピード検証やWebデータ照合には Gemini 3.5 Flash を適時使い分けるルーティングアルゴリズムを強化。",
      pluginImprovement: "自動化ビルドチェッカーおよびLintingチェッカーと、OrganizationExecutorをリアルタイム連携させるプラグインの不揮発化。",
      workflowImprovement: "レビュー監査不合格時における、開発者エージェント（Developer）への自動差し戻し(Refinement)ワークフローループのステップ短縮化。",
      memoryImprovement: "蓄積されたIntelligence DNAを自律解析し、ACOS Knowledge Graphへ新しい事実エッジ（Relation）を100%自動で追加・更新する自己進化メモリエンジンの搭載。"
    }
  };
}
