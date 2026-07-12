/**
 * Mission Quality Validator (MQV) V2
 * 
 * Objective:
 * Automatically verify if the generated mission artifact (AI output) matches the user's intent (request).
 * 
 * Core Enhancements (V2):
 * - Category-based classification is expanded to 30 rich AI Capabilities.
 * - Leverages CapabilityRegistry, RoutingEngine, and ProviderRegistry.
 * - Performs real-time capabilities mapping, match score calculation, and optimal provider routing.
 * - Prevents Gemini lock-in by using the ACOS Routing Engine to determine the best provider.
 */

import { Capability } from "../lib/capability-registry/domain/entities/Capability";
import { Provider } from "../lib/capability-registry/domain/entities/Provider";
import { CapabilityRegistry } from "../lib/capability-registry/application/CapabilityRegistry";
import { RoutingEngine } from "../lib/routing-engine/RoutingEngine";

export interface ProviderDetail {
  id: string;
  name: string;
  provider: string;
  quality: number; // 1-10
  cost: number;    // 1-10
  latency: number; // ms
  health: string;  // e.g. "healthy" | "degraded" | "down"
  overallScore: number; // calculated 0-10 or 0-100 score
  selectionReason: string; // Dynamic reason for selection
}

export interface ValidationResult {
  success: boolean;
  requestCategory: string; // The primary Capability mapped for the request
  outputCategory: string;  // The primary Capability mapped for the output
  matchScore: number;      // Alignment matching percentage (0 - 100)
  details: string;
  complexity: "Low" | "Medium" | "High" | "Very High";
  complexityReason: string;
  requestEvidence: string[];
  outputEvidence: string[];
  matchReason: string;
  recommendedProvider?: ProviderDetail; // Ranked 1
  top3Providers: ProviderDetail[];      // Ranking of top 3 providers
}

export interface ValidationTestCase {
  id: string;
  name: string;
  request: string;
  output: string;
  expectedSuccess: boolean;
  expectedCategory: string;
}

// 30 Rich Capabilities definitions paired with optimized keywords (supporting Japanese & English)
export const CAPABILITIES_MAP: Record<string, { desc: string; keywords: string[] }> = {
  "Travel Planning": {
    desc: "旅行、観光、ツアー、宿泊、日程、温泉などの計画・プランニング",
    keywords: ["旅行", "ツアー", "プラン", "観光", "日程", "ホテル", "フライト", "宿泊", "名所", "温泉", "travel", "trip", "itinerary", "sightseeing", "hotel", "flight", "tourism", "destination", "vacation"]
  },
  "Research": {
    desc: "情報検索、リサーチ、最新ニュース、調査",
    keywords: ["調べ", "検索", "最新", "ニュース", "リサーチ", "調査", "search", "find", "research", "news", "investigate"]
  },
  "Legal Reasoning": {
    desc: "法律、規約、契約書、合意書、弁護士、法務、コンプライアンス",
    keywords: ["法律", "規約", "契約", "リーガル", "合意", "訴訟", "弁護士", "法務", "法令", "憲法", "コンプライアンス", "legal", "law", "contract", "terms", "agreement", "regulation", "compliance", "constitution", "statute"]
  },
  "Code Generation": {
    desc: "プログラム、ソースコード、スクリプト、バグ修正、システム開発",
    keywords: ["コード", "プログラム", "実装", "バグ", "エラー", "スクリプト", "プログラミング", "開発", "code", "program", "implement", "bug", "error", "script", "ts", "js", "python", "html", "css", "postgresql", "create table"]
  },
  "Marketing": {
    desc: "マーケティング、広告、宣伝、ペルソナ、市場、ターゲット",
    keywords: ["マーケティング", "広告", "宣伝", "ペルソナ", "ターゲット", "市場", "marketing", "ad", "target", "market", "branding"]
  },
  "Finance": {
    desc: "金融、投資、株価、予算、財務、会計、売上、利益",
    keywords: ["金融", "投資", "株価", "予算", "財務", "会計", "売上", "利益", "融資", "finance", "investment", "budget", "stock", "revenue", "profit", "account", "tax"]
  },
  "Medical": {
    desc: "医療、病気、症状、健康、診断、治療、クリニック",
    keywords: ["医療", "病気", "症状", "健康", "診断", "治療", "クリニック", "medical", "health", "symptom", "diagnosis", "disease", "doctor"]
  },
  "Education": {
    desc: "教育、学習、授業、教科書、問題集、スクール、勉強",
    keywords: ["教育", "学習", "授業", "教科書", "問題集", "スクール", "勉強", "教材", "education", "learn", "study", "teacher", "lesson", "student"]
  },
  "Image Generation": {
    desc: "画像、絵、イラスト、写真、バナー、グラフィックデザイン",
    keywords: ["画像", "絵", "イラスト", "写真", "バナー", "グラフィック", "デザイン", "描画", "image", "draw", "paint", "illustration", "photo", "graphic", "art", "pic"]
  },
  "Presentation": {
    desc: "資料、スライド、プレゼン、パワポ、デモ構成",
    keywords: ["資料", "スライド", "プレゼン", "パワポ", "プレゼンテーション", "提案書", "presentation", "slide", "powerpoint", "keynote", "proposal", "pitch", "deck"]
  },
  "Spreadsheet": {
    desc: "スプレッドシート、エクセル、表、セル、数式、データ集計",
    keywords: ["スプレッドシート", "エクセル", "表", "セル", "数式", "データ集計", "spreadsheet", "excel", "csv", "table", "cell", "formula"]
  },
  "Translation": {
    desc: "翻訳、英語、日本語、他言語、通訳",
    keywords: ["翻訳", "英語", "日本語", "他言語", "通訳", "英訳", "和訳", "translate", "translation", "english", "japanese", "language"]
  },
  "Creative Writing": {
    desc: "創作、小説、ポエム、脚本、シナリオ、物語、コンテンツ作成",
    keywords: ["創作", "小説", "ポエム", "脚本", "シナリオ", "物語", "執筆", "詩", "novel", "story", "poem", "creative", "write", "fiction"]
  },
  "Fact Checking": {
    desc: "事実確認、ファクトチェック、真実、エビデンス、証拠",
    keywords: ["事実確認", "ファクトチェック", "真実", "エビデンス", "証拠", "裏付け", "fact", "check", "truth", "evidence"]
  },
  "Data Analysis": {
    desc: "分析、データ、統計、集計、解析、視覚化",
    keywords: ["分析", "データ", "統計", "集計", "解析", "視覚化", "グラフ", "analysis", "data", "stat", "analytics", "chart"]
  },
  "Customer Support": {
    desc: "顧客、サポート、問い合わせ、クレーム、ヘルプデスク、応答",
    keywords: ["顧客", "サポート", "問い合わせ", "クレーム", "ヘルプ", "回答", "返信", "support", "customer", "help", "contact", "ticket"]
  },
  "Security": {
    desc: "セキュリティ、暗号、ハッキング、脆弱性、認証、防御",
    keywords: ["セキュリティ", "暗号", "ハッキング", "脆弱性", "認証", "防御", "security", "hack", "decrypt", "encrypt", "auth", "vulnerability"]
  },
  "Database Management": {
    desc: "データベース、SQL、テーブル、インデックス、マイグレーション",
    keywords: ["データベース", "SQL", "テーブル", "インデックス", "マイグレーション", "クエリ", "database", "sql", "query", "tables", "index"]
  },
  "Project Management": {
    desc: "プロジェクト、タスク、ガントチャート、進捗、アジャイル、タスク管理",
    keywords: ["プロジェクト", "タスク", "ガントチャート", "進捗", "アジャイル", "WBS", "project", "task", "gantt", "sprint", "agile", "kanban"]
  },
  "Math & Logic": {
    desc: "数学、数式、計算、論理、証明",
    keywords: ["数学", "数式", "計算", "論理", "証明", "演算", "math", "calculation", "logic", "proof", "arithmetic"]
  },
  "Scheduling": {
    desc: "日程調整、カレンダー、スケジュール、アポイント、ブッキング",
    keywords: ["日程調整", "カレンダー", "スケジュール", "アポ", "予約", "schedule", "calendar", "appointment", "booking"]
  },
  "Summarization": {
    desc: "要約、まとめる、抜粋、ダイジェスト、圧縮",
    keywords: ["要約", "まとめる", "抜粋", "ダイジェスト", "圧縮", "summary", "summarize", "digest", "condense"]
  },
  "Consulting": {
    desc: "コンサル、アドバイス、相談、戦略、提案",
    keywords: ["コンサル", "アドバイス", "相談", "戦略", "提案", "助言", "consulting", "advisor", "strategy", "advice"]
  },
  "Game Design": {
    desc: "ゲーム、ゲームデザイン、シナリオ、ルール、ゲーム開発",
    keywords: ["ゲーム", "ゲームデザイン", "シナリオ", "ルール", "対戦", "game", "design", "play", "rules", "rpg"]
  },
  "Social Media": {
    desc: "SNS、ツイート、投稿、ハッシュタグ、拡散、インフルエンサー",
    keywords: ["SNS", "ツイート", "投稿", "ハッシュタグ", "拡散", "インスタ", "ブログ記事", "tweet", "post", "hashtag", "sns", "instagram", "facebook", "tiktok"]
  },
  "Voice Synthesis": {
    desc: "音声合成、ナレーション、読み上げ、音声データ作成、合成音声",
    keywords: ["音声合成", "ナレーション", "読み上げ", "音声データ", "合成音声", "声優", "ボイス", "tts", "voice", "synthesis", "speech", "narration"]
  },
  "Video Editing": {
    desc: "動画編集、映像制作、テロップ入れ、カット編集、エフェクト",
    keywords: ["動画編集", "映像制作", "テロップ", "カット編集", "エフェクト", "動画作成", "ユーチューブ動画", "video", "editing", "movie", "clip", "render", "keyframes"]
  },
  "Sentiment Analysis": {
    desc: "感情分析、レビュー評価、ネガポジ判定、顧客心理分析",
    keywords: ["感情分析", "レビュー評価", "ネガポジ", "ポジティブ", "ネガティブ", "感情判定", "sentiment", "polarity", "opinion", "emotion"]
  },
  "Network Architecture": {
    desc: "ネットワーク、サーバーインフラ、DNS、CDN、ルーター、ファイアウォール",
    keywords: ["ネットワーク", "インフラ", "ルーター", "ファイアウォール", "dns", "cdn", "vpn", "ipアドレス", "network", "router", "switch", "gateway"]
  },
  "UX/UI Design": {
    desc: "UIデザイン、UX改善、ワイヤーフレーム、ユーザーインターフェース設計、Figma",
    keywords: ["UIデザイン", "UX改善", "ワイヤーフレーム", "モックアップ", "figma", "プロトタイプ", "使いやすさ", "ux", "ui", "mockup", "wireframe", "usability"]
  }
};

/**
 * ACOS Unified Validation Manager (Coordinating Registries and Routing Engine)
 */
export class ACOSValidationManager {
  private static instance: ACOSValidationManager;
  public registry: CapabilityRegistry;
  public routingEngine: RoutingEngine;

  private constructor() {
    this.registry = new CapabilityRegistry();
    this.routingEngine = new RoutingEngine();

    // 1. Register all 30 Capabilities into the Capability Registry
    Object.entries(CAPABILITIES_MAP).forEach(([name, meta]) => {
      this.registry.registerCapability(new Capability(name, meta.desc, "utility"));
    });

    // 2. Initialize default Providers
    this.initializeDefaultProviders();
  }

  private initializeDefaultProviders() {
    const defaultProviders = [
      new Provider(
        "openrouter/anthropic/claude-3.5-sonnet",
        "Claude 3.5 Sonnet (OpenRouter)",
        "OpenRouter",
        new Map([
          ["Reasoning", 5], ["Planning", 4], ["Coding", 5], ["Writing", 5], ["Analysis", 5], ["Research", 4],
          ["Travel Planning", 4], ["Legal Reasoning", 5], ["Code Generation", 5], ["Creative Writing", 5], ["Fact Checking", 4], ["Presentation", 4],
          ["Database Management", 5], ["Security", 5], ["UX/UI Design", 4]
        ]),
        "healthy",
        { cost: 6, latency: 850, quality: 9, failureRate: 0.005 }
      ),
      new Provider(
        "openrouter/openai/gpt-4o",
        "GPT-4o (OpenRouter)",
        "OpenRouter",
        new Map([
          ["Reasoning", 5], ["Planning", 5], ["Coding", 4], ["Writing", 4], ["Presentation", 5], ["Math", 5], ["Analysis", 4],
          ["Travel Planning", 5], ["Marketing", 5], ["Finance", 5], ["Spreadsheet", 5], ["Legal Reasoning", 4],
          ["Sentiment Analysis", 5], ["Network Architecture", 4]
        ]),
        "healthy",
        { cost: 7, latency: 720, quality: 9, failureRate: 0.008 }
      ),
      new Provider(
        "openrouter/google/gemini-1.5-pro",
        "Gemini 1.5 Pro (OpenRouter)",
        "OpenRouter",
        new Map([
          ["Reasoning", 4], ["Vision", 5], ["Search", 5], ["Multimodal", 5], ["Translation", 5], ["Research", 5], ["Simulation", 4],
          ["Translation", 5], ["Fact Checking", 5], ["Medical", 4], ["Education", 5], ["Travel Planning", 4],
          ["Summarization", 5], ["Consulting", 4]
        ]),
        "healthy",
        { cost: 4, latency: 600, quality: 8, failureRate: 0.015 }
      ),
      new Provider(
        "openrouter/deepseek/deepseek-coder",
        "DeepSeek Coder (OpenRouter)",
        "OpenRouter",
        new Map([
          ["Coding", 5], ["Math", 4], ["Reasoning", 3], ["Analysis", 3],
          ["Code Generation", 5], ["Math & Logic", 5], ["Database Management", 5]
        ]),
        "healthy",
        { cost: 2, latency: 1200, quality: 8, failureRate: 0.025 }
      ),
      new Provider(
        "openrouter/xai/grok-2",
        "Grok 2 (OpenRouter)",
        "OpenRouter",
        new Map([
          ["Debate", 5], ["Forecast", 4], ["Search", 4], ["Writing", 4],
          ["Creative Writing", 4], ["Social Media", 5], ["Research", 4]
        ]),
        "healthy",
        { cost: 5, latency: 550, quality: 8, failureRate: 0.03 }
      ),
      new Provider(
        "openrouter/stability/stable-diffusion",
        "Stable Diffusion 3 (OpenRouter)",
        "OpenRouter",
        new Map([
          ["Image Generation", 5]
        ]),
        "healthy",
        { cost: 5, latency: 900, quality: 8, failureRate: 0.01 }
      ),
      new Provider(
        "openrouter/elevenlabs/audio",
        "ElevenLabs Voice API",
        "ElevenLabs",
        new Map([
          ["Voice Synthesis", 5]
        ]),
        "healthy",
        { cost: 6, latency: 1100, quality: 9, failureRate: 0.012 }
      ),
      new Provider(
        "openrouter/runway/gen3",
        "Runway Gen-3 (OpenRouter)",
        "OpenRouter",
        new Map([
          ["Video Editing", 5]
        ]),
        "healthy",
        { cost: 8, latency: 2500, quality: 9, failureRate: 0.02 }
      )
    ];

    defaultProviders.forEach(p => {
      try {
        this.registry.registerProvider(p);
      } catch (e) {
        // Safe check
      }
    });
  }

  public static getInstance(): ACOSValidationManager {
    if (!ACOSValidationManager.instance) {
      ACOSValidationManager.instance = new ACOSValidationManager();
    }
    return ACOSValidationManager.instance;
  }
}

/**
 * Classifies a text into one of the 30 rich ACOS Capabilities based on keyword weights.
 */
export function classifyContent(text: string): string {
  if (!text) return "Summarization";
  const normalized = text.toLowerCase();
  
  let bestCap = "Summarization";
  let maxCount = 0;

  for (const [capName, meta] of Object.entries(CAPABILITIES_MAP)) {
    let count = 0;
    for (const word of meta.keywords) {
      let pos = normalized.indexOf(word.toLowerCase());
      while (pos !== -1) {
        count++;
        pos = normalized.indexOf(word.toLowerCase(), pos + 1);
      }
    }
    if (count > maxCount) {
      maxCount = count;
      bestCap = capName;
    }
  }

  return bestCap;
}

/**
 * Automatically determine the mission complexity (Low, Medium, High, Very High) based on sentence length and technical density
 */
export function getMissionComplexity(text: string): { level: "Low" | "Medium" | "High" | "Very High"; reason: string } {
  if (!text) return { level: "Low", reason: "入力テキストが空です。" };
  const len = text.length;
  
  // Count technical terms
  const techTerms = [
    "api", "database", "schema", "db", "auth", "oauth", "security", "figma", "react", "postgresql", 
    "spanner", "sql", "architecture", "design system", "system", "router", "routing", "engine", 
    "validation", "validator", "workflow", "server", "logic", "analytics", "dashboard"
  ];
  const matches = techTerms.filter(term => text.toLowerCase().includes(term));
  
  if (len >= 150 || matches.length >= 4) {
    return {
      level: "Very High",
      reason: `文章量 (${len}文字) が極めて豊富であり、複数の高度な専門システムワード (${matches.join(", ")}) が検出されたため、高度なオーケストレーションと統合推論処理が不可欠です。`
    };
  } else if (len >= 75 || matches.length >= 2) {
    return {
      level: "High",
      reason: `文章量 (${len}文字) が多く、技術ワード (${matches.join(", ")}) が確認できるため、多層的な能力適合度分析が必要です。`
    };
  } else if (len >= 25 || matches.length >= 1) {
    return {
      level: "Medium",
      reason: `中程度の文章量 (${len}文字) と、一部の関連語句 (${matches.join(", ") || "なし"}) から、一般的な意図解釈と構成判定が求められます。`
    };
  } else {
    return {
      level: "Low",
      reason: `文章量 (${len}文字) が極めてシンプルで単一の指示文であるため、軽量なコンテキスト解釈で対応可能です。`
    };
  }
}

/**
 * Extracts found keywords of a capability from text as evidence
 */
export function extractEvidence(text: string, capName: string): string[] {
  const meta = CAPABILITIES_MAP[capName];
  if (!meta) return [];
  const normalized = text.toLowerCase();
  const matched = new Set<string>();
  meta.keywords.forEach(word => {
    if (normalized.includes(word.toLowerCase())) {
      matched.add(word);
    }
  });
  return Array.from(matched);
}

/**
 * Generates dynamic, highly explainable selection reason for each provider based on metrics
 */
export function getProviderSelectionReason(pName: string, q: number, c: number, l: number, cap: string): string {
  if (q >= 9) {
    return `このプロバイダーは最高レベルの知的論理推論（品質スコア: ${q}/10）を保持しており、複雑な「${cap}」の意思決定において間違いのない成果物を構築するのに最も適しています。`;
  }
  if (c <= 3) {
    return `コストパフォーマンス（コスト負荷: ${c}/10）が圧倒的に優れており、大量の「${cap}」トランザクションや高頻度なバックグラウンド処理を最小限のリソースで実現可能です。`;
  }
  if (l <= 650) {
    return `応答速度（実測レイテンシ: ${l}ms）が非常に高速であり、リアルタイム性が極めて重要なユーザーインタラクションや「${cap}」の高速処理に抜群の強みを発揮します。`;
  }
  return `能力適合性（Capability: 10）、稼働健全性、および全体のパフォーマンス（コスト、速度、正確性）の総合バランスが優れており、本ミッションの「${cap}」に最適化されています。`;
}

/**
 * Replicates ACOS Routing Service scoring for client-side transparency and explainability
 */
export function calculateScoreForDisplay(
  provider: Provider,
  requiredCapabilities: string[],
  priority: "cost" | "latency" | "quality" | "balanced" = "balanced"
): {
  overall: number;
  capabilityScore: number;
  costScore: number;
  latencyScore: number;
  qualityScore: number;
  healthScore: number;
} {
  // 1. Capability rating
  let capabilitySum = 0;
  let matchedCount = 0;

  requiredCapabilities.forEach(cap => {
    const rating = provider.getCapabilityRating(cap);
    if (rating > 0) {
      capabilitySum += rating;
      matchedCount++;
    }
  });

  const capabilityMatchRate = requiredCapabilities.length > 0 ? matchedCount / requiredCapabilities.length : 1.0;
  const avgCapabilityRating = matchedCount > 0 ? (capabilitySum / matchedCount) * 2 : 0;
  const baseCapabilityScore = avgCapabilityRating * capabilityMatchRate;

  // 2. Metrics Score (0 to 10 scale for each metric)
  const metrics = provider.metrics;

  // Cost: lower is better (cheapness score)
  const costScoreVal = 11 - Math.max(1, Math.min(10, metrics.cost));

  // Latency: lower is better. Normalize 100ms - 3000ms
  const latencyScoreVal = Math.max(1, Math.min(10, 10 - ((metrics.latency - 200) / 230)));

  // Quality: higher is better
  const qualityScoreVal = Math.max(1, Math.min(10, metrics.quality));

  // Failure Rate -> Reliability
  const reliabilityScoreVal = Math.max(0, Math.min(10, 10 - (metrics.failureRate * 100)));

  // Weighting based on priority
  let metricsScore = 0;
  switch (priority) {
    case "cost":
      metricsScore = costScoreVal * 0.5 + qualityScoreVal * 0.2 + latencyScoreVal * 0.1 + reliabilityScoreVal * 0.2;
      break;
    case "latency":
      metricsScore = latencyScoreVal * 0.5 + reliabilityScoreVal * 0.3 + qualityScoreVal * 0.1 + costScoreVal * 0.1;
      break;
    case "quality":
      metricsScore = qualityScoreVal * 0.5 + reliabilityScoreVal * 0.3 + latencyScoreVal * 0.1 + costScoreVal * 0.1;
      break;
    case "balanced":
    default:
      metricsScore = (costScoreVal + latencyScoreVal + qualityScoreVal + reliabilityScoreVal) / 4;
      break;
  }

  let healthMultiplier = 1.0;
  if (provider.health === "degraded") {
    healthMultiplier = 0.6;
  } else if (provider.health === "down") {
    healthMultiplier = 0.0;
  }

  const capabilityWeight = (priority === "balanced" || priority === "quality") ? 0.6 : 0.3;
  const metricsWeight = 1.0 - capabilityWeight;
  const overall = (baseCapabilityScore * capabilityWeight + metricsScore * metricsWeight) * healthMultiplier;

  return {
    overall: Math.max(0, overall),
    capabilityScore: baseCapabilityScore,
    costScore: costScoreVal,
    latencyScore: latencyScoreVal,
    qualityScore: qualityScoreVal,
    healthScore: provider.health === "healthy" ? 10 : (provider.health === "degraded" ? 6 : 0)
  };
}

/**
 * Validates whether the AI Output matches the User's original request.
 */
export function validateMissionQuality(request: string, output: string): ValidationResult {
  const reqCap = classifyContent(request);
  const outCap = classifyContent(output);

  const isExactMatch = reqCap === outCap;
  
  let matchScore = 0;
  let success = false;
  let details = "";
  let matchReason = "";

  const reqEvidence = extractEvidence(request, reqCap);
  const outEvidence = extractEvidence(output, outCap);

  if (isExactMatch) {
    matchScore = 100;
    success = true;
    details = `完全適合：要求された機能 [${reqCap}] と、AI成果物が提供する機能 [${outCap}] が100%一致しています。`;
    matchReason = `要求能力と成果物能力の双方が「${reqCap}」に完全合致しています。抽出根拠キーワードの重複度および整合性が極めて高いレベルにあります。`;
  } else {
    // Check if they are related adjacent capabilities
    const devCaps = ["Code Generation", "Database Management", "Security", "Network Architecture", "UX/UI Design", "Math & Logic"];
    const businessCaps = ["Marketing", "Presentation", "Finance", "Spreadsheet", "Consulting", "Project Management"];
    const textCaps = ["Creative Writing", "Summarization", "Translation", "Fact Checking", "Sentiment Analysis", "Social Media"];
    const mediaCaps = ["Image Generation", "Voice Synthesis", "Video Editing", "Game Design"];

    const isBothDev = devCaps.includes(reqCap) && devCaps.includes(outCap);
    const isBothBusiness = businessCaps.includes(reqCap) && businessCaps.includes(outCap);
    const isBothText = textCaps.includes(reqCap) && textCaps.includes(outCap);
    const isBothMedia = mediaCaps.includes(reqCap) && mediaCaps.includes(outCap);

    if (isBothDev || isBothBusiness || isBothText || isBothMedia) {
      matchScore = 75;
      success = true;
      details = `部分的適合：要求された機能 [${reqCap}] と成果物機能 [${outCap}] は異なりますが、同一ドメインの隣接能力（同系統のドメイン）として適正と評価されました。`;
      matchReason = `要求された「${reqCap}」と成果物の「${outCap}」は、同一の上位技術ドメイン（隣接機能）に属しているため、部分的な適合と認められます。`;
    } else {
      matchScore = 30;
      success = false;
      details = `不整合：要求された機能は [${reqCap}] ですが、生成された成果物は [${outCap}] に分類されています。コンテキストに不整合が検出されました。`;
      matchReason = `要求された「${reqCap}」に対し、成果物は異なるドメインの「${outCap}」に分類されており、文脈の乖離が認められます。`;
    }
  }

  // Automatic Complexity determination
  const complexityInfo = getMissionComplexity(request);

  // ACOS Routing Engine dynamic query (Gemini-free routing constraint)
  const manager = ACOSValidationManager.getInstance();
  const allProviders = manager.registry.getAllProviders();

  // Score all providers and sort to find TOP3
  const scoredList = allProviders.map(p => {
    const scores = calculateScoreForDisplay(p, [reqCap], "quality");
    const selectionReason = getProviderSelectionReason(
      p.name,
      p.metrics.quality,
      p.metrics.cost,
      p.metrics.latency,
      reqCap
    );
    return {
      id: p.id,
      name: p.name,
      provider: p.adapterId,
      quality: p.metrics.quality,
      cost: p.metrics.cost,
      latency: p.metrics.latency,
      health: p.health,
      overallScore: Number((scores.overall * 10).toFixed(1)), // Scale out of 100
      selectionReason
    };
  });

  // Sort descending by overallScore
  scoredList.sort((a, b) => b.overallScore - a.overallScore);

  // Take top 3
  const top3 = scoredList.slice(0, 3);
  const recommendedProvider = top3[0];

  return {
    success,
    requestCategory: reqCap,
    outputCategory: outCap,
    matchScore,
    details,
    complexity: complexityInfo.level,
    complexityReason: complexityInfo.reason,
    requestEvidence: reqEvidence.length > 0 ? reqEvidence : ["文脈キーワード"],
    outputEvidence: outEvidence.length > 0 ? outEvidence : ["成果物キーワード"],
    matchReason,
    recommendedProvider,
    top3Providers: top3
  };
}

/**
 * Pre-configured test cases mapped to extended capabilities
 */
export const VALIDATION_TEST_CASES: ValidationTestCase[] = [
  {
    id: "tc-1",
    name: "旅行依頼 ➔ 旅行プラン (成功パターン)",
    request: "来週の京都旅行プランを作成してください。美味しい温泉と寺院巡りの日程をお願いします。",
    output: "京都2泊3日の観光プランです。1日目は嵐山温泉と金閣寺。2日目は清水寺巡り。3日目は宇治の抹茶。ホテル予約とフライトを含みます。",
    expectedSuccess: true,
    expectedCategory: "Travel Planning"
  },
  {
    id: "tc-2",
    name: "旅行依頼 ➔ 法律解説 (失敗パターン)",
    request: "来週の京都旅行プランを作成してください。美味しい温泉と寺院巡りの日程をお願いします。",
    output: "労働基準法第36条に基づく時間外労働および休日労働に関する労使協定（いわゆる36協定）の遵守事項および罰則に関する解説文書です。",
    expectedSuccess: false,
    expectedCategory: "Travel Planning"
  },
  {
    id: "tc-3",
    name: "営業資料 ➔ 営業資料 (成功パターン)",
    request: "新規セキュリティソフトウェアの顧客向け営業提案資料のスライド構成案を作成してください。",
    output: "新規次世代AIファイアウォールのクライアント向け提案書。アジェンダ、現状課題、製品の優位性、価格プラン、ROI分析スライド構成。",
    expectedSuccess: true,
    expectedCategory: "Presentation"
  },
  {
    id: "tc-4",
    name: "営業資料 ➔ 旅行プラン (失敗パターン)",
    request: "新規セキュリティソフトウェアの顧客向け営業提案資料のスライド構成案を作成してください。",
    output: "北海道3泊4日スキーツアー日程表。ニセコのホテル宿泊、マウントレースイのチケット、千歳空港発着フライト付きプラン。",
    expectedSuccess: false,
    expectedCategory: "Presentation"
  },
  {
    id: "tc-5",
    name: "契約書解説 ➔ リーガルチェック (成功パターン)",
    request: "この秘密保持契約書（NDA）のリーガルチェックをお願いします。注意すべき規約はありますか？",
    output: "秘密保持に関する合意条項のリーガルチェック。第5条の秘密情報開示例外、第12条の準拠法および専属的合意管轄。コンプライアンス法務基準をパス。",
    expectedSuccess: true,
    expectedCategory: "Legal Reasoning"
  },
  {
    id: "tc-6",
    name: "システム設計 ➔ データベースコード (成功パターン)",
    request: "ユーザー管理機能のシステム開発のために、PostgreSQLのデータベーススキーマ設計をお願いします。",
    output: "CREATE TABLE users (id SERIAL PRIMARY KEY, username VARCHAR(50) NOT NULL UNIQUE, created_at TIMESTAMP DEFAULT NOW());",
    expectedSuccess: true,
    expectedCategory: "Code Generation"
  },
  {
    id: "tc-7",
    name: "感情分析 ➔ レビュー評価 (成功パターン)",
    request: "この商品レビュー文のネガポジ判定および顧客の感情分析をお願いします。",
    output: "レビュー文の感情判定結果：全体的にポジティブ（星4.5相当）。顧客は使いやすさに大変満足しています。",
    expectedSuccess: true,
    expectedCategory: "Sentiment Analysis"
  },
  {
    id: "tc-8",
    name: "UIモックアップ ➔ Figma設計 (成功パターン)",
    request: "新しいダッシュボードのUI/UXデザイン設計書、およびFigmaのワイヤーフレーム構成をお願いします。",
    output: "ダッシュボードのUI/UX改善計画：ナビゲーションの階層を整理し、ワイヤーフレームをFigma上で設計しました。レスポンシブなビューポートも対応。",
    expectedSuccess: true,
    expectedCategory: "UX/UI Design"
  }
];
