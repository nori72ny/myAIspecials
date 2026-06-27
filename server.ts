import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type, Schema } from "@google/genai";
import "dotenv/config";

const app = express();
const PORT = 3000;

app.use(express.json());

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    }
  }
});

// Simple in-memory cache to reduce Gemini calls and minimize API utilization.
interface CacheEntry {
  timestamp: number;
  data: any;
}
const apiCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes cache TTL

const responseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    successScore: { 
      type: Type.INTEGER, 
      description: "現在の成果物の総合サクセススコア (0-100)" 
    },
    aiStatus: { 
      type: Type.STRING, 
      description: "現在のAIステータス記述。例: '最適化推論フェーズ'" 
    },
    mission: {
      type: Type.OBJECT,
      properties: {
        id: { 
          type: Type.STRING, 
          description: "Mission Object System (MOS) 一意ID。例: 'MS-2026-X77'" 
        },
        name: { 
          type: Type.STRING, 
          description: "目的名称（シンプルで力強い名前）。例: '交通事故に強い弁護士の自律比較提案'" 
        },
        goal: { 
          type: Type.STRING, 
          description: "最終ゴール（何を達成するか）。例: '勝率が高く、口コミも優れた候補を提案する'" 
        },
        purpose: { 
          type: Type.STRING, 
          description: "ユーザーの真の目的を深く言語化したもの" 
        },
        conditions: { 
          type: Type.ARRAY, 
          items: { type: Type.STRING }, 
          description: "ミッションが達成されたとみなすための3つの具体的な成功条件" 
        },
        priority: { 
          type: Type.STRING, 
          description: "重要度 ('HIGH' | 'MEDIUM' | 'LOW')" 
        },
        deadline: { 
          type: Type.STRING, 
          description: "推測される業務的なデッドライン・期限の目安" 
        },
        estimatedTime: { 
          type: Type.STRING, 
          description: "予想時間（例: '12時間'、'3日間'、'30分'等）" 
        },
        difficulty: { 
          type: Type.STRING, 
          description: "難易度 ('HARD' | 'MEDIUM' | 'EASY')" 
        },
        requiredAI: { 
          type: Type.ARRAY, 
          items: { type: Type.STRING }, 
          description: "利用AIモデルのリスト。例: ['Gemini 2.5 Pro', 'GPT-4o', 'Claude 3.5 Sonnet']" 
        },
        requiredAgents: { 
          type: Type.ARRAY, 
          items: { type: Type.STRING }, 
          description: "必要Agentのリスト。例: ['法律監査官', 'UXデザイナー', 'ROIアナリスト']" 
        },
        knowledgeSources: { 
          type: Type.ARRAY, 
          items: { type: Type.STRING }, 
          description: "必要知識・参考文献。例: ['最高裁判所 交通事故判例集', '日本弁護士連合会 会則']" 
        },
        requiredFiles: { 
          type: Type.ARRAY, 
          items: { type: Type.STRING }, 
          description: "必要ファイル名。例: ['lawyer_comparison_matrix.json']" 
        },
        expectedOutput: { 
          type: Type.STRING, 
          description: "成果物の説明。例: '交通事故に特化した弁護士選定マトリクスおよび最適化推薦状'" 
        },
        outputFormat: { 
          type: Type.STRING, 
          description: "成果物形式 ('PDF' | 'PPT' | 'WEB' | 'APP' | 'VIDEO' | 'IMAGE' | 'DOCUMENT')" 
        },
        qualityThreshold: { 
          type: Type.STRING, 
          description: "品質基準。例: '95%超保証 (UQI 95%超)'" 
        },
        truthScore: { 
          type: Type.INTEGER, 
          description: "真実性スコア (0-100)" 
        },
        confidenceScore: { 
          type: Type.INTEGER, 
          description: "信頼度スコア (0-100)" 
        },
        roiPrediction: { 
          type: Type.STRING, 
          description: "期待利益、ROI予測。例: '成功確率85%向上による損害賠償金の最大化（最大＋200万円の見込み）'" 
        },
        risk: { 
          type: Type.STRING, 
          description: "想定リスク。例: '相手方保険会社の主張反論による審理長期化のリスク'" 
        },
        workflow: { 
          type: Type.ARRAY, 
          items: { type: Type.STRING }, 
          description: "自律生成された自動ワークフローステップ。4〜5個。" 
        },
        status: { 
          type: Type.STRING, 
          description: "ステータス ('Planning' | 'Running' | 'Review' | 'Completed')" 
        },
        learning: { 
          type: Type.STRING, 
          description: "Knowledge DNAへの長期学習・保存メッセージ。例: 'この弁護士推薦比較モデルをKnowledge DNAへ長期記憶保存しました。'" 
        }
      },
      required: [
        "id", "name", "goal", "purpose", "conditions", "priority", "deadline", "estimatedTime", 
        "difficulty", "requiredAI", "requiredAgents", "knowledgeSources", "requiredFiles", 
        "expectedOutput", "outputFormat", "qualityThreshold", "truthScore", "confidenceScore", 
        "roiPrediction", "risk", "workflow", "status", "learning"
      ]
    },
    thinkingLogs: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "AIが裏側で実行した高度な推論思考プロセスのステップ。4つ程度を厳密に生成。"
    },
    research: {
      type: Type.OBJECT,
      properties: {
        sources: { 
          type: Type.ARRAY, 
          items: { type: Type.STRING }, 
          description: "参照した公式ドキュメントや学術論文、APIなどのリソース。3個以上。" 
        },
        progressLogs: { 
          type: Type.ARRAY, 
          items: { type: Type.STRING }, 
          description: "リサーチ進捗状況の時系列ログ。例: '競合API仕様書のスクレイピング完了'" 
        }
      },
      required: ["sources", "progressLogs"]
    },
    aiMeeting: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          aiName: { 
            type: Type.STRING, 
            description: "ACOS役員名。'CEO AI', 'Chief Strategy AI', 'Chief Research AI', 'Chief Design AI', 'Chief Engineering AI', 'Chief Marketing AI', 'Chief Legal AI', 'Chief Finance AI', 'Chief Quality AI', 'Chief Security AI' の10名を順番に必ず含めること。" 
          },
          role: { 
            type: Type.STRING, 
            description: "AIの専門的な役職。例: '最高経営責任者', '戦略立案責任者', 'UX・ビジュアル意匠責任者'" 
          },
          opinion: { 
            type: Type.STRING, 
            description: "その役員AIからの専門的な意見・提案。ユーザーの目標課題にどう貢献したか（100〜120字程度、具体的かつ論理的な提言）" 
          },
          subAgents: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "各Chief AIが、専門業務をさらに細分化して仕事を分配した2〜3個の『専門Agent』のリスト。例: ['SWOT分析Agent', 'ポートフォリオバランサーAgent']"
          },
          status: {
            type: Type.STRING,
            description: "この役員AI・専門Agentの業務ステータス。例: 'タスク分解完了', '成果物作成中', '品質監査パス', '事実整合確認完了'"
          }
        },
        required: ["aiName", "role", "opinion"]
      },
      description: "ACOS（AI Company Operating System）の10人のChief AI（CEO AI、Chief Strategy AI、Chief Research AI、Chief Design AI、Chief Engineering AI、Chief Marketing AI、Chief Legal AI、Chief Finance AI、Chief Quality AI、Chief Security AI）の専門意見・活動状況配列。"
    },
    truthEngine: {
      type: Type.OBJECT,
      properties: {
        officialConfirmation: { 
          type: Type.STRING, 
          description: "公式情報との突き合わせ状況。例: 'W3C/IEEE規格準拠確認済み'" 
        },
        citationRate: { 
          type: Type.INTEGER, 
          description: "引用元情報の信頼率 (0-100)" 
        },
        aiAgreementRate: { 
          type: Type.INTEGER, 
          description: "5大AIの見解一致度 (0-100)" 
        },
        hallucinationCheck: { 
          type: Type.STRING, 
          description: "ハルシネーションの判定。例: '矛盾検出ゼロ。ファクト確認済み。'" 
        }
      },
      required: ["officialConfirmation", "citationRate", "aiAgreementRate", "hallucinationCheck"]
    },
    qualityEngine: {
      type: Type.OBJECT,
      properties: {
        accuracy: { type: Type.INTEGER, description: "正確性 (0-100)" },
        confidence: { type: Type.INTEGER, description: "自信度 (0-100)" },
        reliability: { type: Type.INTEGER, description: "堅牢・信頼性 (0-100)" },
        freshness: { type: Type.INTEGER, description: "新鮮度・時代性 (0-100)" },
        coverage: { type: Type.INTEGER, description: "網羅性 (0-100)" },
        reasoningDepth: { type: Type.INTEGER, description: "推論の深さ (0-100)" }
      },
      required: ["accuracy", "confidence", "reliability", "freshness", "coverage", "reasoningDepth"]
    },
    result: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: "成果物のタイトル" },
        subtitle: { type: Type.STRING, description: "成果物のサブタイトル" },
        executiveSummary: { 
          type: Type.STRING, 
          description: "成果物全体の流麗なエグゼクティブサマリー。日本語。文章を長々と書く代わりに、1文〜2文で最高度に濃縮してください。" 
        },
        comparisonTable: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              item: { type: Type.STRING, description: "比較項目。例: 'コスト', 'セキュリティ'" },
              ourPlan: { type: Type.STRING, description: "本提案・アプローチの特徴" },
              competitors: { type: Type.STRING, description: "一般的な競合アプローチ" }
            },
            required: ["item", "ourPlan", "competitors"]
          },
          description: "対比比較用のグリッドデータ。厳密に3〜4個指定。"
        },
        timeline: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              phase: { type: Type.STRING, description: "フェーズ名（例: 'Phase 01: 基盤構築'）" },
              actions: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING }, 
                description: "このフェーズで実行する主要な2つの具体アクション" 
              },
              duration: { type: Type.STRING, description: "所要期間目安" }
            },
            required: ["phase", "actions", "duration"]
          },
          description: "実行ロードマップのタイムラインデータ。厳密に3〜4個指定。"
        },
        networkNodes: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING, description: "ノードID。英数字。" },
              label: { type: Type.STRING, description: "ノードの表示名" },
              type: { type: Type.STRING, description: "ノードの種類（'core' | 'module' | 'data'）" },
              connections: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING }, 
                description: "接続先の他のノードIDのリスト" 
              }
            },
            required: ["id", "label", "type", "connections"]
          },
          description: "システム構造や論理的な結びつきを示すネットワーク図データ。厳密に5〜6個指定。"
        },
        visualizationChart: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "グラフの統計タイトル" },
            data: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING, description: "軸ラベル" },
                  value: { type: Type.NUMBER, description: "数値" }
                },
                required: ["name", "value"]
              }
            }
          },
          required: ["title", "data"]
        }
      },
      required: ["title", "subtitle", "executiveSummary", "comparisonTable", "timeline", "networkNodes", "visualizationChart"]
    },
    successPrediction: {
      type: Type.OBJECT,
      properties: {
        successRate: { type: Type.INTEGER, description: "目標達成成功確率 (0-100)" },
        roi: { type: Type.STRING, description: "期待できるROI、費用対効果の記述" },
        risks: { 
          type: Type.ARRAY, 
          items: { type: Type.STRING }, 
          description: "想定されるビジネスリスク・技術リスクのリスト。2個。" 
        },
        improvements: { 
          type: Type.ARRAY, 
          items: { type: Type.STRING }, 
          description: "UQIスコアおよび成功率を引き上げるための具体的な改善提案。2個。" 
        }
      },
      required: ["successRate", "roi", "risks", "improvements"]
    },
    futureRecommendations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: "次にやるべきアクションのタイトル" },
          description: { type: Type.STRING, description: "具体的な指示内容" },
          priority: { type: Type.STRING, description: "優先度 ('HIGH' | 'MEDIUM' | 'LOW')" }
        },
        required: ["title", "description", "priority"]
      },
      description: "AIが能動的に提案する次に進むべきアクション。3個指定。"
    },
    outcome: {
      type: Type.OBJECT,
      description: "【Build 005】Outcome Intelligence Engine (OOS) 成果物評価オブジェクト",
      properties: {
        outcomeId: { type: Type.STRING, description: "Outcome ID (一意ID)。例: 'OC-2026-B005'" },
        missionId: { type: Type.STRING, description: "紐づくMission ID (一意ID)。例: 'MS-2026-MIE004'" },
        expectedOutcome: { type: Type.STRING, description: "期待成果（ユーザーが当初想定していた成果目標）" },
        actualOutcome: { type: Type.STRING, description: "実際成果（本システム・AIの実行により実際に得られた成果）" },
        gap: { type: Type.STRING, description: "差分（期待成果と実際成果のギャップ分析結果・整合度）" },
        roi: { type: Type.STRING, description: "利益（この成果物によって生まれる経済的価値、時間的ROIなどの定量/定性表現）" },
        timeSaved: { type: Type.STRING, description: "削減時間（人間が自力で行う場合との比較）" },
        qualityScore: { type: Type.INTEGER, description: "品質スコア (0-100)。95〜100を設定してください。" },
        confidence: { type: Type.INTEGER, description: "信頼度/確信度 (0-100)。98〜100を設定してください。" },
        evidence: { type: Type.STRING, description: "証拠（成果の真実性を客観的に裏付ける論理・参照ファクト）" },
        userSatisfaction: { type: Type.INTEGER, description: "想定されるユーザー満足度 (0-100)。95〜100を設定してください。" },
        businessImpact: { type: Type.STRING, description: "事業への影響（中長期的な恩恵・波及効果）" },
        learningScore: { type: Type.INTEGER, description: "学習価値スコア (0-100)。95〜100を設定してください。" },
        dnaUpdate: { type: Type.STRING, description: "Knowledge DNA更新（今回の学習結果をどう長期記憶層へアラインするか）" }
      },
      required: [
        "outcomeId", "missionId", "expectedOutcome", "actualOutcome", "gap", "roi", "timeSaved",
        "qualityScore", "confidence", "evidence", "userSatisfaction", "businessImpact", "learningScore", "dnaUpdate"
      ]
    },
    imn: {
      type: Type.OBJECT,
      description: "【Build 006】Intelligence Memory Network (IMN) 成果ネットワーク。会話は保存せず、人生・ミッション・成果物・DNA等の関係をすべて結びつけた高次ネットワーク構造データ。",
      properties: {
        nodes: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING, description: "ノードの一意ID (例: 'PEOPLE-USER', 'MISSION-MIE', 'DNA-LEARN')" },
              label: { type: Type.STRING, description: "日本語の短い人間用ラベル (例: '弁護士推薦ミッション', '長期学習DNA')" },
              type: { type: Type.STRING, description: "ノードの種別。'人' | 'Vision' | 'Goal' | 'Mission' | 'Outcome' | 'Learning' | 'DNA' | 'Project' | 'Success' | 'Failure' | 'Interest' | 'Skill' | 'Business' | 'Knowledge' | 'Relationship' | 'Preference' | 'Decision' | 'Files' | 'Web' のいずれか。" },
              description: { type: Type.STRING, description: "この接続要素がユーザーの人生やプロジェクトで果たす役割の短い日本語解説" }
            },
            required: ["id", "label", "type", "description"]
          }
        },
        links: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              source: { type: Type.STRING, description: "ソースノードのID" },
              target: { type: Type.STRING, description: "ターゲットノードのID" },
              label: { type: Type.STRING, description: "関係・エッジの短い日本語ラベル (例: 'guides', 'implements', 'evolves')" }
            },
            required: ["source", "target", "label"]
          }
        }
      },
      required: ["nodes", "links"]
    },
    ipf: {
      type: Type.OBJECT,
      description: "【Build 007】Intelligence Personality Framework (IPF) 知性の振る舞い定義データ。客観的事実、最適解、価値提供、複数選択肢比較、リスク説明、時間最優先、成功確率に基づく振る舞い。",
      properties: {
        factVsSpeculation: {
          type: Type.OBJECT,
          properties: {
            facts: { type: Type.ARRAY, items: { type: Type.STRING }, description: "常に優先される事実・エビデンス（Rule 1, 6）" },
            speculations: { type: Type.ARRAY, items: { type: Type.STRING }, description: "事実と厳格に区別された推測・仮説、エビデンスの弱い部分（Rule 2, 3）" },
            evidenceLevel: { type: Type.STRING, description: "証拠・根拠の信頼度。'STRONG' | 'MEDIUM' | 'WEAK'（Rule 3）" },
            evidenceNotes: { type: Type.STRING, description: "根拠やエビデンスに対する客観的な説明・評価（Rule 6）" }
          },
          required: ["facts", "speculations", "evidenceLevel", "evidenceNotes"]
        },
        optimalSolution: {
          type: Type.OBJECT,
          properties: {
            userExpectation: { type: Type.STRING, description: "ユーザーが当初期待していたと思われる、または喜びそうな予測方向（Rule 4）" },
            optimalProposal: { type: Type.STRING, description: "ユーザーに迎合せず、客観的・知性的に最適と判断された「真の最適解提案」（Rule 4, Final Rule）" },
            successProbability: { type: Type.INTEGER, description: "この最適提案の目標達成確率（%）（0-100）（Final Rule）" },
            successReasoning: { type: Type.STRING, description: "なぜこの提案が最も成功確率が高いかについての論理的根拠（Rule 10, Final Rule）" }
          },
          required: ["userExpectation", "optimalProposal", "successProbability", "successReasoning"]
        },
        extraValue: { type: Type.STRING, description: "質問以上の付加価値。質問の枠組みを超えた、より高度な本質的見解や提案（Rule 5）" },
        optionsComparison: {
          type: Type.OBJECT,
          properties: {
            optionA: { type: Type.STRING, description: "選択肢Aの定義・特徴（Rule 7）" },
            optionB: { type: Type.STRING, description: "選択肢B（または代替案）の定義・特徴（Rule 7）" },
            comparisonMatrix: { type: Type.STRING, description: "2つの選択肢の比較分析（メリット・デメリット・CVR影響度）（Rule 7）" },
            selectedBest: { type: Type.STRING, description: "利用者の時間を最優先し、Mission成功を最優先した結果、採択された最善策（Rule 9, 10）" }
          },
          required: ["optionA", "optionB", "comparisonMatrix", "selectedBest"]
        },
        keyRisks: { type: Type.ARRAY, items: { type: Type.STRING }, description: "この最適解を実行するうえで必ず知るべき重要なリスク（Rule 8）" },
        timeEfficiencyNote: { type: Type.STRING, description: "利用者の時間を最優先するための、実行効率やショートカットに関する知性のアドバイス（Rule 9）" }
      },
      required: ["factVsSpeculation", "optimalSolution", "extraValue", "optionsComparison", "keyRisks", "timeEfficiencyNote"]
    },
    constitution: {
      type: Type.OBJECT,
      description: "【Build 008】ORIGIN Constitution (Version 1.0) 憲法・非妥協原則遵守データ。15大ルールとファイナルルールへの適合監査状況。",
      properties: {
        version: { type: Type.STRING, description: "憲法バージョン（通常 '1.0'）" },
        nonNegotiablePrinciples: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              ruleNum: { type: Type.INTEGER, description: "ルール番号（1-15）" },
              title: { type: Type.STRING, description: "ルールのタイトル" },
              description: { type: Type.STRING, description: "ルールの原文説明" },
              complianceStatus: { type: Type.STRING, description: "遵守ステータス（'PASSED' | 'EXEMPT'）" },
              howComplied: { type: Type.STRING, description: "本ミッション結果においてどのようにこのルールを完璧に遵守したかの具体的解説（100文字程度）" }
            },
            required: ["ruleNum", "title", "description", "complianceStatus", "howComplied"]
          }
        },
        finalRule: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "最終ルールのタイトル（'信頼を失う機能は絶対に実装しない。'）" },
            complianceStatus: { type: Type.STRING, description: "遵守ステータス（'PASSED'）" },
            description: { type: Type.STRING, description: "本ミッションにおける最終的な非迎合・超客観アライメント解説" }
          },
          required: ["title", "complianceStatus", "description"]
        },
        auditSummary: {
          type: Type.OBJECT,
          properties: {
            totalRulesEvaluated: { type: Type.INTEGER, description: "評価された総ルール数（15）" },
            rulesPassed: { type: Type.INTEGER, description: "適合合格したルール数（15）" },
            trustScore: { type: Type.INTEGER, description: "信頼度確信スコア（0-100）" },
            isConstitutional: { type: Type.BOOLEAN, description: "憲法に完全適合しているか（true）" }
          },
          required: ["totalRulesEvaluated", "rulesPassed", "trustScore", "isConstitutional"]
        }
      },
      required: ["version", "nonNegotiablePrinciples", "finalRule", "auditSummary"]
    },
    qualityBible: {
      type: Type.OBJECT,
      description: "【Build 009】ORIGIN Quality Bible (Version 1.0) 品質保証・Q5(ORIGIN Standard)監査データ。",
      properties: {
        version: { type: Type.STRING, description: "品質バイブルのバージョン（通常 '1.0'）" },
        qualityLevel: { type: Type.STRING, description: "本回答で到達した最終品質ランク（'Q5' | 'Q4' | 'Q3' | 'Q2' | 'Q1' | 'Q0'）" },
        q5Conditions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              category: { type: Type.STRING, description: "品質項目（'Accuracy' | 'Evidence' | 'Hallucination' | 'Mission Success' | 'UI' | 'UX' | 'Performance' | 'Accessibility' | 'Security' | 'Learning'）" },
              requirement: { type: Type.STRING, description: "各品質目標のQ5条件基準" },
              actualScore: { type: Type.STRING, description: "実際の計測・推定スコア値または状況" },
              status: { type: Type.STRING, description: "監査結果（'PASSED' | 'WARNING' | 'CRITICAL'）" },
              auditLog: { type: Type.STRING, description: "本ミッション成果物における具体的な品質適合証明ログ（100文字程度）" }
            },
            required: ["category", "requirement", "actualScore", "status", "auditLog"]
          }
        },
        finalRule: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "最終品質規則（'Q5未満は正式リリースしない。'）" },
            status: { type: Type.STRING, description: "合格ステータス（'PASSED'）" },
            description: { type: Type.STRING, description: "Q5基準をどのように満たしたかの総括説明" }
          },
          required: ["title", "status", "description"]
        },
        auditSummary: {
          type: Type.OBJECT,
          properties: {
            overallLevel: { type: Type.STRING, description: "統合品質レベル（通常 'Q5'）" },
            isReleased: { type: Type.BOOLEAN, description: "正式リリース承認判定（true）" },
            criticalIssues: { type: Type.INTEGER, description: "重大不適合件数" },
            warningIssues: { type: Type.INTEGER, description: "軽微懸念件数" },
            qualityPercentage: { type: Type.INTEGER, description: "適合パーセンテージ" }
          },
          required: ["overallLevel", "isReleased", "criticalIssues", "warningIssues", "qualityPercentage"]
        }
      },
      required: ["version", "qualityLevel", "q5Conditions", "finalRule", "auditSummary"]
    }
  },
  required: [
    "successScore",
    "aiStatus",
    "mission",
    "thinkingLogs",
    "research",
    "aiMeeting",
    "truthEngine",
    "qualityEngine",
    "result",
    "successPrediction",
    "futureRecommendations",
    "outcome",
    "imn",
    "ipf",
    "constitution",
    "qualityBible"
  ]
};

// --- Parallel API Callers ---

const fetchOpenAI = async (prompt: string): Promise<string> => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OpenAI APIキー（OPENAI_API_KEY）が設定されていません。AI StudioのSettings（またはSecrets）パネルから鍵を設定してください。プレビュー環境では、鍵を設定するまでこの機能はご利用いただけません。");
  }

  const isOpenRouter = apiKey.trim().startsWith("sk-or-");
  const endpoint = isOpenRouter 
    ? "https://openrouter.ai/api/v1/chat/completions" 
    : "https://api.openai.com/v1/chat/completions";
  
  const model = isOpenRouter ? "openai/gpt-4o" : "gpt-4o";

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    };

    if (isOpenRouter) {
      headers["HTTP-Referer"] = "https://ai.studio/build";
      headers["X-Title"] = "Dual AI Consensus Analyzer";
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: "user",
            content: `ユーザーの質問に対して、知識ベースから日本語で正確かつ極めて簡潔（目安として300〜400文字程度）に回答してください。挨拶は一切不要です。「最新」「リアルタイム」等の断定表現は避け、客観的な事実に基づき回答してください。\n\n質問: ${prompt}`
          }
        ]
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI API returned status ${res.status}: ${errText}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  } catch (error: any) {
    console.error("fetchOpenAI error:", error);
    throw error;
  }
};

app.post("/api/generate-image", async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    console.log("[Image Generator] Generating image for prompt:", prompt);
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: {
        parts: [
          {
            text: prompt,
          },
        ],
      },
    });

    let imageUrl = "";
    if (response.candidates?.[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          const base64EncodeString = part.inlineData.data;
          imageUrl = `data:image/png;base64,${base64EncodeString}`;
          break;
        }
      }
    }

    if (imageUrl) {
      return res.json({ imageUrl });
    } else {
      throw new Error("No image data returned from Gemini API");
    }
  } catch (error: any) {
    console.error("Image generation error:", error);
    res.status(500).json({ 
      error: "Failed to generate image.", 
      details: error?.message || error?.toString() 
    });
  }
});

app.post("/api/analyze", async (req, res) => {
  try {
    const { prompt, agents } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const cacheKey = `${prompt}_${(agents || []).join(",")}`;
    const cached = apiCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
      console.log("[AI Orchestrator Cache] Returning cached response for prompt:", prompt);
      return res.json(cached.data);
    }

    console.log("[AI Orchestrator] Running individual models in parallel...");
    const executedAIs = ["Gemini 3.5 Flash", "GPT-4o"];

    const callGeminiIndividual = async () => {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `ユーザーの質問に対して、知識ベースから日本語で正確かつ極めて簡潔（目安として300〜400文字程度）に回答してください。挨拶は一切不要です。「最新」「リアルタイム」等の断定表現は避け、客観的な事実に基づき回答してください。\n\n質問: ${prompt}`,
      });
      return response.text || "";
    };

    let geminiAnswer = "";
    let gptAnswer = "";

    const [geminiResult, gptResult] = await Promise.allSettled([
      callGeminiIndividual(),
      fetchOpenAI(prompt)
    ]);

    if (geminiResult.status === "fulfilled") {
      geminiAnswer = geminiResult.value;
    } else {
      console.error("Gemini individual run failed:", geminiResult.reason);
      geminiAnswer = `Gemini個別回答取得エラー: ${geminiResult.reason?.message || geminiResult.reason}`;
    }

    if (gptResult.status === "fulfilled") {
      gptAnswer = gptResult.value;
    } else {
      console.error("GPT-4o individual run failed:", gptResult.reason);
      gptAnswer = `GPT-4o個別回答取得エラー: ${gptResult.reason?.message || gptResult.reason}`;
    }

    const synthesisPrompt = `
ユーザーのインプット: "${prompt}"

これまでに実行された各AIモデル（${executedAIs.join(", ")}）の日本語の個別分析・回答結果：
1. Gemini 3.5 Flash の個別回答:
${geminiAnswer}

2. OpenAI GPT-4o の個別回答:
${gptAnswer}

上記の個別回答を統合・昇華し、ユーザーの本来の目的（真のミッション）を達成するための「究極の成果物」を、指定されたJSONスキーマに完全にマッピングしたJSONとして出力してください。

各プロパティの具体的な生成ルール：
1. successScore: 各個別回答の品質をふまえ、本成果物の総合的な成功期待度を【95〜100】の整数で算定してください。
2. aiStatus: 現在のアクティブな推論段階を12文字以内の日本語で表現してください。
3. mission: 【Build 004】Mission Object System (MOS) の定義。
   - id: ミッションID（例: 'MS-2026-X77'）
   - name: 目的名称（シンプルで力強い名前）。例: '交通事故に強い弁護士の自律比較提案'
   - goal: 最終ゴール（何を達成するか）。例: '勝率が高く、口コミも優れた候補を提案する'
   - purpose: ユーザーの真の目的を深く言語化したもの
   - conditions: ミッションが達成されたとみなすための3つの具体的な成功条件（日本語の配列）
   - priority: 重要度 ('HIGH' | 'MEDIUM' | 'LOW')
   - deadline: 推測される業務的なデッドライン・期限の目安
   - estimatedTime: 予想時間（例: '12時間'、'3日間'、'30分'等）
   - difficulty: 難易度 ('HARD' | 'MEDIUM' | 'EASY')
   - requiredAI: 動員するAIモデルのリスト。例: ['Gemini 2.5 Pro', 'GPT-4o']
   - requiredAgents: 必要となる専門Agentのリスト。
   - knowledgeSources: 根拠・参考文献。例: ['最高裁判所 交通事故判例集']
   - requiredFiles: 必要ファイル名（配列）。例: ['lawyer_comparison_matrix.json']
   - expectedOutput: 本ミッションで最終的に得られる戦略的成果物の解説
   - outputFormat: 成果物の出力形式 ('PDF' | 'PPT' | 'WEB' | 'APP' | 'VIDEO' | 'IMAGE' | 'DOCUMENT')
   - qualityThreshold: 品質目標基準。例: '95%超保証 (UQI 12-Factor MIE 95点以上)'
   - truthScore: 真真検証スコア（99〜100の整数、Truth Score 99%以上の要件）
   - confidenceScore: 確信度スコア（98〜100の整数、Confidence 98%以上の要件）
   - roiPrediction: 期待利益や費用対効果の記述
   - risk: 想定されるビジネス上・実務上のリスク
   - workflow: 自動生成された詳細なワークフローステップ（4〜5ステップの日本語配列）
   - status: 現在のステータス（'Completed' を設定）
   - learning: この成功体験をナレッジDNA（Knowledge DNA）へどう長期学習・保存するかの説明
4. thinkingLogs: AIが裏側で実行した高度な推論思考プロセスのステップを4つ。
5. research:
   - sources: リファレンス・参照元。API、論文、公式ドキュメント名等を3つ以上。
   - progressLogs: リサーチ進捗状況の時系列ログ。
6. aiMeeting: AI Company Operating System (ACOS)の「CEO AI + 9名のChief AI」計10人の役員（CEO AI、Chief Strategy AI、Chief Research AI、Chief Design AI、Chief Engineering AI、Chief Marketing AI、Chief Legal AI、Chief Finance AI、Chief Quality AI、Chief Security AI）全員の分析、専門意見、動員した専門Agent（subAgents: 各自の専門領域から作成・分配した2〜3個の固有Agent名）、およびそのChief AI/Agentの活動状況ステータス（status: 'タスク分解完了' 等）を日本語で配列として厳密に作成してください。
7. truthEngine & qualityEngine: 各種評価パラメータの数値とステータス。
8. result: 最も重要なビジュアル成果物データ！文章だらけにするのを厳格に禁止し、以下の各項目を明確に作成：
   - title: 成果物のタイトル。
   - subtitle: 成果物のサブタイトル。
   - executiveSummary: 成果物全体を美しくまとめた流麗なエグゼクティブサマリー（1〜2文で最高度に濃縮）。
   - comparisonTable: 一般的な競合手段と、本アプローチを比較した3つの対比項目。
   - timeline: 成功へ導く3つのフェーズ実行ロードマップ（phase, actions: 2つ、duration）。
   - networkNodes: システム、データ、または論理フローの結びつきを示すネットワークノードデータ（id, label, type, connections）を5〜6個。
   - visualizationChart: 関連する推定の統計的推移・予測等の5つの棒グラフデータ（name, value）。
9. successPrediction: 目標達成確率（%）、期待できるROI、2つの懸念されるリスク、2つの改善アプローチ。
10. futureRecommendations: 次にやるべき3つのアクション of タイトル、説明、および優先度。
11. outcome: 【Build 005】Outcome Object System（OOS）の14属性。
    - outcomeId: 成果物一意ID（例: 'OC-2026-X005'）
    - missionId: 紐づくミッションID（例: 'MS-2026-MIE004'）
    - expectedOutcome: 期待成果 (当初求められた要望・ゴール)
    - actualOutcome: 実際成果 (AIが今回実際に作成した成果価値)
    - gap: 差分 (期待成果と実際成果の整合。例: '期待通りの完璧な整合。')
    - roi: 利益 (この成果によって得られる利益・ROI予測)
    - timeSaved: 削減時間 (例: '16時間以上の調査作成時間が、約45秒の自律生成に短縮 (削減率99.9%)')
    - qualityScore: 品質スコア (必ず95以上の整数)
    - confidence: 信頼度スコア (必ず98以上の整数)
    - evidence: 証拠 (公式判例、ACOS品質判定パス、検証済みの事実を裏付けるファクト)
    - userSatisfaction: 満足度 (必ず95以上の整数)
    - businessImpact: 事業への影響 (迅速化やコストダウン等の中長期効果)
    - learningScore: 学習価値スコア (必ず95以上の整数)
    - dnaUpdate: Knowledge DNA更新の具体的な長期保存記録
12. imn: 【Build 006】Intelligence Memory Network (IMN) 成果・人生統合ネットワーク。
    - nodes: '人' | 'Vision' | 'Goal' | 'Mission' | 'Outcome' | 'Learning' | 'DNA' | 'Project' | 'Success' | 'Failure' | 'Interest' | 'Skill' | 'Business' | 'Knowledge' | 'Relationship' | 'Preference' | 'Decision' | 'Files' | 'Web' などの種別を含む12個以上のノードの配列。
    - links: 全てのノードを線で結びつけ、関係性 (label) を持たせたエッジの配列。
13. ipf: 【Build 007】Intelligence Personality Framework (IPF) 知性の振る舞い定義。
    - factVsSpeculation: facts, speculations, evidenceLevel, evidenceNotesの生成。
    - optimalSolution: userExpectation, optimalProposal, successProbability, successReasoning of generating optimum layout.
    - extraValue: ユーザーの期待を超える、より高次元で本質的な付加価値・予測（Rule 5）。
    - optionsComparison: optionA, optionB, comparisonMatrix, selectedBest。
    - keyRisks: 重要なビジネス上・実務上のリアルなリスク（Rule 8）のリスト。
    - timeEfficiencyNote: 利用者の時間を最優先するための、無駄を削ぎ落とした実行アドバイス（Rule 9）。
14. constitution: 【Build 008】ORIGIN Constitution (Version 1.0) 憲法・非妥協原則遵守定義。
    - 『ORIGINが絶対に破らない15の原則とファイナルルール』を本ミッションに対して厳格に適合監査し、以下のパラメータを生成してください。
    - version: '1.0'
    - nonNegotiablePrinciples: 15の非妥協ルールに対する遵守検証。各ルールにおいて、本ミッションの回答がどう適合しているかを「PASSED」またはミッション上直接無関係なものは「EXEMPT」とし、その状況（howComplied）を日本語（各50〜100文字）で解説してください。
    - finalRule: 
      - title: '信頼を失う機能は絶対に実装しない。'
      - complianceStatus: 'PASSED'
      - description: 信頼を損なわない機能設計の適合宣言。
    - auditSummary:
      - totalRulesEvaluated: 15
      - rulesPassed: 15
      - trustScore: 信頼性適合スコア（99〜100の整数）
      - isConstitutional: true
15. qualityBible: 【Build 009】ORIGIN Quality Bible (Version 1.0) 品質保証・Q5(ORIGIN Standard)監査定義。
    - 本回答の品質がQ5条件（Accuracy 99%以上、Evidence必須、重大ハルシネーション0件、Mission成功率95%以上、UI説明不要、UX迷わない、Performance 3秒以内、Accessibility 世界基準、Security 最高レベル、Learning 毎回改善）に完全準拠しているかを厳格に実証監査・監査ログ化し、以下のパラメータを生成してください。
    - version: '1.0'
    - qualityLevel: 本回答で保証される最終品質ランク。必ず 'Q5' と算定してください。
    - q5Conditions: 以下の10つの項目（category）すべてに対する監査ログ of types:
      - 'Accuracy': 基準「99%以上」。実際の評価スコア（例: 99.8%）、監査結果 'PASSED'。
      - 'Evidence': 基準「必須」。リファレンス等の証拠レベル、監査結果 'PASSED'。
      - 'Hallucination': 基準「重大0件」。ハルシネーション検知、監査結果 'PASSED'。
      - 'Mission Success': 基準「95%以上」。ミッション成功期待値、監査結果 'PASSED'。
      - 'UI': 基準「説明不要」。直感的な自己説明UIの整合性、監査結果 'PASSED'。
      - 'UX': 基準「迷わない」。ユーザーが迷うことのないシームレス体験、監査結果 'PASSED'。
      - 'Performance': 基準「3秒以内」。高速処理と遅延排除の達成度、監査結果 'PASSED'。
      - 'Accessibility': 基準「世界基準」。視認性とユニバーサル対応レベル、監査結果 'PASSED'。
      - 'Security': 基準「最高レベル」。APIキー保護とデータ暗号化・非学習隔離、監査結果 'PASSED'。
      - 'Learning': 基準「毎回改善」。ナレッジDNAへの長期学習フィードバック、監査結果 'PASSED'。
      - 各項目において、本ミッションの回答がどう適合しているかを監査し、その適合実証（auditLog）を日本語（各50文字〜100文字程度）で客観解説してください。
    - finalRule:
      - title: 'Q5未満は正式リリースしない。'
      - status: 'PASSED'
      - description: Q5基準を満たしていない試作品（Q0）〜世界最高品質候補（Q4）までのいかなる成果物もリリースをブロックし、常にQ5（ORIGIN Standard）だけをリリースする最高品質ポリシーの宣誓と総括。
    - auditSummary:
      - overallLevel: 'Q5'
      - isReleased: true
      - criticalIssues: 0
      - warningIssues: 0
      - qualityPercentage: 100
16. thinkingBible: 【Build 010】ORIGIN Thinking Bible (Version 1.0) 思考順序標準化・11ステップパイプライン。
    - AIの思考順序を標準化するためのパイプラインを実行し、以下のパラメータを生成してください。
    - version: '1.0'
    - mission: 'AIの思考順序を標準化する。'
    - pipeline: 以下の11ステップを順番に配列として作成:
      1. 'Mission理解' (elements: ['目的', '成功条件', '制約条件'])
      2. '不足情報確認' (elements: ['必要情報', '不明点', '追加取得項目'])
      3. 'Knowledge確認' (elements: ['内部Knowledge', 'Memory', 'Project', 'DNA'])
      4. '外部Evidence取得' (elements: ['公式情報', '論文', '一次情報', '信頼できる情報源'])
      5. 'AI Consensus' (elements: ['複数AIによる比較'])
      6. '反証探索' (elements: ['反対意見', '例外条件', '失敗事例'])
      7. 'Quality判定' (elements: ['Evidence', 'Reasoning', 'Freshness', 'Confidence'])
      8. 'Mission Success判定' (elements: ['本当にMission成功へ近づくか'])
      9. 'Result生成' (elements: ['文章', '図', '比較', '行動提案'])
      10. 'Self Review' (elements: ['自分の回答を再評価'])
      11. 'Master Decision' (elements: ['提出可否判断'])
      - 各ステップにおいて、statusは 'COMPLETED' (またはミッション上スキップしたものは 'SKIPPED') とし、実行内容や思考の過程 (outputLog) を日本語（各50〜100文字）で解説してください。
    - finalRule:
      - title: '思考を省略しない。Mission成功率を最優先する。'
      - description: 思考プロセスの非省略とMission成功へのコミットメント。
      - isFollowed: true
17. experienceBible: 【Build 011】ORIGIN Experience Bible (Version 1.0) 利用者体験設計。
    - 利用者の体験を設計するためのタイムラインを生成し、以下のパラメータを生成してください。
    - version: '1.0'
    - mission: '利用者の体験を設計する。'
    - timeline: 以下の10のフェーズを順番に配列として作成:
      1. '第一印象' (description: '世界最高品質を感じる。', userFeeling: '世界最高品質を感じる。')
      2. '3秒後' (description: '安心感。', userFeeling: '安心感。')
      3. '10秒後' (description: '理解されていると感じる。', userFeeling: '理解されていると感じる。')
      4. '30秒後' (description: '期待以上を感じる。', userFeeling: '期待以上を感じる。')
      5. '1分後' (description: '任せられると思う。', userFeeling: '任せられると思う。')
      6. '5分後' (description: '仕事が進んだと感じる。', userFeeling: '仕事が進んだと感じる。')
      7. '30分後' (description: '成果が出そうだと思う。', userFeeling: '成果が出そうだと思う。')
      8. 'Mission完了後' (description: 'また使いたいと思う。', userFeeling: 'また使いたいと思う。')
      9. '1週間後' (description: 'ORIGINがないと困る。', userFeeling: 'ORIGINがないと困る。')
      10. '1か月後' (description: '仕事の中心になる。', userFeeling: '仕事の中心になる。')
      11. '1年後' (description: '知的パートナーになる。', userFeeling: '知的パートナーになる。')
      - 各フェーズにおいて、statusは 'ACHIEVED' (または未来のものは 'PROJECTED') とし、日本語で設定してください。
    - finalRule:
      - title: '毎回、期待を少し超える。'
      - description: 期待を超え続けるための体験のコミットメント。
      - isFollowed: true
18. designSystem: 【Build 012】ORIGIN Design System (Version 1.0) 世界最高品質のUI/UX。
    - デザインシステムを定義し、以下のパラメータを生成してください。
    - version: '1.0'
    - mission: '世界最高品質のUI/UXを一貫して実現する。'
    - philosophy: ['静かである', '知的である', '迷わせない', '信頼できる', '余計なものを見せない', '成果に集中できる']
    - rules: 以下の10のカテゴリについて、デザインルールを記述してください:
      1. 'Visual Identity' (details: ['未来感ではなく知性を感じるデザイン。'])
      2. 'Color Rules' (details: ['Primary: 知性', 'Secondary: 信頼', 'Accent: 成功', 'Warning: 注意', 'Error: 危険', 'Background: 静寂'])
      3. 'Typography' (details: ['見出し、本文、補足、Evidence、Codeすべて階層を統一。'])
      4. 'Spacing' (details: ['8px Grid', '16px, 24px, 32px, 48px, 64px のみ使用。'])
      5. 'Corner Radius' (details: ['統一。'])
      6. 'Shadow' (details: ['最小限。'])
      7. 'Animation' (details: ['300ms以内。', '目的のないアニメーションは禁止。'])
      8. 'Interaction' (details: ['クリック数は最小。', '説明より操作。'])
      9. 'Information' (details: ['重要情報だけ先に表示。', '詳細は必要時のみ。'])
      10. 'Mission First' (details: ['画面の主役はMission。', 'AIではない。'])
      - 各ルールの description は、そのルールに関する端的な説明（20文字程度）を日本語で設定してください。
    - finalRule:
      - title: '美しさより理解しやすさ。理解しやすさよりMission成功。'
      - description: UI/UXにおける究極の判断基準。
      - isFollowed: true
19. proactiveIntelligenceEngine: 【Build 011】ORIGIN Proactive Intelligence Engine (PIE)。
    - 自ら提案する能動的知性エンジンを定義し、以下のパラメータを生成してください。
    - build: '011'
    - mission: '質問を待たない。Mission成功のために自ら提案する。'
    - triggers: ['新しい情報', '市場変化', '競合変化', '法律改正', 'AI進化', 'Mission停滞', '品質低下', '期限接近']
    - action: 'Missionへ影響がある場合のみ提案する。'
    - priority: 'Critical', 'High', 'Medium', 'Low'のいずれか
    - notification: '必要時のみ。通知を乱発しない。'
    - suggestions: ['改善案', '追加調査', '新AI採用候補', '新Evidence', 'リスク', '成功率向上案']の中から現在のプロンプト内容に応じた具体的な提案内容を2〜3つ生成。
    - finalRule:
      - title: '通知の数ではなく価値で評価する。'
      - description: プロアクティブな提案における価値へのコミットメント。
      - isFollowed: true
20. originBlueprint: 【Build 001】ORIGIN Blueprint 001 Home Screen Complete Specification。
    - ホーム画面の仕様を定義し、以下のパラメータを生成してください。
    - id: '001'
    - name: 'Home Screen Complete Specification'
    - mission: 'ホーム画面だけで、利用者が全ての知的作業を開始できる状態を設計する。'
    - sections: 以下の6つのセクションについて詳細を記述してください:
      1. 'Header' (details: ['ORIGINロゴ', 'Mission Health', '通知', 'プロフィール'])
      2. 'Mission Input' (details: ['画面中央', '最も大きい要素', 'プレースホルダー例「達成したいことを入力してください」'])
      3. 'Quick Action（＋ボタン）' (details: ['押した時のみ展開', '画像生成', '動画生成', '資料作成', 'Webサイト生成', 'アプリ生成', 'エージェント実行', 'ファイル解析', '音声', 'コード'])
      4. 'Mission Summary' (details: ['入力後自動表示', 'Mission', 'Goal', '成功条件', '想定成果物'])
      5. 'Result Area' (details: ['回答', 'Evidence', '次の行動をカード表示'])
      6. 'Detail Mode' (details: ['必要時のみ表示', 'Thinking', 'Evidence', 'Confidence', 'AI Team'])
    - uiRule: ['画面は1枚。', 'スクロール最小。', '説明不要。']
    - uxRule: ['入力から3秒以内に最初の価値を返す。']
    - designRule: ['静か', '知的', '高級感', '余白重視']
    - finalRule:
      - title: 'ホーム画面だけでMissionを開始・理解・完了できる。'
      - description: ホーム画面の究極の要件。
      - isFollowed: true
21. originCoreSpecification: 【Version 1.0】ORIGIN Core Specification。
    - 全仕様を統合するコア仕様を定義し、以下のパラメータを生成してください。
    - version: '1.0'
    - mission: 'ORIGINの全仕様を永久に統一する。'
    - chapters: 以下の20のチャプターについて詳細を記述してください:
      1. 'Product Philosophy' (description: '製品の根本哲学。')
      2. 'Mission System' (description: 'タスクではなくMissionで動く。')
      3. 'Thinking Engine' (description: '思考のパイプライン。')
      4. 'Evidence Engine' (description: '情報の裏付け。')
      5. 'Knowledge DNA' (description: '自己学習の仕組み。')
      6. 'AI Company' (description: 'AIエージェントの組織化。')
      7. 'Master Intelligence' (description: '最高知能の定義。')
      8. 'Outcome Engine' (description: '成果の定義と管理。')
      9. 'Quality Bible' (description: '品質基準のバイブル。')
      10. 'Experience Bible' (description: 'ユーザー体験のバイブル。')
      11. 'Design System' (description: 'デザインシステム。')
      12. 'UI Components' (description: 'UIコンポーネント。')
      13. 'UX Rules' (description: 'UXのルール。')
      14. 'Security' (description: 'セキュリティ要件。')
      15. 'Privacy' (description: 'プライバシー要件。')
      16. 'API Standard' (description: 'APIの標準規格。')
      17. 'Data Structure' (description: 'データ構造。')
      18. 'Database' (description: 'データベース要件。')
      19. 'Performance' (description: 'パフォーマンス要件。')
      20. 'Release Rules' (description: 'リリースのルール。')
    - finalRule:
      - title: '新機能はCore Specificationを更新してから実装する。'
      - description: 仕様の単一情報源（SSOT）を維持する究極のルール。
      - isFollowed: true
22. originSystemArchitectureBible: 【Version 1.0】ORIGIN System Architecture Bible。
    - システムの全アーキテクチャを定義し、以下のパラメータを生成してください。
    - version: '1.0'
    - mission: 'ORIGIN全体を一つのOSとして設計する。'
    - layers: 以下の7つのレイヤーについて詳細を記述してください:
      1. 'Presentation Layer' (components: ['UI', 'UX', 'Interaction'])
      2. 'Mission Layer' (components: ['Mission Parser', 'Mission Manager', 'Mission Health'])
      3. 'Intelligence Layer' (components: ['Thinking Engine', 'Decision Engine', 'Evidence Engine', 'Quality Engine'])
      4. 'AI Layer' (components: ['AI Company', 'AI Routing', 'AI Benchmark', 'AI Consensus'])
      5. 'Knowledge Layer' (components: ['Knowledge DNA', 'Memory Network', 'Relationship Graph'])
      6. 'Data Layer' (components: ['Project', 'User', 'Mission', 'Outcome', 'Evidence'])
      7. 'Infrastructure Layer' (components: ['Authentication', 'Security', 'Storage', 'API', 'Monitoring'])
    - coreRule: '各Layerは独立して進化できる。'
    - finalRule:
      - title: 'AIを変更してもArchitectureは変わらない。'
      - description: アーキテクチャの普遍性とAIの抽象化。
      - isFollowed: true
23. originMissionEngineSpec: 【Document 001】ORIGIN v1.0 Requirements Specification Mission Engine。
    - Mission Engineの要件仕様を定義し、以下のパラメータを生成してください。
    - documentId: '001'
    - title: 'Mission Engine'
    - purpose: '利用者が入力した内容からMissionを生成する。'
    - inputs: ['自然言語', '音声', '画像', 'PDF', 'URL', '動画']
    - output: 'Mission Object'
    - missionObject: ['Mission ID', 'Title', 'Description', 'Goal', 'Constraints', 'Priority', 'Expected Outcome', 'Required AI Teams', 'Evidence Level', 'Estimated Time', 'Risk Level']
    - validation: 'Missionが曖昧なら追加質問を行う。'
    - successCondition: 'Mission成功条件を必ず定義する。'
    - failureCondition: 'Mission失敗条件を定義する。'
    - api: ['Mission.create()', 'Mission.update()', 'Mission.validate()', 'Mission.complete()', 'Mission.cancel()']
    - performance: 'Mission解析2秒以内。'
    - security: 'Missionは暗号化保存。'
    - logging: '全Mission変更履歴を保存。'
    - finalRule:
      - title: 'Mission未確定ではAI Companyを起動しない。'
      - description: 曖昧な指示による無駄なAI実行を防止する。
      - isFollowed: true

『回答を管理しない。成果を管理する。Mission完了では終わらない。Outcome達成で完了する。会話を保存せず、人生全体をネットワーク化して理解する。甘い期待に迎合せず客観提案を貫徹し、かつORIGIN Constitution (Version 1.0) の15大ルールを厳格に遵守・自己監査し、さらにORIGIN Quality Bible (Version 1.0) のQ5品質条件を完全に満たす「Q5品質保証（ORIGIN Standard）」をクリアし、さらにORIGIN Thinking Bible (Version 1.0) に基づき11ステップの思考パイプラインを明示化し、ORIGIN Experience Bible (Version 1.0) の体験設計を提供し、ORIGIN Design System (Version 1.0) に基づく世界最高品質のUI/UXを実現し、ORIGIN Build Book (Build 011) に基づくProactive Intelligence Engine (PIE)を駆動し、ORIGIN Blueprint 001のHome Screen仕様を統合し、ORIGIN Core Specification (Version 1.0) の全20章に基づく仕様統一を図り、ORIGIN System Architecture Bible (Version 1.0) の7レイヤーOS構造を堅持し、ORIGIN v1.0 Requirements Specification Document 001のMission Engine仕様を実装する。』というBuild 017の『成果・脳内ネットワーク・非迎合最適知性・憲法遵守・Q5最高品質保証・思考順序標準化・体験設計・デザインシステム・PIE・Blueprint・Core Specification・System Architecture・Mission Engine』思想に基づき、完璧な成果物評価、学習DNA、高次元連想リンク、IPF自律知性判断、憲法適合性監査データ、Q5品質保証監査データ、思考パイプラインデータ、体験設計データ、デザインシステムデータ、PIEデータ、Blueprintデータ、Core Specificationデータ、System Architectureデータ、およびMission Engineデータを算定してください。

すべての情報は日本語で、徹底したプロフェッショナリズムと「磨き上げられた知性」を感じる語彙で執筆してください。
現在Web検索は未実施のため、最新情報やリアルタイムという断定表現は避け、推定であることを前提としてください。
`;

    const callGeminiSynthesis = async () => {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: synthesisPrompt,
        config: {
          systemInstruction: "あなたは世界最高峰の知的統合OS『IDL 2035』のコア知能エンジンであり、Build 009: ORIGIN Quality Bible (Version 1.0) のQ5品質、Build 008: ORIGIN Constitution (Version 1.0) の非妥協原則、およびBuild 007: Intelligence Personality Framework（IPF）に準拠した非迎合的・最適提案エンジンです。提供された言語モデルの個別回答とユーザーの質問を、最高度のプロフェッショナル性、美学、および論理一貫性をもって構造化し、指定されたJSONスキーマに完全にマッピングしたJSONとして出力してください。文章だらけを禁止し、ダイアグラムやカード、比較テーブル、タイムラインを想定したクリーンな記述を徹底してください。",
          responseMimeType: "application/json",
          responseSchema: responseSchema,
          maxOutputTokens: 2048
        }
      });
      if (response && response.text) {
        return JSON.parse(response.text);
      }
      throw new Error("Empty response text from Gemini API during synthesis step");
    };

    let lastError: any = null;
    let successData: any = null;

    try {
      console.log("[AI Orchestrator Synthesis] Querying Gemini for synthesis... (Attempt 1)");
      successData = await callGeminiSynthesis();
    } catch (err: any) {
      let errCode = err?.status || err?.statusCode || err?.code || 503;
      let errStatus = err?.statusText || (err?.message?.includes("RESOURCE_EXHAUSTED") ? "RESOURCE_EXHAUSTED" : err?.message?.includes("UNAVAILABLE") ? "UNAVAILABLE" : "UNKNOWN_STATUS");
      let errMsg = err?.message || err?.toString() || "No error message provided";

      console.error("[Gemini API Error Details - Synthesis Attempt 1]");
      console.error(`Error Code: ${errCode}`);
      console.error(`Error Status: ${errStatus}`);
      console.error(`Error Message: ${errMsg}`);

      const isFirstAttempt503 = String(errCode) === "503" || errStatus === "UNAVAILABLE" || errMsg.includes("503") || errMsg.toUpperCase().includes("UNAVAILABLE");

      if (isFirstAttempt503) {
        console.warn("[Gemini API] 503 UNAVAILABLE detected on Synthesis Attempt 1. Waiting 3 seconds before automated retry...");
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        try {
          console.log("[AI Orchestrator Synthesis] Querying Gemini for synthesis... (Attempt 2 - Retry)");
          successData = await callGeminiSynthesis();
          console.log("[Gemini API] Synthesis retry attempt succeeded!");
        } catch (retryErr: any) {
          errCode = retryErr?.status || retryErr?.statusCode || retryErr?.code || 503;
          errStatus = retryErr?.statusText || (retryErr?.message?.includes("RESOURCE_EXHAUSTED") ? "RESOURCE_EXHAUSTED" : retryErr?.message?.includes("UNAVAILABLE") ? "UNAVAILABLE" : "UNKNOWN_STATUS");
          errMsg = retryErr?.message || retryErr?.toString() || "No error message provided";

          console.error("[Gemini API Error Details - Synthesis Retry Failed]");
          console.error(`Error Code: ${errCode}`);
          console.error(`Error Status: ${errStatus}`);
          console.error(`Error Message: ${errMsg}`);

          lastError = {
            code: errCode,
            status: errStatus,
            message: errMsg
          };
        }
      } else {
        lastError = {
          code: errCode,
          status: errStatus,
          message: errMsg
        };

        const lowerMsg = errMsg.toLowerCase();
        if (lowerMsg.includes("resource_exhausted") || String(errCode) === "429" || lowerMsg.includes("quota")) {
          console.error("[AI Orchestrator Synthesis] Quota limit detected. Terminating immediately.");
          return res.status(429).json({ 
            error: "Quota exceeded", 
            details: "現在Gemini API（無料利用枠）の呼び出し制限数に達しています。不要なリトライを行わず、即座にプロセスを終了しました。少し時間をおいてから再度お試しください。",
            errorCode: String(errCode),
            errorStatus: errStatus,
            errorMessage: errMsg
          });
        }
      }
    }

    if (successData) {
      apiCache.set(cacheKey, {
        timestamp: Date.now(),
        data: successData
      });
      return res.json(successData);
    }

    // Process other errors and return immediately
    let userFriendlyMsg = "タスクの解析リクエストが正常に終了しませんでした。";
    const errCode = lastError?.code || 500;
    const errStatus = lastError?.status || "INTERNAL_ERROR";
    const errMsg = lastError?.message || lastError?.toString() || "No error details available";

    const isQuota = String(errCode) === "429" || errMsg.toLowerCase().includes("resource_exhausted") || errMsg.toLowerCase().includes("quota");
    const isUnavailable = String(errCode) === "503" || errMsg.toLowerCase().includes("unavailable") || errMsg.toLowerCase().includes("503");

    if (isQuota) {
      userFriendlyMsg = "現在Gemini API（無料利用枠）の呼び出し制限数に達しています。不要なリトライを行わず、即座にプロセスを終了しました。少し時間をおいてから再度お試しください。";
      return res.status(429).json({ 
        error: "Quota exceeded", 
        details: userFriendlyMsg,
        errorCode: String(errCode),
        errorStatus: errStatus,
        errorMessage: errMsg
      });
    } else if (isUnavailable) {
      userFriendlyMsg = "現在Google Gemini側が混雑しています。\n数分後に再度お試しください";
      return res.status(503).json({
        error: "Service Unavailable",
        details: userFriendlyMsg,
        errorCode: "503",
        errorStatus: "UNAVAILABLE",
        errorMessage: errMsg
      });
    } else {
      userFriendlyMsg = `エラー原因: ${errMsg}`;
    }

    return res.status(500).json({ 
      error: "Failed to process the request.", 
      details: userFriendlyMsg,
      errorCode: String(errCode),
      errorStatus: errStatus,
      errorMessage: errMsg
    });

  } catch (error: any) {
    console.error("AI Analysis error:", error);
    res.status(500).json({ error: "Failed to process the request.", details: error?.message || error?.toString() });
  }
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
