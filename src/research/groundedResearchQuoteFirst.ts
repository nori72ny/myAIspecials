import type { OriginResearchSource } from "../legacy/originResearchSource.js";
import {
  buildGroundedResearchEvidencePacket,
  type RecoveryPacketSentenceOrigin,
} from "./groundedResearchEvidencePacket.js";

/**
 * Quote-first generation contract (EXTERNAL_KNOWHOW_ANSWER_SEARCH_
 * 2026-11-19 §3, adoption item 1; Anthropic's quote-first prompting
 * guidance + sentence-level citation binding, composed with ORIGIN's
 * own PR-2 evidence packet).
 *
 * Why: the free synthesis path (groundedResearchSynthesisV12) already
 * instructs the model to write only what the packet supports, but the
 * instruction is prose and the validator checks a finished draft
 * against the UNION of every cited source's full excerpt. A stale
 * value that sits anywhere in a cited excerpt — the previous period's
 * rate in the same article that also carries the current one — passes
 * that union check, which is the shape of the round-6 stale-value
 * fatals (F-03 policy rate, F-15 GDP, E-15 call rate: an old figure
 * asserted as current). The contract narrows the support set the
 * model may rest a claim on: before writing, the model must extract
 * the evidence sentences it will use, verbatim, from a registry this
 * module builds deterministically from the PR-2 packet; the answer
 * may then rest only on those extracted quotes. Support is therefore
 * a property of specific sentences the model committed to, not of
 * whatever happens to share an excerpt with them.
 *
 * The switch is ORIGIN_QUOTE_FIRST_MODE ("off" default / "shadow" /
 * "enforce"), fail closed like every Stage-1 switch: only the exact
 * strings enable it, so production behavior is unchanged until the
 * mode is deliberately registered.
 *
 * Mode semantics (fixed by tests in groundedResearchQuoteFirst.test.ts):
 *  - off: the registry and contract are not added to the request and
 *    no binding analysis runs. Requests and adoption are byte-identical
 *    to the pre-quote-first pipeline.
 *  - shadow: the registry and contract ARE added (a contract the model
 *    never saw cannot be judged), the scaffold section the model emits
 *    is removed before the existing adoption gate runs, and the binding
 *    verdict is computed and returned for the caller's structured log.
 *    The gate's decision is exactly the pre-quote-first one on the
 *    scaffold-stripped text: a binding failure never discards, strips,
 *    or otherwise changes the delivered answer.
 *  - enforce: before the existing gate runs, factual units that fail
 *    binding are removed (subject to the safety rails in
 *    groundedResearchSynthesisV12: never more than half the units,
 *    never a table row, never when no substantive conclusion unit
 *    would survive, never leaving a dangling back-reference). The
 *    enforced text is adopted only when the unchanged gate accepts
 *    it; if the gate rejects the enforced text, the verdict of the
 *    unstripped text stands, so enforcement can rescue a draft but
 *    can never make an outcome worse than shadow. A delivered removal
 *    is reported through the adoption's salvaged/removedUnits fields,
 *    so the existing partial-answer disclosure applies unchanged.
 *
 * What binding can and cannot judge: a unit is bound when it cites at
 * least one source that has a verified quote and every numeric token
 * in it appears in that source's verified quotes (or in the packet's
 * own date forms for that source, which the model is separately
 * instructed to state). Non-numeric prose support is not mechanically
 * decidable and is not attempted. Binding is also not a truth check:
 * a claim faithfully resting on a stale quote is bound — choosing
 * between competing values stays with the PR-3 vote, the §4 official-
 * support guard, and the publication gate, exactly as before.
 *
 * This module is pure and deterministic: no model, no network, no
 * clock, no environment reads beyond the switch resolver. The per-unit
 * binding analysis itself lives in groundedResearchSynthesisV12.ts so
 * it shares the validator's own unit machinery and cannot drift from
 * the gate's notion of a factual unit.
 */

export type QuoteFirstMode = "off" | "shadow" | "enforce";

export const ORIGIN_QUOTE_FIRST_MODE_ENV = "ORIGIN_QUOTE_FIRST_MODE" as const;

/**
 * Selected by ORIGIN_QUOTE_FIRST_MODE. Only the exact values "shadow"
 * and "enforce" enable the contract; everything else — including an
 * unset variable — is off (Stage 1 common rule, same shape as
 * resolveRecoveryTemplateFallbackMode).
 */
export function resolveQuoteFirstMode(
  env: NodeJS.ProcessEnv | undefined,
): QuoteFirstMode {
  if (env?.ORIGIN_QUOTE_FIRST_MODE === "shadow") return "shadow";
  if (env?.ORIGIN_QUOTE_FIRST_MODE === "enforce") return "enforce";
  return "off";
}

/** Sources the synthesis packet, validator, and registry all bound to. */
export const QUOTE_FIRST_MAX_SOURCES = 8;

export interface QuoteFirstRegistryEntry {
  /** Stable ID inside one request: Q1..Qn in packet order. */
  quoteId: string;
  /** 0-based index into the bounded sources array. */
  sourceIndex: number;
  /** Citation ID of the owning source (S1..S8, the synthesis module's sourceId). */
  sourceId: string;
  /** The source URL the citation token must carry, as the packet shows it. */
  url: string;
  /** Verbatim evidence sentence (title or excerpt substring). */
  text: string;
  origin: RecoveryPacketSentenceOrigin;
}

export interface QuoteFirstRegistry {
  entries: QuoteFirstRegistryEntry[];
  byId: ReadonlyMap<string, QuoteFirstRegistryEntry>;
}

type RegistrySource = Pick<OriginResearchSource, "title" | "url" | "excerpt">;

/**
 * Build the quote registry for one synthesis request: the PR-2
 * evidence packet over the same bounded source list the synthesis
 * prompt and validator use (first eight), with a stable Q ID per
 * packet sentence. An empty registry means the packet found no
 * answer-bearing sentence in these sources; callers treat that as
 * "quote-first does not engage for this request" rather than forcing
 * a contract the model cannot satisfy.
 */
export function buildQuoteFirstRegistry(
  sources: readonly RegistrySource[],
  question: string,
): QuoteFirstRegistry {
  const bounded = sources.slice(0, QUOTE_FIRST_MAX_SOURCES);
  const packet = buildGroundedResearchEvidencePacket(bounded, question);
  const entries: QuoteFirstRegistryEntry[] = packet.sentences.map((sentence, index) => ({
    quoteId: `Q${index + 1}`,
    sourceIndex: sentence.sourceIndex,
    sourceId: `S${sentence.sourceIndex + 1}`,
    url: bounded[sentence.sourceIndex]?.url ?? "",
    text: sentence.text,
    origin: sentence.origin,
  }));
  return { entries, byId: new Map(entries.map((entry) => [entry.quoteId, entry])) };
}

/** The citation token for a registry entry, exactly as the packet prints it. */
export function quoteFirstCitationToken(entry: QuoteFirstRegistryEntry): string {
  return `[${entry.sourceId}](${entry.url})`;
}

/**
 * The registry section appended to the synthesis user message when
 * the contract is on. Each entry is printed in the exact line shape
 * the model must echo in its scaffold, so a compliant scaffold line
 * is a copy, not a composition.
 */
export function buildQuoteFirstRegistrySection(
  registry: QuoteFirstRegistry,
  language: "ja" | "en",
): string {
  const lines = registry.entries.map(
    (entry) => `${entry.quoteId} ${quoteFirstCitationToken(entry)}: 「${entry.text}」`,
  );
  if (language === "en") {
    return [
      "QUOTE REGISTRY (quote-first)",
      "The following evidence sentences were extracted from the sources above. Before writing the answer, list in an ## Extracted quotes section exactly the sentences you will rely on, one per line, copying each line below character for character. Never quote a sentence that is not in this registry, and never alter a quoted sentence.",
      ...lines,
    ].join("\n");
  }
  return [
    "引用レジストリ（quote-first）",
    "以下は、上記の出典情報から抽出された証跡文です。回答を書く前に、根拠として使う文だけを ## 根拠引用 の節に、以下の行を一字も変えずコピーして列挙してください。レジストリに無い文を引用として作ったり、引用文を書き換えたりしてはいけません。",
    ...lines,
  ].join("\n");
}

/**
 * The contract lines appended to the synthesis system instruction
 * when the contract is on. They add a working section in front of the
 * mandated three answer sections; every pre-existing format rule for
 * the answer sections themselves is unchanged.
 */
export function buildQuoteFirstContractInstruction(language: "ja" | "en"): string {
  if (language === "en") {
    return [
      "Additional contract (quote-first generation):",
      "- Before the three answer sections, output a working section headed ## Extracted quotes. In it, list only the registry sentences you will rely on, one per line, each line copied character for character from the quote registry in the user message (quote ID, the source's full citation token, a colon, and the sentence in 「」).",
      "- Write the answer body using only the sentences listed in that working section as the basis for factual claims. Every number, date, and proper name in the body must appear verbatim in one of the listed quotes. Never write a claim that no listed quote supports; if the quotes do not cover part of the question, say what is missing instead of filling it in.",
      "- The working section is a generation scaffold, not part of the answer. The three answer sections keep every existing format rule (headings, a citation token on every factual line, the full source list).",
    ].join("\n");
  }
  return [
    "追加の契約（quote-first生成）:",
    "- 回答の3節（結論・根拠・出典）の前に、## 根拠引用 という見出しの作業節を置いてください。作業節には、根拠として使うレジストリの文だけを1行に1文ずつ、ユーザーメッセージの引用レジストリの行を一字も変えずコピーして列挙してください（Q番号、出典の引用トークンの完全コピー、コロン、「」で囲んだ文）。",
    "- 回答の本文は、作業節に列挙した引用文だけを根拠に書いてください。本文の数値・日付・固有名詞は、いずれかの列挙した引用文に逐語で現れるものだけを使ってください。列挙した引用文が支持しない主張は書かず、引用文でカバーできない部分は、穴埋めせず不足として明示してください。",
    "- 作業節は生成のための作業領域であり、回答の一部ではありません。本文の3節は、従来の形式要件（見出し、各事実行への引用トークン、出典一覧の完全列挙）をすべて守ってください。",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Scaffold parsing and verbatim verification.
//
// The scaffold is the model's half of the contract: a headed section
// listing the quotes it committed to. Parsing is line-based and
// tolerant of a leading bullet, but verification is strict: a quote
// counts only when its Q ID exists in the registry, the citation on
// the line names that entry's own source and URL, and the quoted text
// equals the registry sentence under normalization (NFKC, whitespace
// removed, one optional trailing sentence terminator ignored on both
// sides — the terminator is punctuation the registry keeps and a
// model may drop, never content).

export interface QuoteFirstVerifiedQuote {
  quoteId: string;
  sourceId: string;
  /** The registry sentence (canonical text, not the model's copy). */
  text: string;
}

export interface QuoteFirstScaffoldParse {
  /** A scaffold heading was present. */
  found: boolean;
  /** Scaffold lines that carried a Q ID and a citation token. */
  declaredCount: number;
  /** Declared quotes that passed verbatim verification. */
  verifiedQuotes: QuoteFirstVerifiedQuote[];
  /** Declared quotes that failed verification (fabricated, misattributed, or altered). */
  invalidCount: number;
  /** The answer text with the scaffold section removed. */
  strippedText: string;
}

const SCAFFOLD_HEADING_PATTERN = /根拠引用|抽出引用|引用抽出|extracted quotes|quote-first/i;
const HEADING_LINE_PATTERN = /^#{1,6}\s+/;
const SCAFFOLD_LINE_PATTERN =
  /^\s*(?:[-*+]\s+)?Q\s?(\d+)\s+\[S(\d+)\]\((https:\/\/[^)\s]+)\)\s*[:：]?\s*(.*)$/;

function normalizeQuoteText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").trim();
}

function quoteTextsEqual(a: string, b: string): boolean {
  const na = normalizeQuoteText(a);
  const nb = normalizeQuoteText(b);
  if (na === nb) return true;
  const stripTerminator = (s: string): string => s.replace(/[。．.!?！？]+$/, "");
  return stripTerminator(na) === stripTerminator(nb);
}

function normalizedUrl(value: string): string {
  try {
    return new URL(value).toString();
  } catch {
    return value;
  }
}

/** The quoted span of a scaffold line's remainder: 「…」, 『…』, or "…"; otherwise the remainder itself. */
function scaffoldQuoteText(remainder: string): string {
  const bracketed = remainder.match(/「([^」]*)」/) ?? remainder.match(/『([^』]*)』/) ?? remainder.match(/"([^"]*)"/);
  if (bracketed) return bracketed[1];
  return remainder.trim();
}

export function parseQuoteFirstScaffold(
  text: string,
  registry: QuoteFirstRegistry,
): QuoteFirstScaffoldParse {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const headingIndex = lines.findIndex(
    (line) => HEADING_LINE_PATTERN.test(line.trim()) && SCAFFOLD_HEADING_PATTERN.test(line),
  );
  if (headingIndex < 0) {
    return { found: false, declaredCount: 0, verifiedQuotes: [], invalidCount: 0, strippedText: text };
  }
  let endIndex = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    if (HEADING_LINE_PATTERN.test(lines[i].trim())) {
      endIndex = i;
      break;
    }
  }
  const verifiedQuotes: QuoteFirstVerifiedQuote[] = [];
  const seenQuoteIds = new Set<string>();
  let declaredCount = 0;
  let invalidCount = 0;
  for (let i = headingIndex + 1; i < endIndex; i += 1) {
    const match = lines[i].match(SCAFFOLD_LINE_PATTERN);
    if (!match) continue;
    declaredCount += 1;
    const entry = registry.byId.get(`Q${match[1]}`);
    const citedSourceId = `S${match[2]}`;
    const quoteText = scaffoldQuoteText(match[4] ?? "");
    if (
      !entry ||
      entry.sourceId !== citedSourceId ||
      normalizedUrl(entry.url) !== normalizedUrl(match[3]) ||
      !quoteTextsEqual(quoteText, entry.text)
    ) {
      invalidCount += 1;
      continue;
    }
    if (seenQuoteIds.has(entry.quoteId)) continue;
    seenQuoteIds.add(entry.quoteId);
    verifiedQuotes.push({ quoteId: entry.quoteId, sourceId: entry.sourceId, text: entry.text });
  }
  const strippedText = [...lines.slice(0, headingIndex), ...lines.slice(endIndex)]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { found: true, declaredCount, verifiedQuotes, invalidCount, strippedText };
}
