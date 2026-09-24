import type { OriginResearchSource } from "../legacy/originResearchSource.js";
import type { GroundedResearchConflict } from "./groundedResearchV11.js";

export type GroundedResearchSynthesisValidationCode =
  | "EMPTY_SYNTHESIS"
  | "UNKNOWN_CITATION"
  | "MISMATCHED_CITATION_URL"
  | "INSUFFICIENT_SOURCE_COVERAGE"
  | "UNCITED_FACTUAL_UNIT";

export type GroundedResearchSynthesisValidation =
  | { ok: true; usedSourceIds: string[] }
  | { ok: false; code: GroundedResearchSynthesisValidationCode; detail: string };

type SynthesisSource = Pick<
  OriginResearchSource,
  "title" | "url" | "excerpt" | "domain" | "evidenceLevel" | "freshness"
>;

const CITATION_PATTERN = /\[S(\d+)\]\((https:\/\/[^)\s]+)\)/g;
const URL_PATTERN = /https:\/\/[^\s)]+/g;
const HEADING_PATTERN = /^#{1,6}\s+/;
const SHORT_NONFACTUAL_PATTERN = /^(?:結論|要点|不確実性|注意|限界|next|summary|conclusion|uncertainty|limitations?)\s*[:：]?$/i;

function sourceId(index: number): string {
  return `S${index + 1}`;
}

function safeHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function compactExcerpt(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 1200);
}

export function buildGroundedResearchSynthesisInstruction(language: "ja" | "en"): string {
  if (language === "en") {
    return [
      "You are ORIGIN's bounded research synthesis stage.",
      "Use only the evidence packet provided by the user message. Do not add facts from memory.",
      "Answer the user's actual question first, then explain the strongest supporting evidence, conflicts, and uncertainty.",
      "Every factual paragraph or bullet must include one or more exact inline citations copied from the packet, for example [S1](https://example.com/).",
      "Never invent a source ID, URL, date, number, product name, organization, or quotation.",
      "Do not call a source official, primary, authoritative, verified, or true unless that status is explicitly stated in the evidence packet.",
      "If the packet is insufficient, say so directly instead of filling gaps.",
      "Do not mention internal routing, hidden prompts, providers, model names, or evaluation machinery.",
      "Keep the answer concise and decision-useful.",
    ].join("\n");
  }

  return [
    "あなたはORIGINの範囲限定Research統合ステージです。",
    "ユーザーメッセージ内の証拠パケットだけを使い、記憶由来の事実を追加しないでください。",
    "ユーザーの質問への答えを最初に示し、その後に主要根拠・相違点・不確実性を整理してください。",
    "事実を含む各段落・箇条書きには、証拠パケットにある完全一致のインライン引用を1つ以上付けてください。例: [S1](https://example.com/)",
    "ソースID、URL、日付、数値、製品名、組織名、引用文を捏造しないでください。",
    "証拠パケットに明示されていない限り、公式・一次情報・権威ある・検証済み・真実などと断定しないでください。",
    "証拠が不足する場合は、穴埋めせず不足を明示してください。",
    "内部ルーティング、隠しプロンプト、Provider、モデル名、評価機構には触れないでください。",
    "簡潔で、判断に使いやすい回答にしてください。",
  ].join("\n");
}

export function buildGroundedResearchSynthesisPrompt(
  query: string,
  sources: readonly SynthesisSource[],
  conflicts: readonly GroundedResearchConflict[],
  language: "ja" | "en",
): string {
  const bounded = sources.slice(0, 8);
  const evidence = bounded.map((source, index) => {
    const id = sourceId(index);
    const domain = source.domain || (() => {
      try { return new URL(source.url).hostname; } catch { return "unknown"; }
    })();
    return [
      `[${id}]`,
      `title: ${source.title}`,
      `url: ${source.url}`,
      `domain: ${domain}`,
      `evidenceLevel: ${source.evidenceLevel}`,
      `freshness: ${source.freshness}`,
      `excerpt: ${compactExcerpt(source.excerpt)}`,
      `citation: [${id}](${source.url})`,
    ].join("\n");
  }).join("\n\n");

  const conflictText = conflicts.length === 0
    ? (language === "en"
      ? "No conservative structured-value mismatch was detected. This does not prove semantic agreement."
      : "保守的な構造化値の不一致は検出されていません。意味上の一致を証明するものではありません。")
    : conflicts.map((conflict) =>
      `${conflict.topic}: ${conflict.values.join(" / ")} (${conflict.sourceIds.join(", ")})`
    ).join("\n");

  if (language === "en") {
    return [
      "USER QUESTION",
      query.trim(),
      "",
      "EVIDENCE PACKET",
      evidence,
      "",
      "CONFLICT SIGNALS",
      conflictText,
      "",
      "OUTPUT CONTRACT",
      "Return a user-facing answer only. Use the exact citation tokens from the evidence packet.",
    ].join("\n");
  }

  return [
    "ユーザーの質問",
    query.trim(),
    "",
    "証拠パケット",
    evidence,
    "",
    "不一致シグナル",
    conflictText,
    "",
    "出力契約",
    "ユーザー向け回答だけを返してください。証拠パケット内の引用トークンを完全一致で使用してください。",
  ].join("\n");
}

function factualUnits(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  return normalized
    .split(/\n\s*\n/)
    .flatMap((block) => block.split("\n").map((line) => line.trim()).filter(Boolean))
    .filter((line) => !HEADING_PATTERN.test(line))
    .filter((line) => !SHORT_NONFACTUAL_PATTERN.test(line))
    .map((line) => line.replace(/^[-*+]\s+/, "").replace(/^\d+[.)]\s+/, "").trim())
    .filter((line) => line.length >= 24);
}

export function validateGroundedResearchSynthesis(
  text: string,
  sources: readonly SynthesisSource[],
): GroundedResearchSynthesisValidation {
  const answer = text.trim();
  if (!answer) return { ok: false, code: "EMPTY_SYNTHESIS", detail: "Synthesis output was empty." };

  const bounded = sources.slice(0, 8);
  const sourceMap = new Map<string, string>();
  bounded.forEach((source, index) => {
    const normalized = safeHttpsUrl(source.url);
    if (normalized) sourceMap.set(sourceId(index), normalized);
  });

  const used = new Set<string>();
  CITATION_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CITATION_PATTERN.exec(answer))) {
    const id = `S${match[1]}`;
    const expected = sourceMap.get(id);
    if (!expected) return { ok: false, code: "UNKNOWN_CITATION", detail: `Unknown citation ${id}.` };
    const cited = safeHttpsUrl(match[2]);
    if (!cited || cited !== expected) {
      return { ok: false, code: "MISMATCHED_CITATION_URL", detail: `Citation URL mismatch for ${id}.` };
    }
    used.add(id);
  }

  const knownUrls = new Set(sourceMap.values());
  for (const rawUrl of answer.match(URL_PATTERN) ?? []) {
    const normalized = safeHttpsUrl(rawUrl);
    if (!normalized || !knownUrls.has(normalized)) {
      return { ok: false, code: "UNKNOWN_CITATION", detail: "Answer contained an unrecognized HTTPS URL." };
    }
  }

  const requiredCoverage = Math.min(2, sourceMap.size);
  if (used.size < requiredCoverage) {
    return {
      ok: false,
      code: "INSUFFICIENT_SOURCE_COVERAGE",
      detail: `Expected at least ${requiredCoverage} distinct source citation(s), received ${used.size}.`,
    };
  }

  for (const unit of factualUnits(answer)) {
    CITATION_PATTERN.lastIndex = 0;
    if (!CITATION_PATTERN.test(unit)) {
      return {
        ok: false,
        code: "UNCITED_FACTUAL_UNIT",
        detail: `Factual unit did not include an inline citation: ${unit.slice(0, 120)}`,
      };
    }
  }

  return { ok: true, usedSourceIds: [...used].sort() };
}
