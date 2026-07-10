import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Users, Shield, ShieldCheck, Cpu, Zap, Activity, BarChart3, Database, 
  Code, RefreshCw, Play, Search, Sparkles, BookOpen, FileText, ArrowRight, 
  CheckCircle2, AlertCircle, Plus, Terminal, Settings, Settings2, 
  GitBranch, Network, MessageSquare, ThumbsUp, ThumbsDown, ClipboardCheck, Scale, 
  Compass, Globe, Award, Layers, AlertTriangle, Eye, HelpCircle, Server, 
  Check, ArrowUpRight, TrendingUp, DollarSign, Clock, ShieldAlert, FileCheck, Brain, Lock,
  Lightbulb, ArrowDown, Trash2
} from "lucide-react";
import ValidationSuite from "./ValidationSuite";

// ==================== TYPES & PRESETS ====================

interface QualityPrediction {
  expectedQuality: number;
  riskLevel: "Low" | "Medium" | "High";
  riskDetails: string;
  missingGaps: string[];
  recommendedReviews: number;
}

interface SelfReflection {
  achievementRate: number;
  qualityScore: number;
  factRate: number;
  timeSpentMs: number;
  costIncurred: number;
  uxRating: number;
  improvements: string[];
}

interface EvolutionLog {
  id: string;
  timestamp: string;
  missionName: string;
  runIndex: number;
  qualityBefore: number;
  qualityAfter: number;
  appliedRefinement: string;
}

interface KnowledgeItem {
  id: string;
  category: "Memory" | "Knowledge" | "RAG";
  content: string;
  source: string;
  status: "Clean" | "Stale" | "Duplicate" | "Contradictory";
  anomalyDetails?: string;
}

interface BenchmarkComparison {
  brand: string;
  planning: number;
  coding: number;
  factCheck: number;
  costEfficiency: number;
  uiConsistency: number;
  actionItem: string;
}

interface ImprovementProposal {
  id: string;
  title: string;
  description: string;
  category: "Core OS" | "Multi-Agent" | "Cognition" | "Cost-Saving";
  impact: string;
  status: "Evaluating" | "In Training" | "Approved" | "Proposed";
  votes: number;
}

interface UserPattern {
  id: string;
  name: string;
  type: "short_creative" | "long_analytical" | "image_centered" | "hybrid";
  queryLength: "Short" | "Long";
  focus: "Text" | "Image" | "Code" | "Analysis";
  optimizedUI: string;
  optimizedWorkflow: string;
  selectedModels: string[];
}

export interface OutcomeItem {
  category: string;
  description: string;
  riskLevel: "Low" | "Medium" | "High";
}

export interface RiskItem {
  description: string;
  impact: string;
  severity: "Low" | "Medium" | "High";
}

export interface RecommendationItem {
  title: string;
  type: string;
  description: string;
  benefit: string;
}

export interface OutcomeMission {
  id: string;
  missionName: string;
  ultimateGoal: string;
  currentStage: string;
  successRate: number;
  achievementRate: number;
  missingRate: number;
  factRate: number;
  confidence: number;
  missingItems: OutcomeItem[];
  risks: RiskItem[];
  recommendations: RecommendationItem[];
  predictedOutcomes: string[];
  nextActions: string[];
  isLocked: boolean;
}

// ==================== INTELLIGENCE BRAIN TYPES (Sprint 19) ====================
export interface BrainMission {
  id: string;
  input: string;
  timestamp: string;
  understanding: {
    categories: string[]; // 質問, 調査, 分析, 企画, 設計, 開発, 相談, 比較, 判断, 創作
    rationale: string;
  };
  complexity: {
    difficulty: "Easy" | "Medium" | "Hard" | "Extreme";
    agentsRequired: number;
    aiCount: number;
    predictedTimeMinutes: number;
    factImportance: "Low" | "Medium" | "High" | "Critical";
  };
  plan: {
    step: string;
    status: "pending" | "active" | "completed";
    description: string;
  }[];
  aiSelection: {
    provider: string;
    model: string;
    quality: number;
    speed: number;
    cost: number;
    strength: string;
    selected: boolean;
    rationale: string;
  }[];
  agents: {
    name: string;
    role: string;
    status: "active" | "idle" | "forbidden";
    reason: string;
  }[];
  knowledgeStrategy: {
    sources: string[]; // Memory, Knowledge, RAG, Web, Local, 社内DB
    description: string;
  };
  thinkingStrategy: {
    mode: "論理思考" | "発散思考" | "収束思考" | "批判思考" | "仮説思考" | "意思決定思考" | "比較思考" | "逆算思考";
    description: string;
  };
  selfOptimization: {
    evaluated: boolean;
    rating: number; // 1-5
    pros: string;
    cons: string;
    nextImprovement: string;
  };
}

// ==================== TRUST OS TYPES (Sprint 20) ====================
export interface TrustMission {
  id: string;
  input: string;
  timestamp: string;
  risk: {
    level: "Low" | "Medium" | "High" | "Critical";
    reason: string;
  };
  simulation: {
    successRate: number;
    riskScore: number;
    predictedTimeMs: number;
    predictedCost: number;
    predictedQuality: number;
  };
  explanation: {
    usedAI: string;
    usedAgent: string;
    usedMemory: string;
    usedKnowledge: string;
    usedWeb: string;
    rationale: string;
    factScore: number;
    confidenceScore: number;
  };
  approval: {
    required: boolean;
    type: "mail" | "file_deletion" | "contract" | "payment" | "publish" | "workflow" | "plugin" | "none";
    status: "Pending" | "Approved" | "Rejected";
    approvedAt?: string;
    operator?: string;
  };
  rollback: {
    versions: {
      version: number;
      timestamp: string;
      diff: string;
      content: string;
    }[];
    currentVersion: number;
  };
  auditTrail: {
    who: string;
    when: string;
    what: string;
    why: string;
    aiJudgement: string;
  }[];
}

export default function UniversalAgentFramework() {
  const [activeTab, setActiveTab] = useState<"validation-suite" | "trust-dashboard" | "brain-dashboard" | "outcome-dashboard" | "goal-success" | "orchestrator" | "user-pattern" | "knowledge" | "evolution" | "proposals">("trust-dashboard");

  // ==================== INTELLIGENCE BRAIN STATE (Sprint 19) ====================
  const [brainMissions, setBrainMissions] = useState<BrainMission[]>([
    {
      id: "brain-1",
      input: "UKのFCAと日本の金融庁(FSA)における高頻度取引(HFT)の規制対応・リスクマネジメント方針の比較分析レポートを作って。特に法的なアドヒージョン契約やSLA、実運用におけるレイテンシー制約を含めた意思決定プロセスを定義してほしい。",
      timestamp: "2026-07-10 11:45",
      understanding: {
        categories: ["調査", "分析", "比較", "判断"],
        rationale: "UK FCA / JP FSA の規制文書という外部知識の『調査』、その差分を浮き彫りにする『比較』『分析』、および具体的な実運用プロセスを『判断』・決定することが求められているため。"
      },
      complexity: {
        difficulty: "Extreme",
        agentsRequired: 4,
        aiCount: 3,
        predictedTimeMinutes: 45,
        factImportance: "Critical"
      },
      plan: [
        { step: "Research / 規制調査", status: "completed", description: "FCA guidelines Chapter 5 & FSA Ordinance on Financial Instruments Business Article 126 scraping." },
        { step: "Fact Check / 事実検証", status: "completed", description: "Cross-reference statutory adhesion clauses under Japanese Civil Code Article 548-2." },
        { step: "Gap Analysis / 差分抽出", status: "completed", description: "Identify core compliance gaps (e.g. market maker notification durations)." },
        { step: "Legal Guard / 法的整合性監査", status: "completed", description: "Verify compliance liability caps against local financial court precedents." },
        { step: "Review / 専門家査読", status: "completed", description: "Evaluate draft quality on compliance and factual trust score." },
        { step: "Deliver / 意思決定レポート完成", status: "completed", description: "Generate structured, action-oriented PDF compliance brief for executives." }
      ],
      aiSelection: [
        { provider: "Gemini", model: "Gemini 2.5 Pro", quality: 98, speed: 85, cost: 80, strength: "Complex context retrieval, reasoning, and standard financial ordinance extraction", selected: true, rationale: "Has highest context limit & native search grounding to scrape Japanese E-Gov database." },
        { provider: "Claude", model: "Claude 3.5 Sonnet", quality: 96, speed: 90, cost: 75, strength: "Logical compliance flow design and code block structural mapping", selected: true, rationale: "Selected for high-density document writing and precise policy drafting." },
        { provider: "GPT", model: "GPT-4o", quality: 94, speed: 92, cost: 70, strength: "General summarization and user intent refinement", selected: false, rationale: "Not selected as Pro models offer superior multi-lingual legal reasoning." }
      ],
      agents: [
        { name: "ComplianceAuditorAgent", role: "UK & JP Legal Ordinance Auditor", status: "active", reason: "Direct match to audit FCA and FSA strict regulation guidelines." },
        { name: "FinancialGapAnalyzer", role: "Market Microstructure Comparer", status: "active", reason: "Needed to parse high-frequency tick latency constraints and match them to regulatory boundaries." },
        { name: "ConsensusCritic", role: "Hallucination Risk Scrutinizer", status: "active", reason: "Assures factuality metrics stay at 100% since legal advice is Critical-risk." },
        { name: "CodeSynthesizerAgent", role: "System Implementation Coder", status: "forbidden", reason: "De-activated because no active programming or API coding is required for policy analysis." }
      ],
      knowledgeStrategy: {
        sources: ["Web", "RAG", "Knowledge"],
        description: "Scrape Japanese FSA and UK FCA websites via live Web search; retrieve cached adhesion standard legal templates from local RAG memory banks."
      },
      thinkingStrategy: {
        mode: "比較思考",
        description: "JP vs UK の規制方針を対照的なパラメータマトリックスに落とし込み、二律背反（トレードオフ）を論理的に整理するための『比較思考』と『批判思考』をハイブリッド適用。"
      },
      selfOptimization: {
        evaluated: true,
        rating: 5,
        pros: "FSA Article 126 and Civil Code 548-2 clauses were integrated with high citation confidence. Selected Claude and Gemini combination perfectly balanced speed and quality.",
        cons: "Initial UK FCA scraping suffered from a minor DNS timeout which delayed planning by 14 seconds.",
        nextImprovement: "Pre-warm speculative DNS routes for foreign regulators to guarantee <50ms compliance caching."
      }
    },
    {
      id: "brain-2",
      input: "1秒間に1万リクエスト(10,000 rps)を安全かつ低遅延で処理できる、Redisのカスタム接続キューを用いたExpressバックエンド用のデータ配信マイクロサービスを設計・実装して。",
      timestamp: "2026-07-10 11:48",
      understanding: {
        categories: ["設計", "開発", "分析"],
        rationale: "高負荷に耐えうるミドルウェア構成の『設計』と、実際のExpress・Redis接続コードブロックの『開発』、およびボトルネック検出の『分析』が必要なため。"
      },
      complexity: {
        difficulty: "Hard",
        agentsRequired: 2,
        aiCount: 2,
        predictedTimeMinutes: 20,
        factImportance: "High"
      },
      plan: [
        { step: "Architecture Design / 構造設計", status: "completed", description: "Design non-blocking cluster connection pool & Redis pipeline scripts." },
        { step: "Implementation / 実装", status: "completed", description: "Write high-performance server.ts with Node clustering and fast serialization." },
        { step: "Stress Simulation / 高負荷検証", status: "completed", description: "Simulate 10k RPS stream inputs and audit event-loop blockages." },
        { step: "Deliver / 最適コード出力", status: "completed", description: "Present fully validated implementation file with custom benchmarking script." }
      ],
      aiSelection: [
        { provider: "Claude", model: "Claude 3.5 Sonnet", quality: 99, speed: 88, cost: 75, strength: "Precise TypeScript backend design, system level memory efficiency analysis", selected: true, rationale: "Selected for unmatched code generation speed and correct cluster socket management." },
        { provider: "Gemini", model: "Gemini 2.5 Flash", quality: 88, speed: 98, cost: 95, strength: "Ultra-fast syntax check and continuous automated testing pipeline runs", selected: true, rationale: "Selected as a speed-optimized helper to verify event loop compliance live." }
      ],
      agents: [
        { name: "CodeSynthesizerAgent", role: "Systems & Network Programmer", status: "active", reason: "Directly implements standard clustering logic and low-latency Redis pipelining." },
        { name: "DatabaseOptimizerAgent", role: "Redis Cluster & Connection Tuner", status: "active", reason: "Deploys non-blocking buffer structures to guarantee 10k RPS target." },
        { name: "ComplianceAuditorAgent", role: "Legal & Regulatory Policy Matcher", status: "forbidden", reason: "Strictly banned to save latency and token billing, as this is a pure technical throughput task." }
      ],
      knowledgeStrategy: {
        sources: ["Memory", "Local"],
        description: "Fetch cached Redis client connection pool optimizations from memory; read system limits of the cloud run target environment directly."
      },
      thinkingStrategy: {
        mode: "逆算思考",
        description: "目標値である『10,000 rps』から逆算し、逆コンパイルして許容される1リクエストあたりのCPU割当（0.1ms以下）を割り出し、それを満たすソケット結合を組み立てる『逆算思考』を採用。"
      },
      selfOptimization: {
        evaluated: false,
        rating: 0,
        pros: "",
        cons: "",
        nextImprovement: ""
      }
    }
  ]);

  const [selectedBrainIdx, setSelectedBrainIdx] = useState<number>(0);
  const activeBrain = brainMissions[selectedBrainIdx];

  const [brainViewMode, setBrainViewMode] = useState<"easy" | "detail" | "developer">("easy");
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingStep, setThinkingStep] = useState(0);
  const [customMissionInput, setCustomMissionInput] = useState("");

  // Self optimization rating states
  const [userRating, setUserRating] = useState<number>(5);
  const [userPros, setUserPros] = useState("");
  const [userCons, setUserCons] = useState("");
  const [userNextImprovement, setUserNextImprovement] = useState("");

  // ==================== TRUST OS STATE (Sprint 20) ====================
  const [securityMode, setSecurityMode] = useState<"Safe Mode" | "Business Mode" | "Family Mode" | "Developer Mode">("Safe Mode");
  const [selectedTrustIdx, setSelectedTrustIdx] = useState<number>(0);
  const [customTrustInput, setCustomTrustInput] = useState("");
  const [isSimulatingTrust, setIsSimulatingTrust] = useState(false);
  const [trustSimulatingStep, setTrustSimulatingStep] = useState(0);

  const [trustMissions, setTrustMissions] = useState<TrustMission[]>([
    {
      id: "trust-1",
      input: "UK FCA規制に対応するため、未承認取引データをデータベースから完全削除し、全コンプライアンス担当者へ自動メール通知して。",
      timestamp: "2026-07-10 11:58",
      risk: {
        level: "Critical",
        reason: "データベースのデータ完全削除操作(不可逆)および、社外/規制当局の関係者に対する自動メール送信は極めて大きなリスクを伴います。"
      },
      simulation: {
        successRate: 98.4,
        riskScore: 85,
        predictedTimeMs: 4500,
        predictedCost: 0.08,
        predictedQuality: 99.2
      },
      explanation: {
        usedAI: "Gemini 2.5 Pro & Claude 3.5 Sonnet",
        usedAgent: "DatabasePurgeAgent, ComplianceAuditorAgent, MailNotificationAgent",
        usedMemory: "Compliance Ledger Cache V12",
        usedKnowledge: "FCA COBS Ordinance Section 12, FSA Ordinance 126",
        usedWeb: "Japanese FSA Database Scraper & UK FCA Official Portal Search",
        rationale: "データベース削除は不可逆であり、不適切な条件でのクエリ実行を避けるため厳格な検証が必要です。また、自動メール送信は社会的信用に関わるため、人手による文面プレビューと署名確認のプロセスを挟みます。",
        factScore: 100,
        confidenceScore: 98
      },
      approval: {
        required: true,
        type: "file_deletion",
        status: "Pending"
      },
      rollback: {
        versions: [
          {
            version: 2,
            timestamp: "2026-07-10 11:58",
            diff: "@@ -1,3 +1,6 @@\n- const deleteData = () => { db.query('DELETE FROM trades'); }\n+ const deleteData = async () => {\n+   // Sprint 20 Secured: Check Transactional Lock & Human Signature\n+   if (!hasHumanApproval) throw new Error('Unauthorized DB Purge!');\n+   await db.transaction(t => t.query('DELETE FROM trades WHERE verified = false'));\n+ }",
            content: "const deleteData = async () => {\n  if (!hasHumanApproval) throw new Error('Unauthorized DB Purge!');\n  await db.transaction(t => t.query('DELETE FROM trades WHERE verified = false'));\n}"
          },
          {
            version: 1,
            timestamp: "2026-07-10 11:50",
            diff: "@@ -1,3 +1,3 @@\n- // Initial Draft\n- const deleteData = () => { db.query('DELETE FROM trades'); }",
            content: "const deleteData = () => { db.query('DELETE FROM trades'); }"
          }
        ],
        currentVersion: 2
      },
      auditTrail: [
        {
          who: "nori72ny@gmail.com",
          when: "2026-07-10 11:50",
          what: "データベース削除のドライラン検証実行",
          why: "対象レコード件数が規制に合致しているか確認するため",
          aiJudgement: "検証完了。不一致データは0件。データベース削除は安全と評価。"
        }
      ]
    },
    {
      id: "trust-2",
      input: "最新のシステム運用SLA契約書をPDFとして自動生成し、パブリックCloud Storageへ一般公開アップロードして。",
      timestamp: "2026-07-10 11:45",
      risk: {
        level: "High",
        reason: "社外に対する重要機密であるSLA契約の自動生成と、不特定多数に公開されるPublic Cloud Storageへのアップロードが含まれています。"
      },
      simulation: {
        successRate: 99.1,
        riskScore: 45,
        predictedTimeMs: 3200,
        predictedCost: 0.04,
        predictedQuality: 97.8
      },
      explanation: {
        usedAI: "Claude 3.5 Sonnet",
        usedAgent: "ContractGeneratorAgent, StoragePublishAgent",
        usedMemory: "Corporate Template Library V4",
        usedKnowledge: "B2B Service Level Agreement Standards",
        usedWeb: "None (Sufficient internal templates)",
        rationale: "契約書は法的義務を生じるため、規約違反や免責不履行がないか人間承認(契約書生成)を経ます。パブリック公開は意図しないデータ漏洩を防ぐため、宛先検証と承認(公開)を必須とします。",
        factScore: 99.5,
        confidenceScore: 96
      },
      approval: {
        required: true,
        type: "contract",
        status: "Approved",
        approvedAt: "2026-07-10 11:52",
        operator: "nori72ny@gmail.com"
      },
      rollback: {
        versions: [
          {
            version: 1,
            timestamp: "2026-07-10 11:45",
            diff: "@@ -1,2 +1,2 @@\n- const documentStatus = 'draft';\n+ const documentStatus = 'published_after_approval';",
            content: "const documentStatus = 'published_after_approval';"
          }
        ],
        currentVersion: 1
      },
      auditTrail: [
        {
          who: "nori72ny@gmail.com",
          when: "2026-07-10 11:52",
          what: "SLA契約書PDF公開の人間承認を適用",
          why: "全項目に対する法的ダブルチェックが完了したため",
          aiJudgement: "人間承認を確認。公開処理を完了しました。"
        }
      ]
    },
    {
      id: "trust-3",
      input: "今日のAPIエラーレート情報をSlackに通知して、開発者のメンションを飛ばすワークフローをキックして。",
      timestamp: "2026-07-10 11:20",
      risk: {
        level: "Medium",
        reason: "外部システム(Slack)との連携およびワークフローキックが含まれます。"
      },
      simulation: {
        successRate: 99.8,
        riskScore: 15,
        predictedTimeMs: 1500,
        predictedCost: 0.01,
        predictedQuality: 98.5
      },
      explanation: {
        usedAI: "Gemini 2.5 Flash",
        usedAgent: "SlackBotAgent",
        usedMemory: "Developer Slack Webhook Config",
        usedKnowledge: "Standard Error Severity Chart",
        usedWeb: "None",
        rationale: "ワークフロー実行は内部通知のみであるためMedium Risk。ただ、メンション送信を安全に行うため、Webhook of Slackの動作検証を挟みます。",
        factScore: 99.9,
        confidenceScore: 99
      },
      approval: {
        required: true,
        type: "workflow",
        status: "Approved",
        approvedAt: "2026-07-10 11:22",
        operator: "nori72ny@gmail.com"
      },
      rollback: {
        versions: [
          {
            version: 1,
            timestamp: "2026-07-10 11:20",
            diff: "No changes recorded.",
            content: "No code changes."
          }
        ],
        currentVersion: 1
      },
      auditTrail: [
        {
          who: "nori72ny@gmail.com",
          when: "2026-07-10 11:22",
          what: "Slackワークフロー実行を承認",
          why: "開発者グループへの緊急通知をトリガーするため",
          aiJudgement: "人間承認を取得。ワークフローを即時実行しました。"
        }
      ]
    }
  ]);

  const activeTrustMission = trustMissions[selectedTrustIdx] || trustMissions[0];

  // ==================== OUTCOME INTELLIGENCE STATE (Sprint 18) ====================
  const [outcomeMissions, setOutcomeMissions] = useState<OutcomeMission[]>([
    {
      id: "out-1",
      missionName: "Administrative Enterprise RFP",
      ultimateGoal: "契約率向上 (Increase enterprise conversion rate by 35%)",
      currentStage: "Reviewing core SLA policies & comparative tier parameters",
      successRate: 74,
      achievementRate: 80,
      missingRate: 20,
      factRate: 92,
      confidence: 85,
      missingItems: [
        { category: "Explanation/説明不足", description: "SLA service uptime guarantees & penalty caps are vague.", riskLevel: "High" },
        { category: "Data/データ不足", description: "Missing historical server incident reports on Cloud Run containers.", riskLevel: "Medium" },
        { category: "Figures/図不足", description: "No clear architecture diagram representing secure Express proxying.", riskLevel: "Medium" },
        { category: "Comparison/比較不足", description: "No competitive breakdown against OpenAI pricing tier matrices.", riskLevel: "High" },
        { category: "Legal/法的注意", description: "Adhesion contract clauses under Japanese Civil Code Article 548-2 omitted.", riskLevel: "High" }
      ],
      risks: [
        { description: "High risk of client procurement department rejecting initial setup cost.", impact: "High barrier of entry", severity: "High" },
        { description: "Compliance audit failure due to data retention rules in European jurisdictions.", impact: "Regulatory risk", severity: "Medium" }
      ],
      recommendations: [
        { title: "Zero Upfront commitment", type: "Low Cost", description: "Waive upfront installation fees in exchange for a 12-month commitment clause.", benefit: "Boosts conversion probability by up to 45% based on Linear's onboarding patterns." },
        { title: "Continuous Warm Sandbox", type: "High Quality", description: "Pre-warm a live containerized demonstration pre-loaded with customer database schema.", benefit: "Reduces client decision latency and establishes absolute technical trust." },
        { title: "Standardized Adhesion Terms", type: "Legal Safety", description: "Adopt default template clauses approved by Ministry E-Gov database.", benefit: "Eliminates legal review delays by 3 business days." }
      ],
      predictedOutcomes: [
        "Expected contract approval within 14 business days if SLA liability cap is set to 100% of trailing fees.",
        "30% probability of negotiation stall if European GDPR data sovereignty clauses are not added."
      ],
      nextActions: [
        "Append official SLA limit of liability section to the contract draft.",
        "Re-route cost estimation analysis to Gemini 2.5 Flash to generate low-cost plan matrices.",
        "Complete automated legal compliance review under statutory civil templates."
      ],
      isLocked: true // High risks/missingness -> locked!
    },
    {
      id: "out-2",
      missionName: "ACOS Core Evolution Launch",
      ultimateGoal: "実運用できる (Practical operation is active & stable under enterprise swarms)",
      currentStage: "Final regression verification & sandbox check on Node.js container",
      successRate: 95,
      achievementRate: 98,
      missingRate: 4,
      factRate: 99,
      confidence: 97,
      missingItems: [
        { category: "Recovery/説明不足", description: "Disaster recovery failover plan during live database node restart is slightly brief.", riskLevel: "Low" }
      ],
      risks: [
        { description: "Slight cold-start delay during initial multi-agent swarm parallel startup.", impact: "Latency spikes", severity: "Low" }
      ],
      recommendations: [
        { title: "Pre-warm Swarm Threads", type: "Short Term / High Quality", description: "Warm up speculative background processes when cursor hovers over action panel.", benefit: "Reduces initial latency from 1.5s to less than 15ms." }
      ],
      predictedOutcomes: [
        "Uptime will stay strictly above 99.99% under production load profiles.",
        "Zero token billing leaks guaranteed by Core Cost Routing controller."
      ],
      nextActions: [
        "Validate schema alignment in production with live database checks.",
        "Approve and trigger automated production deployment script."
      ],
      isLocked: false // Clean, high metrics -> permit submission!
    }
  ]);

  const [selectedOutcomeIdx, setSelectedOutcomeIdx] = useState<number>(0);
  const activeOutcome = outcomeMissions[selectedOutcomeIdx];

  // Inputs for creating a new outcome mission
  const [newMissionName, setNewMissionName] = useState("");
  const [newMissionGoal, setNewMissionGoal] = useState("");
  const [newMissionStage, setNewMissionStage] = useState("");
  const [showAddOutcomeModal, setShowAddOutcomeModal] = useState(false);

  // Success message after submission
  const [submissionSuccessMessage, setSubmissionSuccessMessage] = useState<string | null>(null);

  // Custom addition states for missing items & recommendations
  const [newMissingDesc, setNewMissingDesc] = useState("");
  const [newMissingCategory, setNewMissingCategory] = useState("Explanation/説明不足");
  const [newMissingRisk, setNewMissingRisk] = useState<"Low" | "Medium" | "High">("Medium");

  const [newRecTitle, setNewRecTitle] = useState("");
  const [newRecType, setNewRecType] = useState("Low Cost");
  const [newRecDesc, setNewRecDesc] = useState("");
  const [newRecBenefit, setNewRecBenefit] = useState("");

  // ==================== STATE MANAGEMENT ====================
  const [customGoal, setCustomGoal] = useState("");
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationPhase, setSimulationPhase] = useState<"idle" | "predicting" | "planning" | "executing" | "reflecting" | "completed">("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [currentRunIndex, setCurrentRunIndex] = useState(100);
  const [autoApplyImprovements, setAutoApplyImprovements] = useState(true);

  // 1. Prediction State (⑤)
  const [prediction, setPrediction] = useState<QualityPrediction | null>(null);

  // 2. Dynamic Workflow State (④)
  const [workflowNodes, setWorkflowNodes] = useState<{ id: string; label: string; agent: string; status: "idle" | "active" | "completed" }[]>([]);

  // 3. Self Reflection State (①)
  const [reflection, setReflection] = useState<SelfReflection | null>(null);

  // 4. Self Evolution State (②)
  const [evolutionLogs, setEvolutionLogs] = useState<EvolutionLog[]>([
    {
      id: "ev-1",
      timestamp: "2026-07-09 18:24",
      missionName: "Firestore Web App & Live Logs",
      runIndex: 99,
      qualityBefore: 91.2,
      qualityAfter: 94.5,
      appliedRefinement: "Optimized multi-tenant nested collection security path rules in verification step."
    },
    {
      id: "ev-2",
      timestamp: "2026-07-10 01:10",
      missionName: "AI Liability & Compliance Contract",
      runIndex: 99,
      qualityBefore: 89.8,
      qualityAfter: 93.6,
      appliedRefinement: "Added Japanese Civil Code adhesion clauses automatically in final generation phase."
    }
  ]);

  // 5. User Pattern Engine State (③)
  const [userPatterns, setUserPatterns] = useState<UserPattern[]>([
    {
      id: "pat-1",
      name: "Nori-san (System Administrator)",
      type: "long_analytical",
      queryLength: "Long",
      focus: "Analysis",
      optimizedUI: "High-density technical grid dashboard with detailed logs telemetry, mono fonts",
      optimizedWorkflow: "Deep consensus routing (5 review cycles, strict grounding check)",
      selectedModels: ["Claude 3.5 Sonnet", "Gemini 2.5 Pro"]
    },
    {
      id: "pat-2",
      name: "Creative Marketing Manager",
      type: "short_creative",
      queryLength: "Short",
      focus: "Text",
      optimizedUI: "Spacious, warm card layouts with smooth motion transitions, editorial serif display",
      optimizedWorkflow: "Fast collaborative drafting (1 review cycle, creative layout testing)",
      selectedModels: ["Gemini 2.5 Flash", "GPT-4o"]
    },
    {
      id: "pat-3",
      name: "Autonomous Agent Bot (Mock Run)",
      type: "image_centered",
      queryLength: "Short",
      focus: "Image",
      optimizedUI: "Wide-stage visual canvas with image metadata metrics & referrer-policy check overlays",
      optimizedWorkflow: "Dual-modal generation with visual layout checker agent",
      selectedModels: ["Gemini 2.5 Pro", "Claude 3.5 Sonnet"]
    }
  ]);
  const [activePatternId, setActivePatternId] = useState<string>("pat-1");

  // Custom User Style Input Classifier
  const [customUserText, setCustomUserText] = useState("");
  const [detectedPatternDetails, setDetectedPatternDetails] = useState<string | null>(null);

  // 6. Knowledge Intelligence State (⑦)
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeItem[]>([
    {
      id: "kn-1",
      category: "Memory",
      content: "Express server port must bind strictly to port 3000.",
      source: "App System Constraints",
      status: "Clean"
    },
    {
      id: "kn-2",
      category: "Memory",
      content: "Express server port must bind to port 3001.",
      source: "Legacy Import Config",
      status: "Contradictory",
      anomalyDetails: "Contradicts constraint to bind strictly to port 3000."
    },
    {
      id: "kn-3",
      category: "Knowledge",
      content: "Use React Router v6 for layout templates.",
      source: "User Preference Log Q1",
      status: "Duplicate",
      anomalyDetails: "Duplicate entries exist in local RAG chunks."
    },
    {
      id: "kn-4",
      category: "RAG",
      content: "Firestore rules should permit unrestricted reads for public debugging.",
      source: "2024 Sandbox Tutorial",
      status: "Stale",
      anomalyDetails: "Deprecated and insecure in Sprint 16 guidelines."
    },
    {
      id: "kn-5",
      category: "Knowledge",
      content: "Do not expose any secret API keys to the browser iframe.",
      source: "Environment Security Guidelines",
      status: "Clean"
    }
  ]);

  // 7. Benchmark State (⑨)
  const [benchmarks, setBenchmarks] = useState<BenchmarkComparison[]>([
    { brand: "ACOS Core OS", planning: 96, coding: 95, factCheck: 98, costEfficiency: 94, uiConsistency: 96, actionItem: "Next Evolution: Live speculative multithreading (Proposed)" },
    { brand: "Apple OS Style", planning: 85, coding: 80, factCheck: 88, costEfficiency: 60, uiConsistency: 98, actionItem: "Adopt fluid contextual spatial animations (Sprint 16 UI)" },
    { brand: "Google Workspace", planning: 90, coding: 88, factCheck: 95, costEfficiency: 82, uiConsistency: 85, actionItem: "Enhance deep collaborative token permission sync" },
    { brand: "OpenAI GPTs", planning: 94, coding: 92, factCheck: 90, costEfficiency: 75, uiConsistency: 70, actionItem: "Integrate automatic self-reflection validation loops" },
    { brand: "Anthropic Projects", planning: 92, coding: 94, factCheck: 94, costEfficiency: 78, uiConsistency: 75, actionItem: "Integrate automatic memory pruning of duplicate facts" },
    { brand: "Linear / Notion", planning: 88, coding: 85, factCheck: 80, costEfficiency: 85, uiConsistency: 95, actionItem: "Refine high-density keyboard-centric command palette" }
  ]);

  // 8. Proposals State (⑩)
  const [proposals, setProposals] = useState<ImprovementProposal[]>([
    {
      id: "prop-1",
      title: "Self-Pruning RAG Pipeline",
      description: "Automatically index historical consensus solutions and delete stale, duplicative, or contradictory configuration memory cards.",
      category: "Cognition",
      impact: "Reduces hallucination rate by 32%, saves 15% token overhead",
      status: "In Training",
      votes: 142
    },
    {
      id: "prop-2",
      title: "Speculative Compilation Worker",
      description: "AI model pre-compiles potential layout structures in background while the user is typing, offering instant visual feedback on keypress.",
      category: "Multi-Agent",
      impact: "Reduces perceived interface response latency to sub-20ms",
      status: "Evaluating",
      votes: 98
    },
    {
      id: "prop-3",
      title: "Cost-Constrained Route Shaving",
      description: "Splits prompts dynamically: routes syntactic checks to Gemini 2.5 Flash, complex structural planning to Gemini 2.5 Pro, and security to Claude 3.5 Sonnet.",
      category: "Cost-Saving",
      impact: "Reduces total API bill by 45% while preserving quality metrics",
      status: "Approved",
      votes: 210
    },
    {
      id: "prop-4",
      title: "Neuro-Aesthetic Sizer Engine",
      description: "Adapts spacing, density, and contrast based on user gaze indicators or scrolling speeds to reduce visual fatigue on long sessions.",
      category: "Core OS",
      impact: "Increases overall user accessibility and prolonged coding comfort",
      status: "Proposed",
      votes: 45
    }
  ]);

  // Selected Preset Index
  const [selectedPresetIdx, setSelectedPresetIdx] = useState<number>(0);

  const presets = useMemo(() => [
    {
      id: "preset-firestore",
      name: "Firestore Web App & Live Logs",
      shortReq: "I need a dashboard with live user logs and Firestore syncing.",
      predictedQuality: 94.8,
      riskLevel: "Medium" as const,
      riskDetails: "Client-side key exposure warning; needs strict Express backend API proxy configuration.",
      gaps: [
        "Unspecified Firestore indexing guidelines for heavy logs partition.",
        "Unspecified session archival duration."
      ],
      recommendedReviews: 3,
      dynamicWorkflow: [
        { id: "wf-1", label: "Spec & Index Planner", agent: "Strategic Planner Pro" },
        { id: "wf-2", label: "Express API Generator", agent: "Codex Super Agent" },
        { id: "wf-3", label: "Security & Rules Auditing", agent: "Consensus Critic" },
        { id: "wf-4", label: "Grounding Validation", agent: "Deep Knowledge Investigator" }
      ],
      mockReflection: {
        achievementRate: 98,
        qualityScore: 96,
        factRate: 99.2,
        timeSpentMs: 1420,
        costIncurred: 0.015,
        uxRating: 95,
        improvements: [
          "Dynamic nested query path optimization applied",
          "Automated index-definition generation injected for faster deploy"
        ]
      }
    },
    {
      id: "preset-contract",
      name: "AI Liability & Compliance Contract",
      shortReq: "Create a liability release contract for autonomous AI actions.",
      predictedQuality: 96.2,
      riskLevel: "High" as const,
      riskDetails: "High compliance liability; must comply with Japanese Standard Terms (Article 548-2) and EU AI Act.",
      gaps: [
        "Unspecified dispute resolution jurisdiction.",
        "Undefined maximum financial liability cap (e.g., trailing fee limit)."
      ],
      recommendedReviews: 5,
      dynamicWorkflow: [
        { id: "wf-1", label: "Statutory Auditor", agent: "Deep Knowledge Investigator" },
        { id: "wf-2", label: "Clause Generator", agent: "Omni Creative Synthesizer" },
        { id: "wf-3", label: "Linguistic Refiner", agent: "Strategic Planner Pro" },
        { id: "wf-4", label: "Compliance Verifier", agent: "Consensus Critic" }
      ],
      mockReflection: {
        achievementRate: 99,
        qualityScore: 97.5,
        factRate: 100,
        timeSpentMs: 2150,
        costIncurred: 0.034,
        uxRating: 94,
        improvements: [
          "Tied liability limit automatically to cybersecurity insurance status",
          "Clean Japanese translation mapping verified through Ministry E-Gov database"
        ]
      }
    }
  ], []);

  // Set initial prediction from preset
  useEffect(() => {
    const activePreset = presets[selectedPresetIdx];
    setPrediction({
      expectedQuality: activePreset.predictedQuality,
      riskLevel: activePreset.riskLevel,
      riskDetails: activePreset.riskDetails,
      missingGaps: activePreset.gaps,
      recommendedReviews: activePreset.recommendedReviews
    });
    setWorkflowNodes(activePreset.dynamicWorkflow.map(node => ({ ...node, status: "idle" })));
  }, [selectedPresetIdx, presets]);

  // ==================== INTERACTIVE HANDLERS ====================

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${time}] ${msg}`]);
  };

  const startACOSLoop = () => {
    if (isSimulating) return;
    setIsSimulating(true);
    setLogs([]);
    setReflection(null);

    const activePreset = presets[selectedPresetIdx];

    // Phase 1: Quality Prediction Engine (⑤)
    setSimulationPhase("predicting");
    addLog(`[ACOS CORE] Launching Quality Prediction Engine for: "${activePreset.name}"...`);
    addLog(`[⑤ PREDICT] Analyzing mission complexity. Expected Quality: ${activePreset.predictedQuality}% | Risk: ${activePreset.riskLevel}`);
    addLog(`[⑤ PREDICT] Missing info detected: ${activePreset.gaps.join(", ")}`);

    setTimeout(() => {
      // Phase 2: Workflow Intelligence (④)
      setSimulationPhase("planning");
      addLog(`[④ WORKFLOW] Bypassing static templates. Designing custom workflow DAG for this specific prompt...`);
      const nodes = activePreset.dynamicWorkflow.map((node, i) => ({
        ...node,
        status: i === 0 ? ("active" as const) : ("idle" as const)
      }));
      setWorkflowNodes(nodes);
      addLog(`[④ WORKFLOW] Dynamically spawned sequence: ${activePreset.dynamicWorkflow.map(n => n.agent).join(" ➔ ")}`);

      setTimeout(() => {
        // Phase 3: Executing multi-agent validation
        setSimulationPhase("executing");
        addLog(`[⑥ COST] Optimizing LLM routing models dynamically: Selected combinations optimized for latency, precision, and cost balance.`);
        
        let nodeIdx = 0;
        const interval = setInterval(() => {
          if (nodeIdx < nodes.length) {
            setWorkflowNodes(prev => prev.map((n, idx) => ({
              ...n,
              status: idx === nodeIdx ? "active" : idx < nodeIdx ? "completed" : "idle"
            })));
            addLog(`[② EVOLUTION] Execution loop #${currentRunIndex}: Agent "${nodes[nodeIdx].agent}" completed deliverables.`);
            nodeIdx++;
          } else {
            clearInterval(interval);
            // Complete nodes
            setWorkflowNodes(prev => prev.map(n => ({ ...n, status: "completed" })));

            // Phase 4: Self Reflection Engine (①)
            setSimulationPhase("reflecting");
            addLog(`[① REFLECTION] Mission ended. Initiating automated Self-Reflection auditing...`);
            addLog(`[① REFLECTION] Grading performance on: Achievement, Quality, Fact, Time, Cost, UX.`);

            setTimeout(() => {
              // Populate self reflection
              const improvementMultiplier = currentRunIndex > 100 ? 1.02 : 1.0;
              const refData: SelfReflection = {
                achievementRate: Math.min(100, Math.round(activePreset.mockReflection.achievementRate * improvementMultiplier)),
                qualityScore: Math.min(100, Math.round(activePreset.mockReflection.qualityScore * improvementMultiplier)),
                factRate: Math.min(100, Number((activePreset.mockReflection.factRate * improvementMultiplier).toFixed(1))),
                timeSpentMs: Math.round(activePreset.mockReflection.timeSpentMs * (currentRunIndex > 100 ? 0.88 : 1.0)),
                costIncurred: activePreset.mockReflection.costIncurred * (currentRunIndex > 100 ? 0.75 : 1.0),
                uxRating: Math.min(100, Math.round(activePreset.mockReflection.uxRating * improvementMultiplier)),
                improvements: activePreset.mockReflection.improvements
              };
              setReflection(refData);
              addLog(`[① REFLECTION] Self evaluation score generated: Achievement ${refData.achievementRate}% | Quality: ${refData.qualityScore}%`);
              
              if (autoApplyImprovements) {
                addLog(`[② EVOLUTION] Self-Evolution successfully applied! Optimization rules mapped to next mission state.`);
              }
              
              setSimulationPhase("completed");
              setIsSimulating(false);

              // Inject new Evolution Log (②)
              if (currentRunIndex > 100) {
                const newEvLog: EvolutionLog = {
                  id: `ev-${Date.now()}`,
                  timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16),
                  missionName: activePreset.name,
                  runIndex: currentRunIndex,
                  qualityBefore: activePreset.predictedQuality,
                  qualityAfter: refData.qualityScore,
                  appliedRefinement: `Optimized through user pattern alignment and automated memory pruning. Re-run #${currentRunIndex} achieved perfect grounding.`
                };
                setEvolutionLogs(prev => [newEvLog, ...prev]);
              }
            }, 1200);
          }
        }, 1000);

      }, 1500);

    }, 1500);
  };

  // Run the 101st Run with improved parameters
  const runEvolutionStep = () => {
    setCurrentRunIndex(prev => prev + 1);
    addLog(`[② EVOLUTION] Upgrading core execution model from Run #${currentRunIndex} to #${currentRunIndex + 1}...`);
    addLog(`[② EVOLUTION] Optimizing constraints: Applying auto-discovered improvements directly into memory bank.`);
    setTimeout(() => {
      startACOSLoop();
    }, 500);
  };

  // User style analyzer
  const handleUserStyleAnalyze = () => {
    if (!customUserText.trim()) return;

    // Analyze text and classify (③)
    const len = customUserText.length;
    let focus: "Text" | "Image" | "Code" | "Analysis" = "Text";
    let type: "short_creative" | "long_analytical" | "image_centered" | "hybrid" = "hybrid";
    let optimizedUI = "Balanced dashboard with smart assistance triggers";
    let optimizedWorkflow = "Dynamic dual-agent workflow with standard reviews";
    let selectedModels = ["Gemini 2.5 Pro"];

    if (customUserText.toLowerCase().includes("select") || customUserText.toLowerCase().includes("sql") || customUserText.toLowerCase().includes("index") || len > 200) {
      focus = "Analysis";
      type = "long_analytical";
      optimizedUI = "High-density technical grid dashboard with detailed logs telemetry, mono fonts";
      optimizedWorkflow = "Deep consensus routing (5 review cycles, strict grounding check)";
      selectedModels = ["Claude 3.5 Sonnet", "Gemini 2.5 Pro"];
    } else if (customUserText.toLowerCase().includes("draw") || customUserText.toLowerCase().includes("image") || customUserText.toLowerCase().includes("logo")) {
      focus = "Image";
      type = "image_centered";
      optimizedUI = "Wide-stage visual canvas with image metadata metrics & referrer-policy check overlays";
      optimizedWorkflow = "Dual-modal generation with visual layout checker agent";
      selectedModels = ["Gemini 2.5 Pro", "Claude 3.5 Sonnet"];
    } else if (len < 50) {
      focus = "Text";
      type = "short_creative";
      optimizedUI = "Spacious, warm card layouts with smooth motion transitions, editorial serif display";
      optimizedWorkflow = "Fast collaborative drafting (1 review cycle, creative layout testing)";
      selectedModels = ["Gemini 2.5 Flash", "GPT-4o"];
    }

    const newPattern: UserPattern = {
      id: `pat-custom-${Date.now()}`,
      name: `Analyst Session (Auto-Detected)`,
      type,
      queryLength: len > 100 ? "Long" : "Short",
      focus,
      optimizedUI,
      optimizedWorkflow,
      selectedModels
    };

    setUserPatterns(prev => [newPattern, ...prev]);
    setActivePatternId(newPattern.id);
    setDetectedPatternDetails(`Automatically classified your style as [${type.toUpperCase()}] based on ${len} characters. Reshaped ACOS OS framework layout to fit.`);
    setCustomUserText("");
  };

  // Knowledge clean up (⑦)
  const pruneKnowledgeBase = () => {
    addLog(`[⑦ KNOWLEDGE] Running RAG, Memory, and Knowledge Graph pruning algorithm...`);
    addLog(`[⑦ KNOWLEDGE] Scanning for deprecated rules, duplicate chunks, and contradictory statements...`);
    
    setTimeout(() => {
      setKnowledgeBase(prev => {
        // Resolve issues
        return prev.map(item => {
          if (item.status !== "Clean") {
            return {
              ...item,
              status: "Clean",
              anomalyDetails: undefined,
              content: item.status === "Contradictory" ? "Express server port must bind strictly to port 3000 (Resolved redundancy)." : item.content + " (Auto-Pruned duplicates & checked legacy sandbox rules)."
            };
          }
          return item;
        });
      });
      addLog(`[⑦ KNOWLEDGE] Dynamic cleanup finished successfully! Deleted 1 stale RAG element, consolidated 1 duplicate chunk, reconciled 1 contradictory port conflict.`);
    }, 1200);
  };

  // Proposal Upvoting (⑩)
  const upvoteProposal = (id: string) => {
    setProposals(prev => prev.map(p => {
      if (p.id === id) {
        return { ...p, votes: p.votes + 1 };
      }
      return p;
    }));
  };

  // ==================== INTELLIGENCE BRAIN HANDLERS (Sprint 19) ====================
  const triggerBrainThinking = (inputString: string) => {
    if (!inputString.trim() || isThinking) return;
    setIsThinking(true);
    setThinkingStep(1);
    addLog(`[🧠 BRAIN] Received New Mission input. Intelligence Brain intercepting...`);
    addLog(`[🧠 BRAIN] Interception Mode: Diverting user request from direct model pipeline. Commencing deep meta-cognitive audit.`);

    let step = 1;
    const interval = setInterval(() => {
      step++;
      setThinkingStep(step);
      if (step === 2) {
        addLog(`[🧠 BRAIN] ① Mission Understanding: Deconstructing linguistic intent... classified targets.`);
      } else if (step === 3) {
        addLog(`[🧠 BRAIN] ② Mission Complexity: Evaluating difficulty benchmarks, expected duration, and Fact vulnerability.`);
      } else if (step === 4) {
        addLog(`[🧠 BRAIN] ③ Brain Planner: Automatically drawing optimal customized execution workflow nodes... bypassing static sequential models.`);
      } else if (step === 5) {
        addLog(`[🧠 BRAIN] ④ AI Selection: Auditing model efficiencies. Mapping requirements to specialized sub-processors.`);
      } else if (step === 6) {
        addLog(`[🧠 BRAIN] ⑤ Agent Selection: Initializing required operational agents... restricting/banning unnecessary worker threads.`);
      } else if (step === 7) {
        addLog(`[🧠 BRAIN] ⑥ Knowledge Strategy & ⑦ Thinking Strategy: Mapping retrieval nodes and activating specific cognitive mindset...`);
      } else if (step === 8) {
        clearInterval(interval);
        const lowerInput = inputString.toLowerCase();
        
        // Guess categories
        const categories: string[] = [];
        if (lowerInput.includes("調査") || lowerInput.includes("research") || lowerInput.includes("調べ") || lowerInput.includes("規制")) categories.push("調査");
        if (lowerInput.includes("比較") || lowerInput.includes("compare") || lowerInput.includes("差分")) categories.push("比較");
        if (lowerInput.includes("分析") || lowerInput.includes("analysis") || lowerInput.includes("解析")) categories.push("分析");
        if (lowerInput.includes("設計") || lowerInput.includes("design") || lowerInput.includes("構成")) categories.push("設計");
        if (lowerInput.includes("コード") || lowerInput.includes("開発") || lowerInput.includes("実装") || lowerInput.includes("build") || lowerInput.includes("program")) categories.push("開発");
        if (lowerInput.includes("判断") || lowerInput.includes("決めて") || lowerInput.includes("decide")) categories.push("判断");
        if (lowerInput.includes("創作") || lowerInput.includes("作って") || lowerInput.includes("create")) categories.push("創作");
        if (categories.length === 0) {
          categories.push("相談", "分析");
        }

        const isHard = lowerInput.length > 50 || lowerInput.includes("10,000") || lowerInput.includes("規制") || lowerInput.includes("cluster") || lowerInput.includes("hft");
        const difficulty = isHard ? "Hard" : "Medium";
        const agentsCount = isHard ? 4 : 2;
        const aiCount = isHard ? 3 : 2;
        const predictedTime = isHard ? 35 : 15;
        const factImp = isHard ? "Critical" : "High";

        const planSteps = [
          { step: "Research / インプット解析", status: "completed" as const, description: "Extract linguistic tokens and verify vocabulary constraints." },
          { step: "Cognitive Alignment / 思考調整", status: "completed" as const, description: "Initialize optimal memory cache buffers for contextual accuracy." },
          { step: "Agent Orchestration / エージェント召集", status: "completed" as const, description: "Assign active tasks to targeted worker agents." },
          { step: "Quality Verification / 品質監査", status: "completed" as const, description: "Certify output factuality and benchmark performance." }
        ];

        const isCreative = categories.includes("創作") || categories.includes("企画") || categories.includes("設計");
        const primaryModel = isCreative ? "Claude 3.5 Sonnet" : "Gemini 2.5 Pro";
        const thinkingMode = isCreative ? "発散思考" : "論理思考";

        const newMission: BrainMission = {
          id: `brain-custom-${Date.now()}`,
          input: inputString,
          timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16),
          understanding: {
            categories,
            rationale: `ユーザー入力 「${inputString.substring(0, 30)}...」 の語彙パターンを構文解析し、${categories.join("・")}の複数能力が必要とBrainが認識したため。`
          },
          complexity: {
            difficulty,
            agentsRequired: agentsCount,
            aiCount,
            predictedTimeMinutes: predictedTime,
            factImportance: factImp
          },
          plan: planSteps,
          aiSelection: [
            { provider: "Gemini", model: "Gemini 2.5 Pro", quality: 95, speed: 90, cost: 85, strength: "High reasoning, multi-language translation and web grounding", selected: primaryModel === "Gemini 2.5 Pro", rationale: "Selected for general reasoning balance and grounding precision." },
            { provider: "Claude", model: "Claude 3.5 Sonnet", quality: 98, speed: 85, cost: 75, strength: "Accurate architectural blueprints, styling, and coding layout precision", selected: primaryModel === "Claude 3.5 Sonnet", rationale: "Selected for technical planning and complex syntax generation." },
            { provider: "GPT", model: "GPT-4o", quality: 92, speed: 92, cost: 70, strength: "Fast summarization and creative copy drafting", selected: false, rationale: "Kept as secondary backup processor." }
          ],
          agents: [
            { name: "StrategicPlannerPro", role: "Mission Architecture Planner", status: "active", reason: "Required to lay down core foundations for this request." },
            { name: "ConsensusCritic", role: "Grounding and Fact Verification Scout", status: "active", reason: "Mandated to eliminate any hallucination risk profile." },
            { name: "ComplianceAuditorAgent", role: "Regulatory Guard Auditor", status: isHard ? "active" : "idle", reason: isHard ? "Spanned to double check high complexity limits." : "Kept idle to conserve API cost." },
            { name: "DatabaseOptimizerAgent", role: "Redis Connection Tuner", status: "forbidden", reason: "Banned because database clustering is irrelevant to this request." }
          ],
          knowledgeStrategy: {
            sources: ["Memory", "RAG", "Web"],
            description: "Scrape contextual anchors speculatively using Web search; index relevant guidelines from local RAG memory structures."
          },
          thinkingStrategy: {
            mode: thinkingMode as any,
            description: `目的の最大化を狙うため、${thinkingMode}をベースとした思考サイクルを中枢に注入。`
          },
          selfOptimization: {
            evaluated: false,
            rating: 0,
            pros: "",
            cons: "",
            nextImprovement: ""
          }
        };

        setBrainMissions(prev => [newMission, ...prev]);
        setSelectedBrainIdx(0);
        setCustomMissionInput("");
        setIsThinking(false);
        addLog(`[🧠 BRAIN] Intelligence Brain planning loop complete. Generated optimal custom workflow DAG. Ready for execution.`);
      }
    }, 400);
  };

  const handleSelfEvaluate = (idx: number) => {
    setBrainMissions(prev => {
      const updated = [...prev];
      const m = { ...updated[idx] };
      m.selfOptimization = {
        evaluated: true,
        rating: Number((4.6 + Math.random() * 0.4).toFixed(2)),
        pros: m.input.toLowerCase().includes("redis") 
          ? "Target connection speeds were reached flawlessly with non-blocking Event Loop socket checks and optimal Claude-selected buffer configurations."
          : "FSA and FCA compliance citation parameters checked out with 100% precision. Decisive reasoning between JP vs UK policies.",
        cons: m.input.toLowerCase().includes("redis")
          ? "Clustering buffer configuration could lead to a micro-second bottleneck on cold startups if socket reuse is constrained."
          : "FCA guidelines required deep iterative scraping queries which raised initial planning latency to 2.4s.",
        nextImprovement: m.input.toLowerCase().includes("redis")
          ? "Integrate speculative connection cache pre-warmups in the upcoming Sprint 20 pipeline."
          : "Enrich pre-fetched legal ordinance RAG vectors to achieve zero-scraping latencies in critical zones."
      };
      updated[idx] = m;
      return updated;
    });
    addLog(`[🧠 BRAIN] ⑨ Self-Optimization: Evaluated decision weights of Mission #${idx+1}. New performance boundaries mapped into memory.`);
  };

  // ==================== TRUST OS HANDLERS (Sprint 20) ====================
  const triggerTrustSimulation = (inputString: string) => {
    if (!inputString.trim() || isSimulatingTrust) return;
    setIsSimulatingTrust(true);
    setTrustSimulatingStep(1);
    addLog(`[🛡️ TRUST] Received Mission: "${inputString}"`);
    addLog(`[🛡️ TRUST] ① Checking Mission Risk level speculatively...`);

    let step = 1;
    const interval = setInterval(() => {
      step++;
      setTrustSimulatingStep(step);
      if (step === 2) {
        addLog(`[🛡️ TRUST] ② Human Approval Layer analysis... auditing if task contains sensitive API nodes.`);
      } else if (step === 3) {
        addLog(`[🛡️ TRUST] ③ Mission Simulator: Calculating expected success rate, risk scores, duration, cost and quality parameters.`);
      } else if (step === 4) {
        addLog(`[🛡️ TRUST] ④ Explain Decision mapper initializing used AI & Agent graphs...`);
      } else if (step === 5) {
        clearInterval(interval);

        const lower = inputString.toLowerCase();
        
        // ① Risk Assessment & ② Human Approval Check
        let level: "Low" | "Medium" | "High" | "Critical" = "Low";
        let reason = "このミッションは機密データの操作や外部送信を含まないため、比較的安全に実行可能です。";
        let approvalRequired = false;
        let approvalType: any = "none";

        if (lower.includes("delete") || lower.includes("削除") || lower.includes("remove") || lower.includes("データベース") || lower.includes("db")) {
          level = "Critical";
          reason = "データベースの削除やファイル削除などの不可逆的な操作が含まれており、誤実行による重大なデータ損失リスクがあります。";
          approvalRequired = true;
          approvalType = "file_deletion";
        } else if (lower.includes("mail") || lower.includes("メール") || lower.includes("送信") || lower.includes("send")) {
          level = "High";
          reason = "外部関係者への自動メール送信が含まれており、誤送信による情報漏洩や企業としての信用失墜リスクがあります。";
          approvalRequired = true;
          approvalType = "mail";
        } else if (lower.includes("契約") || lower.includes("contract") || lower.includes("規約") || lower.includes("agreement")) {
          level = "High";
          reason = "法的な義務や制限を生じさせる契約書の自動生成が含まれており、専門家によるダブルチェックが必要です。";
          approvalRequired = true;
          approvalType = "contract";
        } else if (lower.includes("支払い") || lower.includes("支払") || lower.includes("payment") || lower.includes("決済") || lower.includes("money") || lower.includes("pay")) {
          level = "Critical";
          reason = "金銭的な取引や外部APIによる課金処理がトリガーされるため、極めて厳格な検証が必要です。";
          approvalRequired = true;
          approvalType = "payment";
        } else if (lower.includes("公開") || lower.includes("publish") || lower.includes("リリース")) {
          level = "High";
          reason = "社外への一般公開・パブリッシュ処理が含まれており、誤ったコンテンツやテストコードの流出リスクがあります。";
          approvalRequired = true;
          approvalType = "publish";
        } else if (lower.includes("workflow") || lower.includes("ワークフロー")) {
          level = "Medium";
          reason = "複数システムにまたがる自動化ワークフローの実行が含まれており、動作確認と検証が必要です。";
          approvalRequired = true;
          approvalType = "workflow";
        } else if (lower.includes("plugin") || lower.includes("プラグイン")) {
          level = "Medium";
          reason = "外部プラグインの実行により不特定の副作用が発生する可能性があるため、承認確認が必要です。";
          approvalRequired = true;
          approvalType = "plugin";
        }

        // ⑤ Mission Simulator calculations
        const randomFactor = Math.random();
        const successRate = Number((95 + randomFactor * 4).toFixed(1));
        const riskScore = level === "Critical" ? 85 : level === "High" ? 50 : level === "Medium" ? 20 : 5;
        const predictedTimeMs = Math.round(1500 + randomFactor * 3000);
        const predictedCost = Number((0.01 + randomFactor * 0.08).toFixed(3));
        const predictedQuality = Number((96 + randomFactor * 3).toFixed(1));

        // Create new mission
        const newTrustMission: TrustMission = {
          id: `trust-${Date.now()}`,
          input: inputString,
          timestamp: new Date().toISOString().replace('T', ' ').slice(0, 16),
          risk: { level, reason },
          simulation: { successRate, riskScore, predictedTimeMs, predictedCost, predictedQuality },
          explanation: {
            usedAI: level === "Critical" || level === "High" ? "Gemini 2.5 Pro & Claude 3.5 Sonnet" : "Gemini 2.5 Flash",
            usedAgent: level === "Critical" || level === "High" ? "ComplianceAuditorAgent, DatabasePurgeAgent" : "DeveloperHelperAgent",
            usedMemory: "Standard Session Context Cache",
            usedKnowledge: "ACOS Corporate Compliance Framework V20",
            usedWeb: level === "Critical" ? "Live Scraping of Statutory Codes" : "None",
            rationale: `入力に対する機密監査、外部接続性、不可逆性のチェックを実行。セキュリティモード: ${securityMode}の規約に基づき安全第一の思考(批判思考)を用いて検証プランを適用しました。`,
            factScore: Number((98 + randomFactor * 2).toFixed(1)),
            confidenceScore: Number((94 + randomFactor * 5).toFixed(1))
          },
          approval: {
            required: approvalRequired,
            type: approvalType,
            status: approvalRequired ? "Pending" : "Approved",
            approvedAt: approvalRequired ? undefined : new Date().toISOString().replace('T', ' ').slice(0, 16),
            operator: approvalRequired ? undefined : "nori72ny@gmail.com"
          },
          rollback: {
            versions: [
              {
                version: 1,
                timestamp: new Date().toISOString().replace('T', ' ').slice(0, 16),
                diff: "No changes recorded. Initial draft.",
                content: "Initial secure sandbox model representation."
              }
            ],
            currentVersion: 1
          },
          auditTrail: [
            {
              who: "nori72ny@gmail.com",
              when: new Date().toISOString().replace('T', ' ').slice(0, 16),
              what: `ミッション "${inputString.slice(0, 20)}..." の受信とリスク評価`,
              why: "Sprint 20 Trustworthy Autonomous OS のリアルタイム機密監視のため",
              aiJudgement: `解析結果: リスク=[${level}]、人間承認=[${approvalRequired ? "要" : "不要"}]。シミュレーション完了。`
            }
          ]
        };

        setTrustMissions(prev => [newTrustMission, ...prev]);
        setSelectedTrustIdx(0);
        setCustomTrustInput("");
        setIsSimulatingTrust(false);
        addLog(`[🛡️ TRUST] Mission Intercepted and registered! Risk level detected: ${level}.`);
      }
    }, 400);
  };

  const handleApproveMission = (id: string, isApproved: boolean) => {
    setTrustMissions(prev => prev.map(m => {
      if (m.id === id) {
        const newStatus = isApproved ? "Approved" : "Rejected";
        addLog(`[🛡️ TRUST] Human Approval Action: ${newStatus} for Mission ID ${id}`);
        return {
          ...m,
          approval: {
            ...m.approval,
            status: newStatus,
            approvedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
            operator: "nori72ny@gmail.com"
          },
          auditTrail: [
            ...m.auditTrail,
            {
              who: "nori72ny@gmail.com",
              when: new Date().toISOString().replace('T', ' ').slice(0, 16),
              what: `人間承認の実行（判定: ${isApproved ? "承認" : "却下"}）`,
              why: "承認必須イベントにオペレーターが署名を付与したため",
              aiJudgement: isApproved ? "承認を確認しました。安全に次のDAGへ推移します。" : "却下を確認しました。即座にスレッド実行をロック・破棄しました。"
            }
          ]
        };
      }
      return m;
    }));
  };

  const handleRollbackVersion = (id: string, targetVer: number) => {
    setTrustMissions(prev => prev.map(m => {
      if (m.id === id) {
        addLog(`[🛡️ TRUST] Rollback Triggered: Restoring Mission ID ${id} to Version ${targetVer}`);
        return {
          ...m,
          rollback: {
            ...m.rollback,
            currentVersion: targetVer
          },
          auditTrail: [
            ...m.auditTrail,
            {
              who: "nori72ny@gmail.com",
              when: new Date().toISOString().replace('T', ' ').slice(0, 16),
              what: `Rollback Engine起動：バージョン${targetVer}へリストア`,
              why: "ユーザーが過去の安全なセーブポイントへの回復を要請したため",
              aiJudgement: `リストア成功。以前のコード記述・環境コンテキストを完全に回復しました。`
            }
          ]
        };
      }
      return m;
    }));
  };

  const activePattern = userPatterns.find(p => p.id === activePatternId) || userPatterns[0];

  return (
    <div className="flex flex-col h-full bg-slate-900 rounded-2xl overflow-hidden text-slate-100 border border-slate-800" id="acos-core-framework">
      
      {/* Dynamic Header with ACOS Core Status telemetry */}
      <div className="p-6 border-b border-slate-800 bg-slate-950 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2 py-0.5 bg-rose-500/20 text-rose-300 text-[10px] font-bold rounded-full font-mono uppercase tracking-wide border border-rose-500/30 animate-pulse">
              Sprint 19「Intelligence Brain Sprint」
            </span>
            <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-300 text-[10px] font-bold rounded-full font-mono uppercase tracking-wide border border-indigo-500/30">
              思考OS「Intelligence Brain」
            </span>
            <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 text-[10px] font-bold rounded-full font-mono uppercase tracking-wide border border-emerald-500/30">
              ACOS Autonomous Brain
            </span>
            <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 text-[10px] font-bold rounded-full font-mono uppercase tracking-wide border border-amber-500/30">
              Active Optimization Mode
            </span>
          </div>
          <h2 className="text-xl font-black text-white flex items-center gap-2 mt-1">
            <Brain className="w-5 h-5 text-rose-400 animate-pulse" /> ACOS Intelligence Brain OS
          </h2>
          <p className="text-xs text-slate-400 font-medium mt-1">
            AIチャットから「思考OS」への進化。ユーザー入力をエージェントへ渡す前に、中枢Brainが自律解析・プラン構築・最適AI選択・戦略意思決定を下します。
          </p>
        </div>

        {/* Real-time Evolutionary Telemetry */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-slate-900 px-3 py-2 rounded-xl border border-slate-800">
            <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Evolution Rate</div>
            <div className="text-xs font-black text-white font-mono flex items-baseline gap-1 mt-0.5">
              +14.8% <span className="text-[9px] text-emerald-400 font-medium">▲ Target</span>
            </div>
          </div>
          <div className="bg-slate-900 px-3 py-2 rounded-xl border border-slate-800">
            <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">RAG Duplicate rate</div>
            <div className="text-xs font-black text-white font-mono flex items-baseline gap-1 mt-0.5">
              0.02% <span className="text-[9px] text-emerald-400 font-medium">▼ clean</span>
            </div>
          </div>
          <div className="bg-slate-900 px-3 py-2 rounded-xl border border-slate-800">
            <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Run Index</div>
            <div className="text-xs font-black text-indigo-300 font-mono flex items-baseline gap-1 mt-0.5">
              #{currentRunIndex} <span className="text-[9px] text-slate-500 font-medium">Active</span>
            </div>
          </div>
          <div className="bg-slate-900 px-3 py-2 rounded-xl border border-slate-800">
            <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Active Pattern</div>
            <div className="text-xs font-black text-emerald-400 font-mono truncate max-w-[80px] mt-0.5">
              {activePattern.type.replace('_', ' ')}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800 bg-slate-950 p-2 gap-1 overflow-x-auto">
        <button
          onClick={() => setActiveTab("trust-dashboard")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
            activeTab === "trust-dashboard" ? "bg-rose-600 text-white shadow-md shadow-rose-600/20" : "text-slate-400 hover:text-slate-200 border border-slate-800/40"
          }`}
        >
          <ShieldCheck className="w-4 h-4 text-emerald-400 animate-pulse" /> Trust Dashboard
        </button>
        <button
          onClick={() => setActiveTab("validation-suite")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
            activeTab === "validation-suite" ? "bg-rose-600 text-white shadow-md shadow-rose-600/20" : "text-slate-400 hover:text-slate-200 border border-slate-800/40"
          }`}
        >
          <Award className="w-4 h-4 text-rose-400 animate-pulse" /> Validation Program (RC-1)
        </button>
        <button
          onClick={() => setActiveTab("brain-dashboard")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
            activeTab === "brain-dashboard" ? "bg-rose-600 text-white shadow-md shadow-rose-600/20" : "text-slate-400 hover:text-slate-200 border border-slate-800/40"
          }`}
        >
          <Brain className="w-4 h-4 text-rose-400 animate-pulse" /> Intelligence Brain
        </button>
        <button
          onClick={() => setActiveTab("outcome-dashboard")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
            activeTab === "outcome-dashboard" ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/20" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Award className="w-4 h-4 text-emerald-400" /> Outcome Dashboard
        </button>
        <button
          onClick={() => setActiveTab("goal-success")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
            activeTab === "goal-success" ? "bg-cyan-600 text-white shadow-md shadow-cyan-600/20" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Compass className="w-4 h-4 text-cyan-400" /> Goal Success Engine
        </button>
        <button
          onClick={() => setActiveTab("orchestrator")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
            activeTab === "orchestrator" ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Network className="w-4 h-4 text-indigo-400" /> Core Sandbox & Reflection
        </button>
        <button
          onClick={() => setActiveTab("user-pattern")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
            activeTab === "user-pattern" ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Users className="w-4 h-4 text-emerald-400" /> User Pattern Engine
        </button>
        <button
          onClick={() => setActiveTab("knowledge")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
            activeTab === "knowledge" ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Brain className="w-4 h-4 text-amber-400" /> Knowledge Intelligence
        </button>
        <button
          onClick={() => setActiveTab("evolution")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
            activeTab === "evolution" ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <BarChart3 className="w-4 h-4 text-cyan-400" /> Evolution & Benchmarks
        </button>
        <button
          onClick={() => setActiveTab("proposals")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
            activeTab === "proposals" ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Lightbulb className="w-4 h-4 text-pink-400" /> Core Proposals
        </button>
      </div>

      {/* Main Container */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        
        {/* ========================================================================= */}
        {/* TAB: VALIDATION PROGRAM (RC-1) */}
        {/* ========================================================================= */}
        {activeTab === "validation-suite" && (
          <ValidationSuite />
        )}

        {/* ========================================================================= */}
        {/* TAB: TRUST OS DASHBOARD (Sprint 20) */}
        {/* ========================================================================= */}
        {activeTab === "trust-dashboard" && (
          <div className="space-y-6 animate-fade-in" id="acos-trust-dashboard">
            
            {/* Top Bar: Mode Selector & Security Info */}
            <div className="bg-slate-950 p-6 rounded-2xl border border-emerald-500/10 shadow-xl space-y-4">
              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                <div>
                  <div className="text-[10px] text-emerald-400 font-mono font-bold uppercase tracking-wider flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" /> Trustworthy Autonomous OS
                  </div>
                  <h3 className="text-lg font-black text-white mt-1">
                    ACOS Core Intelligence Trust Dashboard
                  </h3>
                  <p className="text-xs text-slate-400">
                    ACOSを世界最高レベルで安全に毎日使える思考OSへと進化させる、強固な自律セーフティレイヤーです。
                  </p>
                </div>

                {/* Safe Mode Selector (⑥) */}
                <div className="flex bg-slate-900 p-1.5 rounded-xl border border-slate-800 gap-1 shrink-0">
                  {(["Safe Mode", "Business Mode", "Family Mode", "Developer Mode"] as const).map((mode) => {
                    const isActive = securityMode === mode;
                    return (
                      <button
                        key={mode}
                        onClick={() => {
                          setSecurityMode(mode);
                          addLog(`[🛡️ SECURITY] Mode switched to: ${mode}`);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          isActive 
                            ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/20" 
                            : "text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        {mode === "Safe Mode" && "🛡️ "}
                        {mode === "Business Mode" && "💼 "}
                        {mode === "Family Mode" && "🏠 "}
                        {mode === "Developer Mode" && "⚡ "}
                        {mode}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Dynamic Alert Banner depending on selected mode */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={securityMode}
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className={`p-4 rounded-xl text-xs flex items-start gap-3 border ${
                    securityMode === "Safe Mode"
                      ? "bg-emerald-950/40 border-emerald-500/20 text-emerald-300"
                      : securityMode === "Business Mode"
                      ? "bg-blue-950/40 border-blue-500/20 text-blue-300"
                      : securityMode === "Family Mode"
                      ? "bg-amber-950/40 border-amber-500/20 text-amber-300"
                      : "bg-purple-950/40 border-purple-500/20 text-purple-300"
                  }`}
                >
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <div>
                    <span className="font-extrabold font-mono uppercase mr-1">
                      [{securityMode} ACTIVE]
                    </span>
                    {securityMode === "Safe Mode" && (
                      "セーフモードが有効です。すべてのメール送信、ファイル削除、契約書生成、支払い、公開、ワークフロー実行、プラグイン実行には、人間承認（Human Approval Layer）が強制されます。危険度の高い操作は事前にブロックされ、シミュレータが起動します。"
                    )}
                    {securityMode === "Business Mode" && (
                      "ビジネスモードが有効です。一部の契約関係、外部への大容量データ転送処理以外は、自動承認されスムーズな自律運転を行います。監査ログ（Audit Trail）は詳細に出力されます。"
                    )}
                    {securityMode === "Family Mode" && (
                      "ファミリーモードが有効です。決済や支払いAPIは完全にロック（拒否）され、有害なコンテキストや誤送信を防ぐペアレンタル制御が適用されます。"
                    )}
                    {securityMode === "Developer Mode" && (
                      "デベロッパーモードが有効です。すべての承認レイヤーはバイパスされ、自由なプロトタイプコードの自動削除や外部スクリプトの即時キックが許可されます。注意してご利用ください。"
                    )}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Metrics Dashboard Row (⑧) */}
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 flex flex-col justify-between">
                <div className="text-[10px] font-mono text-slate-500 uppercase font-black">Mission Success</div>
                <div className="text-2xl font-black text-white font-mono mt-2">
                  {(trustMissions.reduce((acc, m) => acc + m.simulation.successRate, 0) / trustMissions.length).toFixed(1)}%
                </div>
                <div className="text-[10px] text-emerald-400 font-mono mt-1 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> Peak Performance
                </div>
              </div>
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 flex flex-col justify-between">
                <div className="text-[10px] font-mono text-slate-500 uppercase font-black">Rollback Enabled</div>
                <div className="text-2xl font-black text-emerald-400 font-mono mt-2">100.0%</div>
                <div className="text-[10px] text-slate-400 font-mono mt-1">Restore points active</div>
              </div>
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 flex flex-col justify-between">
                <div className="text-[10px] font-mono text-slate-500 uppercase font-black">Secured Risk Rate</div>
                <div className="text-2xl font-black text-rose-400 font-mono mt-2">
                  {((trustMissions.filter(m => m.risk.level === "Critical" || m.risk.level === "High").length / trustMissions.length) * 100).toFixed(0)}%
                </div>
                <div className="text-[10px] text-rose-300 font-mono mt-1">High-risk audited</div>
              </div>
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 flex flex-col justify-between">
                <div className="text-[10px] font-mono text-slate-500 uppercase font-black">Approval Verified</div>
                <div className="text-2xl font-black text-white font-mono mt-2">
                  {((trustMissions.filter(m => !m.approval.required || m.approval.status !== "Pending").length / trustMissions.length) * 100).toFixed(0)}%
                </div>
                <div className="text-[10px] text-emerald-400 font-mono mt-1">Double signature</div>
              </div>
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 flex flex-col justify-between">
                <div className="text-[10px] font-mono text-slate-500 uppercase font-black">Fact Accuracy Rate</div>
                <div className="text-2xl font-black text-white font-mono mt-2">
                  {(trustMissions.reduce((acc, m) => acc + m.explanation.factScore, 0) / trustMissions.length).toFixed(1)}%
                </div>
                <div className="text-[10px] text-emerald-400 font-mono mt-1">Zero-hallucination</div>
              </div>
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 flex flex-col justify-between">
                <div className="text-[10px] font-mono text-slate-500 uppercase font-black">Quality Trend</div>
                <div className="text-xs font-black text-indigo-400 font-mono mt-2 flex items-center gap-1">
                  <span>V18</span> <ArrowRight className="w-3 h-3" /> <span>V19</span> <ArrowRight className="w-3 h-3" /> <span className="text-emerald-400">V20</span>
                </div>
                <div className="text-[9px] text-slate-400 mt-1">Trust Engine active</div>
              </div>
            </div>

            {/* Simulated Execution Input Section */}
            <div className="bg-slate-950 p-6 rounded-2xl border border-rose-500/10 space-y-4 shadow-xl">
              <div>
                <div className="text-[10px] text-rose-400 font-mono font-bold uppercase tracking-wider flex items-center gap-1">
                  <Play className="w-3.5 h-3.5" /> Simulated Pre-Execution & Risk Analyzer
                </div>
                <h4 className="text-base font-black text-white mt-1">
                  Interactive Trust Engine Interception
                </h4>
                <p className="text-xs text-slate-400">
                  実行前に、リスクの度合いや承認要件、期待される時間やコスト、そして万が一に備えるリストアバージョンを生成・シミュレートします。
                </p>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={customTrustInput}
                  onChange={(e) => setCustomTrustInput(e.target.value)}
                  placeholder="例: 未払いリストをCSV削除し、財務担当にメール送信 & 支払いAPI実行して..."
                  className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-rose-500 transition-all font-sans"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && customTrustInput.trim() && !isSimulatingTrust) {
                      triggerTrustSimulation(customTrustInput);
                    }
                  }}
                  disabled={isSimulatingTrust}
                />
                <button
                  onClick={() => triggerTrustSimulation(customTrustInput)}
                  disabled={isSimulatingTrust || !customTrustInput.trim()}
                  className={`px-5 py-2.5 rounded-xl text-xs font-bold font-sans flex items-center gap-2 transition-all shrink-0 ${
                    isSimulatingTrust || !customTrustInput.trim()
                      ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                      : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/25 active:scale-95"
                  }`}
                >
                  {isSimulatingTrust ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" /> Simulating...
                    </>
                  ) : (
                    <>
                      <Shield className="w-4 h-4" /> Run Simulator
                    </>
                  )}
                </button>
              </div>

              {/* Simulation progress bar */}
              {isSimulatingTrust && (
                <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-2">
                  <div className="flex justify-between items-center text-[10px] font-mono text-slate-400">
                    <span>PROGRESS PHASE: {trustSimulatingStep}/5</span>
                    <span>
                      {trustSimulatingStep === 1 && "① Risk Assessment Running..."}
                      {trustSimulatingStep === 2 && "② Checking Sensitive Human Approval Node triggers..."}
                      {trustSimulatingStep === 3 && "③ Calculating Success, Cost & Quality bounds..."}
                      {trustSimulatingStep === 4 && "④ Building Explanation Graphs..."}
                      {trustSimulatingStep === 5 && "⑤ Injecting Version Checkpoints..."}
                    </span>
                  </div>
                  <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden">
                    <motion.div
                      className="bg-emerald-500 h-full"
                      initial={{ width: "0%" }}
                      animate={{ width: `${(trustSimulatingStep / 5) * 100}%` }}
                      transition={{ duration: 0.2 }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Main Interactive Row */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Left Column (5/12): Mission List & Detailed Review */}
              <div className="lg:col-span-5 space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-mono font-bold text-slate-400 uppercase tracking-wider">
                    Audited Missions ({trustMissions.length})
                  </span>
                </div>

                <div className="space-y-3 max-h-[700px] overflow-y-auto pr-1">
                  {trustMissions.map((m, idx) => {
                    const isSelected = selectedTrustIdx === idx;
                    const isPending = m.approval.required && m.approval.status === "Pending";
                    
                    return (
                      <button
                        key={m.id}
                        onClick={() => setSelectedTrustIdx(idx)}
                        className={`w-full text-left p-4 rounded-2xl border transition-all flex flex-col gap-3 ${
                          isSelected
                            ? "bg-slate-950 border-emerald-500/40 shadow-lg shadow-emerald-500/5"
                            : "bg-slate-950/40 border-slate-800/60 hover:bg-slate-950 hover:border-slate-800"
                        }`}
                      >
                        <div className="flex justify-between items-center w-full">
                          <span className="text-[10px] font-mono text-slate-500 font-bold">
                            {m.timestamp}
                          </span>
                          
                          {/* Risk Badges */}
                          <div className="flex gap-1.5 items-center">
                            {isPending && (
                              <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 text-[9px] font-mono font-bold rounded border border-amber-500/30 flex items-center gap-0.5 animate-pulse">
                                <Lock className="w-2.5 h-2.5" /> PENDING APPROVAL
                              </span>
                            )}
                            
                            <span className={`px-2 py-0.5 text-[9px] font-mono font-bold rounded border ${
                              m.risk.level === "Critical"
                                ? "bg-red-500/20 text-red-300 border-red-500/30"
                                : m.risk.level === "High"
                                ? "bg-orange-500/20 text-orange-300 border-orange-500/30"
                                : m.risk.level === "Medium"
                                ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                                : "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                            }`}>
                              {m.risk.level} Risk
                            </span>
                          </div>
                        </div>

                        <p className="text-xs text-white font-medium line-clamp-2">
                          {m.input}
                        </p>

                        <div className="flex justify-between items-center w-full pt-1 border-t border-slate-900 text-[10px] text-slate-500 font-mono">
                          <span className="truncate max-w-[120px]">
                            AI: {m.explanation.usedAI}
                          </span>
                          <span className="text-emerald-400 font-bold">
                            Success: {m.simulation.successRate}%
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Right Column (7/12): Core Trust Engines Panel */}
              <div className="lg:col-span-7 space-y-6">
                
                {/* 1. Risk Engine details (①) */}
                <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-[10px] text-slate-500 font-mono font-bold uppercase tracking-wider flex items-center gap-1">
                        <Activity className="w-3.5 h-3.5 text-rose-400" /> ① Mission Risk Engine
                      </div>
                      <h4 className="text-sm font-black text-white mt-1">
                        Dynamic Threat Assessment & Classification
                      </h4>
                    </div>
                    <span className={`px-3 py-1 text-xs font-mono font-bold rounded-full border ${
                      activeTrustMission.risk.level === "Critical"
                        ? "bg-red-500/20 text-red-300 border-red-500/30"
                        : activeTrustMission.risk.level === "High"
                        ? "bg-orange-500/20 text-orange-300 border-orange-500/30"
                        : activeTrustMission.risk.level === "Medium"
                        ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                        : "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                    }`}>
                      {activeTrustMission.risk.level} Risk Class
                    </span>
                  </div>

                  <p className="text-xs text-slate-300 bg-slate-900/60 p-4 rounded-xl border border-slate-900 leading-relaxed">
                    <span className="font-bold text-white block mb-1">【判定理由 / Classification Rationale】</span>
                    {activeTrustMission.risk.reason}
                  </p>
                </div>

                {/* 2. Human Approval Layer (②) */}
                {activeTrustMission.approval.required && (
                  <div className="bg-slate-950 p-6 rounded-2xl border border-amber-500/20 space-y-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="text-[10px] text-amber-400 font-mono font-bold uppercase tracking-wider flex items-center gap-1 animate-pulse">
                          <Lock className="w-3.5 h-3.5" /> ② Human Approval Layer (Mandatory)
                        </div>
                        <h4 className="text-sm font-black text-white mt-1">
                          Sensitive Action Execution Gating
                        </h4>
                        <p className="text-xs text-slate-400">
                          {activeTrustMission.approval.type === "file_deletion" && "検知操作: データベース削除 / ファイル削除"}
                          {activeTrustMission.approval.type === "mail" && "検知操作: メール送信 / 外部通知"}
                          {activeTrustMission.approval.type === "contract" && "検知操作: 契約書自動生成 / 法的事項"}
                          {activeTrustMission.approval.type === "payment" && "検知操作: 支払い / 資金移動"}
                          {activeTrustMission.approval.type === "publish" && "検知操作: パブリックストレージ公開"}
                          {activeTrustMission.approval.type === "workflow" && "検知操作: Workflow実行"}
                          {activeTrustMission.approval.type === "plugin" && "検知操作: Plugin実行"}
                        </p>
                      </div>

                      {/* Status badge */}
                      <span className={`px-2.5 py-1 text-xs font-mono font-bold rounded border ${
                        activeTrustMission.approval.status === "Approved"
                          ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                          : activeTrustMission.approval.status === "Rejected"
                          ? "bg-red-500/20 text-red-300 border-red-500/30"
                          : "bg-amber-500/20 text-amber-300 border-amber-500/30 animate-pulse"
                      }`}>
                        {activeTrustMission.approval.status}
                      </span>
                    </div>

                    {activeTrustMission.approval.status === "Pending" ? (
                      <div className="space-y-3">
                        {securityMode === "Safe Mode" && (
                          <div className="text-[10px] text-emerald-300 bg-emerald-950/20 px-3 py-2 rounded-lg border border-emerald-500/10 flex items-center gap-1.5 font-mono">
                            <Shield className="w-3.5 h-3.5" /> セーフモードによるセキュリティ制限が適用されています。ダブル承認コードが必要です。
                          </div>
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleApproveMission(activeTrustMission.id, true)}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 active:scale-95 shadow-lg shadow-emerald-600/10 font-sans"
                          >
                            <CheckCircle2 className="w-4 h-4" /> Approve & Execute
                          </button>
                          <button
                            onClick={() => handleApproveMission(activeTrustMission.id, false)}
                            className="flex-1 bg-slate-900 hover:bg-slate-800 text-red-400 py-2.5 rounded-xl text-xs font-bold transition-all border border-slate-800 flex items-center justify-center gap-1.5 active:scale-95 font-sans"
                          >
                            <Trash2 className="w-4 h-4" /> Reject & Abort
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-slate-900/60 p-3.5 rounded-xl border border-slate-900 space-y-1.5 text-xs text-slate-400">
                        <div className="flex justify-between">
                          <span>Operator Signature:</span>
                          <span className="font-bold text-slate-200">{activeTrustMission.approval.operator}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Verified At:</span>
                          <span className="font-mono text-slate-200">{activeTrustMission.approval.approvedAt}</span>
                        </div>
                        <div className="text-[10px] text-slate-500 pt-1.5 border-t border-slate-800">
                          ※ この機密処理の監査ハッシュは不変ログ（Audit Trail）に永続保存されました。
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 3. Mission Simulator pre-execution predictions (⑤) */}
                <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-5">
                  <div>
                    <div className="text-[10px] text-slate-500 font-mono font-bold uppercase tracking-wider flex items-center gap-1">
                      <BarChart3 className="w-3.5 h-3.5 text-emerald-400" /> ③ Mission Simulator
                    </div>
                    <h4 className="text-sm font-black text-white mt-1">
                      Pre-Execution Predictive Metrics
                    </h4>
                  </div>

                  <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                    <div className="bg-slate-900 p-3 rounded-xl border border-slate-800 text-center">
                      <div className="text-[9px] text-slate-500 uppercase font-bold">Success Rate</div>
                      <div className="text-sm font-black text-emerald-400 font-mono mt-1">
                        {activeTrustMission.simulation.successRate}%
                      </div>
                    </div>
                    <div className="bg-slate-900 p-3 rounded-xl border border-slate-800 text-center">
                      <div className="text-[9px] text-slate-500 uppercase font-bold">Risk Score</div>
                      <div className="text-sm font-black text-rose-400 font-mono mt-1">
                        {activeTrustMission.simulation.riskScore}%
                      </div>
                    </div>
                    <div className="bg-slate-900 p-3 rounded-xl border border-slate-800 text-center">
                      <div className="text-[9px] text-slate-500 uppercase font-bold">Latency</div>
                      <div className="text-sm font-black text-white font-mono mt-1">
                        {activeTrustMission.simulation.predictedTimeMs}ms
                      </div>
                    </div>
                    <div className="bg-slate-900 p-3 rounded-xl border border-slate-800 text-center">
                      <div className="text-[9px] text-slate-500 uppercase font-bold">SLA Cost</div>
                      <div className="text-sm font-black text-white font-mono mt-1">
                        ${activeTrustMission.simulation.predictedCost}
                      </div>
                    </div>
                    <div className="bg-slate-900 p-3 rounded-xl border border-slate-800 text-center col-span-2 lg:col-span-1">
                      <div className="text-[9px] text-slate-500 uppercase font-bold">Quality</div>
                      <div className="text-sm font-black text-indigo-400 font-mono mt-1">
                        {activeTrustMission.simulation.predictedQuality}%
                      </div>
                    </div>
                  </div>
                </div>

                {/* 4. Explain Decision - AI Reasoning (④) */}
                <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
                  <div>
                    <div className="text-[10px] text-slate-500 font-mono font-bold uppercase tracking-wider flex items-center gap-1">
                      <Brain className="w-3.5 h-3.5 text-indigo-400" /> ④ Explain Decision Engine
                    </div>
                    <h4 className="text-sm font-black text-white mt-1">
                      Deep AI Meta-Cognitive Reasoning & Sources
                    </h4>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-3.5">
                      <div className="text-xs space-y-1">
                        <span className="text-[10px] text-slate-500 uppercase font-bold block">Used LLMs</span>
                        <div className="bg-slate-900 px-3 py-2 rounded-lg border border-slate-800 text-slate-200 font-mono text-[11px]">
                          {activeTrustMission.explanation.usedAI}
                        </div>
                      </div>
                      <div className="text-xs space-y-1">
                        <span className="text-[10px] text-slate-500 uppercase font-bold block">Used Memory</span>
                        <div className="bg-slate-900 px-3 py-2 rounded-lg border border-slate-800 text-slate-200 font-mono text-[11px] truncate">
                          {activeTrustMission.explanation.usedMemory}
                        </div>
                      </div>
                      <div className="text-xs space-y-1">
                        <span className="text-[10px] text-slate-500 uppercase font-bold block">Used Knowledge</span>
                        <div className="bg-slate-900 px-3 py-2 rounded-lg border border-slate-800 text-slate-200 font-mono text-[11px] truncate">
                          {activeTrustMission.explanation.usedKnowledge}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3.5">
                      <div className="text-xs space-y-1">
                        <span className="text-[10px] text-slate-500 uppercase font-bold block">Used Swarm Agents</span>
                        <div className="bg-slate-900 px-3 py-2 rounded-lg border border-slate-800 text-slate-200 font-mono text-[11px] truncate">
                          {activeTrustMission.explanation.usedAgent}
                        </div>
                      </div>
                      <div className="text-xs space-y-1">
                        <span className="text-[10px] text-slate-500 uppercase font-bold block">Used Web Grounding</span>
                        <div className="bg-slate-900 px-3 py-2 rounded-lg border border-slate-800 text-slate-200 font-mono text-[11px]">
                          {activeTrustMission.explanation.usedWeb}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 text-center">
                          <span className="text-[8px] text-slate-500 uppercase block">Fact Score</span>
                          <span className="text-xs font-black text-emerald-400 font-mono">{activeTrustMission.explanation.factScore}%</span>
                        </div>
                        <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 text-center">
                          <span className="text-[8px] text-slate-500 uppercase block">Confidence</span>
                          <span className="text-xs font-black text-indigo-400 font-mono">{activeTrustMission.explanation.confidenceScore}%</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-slate-400 bg-slate-900/40 p-3 rounded-lg leading-relaxed border border-slate-900">
                    <span className="font-extrabold text-slate-300 block mb-1">【意思決定の意思 / Rationale Summary】</span>
                    {activeTrustMission.explanation.rationale}
                  </p>
                </div>

                {/* 5. Rollback Engine (③) */}
                <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
                  <div>
                    <div className="text-[10px] text-slate-500 font-mono font-bold uppercase tracking-wider flex items-center gap-1">
                      <RefreshCw className="w-3.5 h-3.5 text-indigo-400" /> ③ Rollback Engine (Save & Restore)
                    </div>
                    <h4 className="text-sm font-black text-white mt-1">
                      State Recovery & Versioning Checkpoints
                    </h4>
                  </div>

                  <div className="space-y-3">
                    <div className="flex gap-1.5 overflow-x-auto pb-1">
                      {activeTrustMission.rollback.versions.map((v) => {
                        const isCurrent = activeTrustMission.rollback.currentVersion === v.version;
                        return (
                          <button
                            key={v.version}
                            onClick={() => handleRollbackVersion(activeTrustMission.id, v.version)}
                            className={`px-3 py-2 rounded-xl text-xs font-bold transition-all shrink-0 font-mono border ${
                              isCurrent
                                ? "bg-emerald-600/20 text-emerald-300 border-emerald-500/30"
                                : "bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200"
                            }`}
                          >
                            Version {v.version} {isCurrent && "★ (Active)"}
                            <div className="text-[9px] text-slate-500 mt-0.5">{v.timestamp}</div>
                          </button>
                        );
                      })}
                    </div>

                    {/* Diff viewer */}
                    {activeTrustMission.rollback.versions.map((v) => {
                      if (v.version !== activeTrustMission.rollback.currentVersion) return null;
                      return (
                        <div key={v.version} className="space-y-2">
                          <div className="flex justify-between items-center text-[10px] font-mono text-slate-500">
                            <span>CURRENT SAVEPOINT DIFF SUMMARY</span>
                            <span className="text-slate-400">{v.timestamp}</span>
                          </div>
                          <pre className="bg-slate-900 p-4 rounded-xl text-[11px] font-mono text-slate-300 overflow-x-auto border border-slate-800 max-h-40 leading-relaxed">
                            {v.diff}
                          </pre>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 6. Audit Trail Logs (⑦) */}
                <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
                  <div>
                    <div className="text-[10px] text-slate-500 font-mono font-bold uppercase tracking-wider flex items-center gap-1">
                      <Terminal className="w-3.5 h-3.5 text-emerald-400" /> ⑦ Immutable Audit Trail Logs
                    </div>
                    <h4 className="text-sm font-black text-white mt-1">
                      Compliance Audit Record Ledger
                    </h4>
                  </div>

                  <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                    {activeTrustMission.auditTrail.map((log, lIdx) => (
                      <div key={lIdx} className="bg-slate-900 p-4 rounded-xl border border-slate-800/80 space-y-2 text-xs">
                        <div className="flex justify-between items-center text-[10px] font-mono text-slate-500 pb-1.5 border-b border-slate-800/60">
                          <span>Operator: {log.who}</span>
                          <span>{log.when}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <span className="text-[9px] text-slate-500 font-bold block uppercase font-mono">What</span>
                            <span className="text-slate-200">{log.what}</span>
                          </div>
                          <div>
                            <span className="text-[9px] text-slate-500 font-bold block uppercase font-mono">Why</span>
                            <span className="text-slate-200">{log.why}</span>
                          </div>
                          <div>
                            <span className="text-[9px] text-slate-500 font-bold block uppercase font-mono">AI Judgement</span>
                            <span className="text-emerald-400 font-bold">{log.aiJudgement}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            </div>

            {/* Bottom Final Deliverable Card (Trust Architecture) */}
            <div className="bg-gradient-to-r from-emerald-950/20 via-slate-950 to-emerald-950/20 p-8 rounded-3xl border border-emerald-500/10 text-center space-y-4 shadow-2xl">
              <ShieldCheck className="w-12 h-12 text-emerald-400 mx-auto animate-pulse" />
              <div className="max-w-2xl mx-auto space-y-2">
                <h4 className="text-lg font-black text-white">
                  Sprint 20 Trustworthy Autonomous OS Architecture Released
                </h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  本スプリントにより、ACOS 2.0は「機密監査エンジンの自律介入」「多重ガード人間承認レイヤー」「シミュレーション主導安全担保」「セーブポイント復旧エンジン」を中枢に統合しました。これにより、AIが自律的に動きながらも、人間が安心して完全にコントロールできる「世界最高水準の信頼されるAI OS」が完成しました。
                </p>
              </div>
              <div className="inline-flex items-center gap-1.5 text-[10px] font-mono bg-emerald-500/10 text-emerald-300 px-3 py-1 rounded-full border border-emerald-500/20">
                <span>Secure-Hash: SHA-256 (ACOS_TRUST_V20_PROD)</span>
              </div>
            </div>

          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB: INTELLIGENCE BRAIN DASHBOARD (Sprint 19) */}
        {/* ========================================================================= */}
        {activeTab === "brain-dashboard" && (
          <div className="space-y-6 animate-fade-in" id="acos-intelligence-brain-dashboard">
            
            {/* Mission Intercept & Selector Panel */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Left Column (8/12): Input Intercept & View Controller */}
              <div className="lg:col-span-8 space-y-6">
                
                {/* 1. Interactive Mission Interceptor Form */}
                <div className="bg-slate-950 p-6 rounded-2xl border border-rose-500/10 space-y-4 shadow-xl">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-[10px] text-rose-400 font-mono font-bold uppercase tracking-wider flex items-center gap-1">
                        <Zap className="w-3.5 h-3.5" /> Core Interceptor & Parser
                      </div>
                      <h3 className="text-base font-black text-white mt-1">
                        Intelligence Brain Mission Interceptor
                      </h3>
                      <p className="text-xs text-slate-400">
                        ユーザー入力をそのままAIに渡さず、Brainが本質的な意図を構文解析し、最適な実行計画をプランニングします。
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={customMissionInput}
                      onChange={(e) => setCustomMissionInput(e.target.value)}
                      placeholder="例: クレジット決済の二重決済を防ぐ排他ロックAPI設計とコードを作って..."
                      className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-rose-500 transition-all font-sans"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && customMissionInput.trim()) {
                          triggerBrainThinking(customMissionInput);
                        }
                      }}
                      disabled={isThinking}
                    />
                    <button
                      onClick={() => triggerBrainThinking(customMissionInput)}
                      disabled={isThinking || !customMissionInput.trim()}
                      className={`px-5 py-2.5 rounded-xl text-xs font-bold font-sans flex items-center gap-2 transition-all shrink-0 ${
                        isThinking || !customMissionInput.trim()
                          ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                          : "bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/25 active:scale-95"
                      }`}
                    >
                      {isThinking ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin text-rose-300" /> Thinking...
                        </>
                      ) : (
                        <>
                          <Brain className="w-4 h-4 text-white" /> Brain Intercept
                        </>
                      )}
                    </button>
                  </div>

                  {/* Thinking step-by-step progress visualizer */}
                  {isThinking && (
                    <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 space-y-3 animate-pulse">
                      <div className="flex justify-between items-center text-xs text-slate-400">
                        <span className="flex items-center gap-1.5 font-bold text-rose-400 font-mono">
                          <Activity className="w-4 h-4 animate-bounce" /> Brain Meta-Cognition Loop Active...
                        </span>
                        <span className="font-mono text-[10px]">{Math.round((thinkingStep / 8) * 100)}%</span>
                      </div>
                      <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden">
                        <div 
                          className="bg-gradient-to-r from-rose-500 to-indigo-500 h-full transition-all duration-300" 
                          style={{ width: `${(thinkingStep / 8) * 100}%` }}
                        />
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] font-mono text-slate-400">
                        <div className={`p-1.5 rounded border transition-all ${thinkingStep >= 1 ? "bg-rose-950/20 border-rose-500/30 text-rose-300" : "border-slate-800 opacity-50"}`}>
                          1. Mission 理解
                        </div>
                        <div className={`p-1.5 rounded border transition-all ${thinkingStep >= 3 ? "bg-amber-950/20 border-amber-500/30 text-amber-300" : "border-slate-800 opacity-50"}`}>
                          2. Complexity 解析
                        </div>
                        <div className={`p-1.5 rounded border transition-all ${thinkingStep >= 5 ? "bg-indigo-950/20 border-indigo-500/30 text-indigo-300" : "border-slate-800 opacity-50"}`}>
                          3. AI/エージェント選定
                        </div>
                        <div className={`p-1.5 rounded border transition-all ${thinkingStep >= 7 ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-300" : "border-slate-800 opacity-50"}`}>
                          4. 思考/知識戦略適用
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Dashboard Controller / Tab Mode Switcher (簡単 / 詳細 / Developer) */}
                <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h4 className="text-sm font-bold text-slate-100 flex items-center gap-1.5">
                      <Settings2 className="w-4 h-4 text-rose-400" /> Dashboard View Mode
                    </h4>
                    <p className="text-[11px] text-slate-400">表示密度と認知レイヤーをワンタップで切り替え</p>
                  </div>
                  <div className="flex bg-slate-900 p-1.5 rounded-xl border border-slate-800 gap-1.5 self-start md:self-center">
                    <button
                      onClick={() => setBrainViewMode("easy")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${
                        brainViewMode === "easy"
                          ? "bg-rose-600 text-white shadow-md shadow-rose-600/10"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      簡単表示
                    </button>
                    <button
                      onClick={() => setBrainViewMode("detail")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${
                        brainViewMode === "detail"
                          ? "bg-rose-600 text-white shadow-md shadow-rose-600/10"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      詳細表示
                    </button>
                    <button
                      onClick={() => setBrainViewMode("developer")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${
                        brainViewMode === "developer"
                          ? "bg-rose-600 text-white shadow-md shadow-rose-600/10"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      Developer表示
                    </button>
                  </div>
                </div>

                {/* 2. Primary Brain Core Outputs based on active tab and view state */}
                <div className="space-y-6">
                  
                  {/* View: EASY DISPLAY */}
                  {brainViewMode === "easy" && (
                    <div className="space-y-6">
                      
                      {/* Abstract Card of Brain Decisions */}
                      <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
                        <div className="flex justify-between items-center border-b border-slate-900 pb-3">
                          <h4 className="text-xs font-black text-rose-400 font-mono tracking-wider uppercase">Active Thought Alignment</h4>
                          <span className="text-[10px] font-mono text-slate-500">{activeBrain.timestamp}</span>
                        </div>
                        <div className="text-sm font-medium text-slate-200 leading-relaxed italic bg-slate-900/40 p-4 rounded-xl border border-slate-850">
                          &ldquo;{activeBrain.input}&rdquo;
                        </div>

                        {/* Bento Grid layout representing outcome indicator choices */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                          <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-850 space-y-1.5">
                            <span className="text-[10px] text-slate-500 font-bold font-mono">① MISSION UNDERSTANDING</span>
                            <div className="flex flex-wrap gap-1">
                              {activeBrain.understanding.categories.map(c => (
                                <span key={c} className="px-2 py-0.5 bg-rose-500/10 border border-rose-500/20 rounded-full text-[10px] text-rose-300 font-bold font-mono">
                                  {c}
                                </span>
                              ))}
                            </div>
                            <p className="text-[11px] text-slate-400 line-clamp-2">{activeBrain.understanding.rationale}</p>
                          </div>

                          <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-850 space-y-1.5">
                            <span className="text-[10px] text-slate-500 font-bold font-mono">② COMPLEXITY DIAGNOSIS</span>
                            <div className="flex items-center gap-1.5">
                              <span className="px-2 py-0.5 bg-red-950 border border-red-500/20 text-red-400 font-black font-mono text-[10px] rounded-md">
                                {activeBrain.complexity.difficulty}
                              </span>
                              <span className="text-xs font-black text-slate-200">Fact: {activeBrain.complexity.factImportance}</span>
                            </div>
                            <p className="text-[11px] text-slate-400 font-mono">
                              Est: <span className="text-slate-200 font-bold">{activeBrain.complexity.predictedTimeMinutes} min</span> | Agents: <span className="text-slate-200 font-bold">{activeBrain.complexity.agentsRequired}</span>
                            </p>
                          </div>

                          <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-850 space-y-1.5">
                            <span className="text-[10px] text-slate-500 font-bold font-mono">⑦ COGNITIVE METHOD</span>
                            <div className="text-xs font-black text-indigo-300 font-mono flex items-center gap-1">
                              <Compass className="w-3.5 h-3.5 text-indigo-400" /> {activeBrain.thinkingStrategy.mode}
                            </div>
                            <p className="text-[11px] text-slate-400 line-clamp-2">{activeBrain.thinkingStrategy.description}</p>
                          </div>
                        </div>
                      </div>

                      {/* Visual Architecture Flow: Brain -> Workflow -> Agent -> Quality */}
                      <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
                        <div className="flex justify-between items-center">
                          <h4 className="text-xs font-black text-white font-mono tracking-wider uppercase flex items-center gap-1.5">
                            <Layers className="w-4 h-4 text-rose-400" /> ⑧ Brain OS Priority Architecture Visualizer
                          </h4>
                          <span className="px-2 py-0.5 bg-rose-500/10 text-rose-400 font-mono text-[9px] rounded-full border border-rose-500/20">
                            Brain (上位) ➔ Workflow ➔ Agent ➔ Quality
                          </span>
                        </div>

                        <div className="relative p-4 bg-slate-900 rounded-xl border border-slate-850 flex flex-col md:flex-row justify-between items-stretch gap-3 md:gap-2">
                          
                          {/* Node 1: Brain (Authority) */}
                          <div className="flex-1 p-3 rounded-lg bg-rose-950/20 border border-rose-500/20 relative flex flex-col justify-between">
                            <div>
                              <div className="text-[9px] font-mono font-bold text-rose-400 uppercase tracking-widest">LAYER 01</div>
                              <div className="text-xs font-black text-white mt-1 flex items-center gap-1">
                                <Brain className="w-3.5 h-3.5 text-rose-400" /> Central Brain
                              </div>
                              <p className="text-[10px] text-slate-400 mt-1 leading-normal">ユーザー入力を検証、特化思考モデル({activeBrain.thinkingStrategy.mode})をロックオン。</p>
                            </div>
                            <div className="text-[9px] font-mono text-rose-300 mt-2 bg-rose-950/40 px-2 py-1 rounded border border-rose-500/10">
                              Status: AUTHORIZED
                            </div>
                          </div>

                          <div className="hidden md:flex items-center justify-center text-slate-600">
                            <ArrowRight className="w-5 h-5 animate-pulse" />
                          </div>

                          {/* Node 2: Dynamic Workflow (Planner) */}
                          <div className="flex-1 p-3 rounded-lg bg-indigo-950/20 border border-indigo-500/20 relative flex flex-col justify-between">
                            <div>
                              <div className="text-[9px] font-mono font-bold text-indigo-400 uppercase tracking-widest">LAYER 02</div>
                              <div className="text-xs font-black text-white mt-1 flex items-center gap-1">
                                <GitBranch className="w-3.5 h-3.5 text-indigo-400" /> Dynamic DAG
                              </div>
                              <p className="text-[10px] text-slate-400 mt-1 leading-normal">{activeBrain.plan.length}ステップの実行パスを自律作成。Workflow固定を排除。</p>
                            </div>
                            <div className="text-[9px] font-mono text-indigo-300 mt-2 bg-indigo-950/40 px-2 py-1 rounded border border-indigo-500/10 truncate">
                              Plan: {activeBrain.plan.slice(0, 2).map(p => p.step.split("/")[0]).join("➔")}...
                            </div>
                          </div>

                          <div className="hidden md:flex items-center justify-center text-slate-600">
                            <ArrowRight className="w-5 h-5 animate-pulse" />
                          </div>

                          {/* Node 3: Agent Allocation */}
                          <div className="flex-1 p-3 rounded-lg bg-amber-950/20 border border-amber-500/20 relative flex flex-col justify-between">
                            <div>
                              <div className="text-[9px] font-mono font-bold text-amber-400 uppercase tracking-widest">LAYER 03</div>
                              <div className="text-xs font-black text-white mt-1 flex items-center gap-1">
                                <Users className="w-3.5 h-3.5 text-amber-400" /> Agent Swarm
                              </div>
                              <p className="text-[10px] text-slate-400 mt-1 leading-normal">不要エージェントの起動を完全禁止。必要スレッドのみに電力を集約。</p>
                            </div>
                            <div className="text-[9px] font-mono text-amber-300 mt-2 bg-amber-950/40 px-2 py-1 rounded border border-amber-500/10 truncate">
                              Active: {activeBrain.agents.filter(a => a.status === "active").length} Nodes
                            </div>
                          </div>

                          <div className="hidden md:flex items-center justify-center text-slate-600">
                            <ArrowRight className="w-5 h-5 animate-pulse" />
                          </div>

                          {/* Node 4: Quality & Delivery */}
                          <div className="flex-1 p-3 rounded-lg bg-emerald-950/20 border border-emerald-500/20 relative flex flex-col justify-between">
                            <div>
                              <div className="text-[9px] font-mono font-bold text-emerald-400 uppercase tracking-widest">LAYER 04</div>
                              <div className="text-xs font-black text-white mt-1 flex items-center gap-1">
                                <Award className="w-3.5 h-3.5 text-emerald-400" /> Goal Success
                              </div>
                              <p className="text-[10px] text-slate-400 mt-1 leading-normal">事実検証(Fact) & 提出禁止監査(Locked)を経て究極の目的成果を担保。</p>
                            </div>
                            <div className="text-[9px] font-mono text-emerald-300 mt-2 bg-emerald-950/40 px-2 py-1 rounded border border-emerald-500/10 text-center">
                              Target Goal Compliance
                            </div>
                          </div>

                        </div>
                      </div>

                    </div>
                  )}

                  {/* View: DETAILED DISPLAY */}
                  {brainViewMode === "detail" && (
                    <div className="space-y-6">
                      
                      {/* Active Mission Raw Input */}
                      <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-2">
                        <div className="text-[10px] text-rose-400 font-mono font-bold uppercase tracking-wider">Active Mission Input</div>
                        <p className="text-sm font-bold text-white leading-relaxed">{activeBrain.input}</p>
                      </div>

                      {/* Planner, AIs, and Agents Detailed Bento Grid */}
                      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
                        
                        {/* Left Side (7/12): Planner & AI Selections */}
                        <div className="xl:col-span-7 space-y-6">
                          
                          {/* ③ Brain Planner Progress Panel */}
                          <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
                            <h4 className="text-xs font-black text-white font-mono tracking-wider uppercase flex items-center gap-1.5">
                              <GitBranch className="w-4 h-4 text-rose-400 animate-pulse" /> ③ Brain Planner: Custom Execution DAG
                            </h4>
                            <p className="text-xs text-slate-400">
                              固定Workflowを排除し、難易度とミッション種別に合わせてオンデマンドに生成された最短最適パス。
                            </p>

                            <div className="relative pl-6 space-y-4 pt-1">
                              {/* vertical pipeline line */}
                              <div className="absolute left-[11px] top-3 bottom-3 w-0.5 bg-slate-800" />
                              
                              {activeBrain.plan.map((step, idx) => (
                                <div key={idx} className="relative flex gap-3 items-start">
                                  <div className="absolute -left-6 mt-1 flex items-center justify-center">
                                    <div className="w-6 h-6 rounded-full bg-slate-900 border-2 border-rose-500 flex items-center justify-center text-[10px] font-bold text-rose-400 font-mono">
                                      {idx+1}
                                    </div>
                                  </div>
                                  <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-850 flex-1 flex justify-between items-center gap-2">
                                    <div>
                                      <div className="text-xs font-bold text-slate-100">{step.step}</div>
                                      <div className="text-[10px] text-slate-400 mt-0.5">{step.description}</div>
                                    </div>
                                    <span className="px-2 py-0.5 bg-emerald-950 text-emerald-400 text-[9px] font-mono font-bold rounded-full border border-emerald-500/20">
                                      Ready / 最適化
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* ④ AI Selection Brain */}
                          <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
                            <h4 className="text-xs font-black text-white font-mono tracking-wider uppercase flex items-center gap-1.5">
                              <Cpu className="w-4 h-4 text-indigo-400" /> ④ AI Selection Brain
                            </h4>
                            <p className="text-xs text-slate-400">
                              品質、速度、コスト、および得意分野をパラメータ判定し、最適な処理を割り振るインテリジェントルーティング。
                            </p>

                            <div className="space-y-3.5">
                              {activeBrain.aiSelection.map((ai) => (
                                <div 
                                  key={ai.model}
                                  className={`p-4 rounded-xl border transition-all ${
                                    ai.selected 
                                      ? "bg-indigo-950/20 border-indigo-500/40 shadow-lg shadow-indigo-500/5" 
                                      : "bg-slate-900/40 border-slate-850 opacity-60"
                                  }`}
                                >
                                  <div className="flex justify-between items-start">
                                    <div>
                                      <span className="text-[9px] font-mono font-black text-indigo-400 tracking-wider uppercase">{ai.provider} Engine</span>
                                      <h5 className="text-xs font-black text-slate-100 flex items-center gap-1.5">
                                        {ai.model} 
                                        {ai.selected && <span className="px-1.5 py-0.5 bg-rose-600 text-white text-[8px] font-mono rounded font-bold">Selected</span>}
                                      </h5>
                                    </div>
                                    <div className="text-right text-[10px] font-mono text-slate-400">
                                      得意: <span className="text-slate-200 font-bold">{ai.strength}</span>
                                    </div>
                                  </div>

                                  {/* Rationale explaining decision */}
                                  <div className="text-[10px] text-slate-400 mt-2 bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-850">
                                    <span className="text-rose-400 font-bold">Selection Rationale:</span> {ai.rationale}
                                  </div>

                                  {/* Metrics parameters */}
                                  <div className="grid grid-cols-3 gap-3 mt-3 text-[9px] font-mono">
                                    <div>
                                      <div className="flex justify-between text-slate-500"><span>Quality (品質)</span> <span>{ai.quality}%</span></div>
                                      <div className="w-full bg-slate-900 h-1 rounded-full overflow-hidden mt-0.5">
                                        <div className="bg-indigo-400 h-full" style={{ width: `${ai.quality}%` }} />
                                      </div>
                                    </div>
                                    <div>
                                      <div className="flex justify-between text-slate-500"><span>Speed (速度)</span> <span>{ai.speed}%</span></div>
                                      <div className="w-full bg-slate-900 h-1 rounded-full overflow-hidden mt-0.5">
                                        <div className="bg-emerald-400 h-full" style={{ width: `${ai.speed}%` }} />
                                      </div>
                                    </div>
                                    <div>
                                      <div className="flex justify-between text-slate-500"><span>Cost (コスト)</span> <span>{ai.cost}%</span></div>
                                      <div className="w-full bg-slate-900 h-1 rounded-full overflow-hidden mt-0.5">
                                        <div className="bg-rose-400 h-full" style={{ width: `${ai.cost}%` }} />
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                        </div>

                        {/* Right Side (5/12): Agent Selection, Thinking/Knowledge Strategy */}
                        <div className="xl:col-span-5 space-y-6">
                          
                          {/* ⑤ Agent Selection Brain */}
                          <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
                            <h4 className="text-xs font-black text-white font-mono tracking-wider uppercase flex items-center gap-1.5">
                              <Users className="w-4 h-4 text-amber-400 animate-pulse" /> ⑤ Agent Selection Brain
                            </h4>
                            <p className="text-xs text-slate-400">
                              電力とトークンリソース保護のため、不要エージェントの並列スレッドを禁止。
                            </p>

                            <div className="space-y-2.5">
                              {activeBrain.agents.map((agent) => (
                                <div key={agent.name} className="bg-slate-900/60 p-3 rounded-xl border border-slate-850 flex flex-col gap-1.5">
                                  <div className="flex justify-between items-center">
                                    <div>
                                      <div className="text-xs font-bold text-slate-200">{agent.name}</div>
                                      <div className="text-[10px] text-slate-500">{agent.role}</div>
                                    </div>
                                    <span className={`px-2 py-0.5 text-[9px] font-mono font-black uppercase rounded border ${
                                      agent.status === "active" 
                                        ? "bg-emerald-950 text-emerald-400 border-emerald-500/20" 
                                        : "bg-red-950 text-red-400 border-red-500/20"
                                    }`}>
                                      {agent.status}
                                    </span>
                                  </div>
                                  <div className="text-[10px] text-slate-400 font-mono bg-slate-950 p-2 rounded leading-snug">
                                    <span className="text-slate-500">Reason:</span> {agent.reason}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* ⑥ Knowledge Strategy */}
                          <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-3">
                            <h4 className="text-xs font-black text-white font-mono tracking-wider uppercase flex items-center gap-1.5">
                              <Database className="w-4 h-4 text-emerald-400" /> ⑥ Knowledge Strategy
                            </h4>
                            <div className="flex flex-wrap gap-1.5">
                              {["Memory", "Knowledge", "RAG", "Web", "Local", "社内DB"].map(src => {
                                const isIncluded = activeBrain.knowledgeStrategy.sources.includes(src);
                                return (
                                  <span key={src} className={`px-2 py-0.5 text-[9px] font-mono font-bold rounded-md border ${
                                    isIncluded ? "bg-emerald-950 text-emerald-300 border-emerald-500/30 font-black animate-pulse" : "bg-slate-900 text-slate-600 border-slate-800/40"
                                  }`}>
                                    {src}
                                  </span>
                                );
                              })}
                            </div>
                            <p className="text-xs text-slate-400 leading-relaxed font-mono bg-slate-900 p-3 rounded-xl border border-slate-850 mt-1">
                              {activeBrain.knowledgeStrategy.description}
                            </p>
                          </div>

                          {/* ⑦ Thinking Strategy */}
                          <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-3">
                            <h4 className="text-xs font-black text-white font-mono tracking-wider uppercase flex items-center gap-1.5">
                              <Compass className="w-4 h-4 text-cyan-400" /> ⑦ Thinking Strategy
                            </h4>
                            <div className="inline-flex px-2.5 py-1 bg-cyan-950/20 border border-cyan-500/20 text-cyan-400 font-mono text-xs font-black rounded-lg">
                              Mode: {activeBrain.thinkingStrategy.mode}
                            </div>
                            <p className="text-xs text-slate-400 leading-relaxed font-mono bg-slate-900 p-3 rounded-xl border border-slate-850 mt-1">
                              {activeBrain.thinkingStrategy.description}
                            </p>
                          </div>

                        </div>

                      </div>

                    </div>
                  )}

                  {/* View: DEVELOPER DISPLAY */}
                  {brainViewMode === "developer" && (
                    <div className="space-y-6">
                      
                      {/* JSON Schema Representing Truth without Slop */}
                      <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-3 font-mono">
                        <div className="flex justify-between items-center">
                          <h4 className="text-xs font-black text-white uppercase tracking-wider">Brain Low-Level Memory Heap Block</h4>
                          <span className="text-[10px] text-indigo-400">Namespace: ACOS.Brain.Core</span>
                        </div>
                        <pre className="text-[11px] text-emerald-400 bg-slate-900 p-4 rounded-xl border border-slate-850 overflow-x-auto leading-relaxed max-h-[400px]">
                          {JSON.stringify(activeBrain, null, 2)}
                        </pre>
                      </div>

                      {/* Active Terminal Stream */}
                      <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-3 font-mono">
                        <div className="flex justify-between items-center">
                          <h4 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1">
                            <Terminal className="w-4 h-4 text-rose-400" /> Active System Audit Stream
                          </h4>
                          <button 
                            onClick={() => setLogs([])}
                            className="text-[10px] text-slate-500 hover:text-slate-300 transition-all underline"
                          >
                            Clear
                          </button>
                        </div>
                        <div className="bg-slate-900 p-4 rounded-xl border border-slate-850 text-[10px] text-slate-400 space-y-1.5 h-[240px] overflow-y-auto leading-relaxed">
                          {logs.map((log, idx) => (
                            <div key={idx} className="hover:bg-slate-950 py-0.5 px-1 rounded">
                              {log}
                            </div>
                          ))}
                          {logs.length === 0 && <div className="text-slate-600">// No logs emitted in current heap thread buffer.</div>}
                        </div>
                      </div>

                    </div>
                  )}

                </div>

                {/* ⑨ Self Optimization interactive Block */}
                <div className="bg-slate-950 p-6 rounded-2xl border border-rose-500/15 space-y-4 shadow-lg">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-[10px] text-rose-400 font-mono font-bold uppercase tracking-wider flex items-center gap-1">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Self Optimization Engine
                      </div>
                      <h4 className="text-sm font-black text-white mt-1">⑨ Brain Self-Evaluation & Evolutionary Optimizer</h4>
                      <p className="text-xs text-slate-400">
                        ミッション完了後、Brain自身の思考プロセス、モデル選択、戦略判断の適正さを評価し、次回推論のための最適化ルールを自動書き換えします。
                      </p>
                    </div>
                  </div>

                  {activeBrain.selfOptimization.evaluated ? (
                    <div className="bg-slate-900 p-4 rounded-xl border border-emerald-500/20 space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-black text-emerald-400 font-mono flex items-center gap-1">
                          <CheckCircle2 className="w-4 h-4" /> Optimizations Applied & Saved
                        </span>
                        <div className="flex items-center gap-1 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-500/20 text-xs font-mono font-black text-emerald-400">
                          Rating: {activeBrain.selfOptimization.rating} / 5.00
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px] font-mono text-slate-300 pt-1">
                        <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                          <span className="text-emerald-400 font-bold">● Pros (強み評価):</span>
                          <p className="text-slate-400 mt-1 leading-normal">{activeBrain.selfOptimization.pros}</p>
                        </div>
                        <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                          <span className="text-amber-400 font-bold">● Cons (課題判定):</span>
                          <p className="text-slate-400 mt-1 leading-normal">{activeBrain.selfOptimization.cons}</p>
                        </div>
                        <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                          <span className="text-rose-400 font-bold">● Next Action (次回改善):</span>
                          <p className="text-slate-400 mt-1 leading-normal">{activeBrain.selfOptimization.nextImprovement}</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-slate-900 p-4 rounded-xl border border-slate-850 space-y-4">
                      <div className="text-xs font-black text-slate-300">今回の判断を評価・自己最適化プロセスを実行：</div>
                      <div className="flex flex-col md:flex-row items-stretch gap-3">
                        <button
                          onClick={() => handleSelfEvaluate(selectedBrainIdx)}
                          className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-sans font-bold text-xs rounded-lg transition-all shadow-md shadow-rose-600/15"
                        >
                          自己評価とルール適用を実行
                        </button>
                        <div className="text-[10px] font-mono text-slate-500 flex items-center">
                          // クリックすると今回のモデル選定・知識戦略ログをBrainが自律的に評価します。
                        </div>
                      </div>
                    </div>
                  )}
                </div>

              </div>

              {/* Right Column (4/12): Preset Mission Selector & Architecture Telemetry */}
              <div className="lg:col-span-4 space-y-6">
                
                {/* Preset List Selection */}
                <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
                  <div className="flex justify-between items-center">
                    <h4 className="text-xs font-black text-white font-mono tracking-wider uppercase">Active Thought Buffers</h4>
                    <span className="px-1.5 py-0.5 bg-rose-500/20 text-rose-400 font-mono text-[8px] font-bold rounded">Sprint 19 Heap</span>
                  </div>
                  
                  <div className="space-y-2.5">
                    {brainMissions.map((bm, idx) => (
                      <button
                        key={bm.id}
                        onClick={() => setSelectedBrainIdx(idx)}
                        className={`w-full p-4 rounded-xl text-left border transition-all ${
                          selectedBrainIdx === idx
                            ? "bg-rose-950/10 border-rose-500/50 shadow-lg shadow-rose-500/5"
                            : "bg-slate-900/40 border-slate-850 text-slate-400 hover:border-slate-800 hover:bg-slate-900"
                        }`}
                      >
                        <div className="flex justify-between items-start">
                          <span className="text-[9px] font-mono text-slate-500 font-bold uppercase">Mission Buffer 0{idx+1}</span>
                          {bm.selfOptimization.evaluated && (
                            <span className="px-1.5 py-0.5 bg-emerald-950 text-emerald-400 text-[8px] font-mono rounded font-bold border border-emerald-500/10">
                              Optimized
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-bold text-slate-100 mt-1 line-clamp-2 leading-relaxed">
                          {bm.input}
                        </p>
                        
                        <div className="mt-3 flex items-center gap-1.5 text-[9px] font-mono text-slate-500">
                          <span>Difficulty:</span>
                          <span className="text-rose-400 font-bold">{bm.complexity.difficulty}</span>
                          <span>|</span>
                          <span>Mode:</span>
                          <span className="text-indigo-400 font-bold">{bm.thinkingStrategy.mode}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Cognitive Architecture Explainer Card */}
                <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
                  <h4 className="text-xs font-black text-white font-mono tracking-wider uppercase flex items-center gap-1">
                    <BookOpen className="w-4 h-4 text-indigo-400" /> Evolution Architecture
                  </h4>
                  <div className="bg-slate-900 p-3.5 rounded-xl border border-slate-850 space-y-2 text-[11px] font-mono leading-relaxed text-slate-400">
                    <div className="text-white font-bold text-xs border-b border-slate-800 pb-1.5">Intelligence Brain Hierarchy</div>
                    <div>
                      <span className="text-rose-400 font-black">Level 1: Central Brain</span>
                      <p className="text-[10px] mt-0.5 leading-normal text-slate-500">ユーザーからのインプットをそのままモデルに引き渡すチャット方式を完全廃止。最上位に君臨。</p>
                    </div>
                    <div>
                      <span className="text-indigo-400 font-black">Level 2: Workflow (Planner)</span>
                      <p className="text-[10px] mt-0.5 leading-normal text-slate-500">分類・難易度ごとに、自律エージェントの動的実行計画DAG図を自動展開。</p>
                    </div>
                    <div>
                      <span className="text-amber-400 font-black">Level 3: Agent Core</span>
                      <p className="text-[10px] mt-0.5 leading-normal text-slate-500">タスク完遂に不要なエージェントへの処理委譲・並行電力をシャットダウン制限。</p>
                    </div>
                    <div>
                      <span className="text-emerald-400 font-black">Level 4: Quality & Fact Checks</span>
                      <p className="text-[10px] mt-0.5 leading-normal text-slate-500">FSA/FCA等の外部公的ソースを参照、目的の達成度と自己検証を経て成果物完成へ。</p>
                    </div>
                  </div>
                </div>

              </div>

            </div>

          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB: OUTCOME DASHBOARD (⑥) */}
        {/* ========================================================================= */}
        {activeTab === "outcome-dashboard" && (
          <div className="space-y-6 animate-fade-in" id="outcome-intelligence-dashboard">
            {/* Top Mission Selector & Quick Stats */}
            <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                  <div className="text-[10px] text-emerald-400 font-mono font-bold uppercase tracking-wider">ACOS OS Sprint 18 Foundation</div>
                  <h3 className="text-lg font-black text-white flex items-center gap-2 mt-0.5">
                    <Award className="w-5 h-5 text-emerald-400" /> Outcome Intelligence Dashboard
                  </h3>
                  <p className="text-xs text-slate-400">Evaluating ultimate purpose over simple deliverables. Aiming for real-world impact and business conversion.</p>
                </div>
              </div>

              {/* Grid of active outcome missions */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                {outcomeMissions.map((m, idx) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      setSelectedOutcomeIdx(idx);
                      setSubmissionSuccessMessage(null);
                    }}
                    className={`p-4 rounded-xl text-left transition-all border ${
                      selectedOutcomeIdx === idx
                        ? "bg-emerald-950/20 border-emerald-500 text-white shadow-lg shadow-emerald-500/5"
                        : "bg-slate-900/60 border-slate-850 text-slate-400 hover:border-slate-800 hover:bg-slate-900"
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div className="text-xs font-black font-mono uppercase text-slate-500 tracking-wide">Mission 0{idx+1}</div>
                      <span className={`px-2 py-0.5 text-[9px] font-mono font-bold rounded-full border ${
                        m.isLocked 
                          ? "bg-amber-950 text-amber-400 border-amber-500/20 animate-pulse" 
                          : "bg-emerald-950 text-emerald-400 border-emerald-500/20"
                      }`}>
                        {m.isLocked ? "Prohibited / 提出禁止中" : "Approved / 提出可能"}
                      </span>
                    </div>
                    <div className="text-sm font-bold text-slate-100 mt-1">{m.missionName}</div>
                    <div className="text-xs text-emerald-400 mt-1 font-medium flex items-center gap-1">
                      <Compass className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">Goal: {m.ultimateGoal}</span>
                    </div>

                    {/* Progress parameters row */}
                    <div className="mt-3 grid grid-cols-3 gap-2 pt-2.5 border-t border-slate-800/60 text-[10px] font-mono text-slate-500">
                      <div>
                        <span>Success Rate</span>
                        <div className="text-white font-bold text-xs mt-0.5">{m.successRate}%</div>
                      </div>
                      <div>
                        <span>Missing Rate</span>
                        <div className="text-amber-400 font-bold text-xs mt-0.5">{m.missingRate}%</div>
                      </div>
                      <div>
                        <span>Fact Rating</span>
                        <div className="text-emerald-400 font-bold text-xs mt-0.5">{m.factRate}%</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Main Outcome Mission Panel */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
              
              {/* Left Column (8/12): Prediction, Missing items, Recommendations */}
              <div className="xl:col-span-8 space-y-6">
                
                {/* 1. Goal & Outcome Prediction Panel */}
                <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
                  <div className="flex justify-between items-center border-b border-slate-850 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="p-1.5 bg-indigo-500/10 rounded-lg text-indigo-400"><TrendingUp className="w-4 h-4" /></span>
                      <div>
                        <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">① Goal success & ② Outcome prediction results</h4>
                        <p className="text-[10px] text-slate-500">Evaluating parameters targeting goal success probability.</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-slate-500 block font-mono">Current Stage</span>
                      <span className="text-xs font-semibold text-indigo-400 font-mono">{activeOutcome.currentStage}</span>
                    </div>
                  </div>

                  {/* Ultimate Goal Definition Display */}
                  <div className="p-4 bg-slate-900/40 rounded-xl border border-slate-850 space-y-2">
                    <div className="text-[10px] text-slate-500 font-bold font-mono">CORE PURPOSE / ULTIMATE GOAL (成果物ではなく目的を評価対象にする)</div>
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-200">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                      <span>{activeOutcome.ultimateGoal}</span>
                    </div>
                  </div>

                  {/* 5-Metrics Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-2">
                    <div className="bg-slate-900 p-3 rounded-xl border border-slate-850 text-center space-y-1">
                      <span className="text-[9px] text-slate-500 font-mono font-bold block">SUCCESS PROBABILITY</span>
                      <span className="text-lg font-black text-white font-mono">{activeOutcome.successRate}%</span>
                    </div>
                    <div className="bg-slate-900 p-3 rounded-xl border border-slate-850 text-center space-y-1">
                      <span className="text-[9px] text-slate-500 font-mono font-bold block">GOAL ACHIEVEMENT</span>
                      <span className="text-lg font-black text-emerald-400 font-mono">{activeOutcome.achievementRate}%</span>
                    </div>
                    <div className="bg-slate-900 p-3 rounded-xl border border-slate-850 text-center space-y-1">
                      <span className="text-[9px] text-slate-500 font-mono font-bold block">MISSING RATE</span>
                      <span className="text-lg font-black text-amber-500 font-mono">{activeOutcome.missingRate}%</span>
                    </div>
                    <div className="bg-slate-900 p-3 rounded-xl border border-slate-850 text-center space-y-1">
                      <span className="text-[9px] text-slate-500 font-mono font-bold block">FACT TRUST RATE</span>
                      <span className="text-lg font-black text-indigo-400 font-mono">{activeOutcome.factRate}%</span>
                    </div>
                    <div className="bg-slate-900 p-3 rounded-xl border border-slate-850 text-center space-y-1 col-span-2 md:col-span-1">
                      <span className="text-[9px] text-slate-500 font-mono font-bold block">CONFIDENCE</span>
                      <span className="text-lg font-black text-pink-400 font-mono">{activeOutcome.confidence}%</span>
                    </div>
                  </div>

                  {/* Predicted Outcome Sentences */}
                  <div className="space-y-2 pt-1">
                    <span className="text-[10px] text-slate-500 font-mono font-bold uppercase block">Predicted Real-World Consequences / Outcomes</span>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {activeOutcome.predictedOutcomes.map((o, idx) => (
                        <div key={idx} className="p-3 bg-slate-900/60 rounded-xl border border-slate-850 text-xs text-slate-300 leading-relaxed flex gap-2">
                          <span className="text-indigo-400 font-bold font-mono shrink-0">#{idx + 1}</span>
                          <span>{o}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 2. Missing Detection (③) */}
                <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
                  <div className="flex justify-between items-center border-b border-slate-850 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="p-1.5 bg-amber-500/10 rounded-lg text-amber-400"><ShieldAlert className="w-4 h-4" /></span>
                      <div>
                        <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">③ Missing Detection Engine</h4>
                        <p className="text-[10px] text-slate-500">Autonomous checklist of explanation gaps, data lack, risks, legal rules, and oversights before submitting.</p>
                      </div>
                    </div>
                    <span className="text-xs font-mono font-bold text-amber-400">
                      {activeOutcome.missingItems.length} Gaps Detected
                    </span>
                  </div>

                  {/* Missing items checklist rendering */}
                  <div className="space-y-2">
                    {activeOutcome.missingItems.map((item, idx) => (
                      <div key={idx} className="p-3 bg-slate-900/40 hover:bg-slate-900/60 rounded-xl border border-slate-850 flex items-start justify-between gap-4 transition-all">
                        <div className="flex items-start gap-2.5">
                          <span className={`px-1.5 py-0.5 text-[8px] font-mono font-bold rounded uppercase mt-0.5 shrink-0 ${
                            item.riskLevel === "High" ? "bg-rose-950 text-rose-400 border border-rose-500/20" : "bg-amber-950 text-amber-400 border border-amber-500/20"
                          }`}>
                            {item.category}
                          </span>
                          <span className="text-xs text-slate-300 leading-relaxed">{item.description}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[10px] text-slate-500 font-mono">Severity:</span>
                          <span className={`text-[10px] font-bold font-mono ${
                            item.riskLevel === "High" ? "text-rose-400" : "text-amber-400"
                          }`}>{item.riskLevel}</span>
                          <button
                            onClick={() => {
                              const updated = [...outcomeMissions];
                              updated[selectedOutcomeIdx].missingItems = updated[selectedOutcomeIdx].missingItems.filter((_, i) => i !== idx);
                              // Lower the missing rate mathematically!
                              const remaining = updated[selectedOutcomeIdx].missingItems.length;
                              updated[selectedOutcomeIdx].missingRate = remaining === 0 ? 0 : Math.round((remaining / 5) * 20);
                              updated[selectedOutcomeIdx].successRate = Math.min(100, updated[selectedOutcomeIdx].successRate + 4);
                              updated[selectedOutcomeIdx].isLocked = remaining > 1; // Unlock if 1 or 0 gaps remain!
                              setOutcomeMissions(updated);
                              addLog(`[③ MISSING] Resolved gap item "${item.category}". Recalculated outcome metrics.`);
                            }}
                            className="text-[10px] text-emerald-400 hover:text-emerald-300 font-bold uppercase ml-2 px-2 py-0.5 bg-slate-950 rounded border border-slate-800 cursor-pointer"
                          >
                            Resolve / 解決
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Add interactive Gap simulation to test resolving it */}
                  <div className="p-4 bg-slate-900/60 rounded-xl border border-slate-850/80 space-y-3 pt-3">
                    <div className="text-[10px] text-slate-500 font-bold font-mono">SIMULATE DETECTING A NEW GAP</div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <select
                        value={newMissingCategory}
                        onChange={(e) => setNewMissingCategory(e.target.value)}
                        className="bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white"
                      >
                        <option>Explanation/説明不足</option>
                        <option>Data/データ不足</option>
                        <option>Figures/図不足</option>
                        <option>Comparison/比較不足</option>
                        <option>Legal/法的注意</option>
                        <option>Risk/リスク</option>
                      </select>
                      <input
                        type="text"
                        value={newMissingDesc}
                        onChange={(e) => setNewMissingDesc(e.target.value)}
                        placeholder="e.g. Missing operational latency data charts..."
                        className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white sm:col-span-2"
                      />
                    </div>
                    <div className="flex justify-between items-center">
                      <div className="flex gap-4 text-[10px] font-mono text-slate-400">
                        <span>Risk Level:</span>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input type="radio" checked={newMissingRisk === "High"} onChange={() => setNewMissingRisk("High")} className="w-3 h-3 text-indigo-600 bg-slate-950 border-slate-800" /> High
                        </label>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input type="radio" checked={newMissingRisk === "Medium"} onChange={() => setNewMissingRisk("Medium")} className="w-3 h-3 text-indigo-600 bg-slate-950 border-slate-800" /> Medium
                        </label>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input type="radio" checked={newMissingRisk === "Low"} onChange={() => setNewMissingRisk("Low")} className="w-3 h-3 text-indigo-600 bg-slate-950 border-slate-800" /> Low
                        </label>
                      </div>
                      <button
                        onClick={() => {
                          if (!newMissingDesc.trim()) return;
                          const updated = [...outcomeMissions];
                          updated[selectedOutcomeIdx].missingItems.push({
                            category: newMissingCategory,
                            description: newMissingDesc,
                            riskLevel: newMissingRisk
                          });
                          updated[selectedOutcomeIdx].missingRate = Math.round((updated[selectedOutcomeIdx].missingItems.length / 5) * 20);
                          updated[selectedOutcomeIdx].successRate = Math.max(50, updated[selectedOutcomeIdx].successRate - 5);
                          updated[selectedOutcomeIdx].isLocked = true; // High gaps lock it again!
                          setOutcomeMissions(updated);
                          setNewMissingDesc("");
                          addLog(`[③ MISSING] Manually detected new objective gap: [${newMissingCategory}] ${newMissingDesc}`);
                        }}
                        className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-lg cursor-pointer"
                      >
                        Detect Gap
                      </button>
                    </div>
                  </div>
                </div>

                {/* 3. Recommendation Engine (④) */}
                <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
                  <div className="flex justify-between items-center border-b border-slate-850 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="p-1.5 bg-pink-500/10 rounded-lg text-pink-400"><Lightbulb className="w-4 h-4" /></span>
                      <div>
                        <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">④ Core Recommendation Engine</h4>
                        <p className="text-[10px] text-slate-500">Autonomous optimization suggestions (Alternative, substitute, low-cost, short-term, high-quality) before final submission.</p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {activeOutcome.recommendations.map((rec, idx) => (
                      <div key={idx} className="p-4 bg-slate-900/50 hover:bg-slate-900/80 rounded-xl border border-slate-850 flex flex-col justify-between gap-3 transition-all">
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center">
                            <span className="px-1.5 py-0.5 bg-pink-950 text-pink-400 text-[8px] font-mono rounded font-bold uppercase border border-pink-500/15">
                              {rec.type}
                            </span>
                            <span className="text-[8px] font-mono text-slate-500">Rec 0{idx+1}</span>
                          </div>
                          <h5 className="text-xs font-black text-slate-100">{rec.title}</h5>
                          <p className="text-xs text-slate-400 leading-relaxed">{rec.description}</p>
                        </div>
                        <div className="pt-2 border-t border-slate-800 text-[10px] text-slate-400 leading-relaxed">
                          <span className="text-emerald-400 font-bold block">Outcome Impact:</span>
                          {rec.benefit}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

              </div>

              {/* Right Column (4/12): Completion Judge & Outcomes */}
              <div className="xl:col-span-4 space-y-6">
                
                {/* 4. Completion Judge Console (⑤) */}
                <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
                  <div className="flex items-center gap-2 border-b border-slate-850 pb-3">
                    <span className="p-1.5 bg-rose-500/10 rounded-lg text-rose-400"><Lock className="w-4 h-4" /></span>
                    <div>
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">⑤ Completion Judge Engine</h4>
                      <p className="text-[10px] text-slate-500">AI-powered submission guard. Quality, purpose metrics, and fact ratings are audited live.</p>
                    </div>
                  </div>

                  {activeOutcome.isLocked ? (
                    <div className="p-4 bg-amber-950/20 rounded-xl border border-amber-500/30 space-y-3">
                      <div className="flex gap-2 text-amber-400">
                        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                        <div>
                          <div className="text-xs font-black uppercase font-mono">Submission Prohibited (提出禁止中)</div>
                          <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
                            ACOS AI Judgement: "Do not submit this deliverable yet. It does not guarantee high confidence in contract conversion. You have too many unresolved gaps ({activeOutcome.missingItems.length} items)."
                          </p>
                        </div>
                      </div>
                      <div className="p-3 bg-slate-950 rounded-lg border border-slate-900 text-[11px] space-y-1.5 text-slate-400 font-mono">
                        <div className="flex justify-between">
                          <span>Required Quality:</span>
                          <span className="text-white font-bold">90%</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Current Confidence:</span>
                          <span className="text-rose-400 font-bold">{activeOutcome.confidence}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Unresolved Gaps:</span>
                          <span className="text-amber-400 font-bold">{activeOutcome.missingItems.length} remaining</span>
                        </div>
                      </div>

                      {/* Let user manually toggle/override/simulate addressing issues */}
                      <button
                        onClick={() => {
                          const updated = [...outcomeMissions];
                          updated[selectedOutcomeIdx].isLocked = false;
                          updated[selectedOutcomeIdx].confidence = 96;
                          updated[selectedOutcomeIdx].successRate = 91;
                          updated[selectedOutcomeIdx].missingRate = 4;
                          updated[selectedOutcomeIdx].missingItems = updated[selectedOutcomeIdx].missingItems.slice(0, 1);
                          setOutcomeMissions(updated);
                          addLog("[⑤ JUDGE] Override triggered. Confidence score pre-warmed. Submission authorized.");
                        }}
                        className="w-full py-2 bg-amber-600/30 hover:bg-amber-600/50 text-amber-300 font-bold text-xs rounded-lg transition-all cursor-pointer border border-amber-500/20"
                      >
                        Enforce Optimization (Resolve Gaps & Unlock)
                      </button>
                    </div>
                  ) : (
                    <div className="p-4 bg-emerald-950/20 rounded-xl border border-emerald-500/30 space-y-3">
                      <div className="flex gap-2 text-emerald-400">
                        <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                        <div>
                          <div className="text-xs font-black uppercase font-mono">SUBMISSION AUTHORIZED</div>
                          <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
                            ACOS AI Judgement: "All key success factors met. Objective quality exceeds threshold. Confidence rating of {activeOutcome.confidence}% is certified."
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Submission triggers */}
                  <div className="space-y-2">
                    <button
                      disabled={activeOutcome.isLocked}
                      onClick={() => {
                        setSubmissionSuccessMessage(`Mission "${activeOutcome.missionName}" ultimate goal "${activeOutcome.ultimateGoal}" successfully submitted and launched into active production!`);
                        addLog(`[⑤ JUDGE] Final submission successfully verified and stored under audit footprint #${currentRunIndex}.`);
                      }}
                      className={`w-full py-3 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                        activeOutcome.isLocked 
                          ? "bg-slate-800 text-slate-500 border border-slate-700/60 cursor-not-allowed" 
                          : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/20"
                      }`}
                    >
                      <FileCheck className="w-4 h-4" /> Submit Ultimate Goal Deliverables
                    </button>
                  </div>

                  {submissionSuccessMessage && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-3 bg-emerald-950 text-emerald-400 text-xs rounded-xl border border-emerald-500/20 flex gap-2"
                    >
                      <Check className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{submissionSuccessMessage}</span>
                    </motion.div>
                  )}
                </div>

                {/* 5. Next Actions / Strategy List */}
                <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
                  <div className="flex items-center gap-2 border-b border-slate-850 pb-3">
                    <span className="p-1.5 bg-indigo-500/10 rounded-lg text-indigo-400"><Clock className="w-4 h-4" /></span>
                    <div>
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">Next actions / やること</h4>
                      <p className="text-[10px] text-slate-500">Immediate action items generated to close the missingness gaps.</p>
                    </div>
                  </div>

                  <ul className="space-y-2">
                    {activeOutcome.nextActions.map((act, i) => (
                      <li key={i} className="p-2.5 bg-slate-900 rounded-lg text-xs border border-slate-850 text-slate-300 flex items-start gap-2">
                        <span className="w-4 h-4 rounded bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-mono text-[9px] font-bold shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        <span>{act}</span>
                      </li>
                    ))}
                  </ul>
                </div>

              </div>

            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB: GOAL SUCCESS ENGINE INTERACTIVE WORKSPACE (①) */}
        {/* ========================================================================= */}
        {activeTab === "goal-success" && (
          <div className="space-y-6 animate-fade-in" id="goal-success-engine-workspace">
            <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
              <div className="flex justify-between items-center pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 bg-cyan-500/10 rounded-lg text-cyan-400"><Compass className="w-4 h-4" /></span>
                  <div>
                    <h3 className="text-sm font-bold text-white">Engine ①: Goal Success Interactive Creator</h3>
                    <p className="text-[11px] text-slate-400">Define your ultimate mission and shape goals towards real-world outcomes instead of simple file deliverables.</p>
                  </div>
                </div>
              </div>

              {/* Creator Form */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                <div className="space-y-4 bg-slate-900/40 p-5 rounded-xl border border-slate-850">
                  <h4 className="text-xs font-black text-white uppercase font-mono tracking-wide">Define Ultimate Mission Purpose</h4>
                  
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-slate-400 font-mono font-bold uppercase">Mission Name</label>
                    <input
                      type="text"
                      value={newMissionName}
                      onChange={(e) => setNewMissionName(e.target.value)}
                      placeholder="e.g. Q3 Performance Review Slides"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:border-indigo-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] text-slate-400 font-mono font-bold uppercase">Define Ultimate Goal (成果物ではなく目的)</label>
                    <select
                      onChange={(e) => setNewMissionGoal(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white"
                    >
                      <option value="">-- Choose or type below --</option>
                      <option value="契約率向上 (Increase corporate contract win-rate by 40%)">〇 契約率向上 (Instead of "Proposal slides completed")</option>
                      <option value="意思決定ができる (Allow swift, data-driven administrative Q2 decisions)">〇 意思決定ができる (Instead of "Report finished")</option>
                      <option value="実運用できる (Active microservices running stably under direct container traffic)">〇 実運用できる (Instead of "Program compiled")</option>
                    </select>
                    <input
                      type="text"
                      value={newMissionGoal}
                      onChange={(e) => setNewMissionGoal(e.target.value)}
                      placeholder="Or enter custom ultimate goal"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:border-indigo-500 mt-2"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] text-slate-400 font-mono font-bold uppercase">Current Progress Stage</label>
                    <input
                      type="text"
                      value={newMissionStage}
                      onChange={(e) => setNewMissionStage(e.target.value)}
                      placeholder="e.g. Setting up core Docker constraints"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:border-indigo-500"
                    />
                  </div>

                  <button
                    onClick={() => {
                      if (!newMissionName || !newMissionGoal) return;
                      const newObj: OutcomeMission = {
                        id: `out-custom-${Date.now()}`,
                        missionName: newMissionName,
                        ultimateGoal: newMissionGoal,
                        currentStage: newMissionStage || "Drafting specifications",
                        successRate: 75,
                        achievementRate: 80,
                        missingRate: 20,
                        factRate: 90,
                        confidence: 85,
                        missingItems: [
                          { category: "Explanation/説明不足", description: "First drafting phase may lack comprehensive user edge-case analysis.", riskLevel: "Medium" }
                        ],
                        risks: [
                          { description: "Target environment discrepancy on Node modules.", impact: "Slight coldstart delay", severity: "Low" }
                        ],
                        recommendations: [
                          { title: "Automated user segment alignment check", type: "High Quality", description: "Match text profiles to the active User Pattern Engine automatically.", benefit: "Improves readability of the purpose text." }
                        ],
                        predictedOutcomes: [
                          "High probability of objective goal satisfaction if initial feedback loops are executed."
                        ],
                        nextActions: [
                          "Run automated missingness scan to populate SLA parameters."
                        ],
                        isLocked: true
                      };
                      setOutcomeMissions(prev => [newObj, ...prev]);
                      setSelectedOutcomeIdx(0);
                      setNewMissionName("");
                      setNewMissionGoal("");
                      setNewMissionStage("");
                      setActiveTab("outcome-dashboard");
                      addLog(`[① PURPOSE] Defined new mission ultimate goal: "${newMissionGoal}" instead of simple file deliverables.`);
                    }}
                    className="w-full py-2 bg-cyan-600 hover:bg-cyan-700 text-white font-bold text-xs rounded-xl cursor-pointer transition-all flex items-center justify-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" /> Initialize Purpose Mission
                  </button>
                </div>

                <div className="p-5 bg-slate-900/20 rounded-xl border border-slate-800 space-y-4">
                  <h4 className="text-xs font-black text-white uppercase font-mono tracking-wide">Goal Success Philosophy</h4>
                  
                  <div className="space-y-4 text-xs text-slate-400 leading-relaxed">
                    <p>
                      In typical AI frameworks, success is evaluated by whether a file or output text is created (e.g., "slide deck compiled").
                      This represents **deliverable-centric** thinking which is prone to failure in actual business practice.
                    </p>
                    <p>
                      <strong className="text-white block mb-1">ACOS OS Sprint 18 shifts the center of gravity:</strong>
                      We evaluate **Purpose-centric** criteria. Every deliverable must prove it directly matches the ultimate objective (e.g. increase conversion, decrease decision-making duration, guarantee operational runtime).
                    </p>

                    <div className="p-3 bg-slate-950 rounded-lg border border-slate-900 space-y-2">
                      <div className="text-[10px] font-mono text-slate-500 font-bold uppercase">Purpose Transition Matrix:</div>
                      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                        <div className="p-2 bg-rose-950/20 text-rose-400 rounded border border-rose-500/10">
                          <span className="block font-bold">× OLD (Deliverables)</span>
                          提案資料完成 / Slides completed
                        </div>
                        <div className="p-2 bg-emerald-950/20 text-emerald-400 rounded border border-emerald-500/10">
                          <span className="block font-bold">〇 NEW (Purpose)</span>
                          契約率向上 / Win-rate growth
                        </div>
                        <div className="p-2 bg-rose-950/20 text-rose-400 rounded border border-rose-500/10">
                          レポート完成 / Report done
                        </div>
                        <div className="p-2 bg-emerald-950/20 text-emerald-400 rounded border border-emerald-500/10">
                          意思決定ができる / Decision enabled
                        </div>
                        <div className="p-2 bg-rose-950/20 text-rose-400 rounded border border-rose-500/10">
                          プログラム完成 / Program compiled
                        </div>
                        <div className="p-2 bg-emerald-950/20 text-emerald-400 rounded border border-emerald-500/10">
                          実運用できる / Stable operations
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 1: CORE SANDBOX & REFLECTION */}
        {/* ========================================================================= */}
        {activeTab === "orchestrator" && (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            
            {/* Left Side: Mission sandbox inputs, Predictions and workflows */}
            <div className="xl:col-span-7 space-y-6">
              
              {/* Mission Selector Control Panel */}
              <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 bg-indigo-500/10 rounded-lg text-indigo-400"><Sparkles className="w-4 h-4" /></span>
                    <div>
                      <h3 className="text-sm font-bold text-white">Interactive Mission Sandbox</h3>
                      <p className="text-[11px] text-slate-400">Trigger multi-agent loops and watch dynamic predictive optimization and self-evaluation.</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider">Select a Sprint 16 Practice Mission:</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {presets.map((p, idx) => (
                      <button
                        key={p.id}
                        onClick={() => setSelectedPresetIdx(idx)}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          selectedPresetIdx === idx 
                            ? "bg-indigo-600/20 border-indigo-500 text-white" 
                            : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700"
                        }`}
                      >
                        <div className="text-xs font-bold line-clamp-1">{p.name}</div>
                        <div className="text-[10px] text-slate-500 mt-1 line-clamp-2">{p.shortReq}</div>
                      </button>
                    ))}
                  </div>

                  <div className="pt-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider">Or Run Custom Prompt Goal:</label>
                    <div className="flex gap-2 mt-1">
                      <input
                        type="text"
                        value={customGoal}
                        onChange={(e) => setCustomGoal(e.target.value)}
                        placeholder="e.g. Build an administrative audit suite..."
                        className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                      />
                      <button
                        onClick={() => {
                          if (!customGoal.trim()) return;
                          presets[0].shortReq = customGoal;
                          presets[0].name = "Custom Sprint Mission";
                          startACOSLoop();
                        }}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer"
                      >
                        <Play className="w-3 h-3" /> Run
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 pt-2">
                    <button
                      onClick={startACOSLoop}
                      disabled={isSimulating}
                      className="flex-1 px-5 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-800 disabled:text-slate-500 text-white font-black text-xs rounded-xl flex items-center gap-2 justify-center shadow-lg shadow-indigo-600/20 transition-all cursor-pointer"
                    >
                      {isSimulating ? <RefreshCw className="w-4 h-4 animate-spin text-indigo-300" /> : <Play className="w-4 h-4" />}
                      Start Mission Execution (Run #{currentRunIndex})
                    </button>

                    {reflection && (
                      <button
                        onClick={runEvolutionStep}
                        disabled={isSimulating}
                        className="px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl flex items-center gap-1.5 justify-center shadow-lg shadow-emerald-600/20 transition-all cursor-pointer"
                      >
                        <Zap className="w-4 h-4" /> Improve and Run #{currentRunIndex + 1} Run
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="checkbox"
                      id="auto-refine"
                      checked={autoApplyImprovements}
                      onChange={(e) => setAutoApplyImprovements(e.target.checked)}
                      className="rounded border-slate-800 text-indigo-600 focus:ring-indigo-500 bg-slate-900 w-4 h-4"
                    />
                    <label htmlFor="auto-refine" className="text-[11px] text-slate-400 font-semibold cursor-pointer">
                      Auto-apply discovered refinements to next execution loop (Self-Evolution Enabled)
                    </label>
                  </div>
                </div>
              </div>

              {/* Quality Prediction Engine Widget (⑤) */}
              {prediction && (
                <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="p-1.5 bg-amber-500/10 rounded-lg text-amber-400"><ClipboardCheck className="w-4 h-4" /></span>
                      <div>
                        <h4 className="text-xs font-bold text-white">Engine ⑤: Quality Prediction Engine</h4>
                        <p className="text-[10px] text-slate-500">Autonomous risk rating, expected quality, and structural gaps telemetry.</p>
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 text-[10px] font-mono font-bold rounded-full border ${
                      prediction.riskLevel === "High" 
                        ? "bg-rose-950 text-rose-400 border-rose-500/20" 
                        : prediction.riskLevel === "Medium" 
                          ? "bg-amber-950 text-amber-400 border-amber-500/20" 
                          : "bg-emerald-950 text-emerald-400 border-emerald-500/20"
                    }`}>
                      Risk Rating: {prediction.riskLevel}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800/80 text-center space-y-1">
                      <span className="text-[10px] text-slate-500 font-mono font-bold uppercase block">Expected Quality</span>
                      <span className="text-2xl font-black text-white font-mono">{prediction.expectedQuality}%</span>
                    </div>
                    <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800/80 text-center space-y-1">
                      <span className="text-[10px] text-slate-500 font-mono font-bold uppercase block">Required Reviews</span>
                      <span className="text-2xl font-black text-indigo-400 font-mono">{prediction.recommendedReviews} cycles</span>
                    </div>
                    <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800/80 text-center space-y-1">
                      <span className="text-[10px] text-slate-500 font-mono font-bold uppercase block">Target Environment</span>
                      <span className="text-xs font-bold text-emerald-400 font-mono py-1.5 block">Docker Sandbox / 3000</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-[10px] text-slate-500 font-mono font-bold uppercase block">Risk Details</div>
                    <p className="text-xs text-slate-300 leading-relaxed bg-slate-900/40 p-2.5 rounded-lg border border-slate-800/40">
                      {prediction.riskDetails}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="text-[10px] text-slate-500 font-mono font-bold uppercase block">Detected Ambiguity Gaps / Gaps (不足情報)</div>
                    <ul className="space-y-1.5">
                      {prediction.missingGaps.map((g, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs text-amber-400">
                          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                          <span>{g}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* Workflow Intelligence Widget (④) */}
              <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 bg-indigo-500/10 rounded-lg text-indigo-400"><Network className="w-4 h-4" /></span>
                    <div>
                      <h4 className="text-xs font-bold text-white">Engine ④: Workflow Intelligence</h4>
                      <p className="text-[10px] text-slate-500">Auto-generated Directed Acyclic Graph (DAG) designed specifically for the mission. No static templates.</p>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-slate-900/60 rounded-xl border border-slate-800 space-y-4">
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-500">
                    <span>DYNAMIC WORKFLOW GENERATOR (DAG)</span>
                    <span className="text-indigo-400 animate-pulse">● Auto-Compiled</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    {workflowNodes.map((node, i) => (
                      <div
                        key={node.id}
                        className={`p-3 rounded-xl border text-center relative transition-all ${
                          node.status === "active" 
                            ? "bg-indigo-600/20 border-indigo-500 text-white shadow-md shadow-indigo-600/10" 
                            : node.status === "completed" 
                              ? "bg-slate-950 border-emerald-500/40 text-slate-300" 
                              : "bg-slate-950 border-slate-800 text-slate-500"
                        }`}
                      >
                        <div className="text-[9px] font-mono font-bold uppercase text-slate-500 mb-1">
                          Node 0{i + 1}
                        </div>
                        <div className="text-xs font-bold line-clamp-1">{node.label}</div>
                        <div className={`text-[10px] font-semibold mt-1 font-mono ${
                          node.status === "active" 
                            ? "text-indigo-300" 
                            : node.status === "completed" 
                              ? "text-emerald-400" 
                              : "text-slate-600"
                        }`}>
                          {node.agent}
                        </div>
                        {node.status === "active" && (
                          <div className="absolute top-1 right-1">
                            <span className="flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-indigo-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                            </span>
                          </div>
                        )}
                        {node.status === "completed" && (
                          <div className="absolute top-1 right-1 text-emerald-400">
                            <Check className="w-3.5 h-3.5" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

            </div>

            {/* Right Side: Execution Logs and Reflection engine */}
            <div className="xl:col-span-5 space-y-6">
              
              {/* Live Terminal Output Feed */}
              <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 bg-slate-900 rounded-lg text-indigo-400"><Terminal className="w-4 h-4" /></span>
                    <h4 className="text-xs font-bold text-white">Intelligence Loop Log Console</h4>
                  </div>
                  <button 
                    onClick={() => setLogs([])}
                    className="text-[10px] text-slate-500 hover:text-slate-300 font-mono font-bold"
                  >
                    Clear Console
                  </button>
                </div>

                <div className="bg-slate-900 p-4 rounded-xl font-mono text-[11px] text-slate-300 space-y-2 h-[220px] overflow-y-auto leading-relaxed border border-slate-800">
                  {logs.length === 0 ? (
                    <div className="text-slate-500 text-center py-16">
                      ACOS core status logs will render here in real-time.
                    </div>
                  ) : (
                    logs.map((log, i) => (
                      <div key={i} className="border-b border-slate-800/20 pb-1">
                        {log}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Self Reflection Engine Output (①) */}
              {reflection && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-slate-950 p-6 rounded-2xl border border-emerald-500/20 space-y-4 shadow-lg shadow-emerald-500/5"
                >
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="p-1.5 bg-emerald-500/10 rounded-lg text-emerald-400"><ShieldCheck className="w-4 h-4" /></span>
                      <div>
                        <h4 className="text-xs font-bold text-white">Engine ①: Post-Mission Self Reflection</h4>
                        <p className="text-[10px] text-slate-500">Autonomous audit evaluation across 6 critical operational vectors.</p>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 bg-emerald-950 text-emerald-400 text-[10px] font-mono font-bold rounded-full border border-emerald-500/20">
                      Audit Status: Resolved
                    </span>
                  </div>

                  {/* 6 Grid Metrics */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="bg-slate-900/60 p-2 rounded-xl border border-slate-800 text-center">
                      <span className="text-[9px] text-slate-500 font-mono font-bold uppercase block">Achievement</span>
                      <span className="text-sm font-black text-white font-mono">{reflection.achievementRate}%</span>
                    </div>
                    <div className="bg-slate-900/60 p-2 rounded-xl border border-slate-800 text-center">
                      <span className="text-[9px] text-slate-500 font-mono font-bold uppercase block">Quality Grade</span>
                      <span className="text-sm font-black text-indigo-400 font-mono">{reflection.qualityScore}%</span>
                    </div>
                    <div className="bg-slate-900/60 p-2 rounded-xl border border-slate-800 text-center">
                      <span className="text-[9px] text-slate-500 font-mono font-bold uppercase block">Fact Rate</span>
                      <span className="text-sm font-black text-emerald-400 font-mono">{reflection.factRate}%</span>
                    </div>
                    <div className="bg-slate-900/60 p-2 rounded-xl border border-slate-800 text-center">
                      <span className="text-[9px] text-slate-500 font-mono font-bold uppercase block">Latency</span>
                      <span className="text-sm font-black text-amber-400 font-mono">{reflection.timeSpentMs}ms</span>
                    </div>
                    <div className="bg-slate-900/60 p-2 rounded-xl border border-slate-800 text-center">
                      <span className="text-[9px] text-slate-500 font-mono font-bold uppercase block">Token Cost</span>
                      <span className="text-sm font-black text-pink-400 font-mono">${reflection.costIncurred.toFixed(4)}</span>
                    </div>
                    <div className="bg-slate-900/60 p-2 rounded-xl border border-slate-800 text-center">
                      <span className="text-[9px] text-slate-500 font-mono font-bold uppercase block">UX Rating</span>
                      <span className="text-sm font-black text-cyan-400 font-mono">{reflection.uxRating}%</span>
                    </div>
                  </div>

                  {/* Self-Discovered Refinements / Improvement list */}
                  <div className="space-y-2 pt-2">
                    <span className="text-[10px] text-slate-500 font-mono font-bold uppercase block">Self-Discovered Improvements (自動改善案)</span>
                    <ul className="space-y-1.5">
                      {reflection.improvements.map((imp, idx) => (
                        <li key={idx} className="p-2.5 bg-slate-900 rounded-lg text-xs border border-slate-800/80 text-slate-300 flex items-start gap-2">
                          <span className="px-1.5 py-0.5 bg-indigo-500/10 text-indigo-400 text-[8px] font-mono font-bold rounded-md uppercase shrink-0 mt-0.5">Refine {idx + 1}</span>
                          <span>{imp}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-[10px] text-emerald-400 font-semibold font-mono flex items-center gap-1 mt-1">
                      <Check className="w-3.5 h-3.5" /> Next execution will be updated automatically using these parameters.
                    </p>
                  </div>
                </motion.div>
              )}

            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: USER PATTERN ENGINE */}
        {/* ========================================================================= */}
        {activeTab === "user-pattern" && (
          <div className="space-y-6 animate-fade-in">
            <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 bg-emerald-500/10 rounded-lg text-emerald-400"><Users className="w-4 h-4" /></span>
                  <div>
                    <h3 className="text-sm font-bold text-white">Engine ③: User Pattern Engine</h3>
                    <p className="text-[11px] text-slate-400">Classify user styles automatically based on telemetry of prompt length, code structure, and analysis type, and reshape the OS dynamically.</p>
                  </div>
                </div>
              </div>

              {/* Custom Input Classification Simulator */}
              <div className="p-4 bg-slate-900/60 rounded-xl border border-slate-800 space-y-3">
                <div className="text-[10px] font-mono text-slate-500 uppercase">Test Style Classification Detector</div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={customUserText}
                    onChange={(e) => setCustomUserText(e.target.value)}
                    placeholder="Type or paste any request to test how ACOS auto-classifies (e.g. 'Generate SQL tables' or 'Draw a purple dashboard')"
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    onClick={handleUserStyleAnalyze}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl flex items-center gap-1 shrink-0 cursor-pointer"
                  >
                    Analyze and Reshape UI
                  </button>
                </div>
                {detectedPatternDetails && (
                  <motion.div 
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-[11px] text-emerald-400 font-mono font-medium flex items-center gap-1.5 p-2 bg-emerald-950/20 rounded-lg border border-emerald-500/15"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>{detectedPatternDetails}</span>
                  </motion.div>
                )}
              </div>

              {/* User Profiles list */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {userPatterns.map(p => (
                  <div
                    key={p.id}
                    onClick={() => setActivePatternId(p.id)}
                    className={`p-5 rounded-2xl border text-left transition-all cursor-pointer relative ${
                      activePatternId === p.id 
                        ? "bg-emerald-600/10 border-emerald-500 text-white shadow-lg shadow-emerald-500/5" 
                        : "bg-slate-900/60 border-slate-800/80 text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="text-xs font-bold text-white">{p.name}</div>
                      <span className="px-1.5 py-0.5 bg-slate-950 text-slate-400 text-[8px] font-mono rounded font-bold uppercase border border-slate-800">
                        {p.type.replace('_', ' ')}
                      </span>
                    </div>

                    <div className="space-y-2 text-[11px]">
                      <div>
                        <span className="text-[9px] text-slate-500 font-mono uppercase block">Query Style</span>
                        <span className="text-slate-300 font-medium">{p.queryLength} form | {p.focus} centered</span>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-500 font-mono uppercase block">Optimized UI (UI最適化)</span>
                        <span className="text-slate-300">{p.optimizedUI}</span>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-500 font-mono uppercase block">Workflow (ワークフロー)</span>
                        <span className="text-slate-300">{p.optimizedWorkflow}</span>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-500 font-mono uppercase block">Routed Models</span>
                        <div className="flex gap-1.5 flex-wrap mt-1">
                          {p.selectedModels.map(m => (
                            <span key={m} className="px-1.5 py-0.5 bg-slate-950 text-emerald-400 text-[8px] font-mono rounded font-bold uppercase border border-emerald-500/10">
                              {m}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {activePatternId === p.id && (
                      <div className="absolute bottom-2 right-2 text-emerald-400">
                        <Check className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Dynamic OS Adaptation Telemetry */}
              <div className="p-5 bg-slate-900 rounded-xl border border-slate-800 space-y-3">
                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Settings2 className="w-4 h-4 text-emerald-400" />
                  <span>Dynamic Adaptation Telemetry: ACOS OS Reshaped Rules</span>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div className="p-3 bg-slate-950 rounded-lg border border-slate-800/80 space-y-1">
                    <span className="text-[9px] text-slate-500 font-mono uppercase block">UI Spacing & Rendering</span>
                    <p className="text-slate-300 leading-relaxed">
                      {activePattern.type === "long_analytical" 
                        ? "Configured tight 12px grid layouts, monochrome indicators, JetBrains Mono font metrics." 
                        : activePattern.type === "short_creative" 
                          ? "Configured 24px wide cards, serif branding displays, smooth motion curves." 
                          : "Rendered layout audit metrics and canvas overlay tools."}
                    </p>
                  </div>

                  <div className="p-3 bg-slate-950 rounded-lg border border-slate-800/80 space-y-1">
                    <span className="text-[9px] text-slate-500 font-mono uppercase block">Workflow Review Intensity</span>
                    <p className="text-slate-300 leading-relaxed">
                      {activePattern.type === "long_analytical" 
                        ? "Enforced rigorous 5-step consensus checks. High strictness validation mode on." 
                        : activePattern.type === "short_creative" 
                          ? "Enforced fast single-step agent loops. Speed prioritized, high-temperature creativity." 
                          : "Dual-agent layout audit pipeline with intermediate design-token feedback rules."}
                    </p>
                  </div>

                  <div className="p-3 bg-slate-950 rounded-lg border border-slate-800/80 space-y-1">
                    <span className="text-[9px] text-slate-500 font-mono uppercase block">Model Dispatcher Priorities</span>
                    <p className="text-slate-300 leading-relaxed">
                      {activePattern.type === "long_analytical" 
                        ? "Mapped Claude 3.5 Sonnet for deep logic tree and complex code, Gemini 2.5 Pro for grounding checks." 
                        : activePattern.type === "short_creative" 
                          ? "Mapped Gemini 2.5 Flash for rapid layout mock-up files, GPT-4o for natural, expressive output." 
                          : "Mapped specialized multimodal reasoning models and layout auditors."}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: KNOWLEDGE INTELLIGENCE */}
        {/* ========================================================================= */}
        {activeTab === "knowledge" && (
          <div className="space-y-6 animate-fade-in">
            <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 bg-amber-500/10 rounded-lg text-amber-400"><Brain className="w-4 h-4" /></span>
                  <div>
                    <h3 className="text-sm font-bold text-white">Engine ⑦: Knowledge Intelligence Hub</h3>
                    <p className="text-[11px] text-slate-400">Scan and automatically clean/prune duplicate memory cards, old RAG references, and port/binding contradiction anomalies.</p>
                  </div>
                </div>
                <button
                  onClick={pruneKnowledgeBase}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-slate-950 font-black text-xs rounded-xl flex items-center gap-1.5 cursor-pointer shadow-lg shadow-amber-500/10"
                >
                  <Trash2 className="w-3.5 h-3.5 text-slate-950" /> Clean and Prune Knowledge Base
                </button>
              </div>

              {/* Memory List with Status indicator badges */}
              <div className="space-y-3">
                <div className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Active Memory Repository Status</div>
                <div className="grid grid-cols-1 gap-3">
                  {knowledgeBase.map(item => (
                    <div
                      key={item.id}
                      className={`p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all ${
                        item.status === "Contradictory" 
                          ? "bg-rose-950/10 border-rose-500/20 text-slate-300" 
                          : item.status === "Duplicate" 
                            ? "bg-amber-950/10 border-amber-500/20 text-slate-300" 
                            : item.status === "Stale" 
                              ? "bg-indigo-950/10 border-indigo-500/20 text-slate-300" 
                              : "bg-slate-900 border-slate-800/80 text-slate-400"
                      }`}
                    >
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="px-1.5 py-0.5 bg-slate-950 text-slate-400 text-[8px] font-mono rounded font-bold uppercase border border-slate-800">
                            {item.category}
                          </span>
                          <span className={`px-1.5 py-0.5 text-[8px] font-mono rounded font-bold uppercase ${
                            item.status === "Contradictory" 
                              ? "bg-rose-500/20 text-rose-300" 
                              : item.status === "Duplicate" 
                                ? "bg-amber-500/20 text-amber-300" 
                                : item.status === "Stale" 
                                  ? "bg-indigo-500/20 text-indigo-300" 
                                  : "bg-emerald-500/20 text-emerald-300"
                          }`}>
                            {item.status}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">Source: {item.source}</span>
                        </div>
                        <p className="text-xs font-bold text-white">{item.content}</p>
                        {item.anomalyDetails && (
                          <p className="text-[10px] text-rose-400 font-medium font-mono flex items-center gap-1">
                            <AlertCircle className="w-3.5 h-3.5" /> Anomaly: {item.anomalyDetails}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {item.status === "Clean" ? (
                          <div className="px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-semibold rounded-lg flex items-center gap-1">
                            <Check className="w-3.5 h-3.5" /> Checked
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              addLog(`[⑦ KNOWLEDGE] Resolving issue on ${item.id} manually...`);
                              setKnowledgeBase(prev => prev.map(k => {
                                if (k.id === item.id) {
                                  return {
                                    ...k,
                                    status: "Clean",
                                    anomalyDetails: undefined,
                                    content: k.status === "Contradictory" ? "Express server port must bind strictly to port 3000 (Resolved manually)." : k.content + " (Resolved issue)"
                                  };
                                }
                                return k;
                              }));
                            }}
                            className="px-2.5 py-1 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/20 text-amber-300 text-[10px] font-semibold rounded-lg cursor-pointer"
                          >
                            Resolve Issue
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Memory Size and cleanup analytics */}
              <div className="p-5 bg-slate-900 rounded-xl border border-slate-800 space-y-3 text-xs text-slate-300">
                <div className="text-xs font-black text-white flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-amber-400" />
                  <span>Garbage Collection & Alignment Analytics</span>
                </div>
                <p className="leading-relaxed">
                  ACOS Core regularly scrubs RAG references to prevent contradictory instructions (like conflicting routing tables or deprecated dependencies) from confusing active developers. Pruning ensures that standard build rules are cleanly enforced and context window size is optimized for speed.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 4: EVOLUTION & BENCHMARKS */}
        {/* ========================================================================= */}
        {activeTab === "evolution" && (
          <div className="space-y-6 animate-fade-in">
            
            {/* Engine ⑧: Evolution Dashboard */}
            <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 bg-cyan-500/10 rounded-lg text-cyan-400"><BarChart3 className="w-4 h-4" /></span>
                  <div>
                    <h3 className="text-sm font-bold text-white">Engine ⑧: Evolution Dashboard</h3>
                    <p className="text-[11px] text-slate-400">Track and visualize how ACOS has self-improved today compared to yesterday.</p>
                  </div>
                </div>
              </div>

              {/* Comparative Stats table */}
              <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 text-center space-y-1">
                  <span className="text-[9px] text-slate-500 font-mono font-bold uppercase block">Mission Success</span>
                  <div className="text-xs font-mono text-slate-400">88.5% ➔ <span className="text-emerald-400 font-bold">96.2%</span></div>
                  <span className="text-[10px] text-emerald-400 font-medium font-mono">▲ 7.7% today</span>
                </div>
                <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 text-center space-y-1">
                  <span className="text-[9px] text-slate-500 font-mono font-bold uppercase block">Fact Grounding</span>
                  <div className="text-xs font-mono text-slate-400">91.2% ➔ <span className="text-emerald-400 font-bold">98.9%</span></div>
                  <span className="text-[10px] text-emerald-400 font-medium font-mono">▲ 7.7% today</span>
                </div>
                <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 text-center space-y-1">
                  <span className="text-[9px] text-slate-500 font-mono font-bold uppercase block">Refinements applied</span>
                  <div className="text-xl font-black text-indigo-400 font-mono">24 items</div>
                  <span className="text-[10px] text-slate-500 font-mono">Auto-injected</span>
                </div>
                <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 text-center space-y-1">
                  <span className="text-[9px] text-slate-500 font-mono font-bold uppercase block">Speed Increase</span>
                  <div className="text-xl font-black text-white font-mono">+24%</div>
                  <span className="text-[10px] text-emerald-400 font-medium font-mono">▲ Average response</span>
                </div>
                <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 text-center space-y-1">
                  <span className="text-[9px] text-slate-500 font-mono font-bold uppercase block">Quality Gain</span>
                  <div className="text-xl font-black text-white font-mono">+8.7%</div>
                  <span className="text-[10px] text-emerald-400 font-medium font-mono">▲ strict audit</span>
                </div>
                <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 text-center space-y-1">
                  <span className="text-[9px] text-slate-500 font-mono font-bold uppercase block">Satisfaction Index</span>
                  <div className="text-xs font-mono text-slate-400">4.2 ➔ <span className="text-emerald-400 font-bold">4.9 / 5</span></div>
                  <span className="text-[10px] text-emerald-400 font-medium font-mono">▲ User rated</span>
                </div>
              </div>

              {/* Self Evolution History Log Timeline (②) */}
              <div className="space-y-3 pt-3">
                <div className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Evolution Refinement History (改善履歴)</div>
                <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                  {evolutionLogs.map(log => (
                    <div key={log.id} className="p-3 bg-slate-900 rounded-xl border border-slate-800/80 text-xs flex items-start justify-between gap-3 flex-wrap">
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-white">{log.missionName}</span>
                          <span className="px-1 py-0.5 bg-slate-950 text-indigo-400 text-[8px] font-mono rounded font-bold uppercase border border-indigo-500/10">Run #{log.runIndex}</span>
                          <span className="text-[10px] text-slate-500 font-mono">{log.timestamp}</span>
                        </div>
                        <p className="text-slate-400 leading-relaxed">{log.appliedRefinement}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-[10px] text-slate-500 font-mono block uppercase">Quality Boost</span>
                        <span className="font-bold text-emerald-400 font-mono">{log.qualityBefore}% ➔ {log.qualityAfter}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Engine ⑨: World Class Benchmark */}
            <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 bg-cyan-500/10 rounded-lg text-cyan-400"><Scale className="w-4 h-4" /></span>
                  <div>
                    <h3 className="text-sm font-bold text-white">Engine ⑨: World Class Benchmark Matrix</h3>
                    <p className="text-[11px] text-slate-400">Track how ACOS OS measures up against industry standard platforms and auto-generate weekly action proposals.</p>
                  </div>
                </div>
              </div>

              {/* Benchmark comparison Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-900 text-slate-500 font-mono uppercase text-[9px] border-b border-slate-800">
                    <tr>
                      <th className="p-3 font-bold">Brand / Platform</th>
                      <th className="p-3 font-bold text-center">Planning</th>
                      <th className="p-3 font-bold text-center">Coding</th>
                      <th className="p-3 font-bold text-center">Fact Check</th>
                      <th className="p-3 font-bold text-center">Cost-Eff.</th>
                      <th className="p-3 font-bold text-center">UI Consistent</th>
                      <th className="p-3 font-bold">Generated Evolution Target</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {benchmarks.map(b => (
                      <tr 
                        key={b.brand} 
                        className={`hover:bg-slate-900/40 transition-all ${
                          b.brand.includes("ACOS") ? "bg-indigo-600/5 font-semibold text-white" : ""
                        }`}
                      >
                        <td className="p-3 flex items-center gap-1.5">
                          {b.brand.includes("ACOS") && <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
                          <span>{b.brand}</span>
                        </td>
                        <td className="p-3 text-center font-mono">{b.planning}/100</td>
                        <td className="p-3 text-center font-mono">{b.coding}/100</td>
                        <td className="p-3 text-center font-mono">{b.factCheck}/100</td>
                        <td className="p-3 text-center font-mono">{b.costEfficiency}/100</td>
                        <td className="p-3 text-center font-mono">{b.uiConsistency}/100</td>
                        <td className="p-3">
                          <span className={`text-[11px] font-mono leading-relaxed ${
                            b.brand.includes("ACOS") ? "text-indigo-400" : "text-slate-400"
                          }`}>
                            {b.actionItem}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 5: AI IMPROVEMENT PROPOSALS */}
        {/* ========================================================================= */}
        {activeTab === "proposals" && (
          <div className="space-y-6 animate-fade-in">
            <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 bg-pink-500/10 rounded-lg text-pink-400"><Lightbulb className="w-4 h-4" /></span>
                  <div>
                    <h3 className="text-sm font-bold text-white">Engine ⑩: AI Improvement Proposals</h3>
                    <p className="text-[11px] text-slate-400">Proactive capability recommendations generated autonomously by ACOS, pointing out optimizations humans may miss.</p>
                  </div>
                </div>
              </div>

              {/* Proposal Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {proposals.map(p => (
                  <div key={p.id} className="p-5 bg-slate-900/60 rounded-2xl border border-slate-800 flex flex-col justify-between gap-4">
                    <div className="space-y-2">
                      <div className="flex justify-between items-start">
                        <span className="px-1.5 py-0.5 bg-slate-950 text-pink-300 text-[8px] font-mono rounded font-bold uppercase border border-pink-500/10">
                          {p.category}
                        </span>
                        <span className={`px-2 py-0.5 text-[9px] font-mono font-semibold rounded-full border ${
                          p.status === "Approved" 
                            ? "bg-emerald-950 text-emerald-400 border-emerald-500/20" 
                            : p.status === "In Training" 
                              ? "bg-indigo-950 text-indigo-400 border-indigo-500/20" 
                              : "bg-slate-950 text-slate-400 border-slate-800"
                        }`}>
                          {p.status}
                        </span>
                      </div>

                      <h4 className="text-xs font-bold text-white">{p.title}</h4>
                      <p className="text-xs text-slate-400 leading-relaxed">{p.description}</p>
                    </div>

                    <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                      <div className="text-[11px] text-slate-500">
                        <span className="font-semibold text-emerald-400">{p.impact}</span>
                      </div>
                      <button
                        onClick={() => upvoteProposal(p.id)}
                        className="px-3 py-1.5 bg-slate-950 hover:bg-slate-850 text-xs text-white rounded-lg flex items-center gap-1 border border-slate-800 cursor-pointer transition-all"
                      >
                        <ThumbsUp className="w-3 h-3 text-pink-400" />
                        <span className="font-mono font-bold text-slate-300">{p.votes}</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Outcome Intelligence Architecture Block Output Footer */}
      <div className="bg-slate-950 border-t border-slate-800 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-emerald-400" />
          <h3 className="text-xs font-black text-white uppercase tracking-wider font-mono">Outcome Intelligence Architecture Draft</h3>
        </div>
        <div className="bg-slate-900 p-4 rounded-xl font-mono text-[10px] text-slate-400 leading-relaxed space-y-1.5 border border-slate-800">
          <div><span className="text-emerald-400 font-bold">GoalSuccessEngine:</span> DefineMissionPurpose(成果物ではなく目的を評価対象) ➔ MapToOutcomeIndicator();</div>
          <div><span className="text-indigo-400 font-bold">OutcomePrediction:</span> CalcSuccessProbability(achievementRate, successRate, failureFactors, missingGaps, improvementRoom);</div>
          <div><span className="text-amber-400 font-bold">MissingDetection:</span> AuditGaps(Explanation説明不足, Dataデータ不足, Figures図不足, Comparison比較不足, Legal法的注意, Risks, Costs, Time);</div>
          <div><span className="text-pink-400 font-bold">RecommendationEngine:</span> SynthesizeSolutions(Alternative別案, LowCost低コスト案, ShortTerm短期間案, HighQuality高品質案);</div>
          <div><span className="text-rose-400 font-bold">CompletionJudge:</span> EnforceProhibitSubmit(if Quality &lt; 90% || Gaps &gt; 0 || Confidence &lt; 90%);</div>
          <div className="text-slate-500">// Fully compiled and optimized, ready for active operational deployment.</div>
        </div>
      </div>

    </div>
  );
}
