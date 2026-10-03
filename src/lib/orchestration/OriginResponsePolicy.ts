import type { AITaskType } from "./MultiAIOrchestrator.js";
import type { OriginRequestIntent } from "./OriginRequestIntent.js";

export type OriginResponseDepth = "concise" | "standard" | "deep";
export type OriginResponseStructure =
  | "answer-first"
  | "conversation"
  | "steps"
  | "comparison"
  | "research"
  | "technical"
  | "deliverable";
export type OriginResponseTone = "conversational" | "neutral" | "professional";

export interface OriginResponsePolicy {
  version: 1;
  depth: OriginResponseDepth;
  structure: OriginResponseStructure;
  tone: OriginResponseTone;
  directAnswerFirst: boolean;
  preferParagraphs: boolean;
  allowBullets: boolean;
  allowTables: boolean;
  preserveRequestedFormat: true;
  explicitFormatRequested: boolean;
  uncertaintyMustBeExplicit: true;
  evidenceNearClaims: true;
  avoidGenericPreamble: true;
  avoidRepeatedConclusion: true;
  avoidListSpam: true;
  avoidTableAbuse: true;
  avoidExcessiveBold: true;
}

export interface ResolveOriginResponsePolicyInput {
  intent: OriginRequestIntent;
  taskType: AITaskType;
  userMessage: string;
}

function hasExplicitConciseRequest(message: string): boolean {
  return /(?:短く|簡潔|要点だけ|結論だけ|一言|100字|200字|300字)|\b(?:brief|concise|short|tl;dr)\b/i.test(message);
}

function hasExplicitDeepRequest(message: string): boolean {
  return /(?:詳しく|詳細|徹底的|網羅的|深く|細かく)|\b(?:detailed|deep|comprehensive|thorough)\b/i.test(message);
}

function hasExplicitFormatRequest(message: string): boolean {
  return /(?:箇条書きなし|箇条書きで|表で|表形式|JSONのみ|JSONだけ|コードだけ|Markdownなし|マークダウンなし|\d+項目|\d+個)|\b(?:json only|code only|no markdown|no bullets?|table only|exactly\s+\d+)\b/i.test(message);
}

function forbidsBullets(message: string): boolean {
  return /(?:箇条書きなし|箇条書きは不要|リストなし)|\b(?:no bullets?|without bullets?)\b/i.test(message);
}

function forbidsTables(message: string): boolean {
  return /(?:表なし|表は不要|テーブルなし)|\b(?:no tables?|without tables?)\b/i.test(message);
}

function requestsComparison(intent: OriginRequestIntent, message: string): boolean {
  return intent.requestedOutputs.includes("comparison")
    || /(?:比較|違い|メリット.{0,3}デメリット)|\b(?:compare|comparison|versus|\bvs\b)\b/i.test(message);
}

function structureFor(input: ResolveOriginResponsePolicyInput): OriginResponseStructure {
  const { intent, taskType, userMessage } = input;
  if (intent.interactionMode === "deliverable") return "deliverable";
  if (requestsComparison(intent, userMessage)) return "comparison";
  if (taskType === "research" || taskType === "current-information") return "research";
  if (["implementation", "architecture", "security", "test", "operations"].includes(taskType)) return "technical";
  if (/(?:手順|やり方|方法|ステップ)|\b(?:steps?|how to|procedure)\b/i.test(userMessage)) return "steps";
  if (intent.interactionMode === "conversation" && intent.requiredCapabilities.length === 0) return "conversation";
  return "answer-first";
}

function depthFor(input: ResolveOriginResponsePolicyInput): OriginResponseDepth {
  if (hasExplicitConciseRequest(input.userMessage)) return "concise";
  if (hasExplicitDeepRequest(input.userMessage)) return "deep";
  if (["architecture", "security", "research", "current-information"].includes(input.taskType)) return "deep";
  return "standard";
}

function toneFor(intent: OriginRequestIntent, taskType: AITaskType): OriginResponseTone {
  if (intent.interactionMode === "deliverable") return "professional";
  if (["implementation", "architecture", "security", "test", "operations", "documentation"].includes(taskType)) return "professional";
  if (intent.interactionMode === "conversation") return "conversational";
  return "neutral";
}

export function resolveOriginResponsePolicy(input: ResolveOriginResponsePolicyInput): OriginResponsePolicy {
  const explicitFormatRequested = hasExplicitFormatRequest(input.userMessage);
  const structure = structureFor(input);
  return {
    version: 1,
    depth: depthFor(input),
    structure,
    tone: toneFor(input.intent, input.taskType),
    directAnswerFirst: structure !== "deliverable",
    preferParagraphs: structure === "conversation" || structure === "answer-first",
    allowBullets: !forbidsBullets(input.userMessage),
    allowTables: !forbidsTables(input.userMessage),
    preserveRequestedFormat: true,
    explicitFormatRequested,
    uncertaintyMustBeExplicit: true,
    evidenceNearClaims: true,
    avoidGenericPreamble: true,
    avoidRepeatedConclusion: true,
    avoidListSpam: true,
    avoidTableAbuse: true,
    avoidExcessiveBold: true,
  };
}

export function originResponsePolicyInstruction(policy: OriginResponsePolicy): string {
  const formatPriority = policy.explicitFormatRequested
    ? "- The user's explicit output format is a hard requirement. Do not add wrappers, headings, tables, bullets, or commentary that violate it."
    : "- Choose formatting only when it improves comprehension; do not structure by habit.";

  return [
    "ORIGIN response presentation policy (presentation only; never override factuality, safety, citations, or tool evidence):",
    `- Depth: ${policy.depth}. Structure: ${policy.structure}. Tone: ${policy.tone}.`,
    policy.directAnswerFirst
      ? "- Start with the answer, decision-relevant point, or usable result; avoid generic meta-introductions and question repetition."
      : "- For a requested deliverable, begin with the deliverable itself rather than commentary about producing it.",
    policy.preferParagraphs
      ? "- Prefer natural paragraphs for ordinary conversation; use lists only for genuinely parallel items or steps."
      : "- Use the structure that best fits the task, but avoid unnecessary sectioning.",
    policy.allowBullets
      ? "- Bullets are allowed when they improve scanability; do not turn every sentence into a bullet."
      : "- Do not use bullet lists.",
    policy.allowTables
      ? "- Tables are allowed for real comparison or dense aligned data; do not use them for ordinary prose."
      : "- Do not use tables.",
    formatPriority,
    "- Keep evidence/citations adjacent to the claims they support and state material uncertainty explicitly.",
    "- Avoid repeated conclusions, excessive bold, vague intensifiers, list spam, table abuse, and awkward literal Japanese.",
    "- Match explanation depth to the task: do not over-explain simple requests or under-explain complex ones.",
  ].join("\n");
}
