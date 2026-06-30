import { Type, Schema } from "@google/genai";

export const responseSchema: Schema = {
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
    },
    thinkingBible: {
      type: Type.OBJECT,
      description: "【Build 010】ORIGIN Thinking Bible (Version 1.0) 思考順序標準化・11ステップパイプラインデータ。",
      properties: {
        version: { type: Type.STRING },
        mission: { type: Type.STRING },
        pipeline: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              step: { type: Type.STRING },
              status: { type: Type.STRING },
              outputLog: { type: Type.STRING },
              elements: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ["step", "status", "outputLog", "elements"]
          }
        },
        finalRule: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            isFollowed: { type: Type.BOOLEAN }
          },
          required: ["title", "description", "isFollowed"]
        }
      },
      required: ["version", "mission", "pipeline", "finalRule"]
    },
    experienceBible: {
      type: Type.OBJECT,
      description: "【Build 011】ORIGIN Experience Bible (Version 1.0) 利用者体験設計データ。",
      properties: {
        version: { type: Type.STRING },
        mission: { type: Type.STRING },
        timeline: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              phase: { type: Type.STRING },
              status: { type: Type.STRING },
              description: { type: Type.STRING },
              userFeeling: { type: Type.STRING }
            },
            required: ["phase", "status", "description", "userFeeling"]
          }
        },
        finalRule: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            isFollowed: { type: Type.BOOLEAN }
          },
          required: ["title", "description", "isFollowed"]
        }
      },
      required: ["version", "mission", "timeline", "finalRule"]
    },
    designSystem: {
      type: Type.OBJECT,
      description: "【Build 012】ORIGIN Design System (Version 1.0) 世界最高品質のUI/UXデータ。",
      properties: {
        version: { type: Type.STRING },
        mission: { type: Type.STRING },
        philosophy: { type: Type.ARRAY, items: { type: Type.STRING } },
        rules: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              category: { type: Type.STRING },
              description: { type: Type.STRING },
              details: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ["category", "description", "details"]
          }
        },
        finalRule: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            isFollowed: { type: Type.BOOLEAN }
          },
          required: ["title", "description", "isFollowed"]
        }
      },
      required: ["version", "mission", "philosophy", "rules", "finalRule"]
    },
    proactiveIntelligenceEngine: {
      type: Type.OBJECT,
      description: "【Build 011】ORIGIN Proactive Intelligence Engine (PIE)データ。",
      properties: {
        build: { type: Type.STRING },
        mission: { type: Type.STRING },
        triggers: { type: Type.ARRAY, items: { type: Type.STRING } },
        action: { type: Type.STRING },
        priority: { type: Type.STRING },
        notification: { type: Type.STRING },
        suggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
        finalRule: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            isFollowed: { type: Type.BOOLEAN }
          },
          required: ["title", "description", "isFollowed"]
        }
      },
      required: ["build", "mission", "triggers", "action", "priority", "notification", "suggestions", "finalRule"]
    },
    originBlueprint: {
      type: Type.OBJECT,
      description: "【Build 001】ORIGIN Blueprint 001 Home Screen Complete Specificationデータ。",
      properties: {
        id: { type: Type.STRING },
        name: { type: Type.STRING },
        mission: { type: Type.STRING },
        sections: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              details: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ["name", "details"]
          }
        },
        uiRule: { type: Type.ARRAY, items: { type: Type.STRING } },
        uxRule: { type: Type.ARRAY, items: { type: Type.STRING } },
        designRule: { type: Type.ARRAY, items: { type: Type.STRING } },
        finalRule: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            isFollowed: { type: Type.BOOLEAN }
          },
          required: ["title", "description", "isFollowed"]
        }
      },
      required: ["id", "name", "mission", "sections", "uiRule", "uxRule", "designRule", "finalRule"]
    },
    originCoreSpecification: {
      type: Type.OBJECT,
      description: "【Version 1.0】ORIGIN Core Specificationデータ。",
      properties: {
        version: { type: Type.STRING },
        mission: { type: Type.STRING },
        chapters: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              num: { type: Type.INTEGER },
              title: { type: Type.STRING },
              description: { type: Type.STRING }
            },
            required: ["num", "title", "description"]
          }
        },
        finalRule: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            isFollowed: { type: Type.BOOLEAN }
          },
          required: ["title", "description", "isFollowed"]
        }
      },
      required: ["version", "mission", "chapters", "finalRule"]
    },
    originSystemArchitectureBible: {
      type: Type.OBJECT,
      description: "【Version 1.0】ORIGIN System Architecture Bibleデータ。",
      properties: {
        version: { type: Type.STRING },
        mission: { type: Type.STRING },
        layers: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              components: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ["name", "components"]
          }
        },
        coreRule: { type: Type.STRING },
        finalRule: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            isFollowed: { type: Type.BOOLEAN }
          },
          required: ["title", "description", "isFollowed"]
        }
      },
      required: ["version", "mission", "layers", "coreRule", "finalRule"]
    },
    originMissionEngineSpec: {
      type: Type.OBJECT,
      description: "【Document 001】ORIGIN v1.0 Requirements Specification Mission Engineデータ。",
      properties: {
        documentId: { type: Type.STRING },
        title: { type: Type.STRING },
        purpose: { type: Type.STRING },
        inputs: { type: Type.ARRAY, items: { type: Type.STRING } },
        output: { type: Type.STRING },
        missionObject: { type: Type.ARRAY, items: { type: Type.STRING } },
        validation: { type: Type.STRING },
        successCondition: { type: Type.STRING },
        failureCondition: { type: Type.STRING },
        api: { type: Type.ARRAY, items: { type: Type.STRING } },
        performance: { type: Type.STRING },
        security: { type: Type.STRING },
        logging: { type: Type.STRING },
        finalRule: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            isFollowed: { type: Type.BOOLEAN }
          },
          required: ["title", "description", "isFollowed"]
        }
      },
      required: [
        "documentId", "title", "purpose", "inputs", "output", 
        "missionObject", "validation", "successCondition", 
        "failureCondition", "api", "performance", "security", 
        "logging", "finalRule"
      ]
    },
    originKernelSpec: {
      type: Type.OBJECT,
      description: "【Version 1.0】ORIGIN Kernel Specificationデータ。",
      properties: {
        version: { type: Type.STRING },
        mission: { type: Type.STRING },
        modules: { type: Type.ARRAY, items: { type: Type.STRING } },
        priority: { type: Type.ARRAY, items: { type: Type.STRING } },
        rule: { type: Type.STRING },
        state: { type: Type.ARRAY, items: { type: Type.STRING } },
        event: { type: Type.ARRAY, items: { type: Type.STRING } },
        principle: { type: Type.STRING }
      },
      required: ["version", "mission", "modules", "priority", "rule", "state", "event", "principle"]
    },
    originAiEvaluationFramework: {
      type: Type.OBJECT,
      description: "【ORIGIN Build】AI Evaluation Framework (OAEF) データ。",
      properties: {
        mission: { type: Type.STRING },
        categories: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              name: { type: Type.STRING },
              metrics: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ["id", "name", "metrics"]
          }
        },
        evaluatedModels: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              modelName: { type: Type.STRING },
              overallEvaluation: { type: Type.STRING },
              scores: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    categoryName: { type: Type.STRING },
                    scoreValue: { type: Type.INTEGER }
                  },
                  required: ["categoryName", "scoreValue"]
                }
              },
              missionSuccessRate: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    domain: { type: Type.STRING },
                    successRate: { type: Type.INTEGER }
                  },
                  required: ["domain", "successRate"]
                }
              },
              advantage: { type: Type.STRING }
            },
            required: ["modelName", "overallEvaluation", "scores", "missionSuccessRate", "advantage"]
          }
        },
        updates: {
          type: Type.OBJECT,
          properties: {
            daily: { type: Type.STRING },
            weekly: { type: Type.STRING },
            monthly: { type: Type.STRING }
          },
          required: ["daily", "weekly", "monthly"]
        },
        finalRule: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            isFollowed: { type: Type.BOOLEAN }
          },
          required: ["title", "description", "isFollowed"]
        }
      },
      required: ["mission", "categories", "evaluatedModels", "updates", "finalRule"]
    },
    originMissionSuccessEngineSpec: {
      type: Type.OBJECT,
      description: "【ORIGIN Build】Mission Success Engine (MSE) データ。",
      properties: {
        mission: { type: Type.STRING },
        steps: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              number: { type: Type.INTEGER },
              title: { type: Type.STRING },
              description: { type: Type.STRING },
              status: { type: Type.STRING }
            },
            required: ["number", "title", "description", "status"]
          }
        },
        postMission: {
          type: Type.OBJECT,
          properties: {
            successRate: { type: Type.INTEGER },
            improvements: { type: Type.ARRAY, items: { type: Type.STRING } },
            reusableKnowledge: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["successRate", "improvements", "reusableKnowledge"]
        },
        finalRule: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            isFollowed: { type: Type.BOOLEAN }
          },
          required: ["title", "description", "isFollowed"]
        }
      },
      required: ["mission", "steps", "postMission", "finalRule"]
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
    "qualityBible",
    "thinkingBible",
    "experienceBible",
    "designSystem",
    "proactiveIntelligenceEngine",
    "originBlueprint",
    "originCoreSpecification",
    "originSystemArchitectureBible",
    "originMissionEngineSpec",
    "originKernelSpec",
    "originAiEvaluationFramework",
    "originMissionSuccessEngineSpec"
  ]
};
