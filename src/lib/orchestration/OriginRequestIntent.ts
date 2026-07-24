import type { AITaskType } from "./MultiAIOrchestrator";

export type OriginInteractionMode =
  | "conversation"
  | "deliverable"
  | "agent-workflow";

export interface OriginIntentRule {
  id: string;
  patterns: readonly RegExp[];
}

export interface OriginRequestIntentCatalog {
  capabilities: readonly OriginIntentRule[];
  outputs: readonly OriginIntentRule[];
  agentWorkflowSignals: readonly RegExp[];
}

export interface OriginRequestIntent {
  primaryTask: AITaskType;
  interactionMode: OriginInteractionMode;
  requiredCapabilities: readonly string[];
  requestedOutputs: readonly string[];
  suggestedOutputs: readonly string[];
}

export const DEFAULT_ORIGIN_REQUEST_INTENT_CATALOG: OriginRequestIntentCatalog = {
  capabilities: [
    { id: "research", patterns: [/検索|調査|リサーチ|最新情報|一次情報|出典|\b(?:search|research)\b/i] },
    { id: "writing", patterns: [/文章|原稿|コピー|構成|執筆|\b(?:write|writing|copy)\b/i] },
    { id: "document-creation", patterns: [/資料|文書|企画書|報告書|レポート|提案書|手順書|\b(?:document|report|proposal)\b/i] },
    { id: "presentation-creation", patterns: [/スライド|プレゼン|PowerPoint|\b(?:slides?|presentation)\b/i] },
    { id: "conversation-design", patterns: [/トークスクリプト|台本|営業トーク|電話スクリプト|\b(?:talk script|sales script)\b/i] },
    { id: "image-generation", patterns: [/画像生成|画像を作|イラスト|バナー|クリエイティブ|\b(?:image generation|illustration|banner)\b/i] },
    { id: "application-development", patterns: [/アプリ|システム|プログラム|実装|コード|API|\b(?:app|application|software|code|implement)\b/i] },
    { id: "website-development", patterns: [/ホームページ|Webサイト|ウェブサイト|LP|ランディングページ|\b(?:website|landing page)\b/i] },
    { id: "social-content", patterns: [/Instagram|インスタグラム|SNS投稿|リール|フィード投稿|\b(?:social post|instagram|reels?)\b/i] },
    { id: "data-analysis", patterns: [/データ分析|集計|統計|KPI|CSV|予測|\b(?:analytics?|statistics?|forecast)\b/i] },
    { id: "design", patterns: [/UI|UX|デザイン|レイアウト|アクセシビリティ|\bdesign\b/i] },
    { id: "security", patterns: [/セキュリティ|脆弱性|認証|権限|XSS|CORS|\bsecurity\b/i] },
  ],
  outputs: [
    { id: "presentation", patterns: [/スライド|プレゼン資料|PowerPoint|\b(?:slides?|presentation)\b/i] },
    { id: "proposal", patterns: [/提案書|企画書|\bproposal\b/i] },
    { id: "document", patterns: [/資料(?:を)?作成|文書|報告書|レポート|手順書|\b(?:document|report)\b/i] },
    { id: "talk-script", patterns: [/トークスクリプト|営業トーク|電話スクリプト|\b(?:talk script|sales script)\b/i] },
    { id: "image", patterns: [/画像生成|画像を作|イラスト|バナー|\b(?:image|illustration|banner)\b/i] },
    { id: "application", patterns: [/アプリ.{0,12}(?:作|生成|開発|実装|完成)|\b(?:build|create|develop)\s+(?:an?\s+)?app\b/i] },
    { id: "website", patterns: [/(?:ホームページ|Webサイト|ウェブサイト).{0,16}(?:作|制作|生成|開発|完成)|\b(?:build|create|develop)\s+(?:a\s+)?website\b/i] },
    { id: "social-post", patterns: [/Instagram投稿|インスタグラム投稿|SNS投稿|リール台本|フィード投稿|\b(?:social post|instagram post)\b/i] },
    { id: "research-result", patterns: [/検索のみ|調査結果|リサーチ結果|\b(?:search results?|research brief)\b/i] },
    { id: "spreadsheet", patterns: [/表計算|スプレッドシート|Excel|CSV|\bspreadsheet\b/i] },
    { id: "chart", patterns: [/グラフ|チャート|可視化|\bchart\b/i] },
    { id: "comparison", patterns: [/比較表|一覧表|比較して|違いを比較|\bcompar(?:e|ison)\b/i] },
  ],
  agentWorkflowSignals: [
    /エージェントとして|エージェントで|一連の作業|最後まで実行|完成まで|調査して.{0,20}(?:作成|制作|実装)/i,
    /\b(?:agent workflow|end[- ]to[- ]end|execute the whole process)\b/i,
  ],
};

function matchesRule(input: string, rule: OriginIntentRule): boolean {
  return rule.patterns.some((pattern) => pattern.test(input));
}

function uniqueMatches(input: string, rules: readonly OriginIntentRule[]): string[] {
  return rules.filter((rule) => matchesRule(input, rule)).map((rule) => rule.id);
}

function suggestedOutputs(input: string, requested: readonly string[]): string[] {
  const suggestions: string[] = [];
  if (/比較|候補|選択肢|メリット.{0,3}デメリット|\boptions?\b/i.test(input)) {
    suggestions.push("comparison");
  }
  if (/数値|推移|割合|時系列|KPI|データ分析|\b(?:trend|metrics?)\b/i.test(input)) {
    suggestions.push("chart");
  }

  return suggestions.filter((output) => !requested.includes(output));
}

function interactionMode(
  input: string,
  requestedOutputs: readonly string[],
  catalog: OriginRequestIntentCatalog,
): OriginInteractionMode {
  if (catalog.agentWorkflowSignals.some((pattern) => pattern.test(input))) {
    return "agent-workflow";
  }
  return requestedOutputs.length > 0 ? "deliverable" : "conversation";
}

export function classifyOriginRequestIntent(
  input: string,
  primaryTask: AITaskType,
  catalog: OriginRequestIntentCatalog = DEFAULT_ORIGIN_REQUEST_INTENT_CATALOG,
): OriginRequestIntent {
  const requiredCapabilities = uniqueMatches(input, catalog.capabilities);
  const requestedOutputs = uniqueMatches(input, catalog.outputs);

  return {
    primaryTask,
    interactionMode: interactionMode(input, requestedOutputs, catalog),
    requiredCapabilities,
    requestedOutputs,
    suggestedOutputs: suggestedOutputs(input, requestedOutputs),
  };
}

export function originRequestIntentInstruction(intent: OriginRequestIntent): string {
  const capabilities = intent.requiredCapabilities.length > 0
    ? intent.requiredCapabilities.join(", ")
    : "general-reasoning";
  const requested = intent.requestedOutputs.length > 0
    ? intent.requestedOutputs.join(", ")
    : "none";
  const suggested = intent.suggestedOutputs.length > 0
    ? intent.suggestedOutputs.join(", ")
    : "none";

  return [
    "Application request analysis (guidance only; not execution evidence):",
    `- Primary task: ${intent.primaryTask}`,
    `- Requested interaction mode: ${intent.interactionMode}`,
    `- Required capabilities detected: ${capabilities}`,
    `- Explicitly requested output types: ${requested}`,
    `- Output types worth considering only if they improve the result: ${suggested}`,
    "- Treat capabilities and output types as extensible. Do not limit the answer to a fixed list of use cases.",
    "- Do not say that an agent, specialist, tool, search, service, or artifact was used unless the execution record proves it.",
  ].join("\n");
}
