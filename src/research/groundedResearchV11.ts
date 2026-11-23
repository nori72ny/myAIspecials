import type { OriginResearchSource } from "../legacy/originResearchSource.js";
import {
  buildGroundedResearchEvidenceCards,
  type GroundedResearchEvidenceCard,
} from "./groundedResearchEvidenceCards.js";
import {
  buildGroundedResearchEvidencePacket,
  splitRecoverySentences,
} from "./groundedResearchEvidencePacket.js";

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

/**
 * Maximum characters of a source excerpt quoted in the partial answer
 * (R-1; shortened from 240 to 120 by the sources-display redesign,
 * SOURCES_DISPLAY_REDESIGN_2026-11-20: a quote is a two-line gist on
 * the source card, not a paragraph — the full text is one tap away
 * through the card's title link).
 */
const PARTIAL_ANSWER_EXCERPT_QUOTE_CHARS = 120;

/**
 * Text as it may appear inside a source card of the partial answer
 * (RESEARCH_FLOOR_DESIGN_2026-11-17 §3 R-1): whitespace collapsed
 * and bounded to PARTIAL_ANSWER_EXCERPT_QUOTE_CHARS characters, and
 * neutralized so the quoted text stays data, never presentation or
 * instruction: Markdown link syntax flattens to its label text, bare
 * URLs are dropped (each card already carries its URL as the title
 * link), and quote marks, heading markers, and code fences are
 * stripped so nothing inside the quoted text can break out of the
 * quoting or pose as the answer's own structure. When the bound cuts
 * the quote, it ends at the last sentence boundary inside the bound
 * whenever that boundary is not too early; otherwise the cut is
 * marked with an ellipsis so the omission is visible instead of
 * silent. Returns "" when nothing quotable remains.
 */
function neutralizePartialAnswerQuote(text: string): string {
  const flattened = text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/[^\s)]+/g, " ");
  const neutralized = flattened
    .replace(/[『』「」“”"‘’'#`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (neutralized.length <= PARTIAL_ANSWER_EXCERPT_QUOTE_CHARS) return neutralized;
  const bounded = neutralized.slice(0, PARTIAL_ANSWER_EXCERPT_QUOTE_CHARS);
  const sentenceEnd = Math.max(
    bounded.lastIndexOf("。"),
    bounded.lastIndexOf("！"),
    bounded.lastIndexOf("？"),
  );
  if (sentenceEnd >= PARTIAL_ANSWER_EXCERPT_QUOTE_CHARS / 2) {
    return bounded.slice(0, sentenceEnd + 1);
  }
  return `${bounded}…`;
}

/**
 * Site-chrome vocabulary for the partial answer's quote hygiene
 * (SOURCES_DISPLAY_REDESIGN_2026-11-20): words that belong to a
 * page's navigation, header, or account furniture rather than to its
 * substance. A single word proves nothing — substantive sentences
 * mention menus and logins too — so a sentence is treated as chrome
 * only when at least three distinct terms co-occur in it.
 */
const PARTIAL_ANSWER_CHROME_KEYWORDS = [
  "サイトマップ", "お問い合わせ", "新規ウィンドウ", "トップページ",
  "サイト内検索", "プライバシーポリシー", "利用規約", "アクセシビリティ",
  "会員登録", "ログイン", "メニュー", "ヘルプ", "検索",
  "有料記事", "有料会員", "トップニュース", "詳しくはこちら",
  "コメントプラス", "吹き出しアイコン", "文字サイズ", "公式アカウント",
  "english", "中文", "sitemap", "contact us", "privacy policy",
  "terms of use", "all rights reserved", "skip to content",
  "back to top", "sign up", "log in", "subscribe", "newsletter",
];

/**
 * Caption credit markers (P3-0, WEEKLY_INSPECTION_P3_DESIGN_2026-11-23
 * §3.6): the credit line of a photo caption — image/photo/illustration
 * provision credits, photographer credits, and their English forms.
 * A credit is never the source's gist, and its presence marks the
 * surrounding run as a caption block (see the filter below). The
 * markers are deliberately specific — a bare mention of a photo or a
 * photographer in substantive text is not a credit.
 */
const PARTIAL_ANSWER_CAPTION_CREDIT_PATTERN =
  /画像提供|写真提供|イラスト提供|動画提供|画像[：:]|写真[：:]|撮影[：:・＝=]|（撮影|撮影者[：:・]|（写真|（画像|\bphoto by\b|\bphotograph by\b|\bphoto credit\b|\bimage credit\b|\(\s*photo\b/iu;

/**
 * Predicate endings of a complete Japanese sentence, for the
 * caption-fragment judgement below: a sentence whose body ends with
 * one of these (auxiliaries, verb/adjective inflections, nominalized
 * predicate forms) states something; a Japanese sentence that ends
 * with anything else — a noun, a katakana run, a particle — is a
 * noun-final fragment （体言止め), the shape of headlines and of
 * photo descriptions.
 */
const PARTIAL_ANSWER_PREDICATE_ENDING_PATTERN =
  /(?:です|ます|でした|ました|だ|である|ない|なかった|いる|ある|なる|する|した|される|れる|られる|せる|させる|たい|よう|こと|もの|ため|から|ので|けど|が|て|し|等|など|ね|よ|な|か|わ|ず|[るたいたきくぐすつぬぶむれせめけげちり])$/u;

/**
 * Whether one sentence of a caption block is a caption fragment:
 * a run without sentence-final punctuation, or a Japanese
 * noun-final fragment with no predicate. Non-Japanese sentences are
 * never judged fragments here — the credit rule alone applies to
 * them. Only ever consulted for sentences of a quote that carries
 * a caption credit (see below), where the run describes the photo
 * rather than stating the source's content.
 */
function isPartialAnswerCaptionFragment(sentence: string): boolean {
  const trimmed = sentence.trim();
  if (!trimmed) return true;
  if (!/[。．！？!?」』）)]$/u.test(trimmed)) return true;
  if (!/[぀-ヿ㐀-䶿一-鿿]/u.test(trimmed)) return false;
  const body = trimmed.replace(/[。．！？!?」』）)]+$/u, "");
  return !PARTIAL_ANSWER_PREDICATE_ENDING_PATTERN.test(body);
}

/**
 * Drops chrome sentences from a raw quote before the R-1
 * neutralization: the evidence packet can select a page's header or
 * navigation run as "answer-bearing" when it happens to contain the
 * question's keywords, and quoting it made the site furniture pose
 * as the source's gist (external design review, 2026-11-20). The
 * selection itself (packet / claim span) is unchanged — this is a
 * presentation-stage filter on the already-selected text, and a
 * source whose quote is entirely chrome simply shows no quote on
 * its card instead of showing the furniture.
 *
 * P3-0 (WEEKLY_INSPECTION_P3_DESIGN_2026-11-23 §3.6) adds the
 * caption forms the 2026-11-23 weekly inspection caught in a tier-T3
 * quote (a photo's alt-text description and its "画像提供, Reuters"
 * credit, selected because the caption names the question's
 * subject): a sentence carrying a caption credit is dropped, and
 * when a quote carries any credit, the caption block's descriptive
 * fragments go with it — the remaining substantive sentences (they
 * end in predicates) are untouched. This is presentation only: the
 * extraction and stated-answer judgements read the packet's
 * sentences, never this filtered quote, so dropping a caption that
 * happens to carry an answer's core costs the card its gist, never
 * a judgement.
 */
function cleanPartialAnswerQuoteText(text: string): string {
  if (!text) return "";
  const sentences = splitRecoverySentences(text);
  const hasCaptionCredit = sentences.some((sentence) =>
    PARTIAL_ANSWER_CAPTION_CREDIT_PATTERN.test(sentence),
  );
  const kept = sentences.filter((sentence) => {
    if (PARTIAL_ANSWER_CAPTION_CREDIT_PATTERN.test(sentence)) return false;
    if (hasCaptionCredit && isPartialAnswerCaptionFragment(sentence)) return false;
    const haystack = sentence.toLowerCase();
    let hits = 0;
    for (const keyword of PARTIAL_ANSWER_CHROME_KEYWORDS) {
      if (haystack.includes(keyword)) {
        hits += 1;
        if (hits >= 3) return false;
      }
    }
    return true;
  });
  return kept.join(" ");
}

/**
 * The quote a source card carries (N-2b,
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
 * character bound and the neutralization are exactly the R-1 rules
 * above, applied by the caller to whichever raw quote wins (the PR-2
 * packet quote or this span). Returns "" when the card selected no
 * claim sentence (e.g. an empty excerpt), leaving the title-only
 * card.
 */
function claimQuoteSpan(card: GroundedResearchEvidenceCard): string {
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
  return card.excerpt.slice(start, end);
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
  // (詳しく調べる), so it never pastes raw retrieved page text. Excerpts are
  // full extracted pages for number-critical question types — navigation
  // and advertising boilerplate included — and quoting them made the raw
  // search dump pose as the answer. The confirmed scope is therefore
  // stated as the same source cards the partial answer uses
  // (buildSourceCardsSection below): a heading and a linked title per
  // source, with the retrieval dates collected into a single line. The
  // per-source attribution boilerplate the cards replaced is gone here
  // as well (SOURCES_DISPLAY_REDESIGN 2026-11-20, report follow-up).
  // The cards' quote does NOT carry to this surface: snippet-level
  // excerpts are often a single fragment with no sentence boundary, so
  // even the deterministically selected quote span can be the raw
  // fragment itself (measured: an unrelated query quoted
  // 「価格 1,000円 ナビゲーション広告文」 verbatim), and this surface
  // keeps its titles-only hygiene — the quote stays exclusive to the
  // partial answer, whose lead frames it as what the source says. The
  // evidence section carries
  // retrieval metadata only, and the internal cross-check breakdown
  // (values per topic) stays in the structured `conflicts` field
  // instead of a user-facing 照合メモ section. Excerpts remain
  // available to the synthesis stage as evidence-packet data.
  const sourceCardsSection = buildSourceCardsSection(bounded, "ja", query, { includeQuotes: false });
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
    report: `## 確認できた内容\n\n依頼: ${compactQuery}\n\n${sourceCardsSection}\n\n## 出典と取得状況\n\n${evidenceLines.join("\n\n")}\n\n${conflictNote}\n\n※ 「公式ドメイン一致」は、ユーザーが明示した公式ソース条件とホスト名が一致したことだけを示します。内容の真偽や媒体の権威性そのものを独立検証した意味ではありません。取得証拠の強さも、質問への最終的な正しさを保証しません。`,
  };
}

/**
 * The sources section shared by the partial answer and the research
 * report (SOURCES_DISPLAY_REDESIGN_2026-11-20; the report adopted the
 * same presentation as a follow-up, so both surfaces show sources
 * identically): the retrieval dates collected into a single line,
 * then one card per source — a heading with the source id and domain
 * (the outlet label — the source data carries no publisher name, so
 * the domain stands in for it), the title as a link to the source,
 * and, for the top three sources, a short verbatim quote (the
 * evidence packet's answer-bearing sentences, falling back to the
 * N-2b claim span) after the site-chrome filter and the R-1
 * neutralization. Callers pass an already-bounded list (at most
 * eight sources). The research report passes includeQuotes: false —
 * its PKG-9 hygiene rule keeps retrieved page text out of that
 * surface entirely (see buildGroundedResearchReport) — and then only
 * the heading, the linked title, and the dates line are shared.
 */
function buildSourceCardsSection(
  sources: readonly OriginResearchSource[],
  language: "ja" | "en",
  question: string,
  options: { includeQuotes?: boolean } = {},
): string {
  const includeQuotes = options.includeQuotes ?? true;
  const cards = includeQuotes ? buildGroundedResearchEvidenceCards(question, sources).cards : [];
  const packet = includeQuotes ? buildGroundedResearchEvidencePacket(sources, question) : null;
  // The packet quote for one source: its excerpt-origin sentences, in
  // original order. Empty when the packet found nothing answer-bearing
  // for that source — the caller then falls back to the claim span.
  const packetQuoteForSource = (sourceIndex: number): string =>
    packet === null
      ? ""
      : packet.sentences
        .filter((sentence) => sentence.sourceIndex === sourceIndex && sentence.origin === "excerpt")
        .map((sentence) => sentence.text)
        .join(" ");
  const domainForList = (source: OriginResearchSource): string => {
    let domain = source.domain ?? "";
    if (!domain) {
      try { domain = new URL(source.url).hostname; } catch { domain = ""; }
    }
    return domain;
  };
  // The title as a Markdown link label: brackets would break the link
  // syntax, so they are widened to their full-width forms (the title
  // text itself is otherwise shown exactly as retrieved).
  const linkLabel = (source: OriginResearchSource): string =>
    displayTitle(source).replace(/\[/g, "［").replace(/\]/g, "］");
  const cardBlocks = sources.map((source, index) => {
    const id = `S${index + 1}`;
    const domain = domainForList(source);
    const heading = domain ? `### ${id} · ${domain}` : `### ${id}`;
    const parts = [heading, `[${linkLabel(source)}](${source.url})`];
    // Quotes ride only on the top three cards, as before the redesign:
    // they are the gist of the highest-ranked sources, and bounding
    // them keeps this section from becoming a second search dump.
    if (includeQuotes && index < 3) {
      // PR-2: prefer the packet's sentences for the quote; fall back
      // to the N-2b claim span when the packet has nothing for this
      // source. Either raw quote goes through the chrome filter and
      // the same R-1 neutralization and character bound, exactly once.
      const quote = neutralizePartialAnswerQuote(
        cleanPartialAnswerQuoteText(
          packetQuoteForSource(index) || claimQuoteSpan(cards[index]),
        ),
      );
      if (quote) parts.push(language === "en" ? `"${quote}"` : `『${quote}』`);
    }
    return parts.join("\n\n");
  });
  // Retrieval dates, collected once: every distinct known date, in
  // source order. Sources without a parseable date contribute nothing
  // (no date is invented for them); when no date is known at all the
  // line is omitted.
  const retrievedLabels: string[] = [];
  for (const source of sources) {
    const label = retrievedDateLabel(source.retrievedAt, language);
    if (label && !retrievedLabels.includes(label)) retrievedLabels.push(label);
  }
  const retrievedLine = retrievedLabels.length === 0
    ? null
    : language === "en"
      ? `Retrieved: ${retrievedLabels.join(", ")}`
      : `取得日：${retrievedLabels.join("、")}`;
  return [
    ...(retrievedLine ? [retrievedLine] : []),
    ...cardBlocks,
  ].join("\n\n");
}

/**
 * Partial-answer fallback body for the chat research path, used when the
 * bounded synthesis stage did not produce an adoptable answer (provider
 * failure, citation-validation failure, plan unavailable, or synthesis
 * disabled) but usable sources were retrieved. The shape is identical no
 * matter why synthesis was not adopted:
 * - an honest lead stating that no summarized answer could be produced
 *   and directing the user to the sources for details;
 * - a "confirmed scope" section holding one card per source (at most
 *   eight): a heading with the source id and domain (the outlet label —
 *   the source data carries no publisher name, so the domain stands in
 *   for it), the title as a link to the source (the "open" action),
 *   and — for the top three sources — a short verbatim quote as the
 *   card's gist. The retrieval dates of all sources are collected into
 *   a single line directly under the section heading instead of being
 *   repeated on every card.
 * Since RESEARCH_FLOOR_DESIGN_2026-11-17 §3 R-1, each of the top
 * sources also carries a verbatim quote from the source, so the core
 * of the answer reaches the user even when synthesis never ran. Since
 * N-2b (N2_N5_IMPLEMENTATION_DESIGN_2026-11-17 §1.4), that quote is
 * the source's evidence-card claim sentences — the sentences selected
 * deterministically as answering the question — rather than the
 * excerpt's head, which for full page extracts is navigation or
 * advertising boilerplate as often as substance. The quote is
 * presented strictly as what the source says — never as a confirmed
 * fact — and is neutralized and bounded by the same R-1 rules; the
 * lead keeps directing the user to verify details at the sources. The
 * internal cross-check breakdown never appears in this body; it stays
 * in logs and structured payload fields.
 * Since the recovery build Stage 1 PR-2, the quote prefers the
 * sentence-level evidence packet (groundedResearchEvidencePacket.ts):
 * the packet splits the RAW excerpt with a period-protecting splitter
 * (decimals, URLs and quoted periods stay intact) and selects up to
 * eight answer-bearing sentences per source list, so a fact such as
 * "1.25%" is quoted whole instead of as the "1." / "25%…" fragments
 * the N-2b claim splitter produced. Title-origin packet sentences
 * are not quoted here — the title is already shown on the same card.
 * When the packet has no excerpt sentence for a source, the quote
 * falls back to that source's N-2b claim span.
 * Sources-display redesign (SOURCES_DISPLAY_REDESIGN_2026-11-20,
 * external design review): the per-source attribution boilerplate
 * ("S1 (domain) states: '…'") and the duplicated plain source list
 * were replaced by the card layout above; the quote bound dropped
 * from 240 to 120 characters with sentence-aware cutting, and a
 * presentation-stage filter drops site-chrome sentences (navigation
 * and header runs the packet selected only because they contain the
 * question's keywords) from the quote before neutralization.
 */
export function buildGroundedResearchPartialAnswer(
  sources: readonly OriginResearchSource[],
  language: "ja" | "en",
  question = "",
): string {
  const bounded = sources.slice(0, 8);
  if (bounded.length === 0) return "";
  const sectionBody = buildSourceCardsSection(bounded, language, question);
  if (language === "en") {
    return `I retrieved ${bounded.length} public source(s), but a summarized answer could not be produced, so the confirmed scope and the source list follow. Please check the sources for the details.\n\n## What could be confirmed\n\n${sectionBody}`;
  }
  return `公開情報を${bounded.length}件取得しましたが、要約した回答を作成できなかったため、確認できた範囲と出典の一覧をお伝えします。内容の詳細は各出典でご確認ください。\n\n## 確認できた範囲\n\n${sectionBody}`;
}
