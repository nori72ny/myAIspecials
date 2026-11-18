import type { OriginResearchSource } from "../legacy/originResearchSource.js";
import {
  buildGroundedResearchEvidenceCards,
  type GroundedResearchEvidenceCard,
} from "./groundedResearchEvidenceCards.js";

export type GroundedResearchConfidence = "strong" | "moderate" | "limited";

export type GroundedSourceAssessment = {
  id: string;
  title: string;
  url: string;
  domain: string;
  evidenceLevel: OriginResearchSource["evidenceLevel"];
  freshness: OriginResearchSource["freshness"];
  sourceAuthority: NonNullable<OriginResearchSource["sourceAuthority"]>;
  score: number;
  scoreScope: "retrieval-evidence-only";
  citation: string;
};

export type GroundedResearchConflict = {
  kind: "structured-value-mismatch";
  topic: "price" | "version" | "percentage";
  values: string[];
  sourceIds: string[];
  note: string;
};

export type GroundedResearchReport = {
  version: "1.1";
  sourceCount: number;
  distinctDomainCount: number;
  confidence: GroundedResearchConfidence;
  confidenceScope: "retrieval-evidence-only";
  semanticConflictDetection: "conservative-structured-only";
  sources: GroundedSourceAssessment[];
  conflicts: GroundedResearchConflict[];
  report: string;
};

function domainOf(source: OriginResearchSource): string {
  if (source.domain) return source.domain.toLowerCase().replace(/^www\./, "");
  try { return new URL(source.url).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return "unknown"; }
}

/** Title as it may appear in user-facing text: whitespace collapsed, bounded. */
function displayTitle(source: OriginResearchSource): string {
  const title = source.title.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, 200);
  return title || domainOf(source);
}

/** Maximum characters of a source excerpt quoted in the partial answer (R-1). */
const PARTIAL_ANSWER_EXCERPT_QUOTE_CHARS = 240;

/**
 * Text as it may appear inside an attribution line of the partial
 * answer (RESEARCH_FLOOR_DESIGN_2026-11-17 §3 R-1): whitespace collapsed
 * and bounded to 240 characters — the same compression rule as the
 * synthesis packet's excerpt compaction — and neutralized so the quoted
 * text stays data, never presentation or instruction: Markdown link
 * syntax flattens to its label text, bare URLs are dropped (the source
 * list below already carries each URL), and quote marks, heading
 * markers, and code fences are stripped so nothing inside the quoted
 * text can break out of the quoting or pose as the answer's own
 * structure. Returns "" when nothing quotable remains.
 */
function neutralizePartialAnswerQuote(text: string): string {
  const flattened = text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/[^\s)]+/g, " ");
  const neutralized = flattened
    .replace(/[『』「」“”"‘’'#`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return neutralized.slice(0, PARTIAL_ANSWER_EXCERPT_QUOTE_CHARS);
}

/**
 * The quote an attribution line carries (N-2b,
 * N2_N5_IMPLEMENTATION_DESIGN_2026-11-17 §1.4): the source's evidence
 * card claim sentences — the verbatim sentences selected as answering
 * the question — instead of the excerpt's first 240 characters, so the
 * quote is the source's answer-bearing core rather than whatever
 * boilerplate happens to lead the page extract. The quote is the
 * contiguous span of the card's excerpt covering the selected
 * sentences (a verbatim substring of the excerpt, itself whole source
 * sentences): the shared sentence splitter can cut a sentence at a
 * period inside a URL or a decimal, and quoting the fragments
 * separately could strand half a Markdown link past the neutralization
 * below, so the span is reconstituted before the R-1 rules apply. The
 * 240-character bound and the neutralization are exactly the R-1 rules
 * above. Returns "" when the card selected no claim sentence (e.g. an
 * empty excerpt), leaving the title-only attribution.
 */
function displayClaimQuote(card: GroundedResearchEvidenceCard): string {
  if (card.claimSentences.length === 0) return "";
  let start = Number.POSITIVE_INFINITY;
  let end = -1;
  for (const sentence of card.claimSentences) {
    const index = card.excerpt.indexOf(sentence);
    if (index < 0) continue;
    start = Math.min(start, index);
    end = Math.max(end, index + sentence.length);
  }
  if (end < 0) return "";
  return neutralizePartialAnswerQuote(card.excerpt.slice(start, end));
}

function retrievedDateLabel(value: string | undefined, language: "ja" | "en"): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return language === "ja"
    ? `${year}年${month}月${day}日`
    : `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function scoreSource(source: OriginResearchSource, domainOccurrenceCount: number): number {
  let score = source.evidenceLevel === "page-verified" ? 55 : 30;
  if (source.freshness === "recent") score += 15;
  else if (source.freshness === "older") score += 5;
  score += domainOccurrenceCount === 1 ? 15 : 5;
  if (source.sourceType === "encyclopedia") score += 5;
  return Math.min(score, 95);
}

function confidenceFor(sources: OriginResearchSource[]): GroundedResearchConfidence {
  const domains = new Set(sources.map(domainOf));
  const pageVerified = sources.filter((source) => source.evidenceLevel === "page-verified").length;
  const recent = sources.filter((source) => source.freshness === "recent").length;
  if (domains.size >= 3 && pageVerified >= 2 && recent >= 1) return "strong";
  if (domains.size >= 2 && (pageVerified >= 1 || recent >= 1)) return "moderate";
  return "limited";
}

function structuredValues(text: string): Array<{ topic: GroundedResearchConflict["topic"]; value: string }> {
  const values: Array<{ topic: GroundedResearchConflict["topic"]; value: string }> = [];
  const compact = text.normalize("NFKC").replace(/\s+/g, " ");
  const patterns: Array<{ topic: GroundedResearchConflict["topic"]; regex: RegExp }> = [
    { topic: "percentage", regex: /(?:率|割合|percentage|rate)[^\d]{0,24}(\d+(?:\.\d+)?%)/gi },
    { topic: "price", regex: /(?:価格|料金|price|cost)[^\d¥$€£]{0,24}([¥$€£]?\d[\d,.]*(?:円|\s?(?:usd|jpy|eur|gbp))?)/gi },
    { topic: "version", regex: /(?:バージョン|version)[^\d]{0,16}(v?\d+(?:\.\d+){0,3})/gi },
  ];
  for (const { topic, regex } of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(compact)) && values.length < 20) values.push({ topic, value: match[1].toLowerCase() });
  }
  return values;
}

function detectConflicts(sources: OriginResearchSource[]): GroundedResearchConflict[] {
  const byTopic = new Map<GroundedResearchConflict["topic"], Map<string, Set<string>>>();
  sources.forEach((source, index) => {
    const sourceId = `S${index + 1}`;
    for (const item of structuredValues(`${source.title} ${source.excerpt}`)) {
      const topic = byTopic.get(item.topic) ?? new Map<string, Set<string>>();
      const sourceIds = topic.get(item.value) ?? new Set<string>();
      sourceIds.add(sourceId);
      topic.set(item.value, sourceIds);
      byTopic.set(item.topic, topic);
    }
  });

  const conflicts: GroundedResearchConflict[] = [];
  for (const [topic, values] of byTopic) {
    if (values.size < 2) continue;
    const sourceIds = new Set<string>();
    for (const ids of values.values()) for (const id of ids) sourceIds.add(id);
    if (sourceIds.size < 2) continue;
    conflicts.push({
      kind: "structured-value-mismatch",
      topic,
      values: [...values.keys()].slice(0, 8),
      sourceIds: [...sourceIds].slice(0, 8),
      note: "Different structured values were retrieved. This is a review signal, not proof of factual contradiction.",
    });
  }
  return conflicts;
}

export function buildGroundedResearchReport(query: string, sources: OriginResearchSource[]): GroundedResearchReport {
  const bounded = sources.slice(0, 8);
  const domainCounts = new Map<string, number>();
  for (const source of bounded) {
    const domain = domainOf(source);
    domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
  }

  const assessments = bounded.map((source, index): GroundedSourceAssessment => {
    const domain = domainOf(source);
    return {
      id: `S${index + 1}`,
      title: source.title,
      url: source.url,
      domain,
      evidenceLevel: source.evidenceLevel,
      freshness: source.freshness,
      sourceAuthority: source.sourceAuthority ?? (source.sourceType === "encyclopedia" ? "secondary-reference" : "unclassified"),
      score: scoreSource(source, domainCounts.get(domain) ?? 1),
      scoreScope: "retrieval-evidence-only",
      citation: `[S${index + 1}](${source.url})`,
    };
  });

  const conflicts = detectConflicts(bounded);
  const confidence = confidenceFor(bounded);
  const compactQuery = query.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, 400);
  // Answer-body hygiene (PKG-9 rule, extended by the synthesis-hygiene
  // change): this report is rendered to users as the research answer body
  // (詳しく調べる), so it never pastes retrieved page text. Excerpts are
  // full extracted pages for number-critical question types — navigation
  // and advertising boilerplate included — and quoting them made the raw
  // search dump pose as the answer. The confirmed scope is therefore
  // stated as attributions built from source titles only, the evidence
  // section carries retrieval metadata only, and the internal cross-check
  // breakdown (values per topic) stays in the structured `conflicts`
  // field instead of a user-facing 照合メモ section. Excerpts remain
  // available to the synthesis stage as evidence-packet data.
  const summaryLines = bounded.map((source, index) => {
    const assessment = assessments[index];
    return `- ${assessment.id}（${assessment.domain}）では『${displayTitle(source)}』と示されています ${assessment.citation}`;
  });
  const evidenceLines = bounded.map((source, index) => {
    const assessment = assessments[index];
    const evidenceLabel = assessment.evidenceLevel === "page-verified" ? "本文確認済み" : "検索結果の要約";
    const freshnessLabel = assessment.freshness === "recent" ? "最近" : assessment.freshness === "older" ? "古い可能性" : "不明";
    const authorityLabel = assessment.sourceAuthority === "official-domain-match"
      ? "公式ドメイン一致（ユーザー指定条件）"
      : assessment.sourceAuthority === "secondary-reference"
        ? "二次参照（百科事典）"
        : "権威性未分類";
    return `### ${assessment.id}: ${displayTitle(source)}\n\n出典: ${assessment.citation}\n取得状態: ${evidenceLabel} / 更新時期: ${freshnessLabel} / 出典区分: ${authorityLabel} / 取得証拠スコア: ${assessment.score}/100`;
  });
  const conflictNote = conflicts.length === 0
    ? "取得した証拠から、価格・バージョン・割合の明示的な不一致は検出されませんでした。意味上の一致までは判定していません。"
    : "取得した出典の間で、価格・バージョン・割合のいずれかに値の食い違いが見られます。重要な判断の前に、一次情報でご確認ください。";

  return {
    version: "1.1",
    sourceCount: bounded.length,
    distinctDomainCount: domainCounts.size,
    confidence,
    confidenceScope: "retrieval-evidence-only",
    semanticConflictDetection: "conservative-structured-only",
    sources: assessments,
    conflicts,
    report: `## 確認できた内容\n\n依頼: ${compactQuery}\n\n${summaryLines.join("\n")}\n\n## 出典と取得状況\n\n${evidenceLines.join("\n\n")}\n\n${conflictNote}\n\n※ 「公式ドメイン一致」は、ユーザーが明示した公式ソース条件とホスト名が一致したことだけを示します。内容の真偽や媒体の権威性そのものを独立検証した意味ではありません。取得証拠の強さも、質問への最終的な正しさを保証しません。`,
  };
}

/**
 * Partial-answer fallback body for the chat research path, used when the
 * bounded synthesis stage did not produce an adoptable answer (provider
 * failure, citation-validation failure, plan unavailable, or synthesis
 * disabled) but usable sources were retrieved. The shape is identical no
 * matter why synthesis was not adopted:
 * - an honest lead stating that no summarized answer could be produced;
 * - a "confirmed scope" section attributing each of the top sources (at
 *   most three) by title and domain — the facts the title itself states,
 *   quoted verbatim, plus the retrieval date when known;
 * - the compact source list (id, title, domain, URL).
 * Since RESEARCH_FLOOR_DESIGN_2026-11-17 §3 R-1, each attribution line
 * also carries a verbatim quote from the source inside the same
 * attribution ("the source states: '…'"), so the core of the answer
 * reaches the user even when synthesis never ran. Since N-2b
 * (N2_N5_IMPLEMENTATION_DESIGN_2026-11-17 §1.4), that quote is the
 * source's evidence-card claim sentences — the sentences selected
 * deterministically as answering the question — rather than the
 * excerpt's head, which for full page extracts is navigation or
 * advertising boilerplate as often as substance. The quote is
 * presented strictly as what the source says — never as a confirmed
 * fact — and is neutralized and bounded by the same R-1 rules; the
 * lead keeps directing the user to verify details at the sources. The
 * internal cross-check breakdown never appears in this body; it stays
 * in logs and structured payload fields.
 */
export function buildGroundedResearchPartialAnswer(
  sources: readonly OriginResearchSource[],
  language: "ja" | "en",
  question = "",
): string {
  const bounded = sources.slice(0, 8);
  if (bounded.length === 0) return "";
  const cards = buildGroundedResearchEvidenceCards(question, bounded).cards;
  const domainForList = (source: OriginResearchSource): string => {
    let domain = source.domain ?? "";
    if (!domain) {
      try { domain = new URL(source.url).hostname; } catch { domain = ""; }
    }
    return domain;
  };
  const confirmedLines = bounded.slice(0, 3).map((source, index) => {
    const id = `S${index + 1}`;
    const domain = domainForList(source);
    const title = displayTitle(source);
    const quote = displayClaimQuote(cards[index]);
    const retrieved = retrievedDateLabel(source.retrievedAt, language);
    if (language === "en") {
      return `- ${id}${domain ? ` (${domain})` : ""} is titled "${title}".${quote ? ` It states: "${quote}"` : ""}${retrieved ? ` (Retrieved ${retrieved}.)` : ""}`;
    }
    return `- ${id}${domain ? `（${domain}）` : ""}では『${title}』と示されています。${quote ? `『${quote}』` : ""}${retrieved ? `（取得日: ${retrieved}）` : ""}`;
  });
  const sourceList = bounded.map((source, index) => {
    const id = `S${index + 1}`;
    const domain = domainForList(source);
    return language === "en"
      ? (domain ? `- ${id}: ${source.title} (${domain})\n  ${source.url}` : `- ${id}: ${source.title}\n  ${source.url}`)
      : (domain ? `- ${id}: ${source.title}（${domain}）\n  ${source.url}` : `- ${id}: ${source.title}\n  ${source.url}`);
  });
  if (language === "en") {
    return `I retrieved ${bounded.length} public source(s), but a summarized answer could not be produced, so the confirmed scope and the source list follow. Please check the sources for the details.\n\n## What could be confirmed\n${confirmedLines.join("\n")}\n\n## Sources\n${sourceList.join("\n")}`;
  }
  return `公開情報を${bounded.length}件取得しましたが、要約した回答を作成できなかったため、確認できた範囲と出典の一覧をお伝えします。内容の詳細は各出典でご確認ください。\n\n## 確認できた範囲\n${confirmedLines.join("\n")}\n\n## 出典\n${sourceList.join("\n")}`;
}
