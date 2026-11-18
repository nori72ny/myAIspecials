/**
 * Recovery build Stage 1, PR-5: refusal output validation,
 * nonexistence statements, conditional answers, and the bounded
 * retry (RECOVERY_BUILD_STAGE1_DESIGN_2026-11-18, PR-5; adoption:
 * EXTERNAL_CONSULT_CHAT100_ADOPTION_2026-11-18).
 *
 * Round 5's remaining non-substantive answers shared three shapes
 * that no earlier stage could fix:
 *
 *  - the research path DID run, but the answer never said the thing
 *    asked about does not exist (I-01 "iPhone 25", I-02
 *    「国民幸福手当」, I-03 「みなとみらい環状線」): the tier-T3
 *    partial answer listed excerpts about OTHER products, systems
 *    and lines, and the tier-T4 hold said only that nothing could be
 *    confirmed. When the question names an entity and that name
 *    appears in NO retrieved source — neither the kept sources nor
 *    the freshness gate's dropped candidates — the honest,
 *    substantive answer is a conditional nonexistence statement,
 *    built here deterministically;
 *  - the direct path ended in a one-line model refusal (J-05:
 *    「申し訳ありませんが、そのご要望には対応できません。」) for a
 *    benign question with a legitimate, lawful framing. The design
 *    answers with output validation plus ONE bounded re-execution
 *    carrying a fixed minimal instruction — never a standing prompt
 *    change, never more than one extra call, and the retry's output
 *    replaces the original only when it is not itself refusal-like
 *    (a worse or equal outcome keeps the original, which then goes
 *    through the usual gates exactly as before);
 *  - transient and structural failures (F-13's provider-error 503,
 *    F-12's empty body) are covered by a one-time research retry on
 *    provider error and by the terminal post-guard in the router —
 *    both wired in originChatRouter.ts, both bounded to one extra
 *    attempt.
 *
 * Everything in this module is pure and deterministic: no model
 * call, no prompt construction beyond the two fixed texts the
 * design fixes verbatim (the retry instruction and the procedure
 * guidance). The publication gate is never weakened: in enforce
 * mode the router passes every conditional answer this module
 * builds through the gate before delivering it, exactly as PR-4
 * does for its template.
 *
 * The switch is ORIGIN_RECOVERY_REFUSAL_VALIDATION_MODE ("off"
 * default / "shadow" / "enforce"). This module only resolves the
 * mode and computes; the CALLER decides what shadow means (the
 * routers log the detection and deliver the original answer
 * byte-identically; the bounded retries run only in enforce).
 *
 * Contract note (ledger replay harness, PR-1): the harness calls
 * `detectRefusalLikeOutput(text)` and treats the return value as a
 * boolean, and calls `buildNonexistenceConditionalAnswer({
 * question, entity, sources })` with ledger-shaped sources (body,
 * not excerpt). The design text describes the detector as returning
 * its signal breakdown; both are served — `analyzeRefusalLikeOutput`
 * returns the full breakdown the design specifies, and
 * `detectRefusalLikeOutput` is its boolean projection, so the
 * harness's J-05 check can actually fail when detection breaks.
 * The builder likewise accepts the design's `entityName` and the
 * harness's `entity` alias, and sources carrying either `excerpt`
 * (production) or `body` (ledger).
 */

export type RecoveryRefusalValidationMode = "off" | "shadow" | "enforce";

/**
 * Selected by ORIGIN_RECOVERY_REFUSAL_VALIDATION_MODE. Only the
 * exact values "shadow" and "enforce" enable the validation;
 * everything else — including an unset variable — is off, so
 * production behavior is unchanged until the mode is deliberately
 * registered (Stage 1 common rule: switches default OFF / shadow).
 */
export function resolveRecoveryRefusalValidationMode(
  env: NodeJS.ProcessEnv | undefined,
): RecoveryRefusalValidationMode {
  if (env?.ORIGIN_RECOVERY_REFUSAL_VALIDATION_MODE === "shadow") return "shadow";
  if (env?.ORIGIN_RECOVERY_REFUSAL_VALIDATION_MODE === "enforce") return "enforce";
  return "off";
}

/**
 * The fixed minimal instruction for the one bounded re-execution
 * (design verbatim). It is attached to the retry dispatch only —
 * the standing system instruction is never modified.
 */
export const RECOVERY_REFUSAL_RETRY_INSTRUCTION =
  "可能な範囲で、確認できる前提と正規の進め方を含めて回答してください。短い拒否だけでは終わらせないでください。";

/**
 * The fixed procedure guidance appended to a tier-T4 hold for a
 * procedure-category question (design verbatim). It points at the
 * official window without inventing any procedure content.
 */
export const RECOVERY_PROCEDURE_GUIDANCE_JA =
  "手続きの詳細は、担当する公式窓口の案内でご確認ください。";
export const RECOVERY_PROCEDURE_GUIDANCE_EN =
  "For the details of the procedure, please check the guidance of the official office in charge.";

// ---------------------------------------------------------------------------
// Refusal-like output detection
// ---------------------------------------------------------------------------

export interface RefusalLikeSignals {
  /** The whole output is under 30 characters (design threshold). */
  tooShort: boolean;
  /** A fixed refusal phrase appears in the output. */
  refusalPattern: boolean;
  /** A Japanese question answered with a Japanese ratio under 0.3. */
  languageMismatch: boolean;
  /** Share of Japanese characters among non-whitespace characters. */
  japaneseRatio: number;
}

export interface RefusalLikeAnalysis {
  isRefusal: boolean;
  signals: RefusalLikeSignals;
}

/** Fixed refusal phrases (design examples plus their polite variants). */
const REFUSAL_PATTERNS_JA: readonly string[] = [
  "対応できません",
  "対応いたしかねます",
  "対応しかねます",
  "回答できません",
  "回答いたしかねます",
  "回答しません",
  "お答えできません",
  "お答えいたしかねます",
  "お答えしません",
  "協力できません",
  "協力しかねます",
  "お手伝いできません",
  "お手伝いいたしかねます",
  "確認できませんでした",
  "分かりかねます",
  "わかりかねます",
  "承ることができません",
  "応じられません",
];

const REFUSAL_PATTERNS_EN: readonly string[] = [
  "i can't help",
  "i cannot help",
  "i can't assist",
  "i cannot assist",
  "i can't provide",
  "i cannot provide",
  "i can't comply",
  "i cannot comply",
  "i can't fulfill",
  "i cannot fulfill",
  "i'm unable to",
  "i am unable to",
  "i won't be able to",
  "i will not be able to",
];

/** Design threshold: an output under 30 characters is "too short". */
export const REFUSAL_TOO_SHORT_CHARS = 30;
/**
 * A refusal phrase near the head of a short-to-medium output still
 * marks the whole output as a refusal (a refusal with one trailing
 * justification sentence is the same shape as J-05's one-liner).
 * A substantive answer that merely MENTIONS a refusal phrase deep
 * inside a long body is not refusal-like.
 */
const REFUSAL_HEAD_WINDOW_CHARS = 40;
const REFUSAL_MEDIUM_MAX_CHARS = 120;

function japaneseRatioOf(text: string): number {
  const compact = text.replace(/\s/g, "");
  if (compact.length === 0) return 0;
  const japanese = compact.match(/[ぁ-んァ-ヶ一-龠々ー]/g)?.length ?? 0;
  return japanese / compact.length;
}

function firstRefusalPatternIndex(text: string): number {
  let best = -1;
  for (const pattern of REFUSAL_PATTERNS_JA) {
    const index = text.indexOf(pattern);
    if (index >= 0 && (best < 0 || index < best)) best = index;
  }
  const lower = text.toLowerCase();
  for (const pattern of REFUSAL_PATTERNS_EN) {
    const index = lower.indexOf(pattern);
    if (index >= 0 && (best < 0 || index < best)) best = index;
  }
  return best;
}

/**
 * Analyze a finished model output for the refusal shape: a fixed
 * refusal phrase that IS the answer — either the whole output is
 * under 30 characters, or the phrase sits in the first 40
 * characters of an output under 120 characters. The language
 * mismatch signal (a Japanese question answered in another
 * language) is reported for observability; it never fires the
 * verdict on its own.
 */
export function analyzeRefusalLikeOutput(
  text: string,
  language?: "ja" | "en",
): RefusalLikeAnalysis {
  const compactLength = text.replace(/\s/g, "").length;
  const tooShort = compactLength < REFUSAL_TOO_SHORT_CHARS;
  const patternIndex = firstRefusalPatternIndex(text);
  const refusalPattern = patternIndex >= 0;
  const japaneseRatio = japaneseRatioOf(text);
  const languageMismatch = language === "ja" && japaneseRatio < 0.3;
  const isRefusal =
    refusalPattern &&
    (tooShort ||
      (patternIndex < REFUSAL_HEAD_WINDOW_CHARS && compactLength < REFUSAL_MEDIUM_MAX_CHARS));
  return {
    isRefusal,
    signals: { tooShort, refusalPattern, languageMismatch, japaneseRatio },
  };
}

/** Boolean projection of analyzeRefusalLikeOutput (ledger harness contract). */
export function detectRefusalLikeOutput(
  text: string,
  language?: "ja" | "en",
): boolean {
  return analyzeRefusalLikeOutput(text, language).isRefusal;
}

// ---------------------------------------------------------------------------
// Refusal-forbidden category (procedure questions)
// ---------------------------------------------------------------------------

export type RefusalForbiddenCategory = "procedure";

/**
 * How-to markers: the question asks how something is done, applied
 * for, or carried out. Appending the official-window guidance to a
 * hold for such a question is harmless and never invents content.
 */
const PROCEDURE_HOWTO_MARKERS: readonly string[] = [
  "どうすれば",
  "どうしたら",
  "手順",
  "方法",
  "やり方",
  "手続き",
  "手続",
  "進め方",
  "申請",
];

/**
 * Capacity-enumeration markers: the question asks what an
 * institution permits or forbids (the E-07 shape — what turning 18
 * made possible and what stayed impossible). These are stable
 * institutional-knowledge questions; a bare refusal is the failure
 * being corrected, so they share the procedure category.
 */
const PROCEDURE_CAPACITY_MARKERS: readonly string[] = [
  "できるようになった",
  "できるようになる",
  "できないまま",
  "できること・できない",
  "できることとできない",
];

/**
 * Classify a question into a category where a bare refusal is
 * forbidden. Only "procedure" exists in Stage 1 (design); anything
 * else returns null.
 */
export function classifyRefusalForbiddenCategory(
  question: string,
): RefusalForbiddenCategory | null {
  for (const marker of PROCEDURE_HOWTO_MARKERS) {
    if (question.includes(marker)) return "procedure";
  }
  for (const marker of PROCEDURE_CAPACITY_MARKERS) {
    if (question.includes(marker)) return "procedure";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Named-entity detection
// ---------------------------------------------------------------------------

/**
 * Quoted spans that are really quoted speech or a quoted question,
 * not an entity name: they carry sentence punctuation or an
 * imperative / interrogative ending.
 */
function isEntityLikeQuotedSpan(span: string): boolean {
  if (span.length < 2 || span.length > 30) return false;
  if (/[。？?]/.test(span)) return false;
  if (/(ください|して|とは|ですか|ますか)$/.test(span)) return false;
  return true;
}

/**
 * Law-name-like tokens: a kanji/katakana run ending in 法. Runs
 * break at hiragana (the same fragmentation the gate-slip design
 * records for formal names containing の/に関する — the absence
 * check below is what keeps a fragment safe: sources about the law
 * contain the fragment). Technique words that merely end in 法
 * （方法・手法・技法） are not law names and are excluded.
 */
const LAW_LIKE_PATTERN = /[一-龠々ァ-ヶー]{2,24}法/g;
const LAW_LIKE_EXCLUDED_SUFFIX = /(方法|手法|技法)$/;

/**
 * Product-model-like tokens: a Latin brand word followed by a
 * model number ("iPhone 25", "Pixel 11", "Windows 11") or by a
 * letter+number model code ("Galaxy S25").
 */
const MODEL_LIKE_PATTERNS: readonly RegExp[] = [
  // The brand run is length-bounded on purpose: an unbounded
  // [A-Za-z0-9-]* before the required whitespace makes the scan
  // polynomial on non-matching inputs (long letter runs), which
  // CodeQL flags as js/polynomial-redos. Real brand tokens are far
  // shorter than 31 characters, so the bound changes no match.
  /[A-Za-z][A-Za-z0-9-]{0,30}\s+\d{1,3}(?:\.\d+)?/g,
  /[A-Za-z][A-Za-z0-9-]{0,30}\s+[A-Za-z]\d[\w.]{0,20}/g,
];

/**
 * Extract the named entities a question asks about, in the
 * design's priority order: quoted names (『』/「」/“”/""), then
 * law-name-like tokens, then product-model-like tokens. Returns
 * every distinct candidate; detectNamedEntity returns the first.
 */
export function detectNamedEntities(question: string): string[] {
  const entities: string[] = [];
  const push = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && !entities.includes(trimmed)) entities.push(trimmed);
  };
  const quoted: Array<{ index: number; value: string }> = [];
  for (const pattern of [/「([^「」]+)」/g, /『([^『』]+)』/g, /“([^”]+)”/g, /"([^"]+)"/g]) {
    for (const match of question.matchAll(pattern)) {
      const value = match[1] ?? "";
      if (isEntityLikeQuotedSpan(value)) {
        quoted.push({ index: match.index ?? 0, value });
      }
    }
  }
  quoted.sort((a, b) => a.index - b.index);
  for (const entry of quoted) push(entry.value);
  for (const match of question.matchAll(LAW_LIKE_PATTERN)) {
    if (!LAW_LIKE_EXCLUDED_SUFFIX.test(match[0])) push(match[0]);
  }
  for (const pattern of MODEL_LIKE_PATTERNS) {
    for (const match of question.matchAll(pattern)) push(match[0]);
  }
  return entities;
}

/** The primary named entity of a question, or null when it names none. */
export function detectNamedEntity(question: string): string | null {
  return detectNamedEntities(question)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Entity absence over a source set
// ---------------------------------------------------------------------------

/** The source fields the absence check reads (production and ledger shapes). */
export interface RefusalValidationSourceLike {
  title?: string;
  excerpt?: string;
  body?: string;
}

function normalizeForEntityMatch(value: string): string {
  return value.normalize("NFKC").replace(/\s/g, "").toLowerCase();
}

/**
 * Whether the entity appears in any source's title or body text
 * (excerpt in production, body in the ledger). Matching is
 * NFKC-normalized, whitespace-insensitive and case-insensitive, so
 * a notation variant ("iPhone25" vs "iPhone 25") still counts as
 * present — the nonexistence statement may fire only when the name
 * is absent under this generous matching.
 */
export function entityAppearsInSources(
  entity: string,
  sources: readonly RefusalValidationSourceLike[],
): boolean {
  const needle = normalizeForEntityMatch(entity);
  if (!needle) return false;
  return sources.some((source) =>
    [source.title ?? "", source.excerpt ?? "", source.body ?? ""].some((field) =>
      normalizeForEntityMatch(field).includes(needle),
    ),
  );
}

// ---------------------------------------------------------------------------
// Conditional answers
// ---------------------------------------------------------------------------

export interface NonexistenceConditionalAnswerInput {
  question: string;
  /** Design shape: the entity the question names. */
  entityName?: string;
  /** Ledger harness alias for entityName. */
  entity?: string;
  /**
   * When given, the answer is produced only if the entity appears
   * in NONE of these sources (the module re-checks the wiring's
   * condition so a caller cannot state nonexistence over sources
   * that do mention the entity).
   */
  sources?: readonly RefusalValidationSourceLike[];
  language?: "ja" | "en";
}

/**
 * Build the conditional nonexistence statement for a named entity
 * that no retrieved source mentions: it says plainly that no source
 * shows the entity exists and that, as far as could be confirmed,
 * there is no such thing under that name — while staying
 * conditional (a different name or spelling may exist). It lists
 * NO sources: the round-5 failure was precisely the listing of
 * unrelated sources as if they were evidence. Returns null when
 * there is no entity or when a provided source does mention it.
 */
export function buildNonexistenceConditionalAnswer(
  input: NonexistenceConditionalAnswerInput,
): string | null {
  const entity = (input.entityName ?? input.entity ?? "").trim();
  if (!entity) return null;
  if (input.sources && entityAppearsInSources(entity, input.sources)) return null;
  if (input.language === "en") {
    return (
      `I checked public sources for "${entity}", but found no source indicating that it exists. ` +
      `As far as I could confirm, there is nothing by the name "${entity}". ` +
      `The name or spelling may differ; if you know the official name, I can check again.`
    );
  }
  return (
    `『${entity}』について、公表情報を確認しましたが、その存在を示す出典は見つかりませんでした。` +
    `確認できた範囲では、『${entity}』という名称のものは存在しないと考えられます。` +
    `名称や表記が異なる可能性もありますので、正式な名称が分かれば、改めて確認します。`
  );
}

/**
 * The procedure conditional form of a tier-T4 hold: the hold text
 * itself, unchanged, with the fixed official-window guidance
 * appended (design). Idempotent — a text already carrying the
 * guidance is returned as-is.
 */
export function buildProcedureConditionalAnswer(input: {
  baseText: string;
  language?: "ja" | "en";
}): string {
  const guidance =
    input.language === "en" ? RECOVERY_PROCEDURE_GUIDANCE_EN : RECOVERY_PROCEDURE_GUIDANCE_JA;
  if (input.baseText.includes(guidance)) return input.baseText;
  return `${input.baseText}\n\n${guidance}`;
}

// ---------------------------------------------------------------------------
// Undetermined future outcomes (the I-05 shape)
// ---------------------------------------------------------------------------

const UNDETERMINED_FUTURE_MARKERS: readonly string[] = [
  "来年",
  "来月",
  "次回",
  "今後",
  "将来",
  "翌年",
  "次の大会",
];
const UNDETERMINED_CONFIRMED_DEMAND_MARKERS: readonly string[] = [
  "確定情報",
  "確定した情報",
  "予想ではなく",
  "予測ではなく",
];
const UNDETERMINED_OUTCOME_MARKERS: readonly string[] = [
  "優勝",
  "勝者",
  "結果",
  "当選",
  "勝敗",
  "チャンピオン",
];

/**
 * Whether the question demands CONFIRMED information about the
 * outcome of a future event (I-05: next year's World Cup winner,
 * "not a prediction — confirmed information"). All three marker
 * families must be present; the shape is deliberately narrow so
 * ordinary future questions keep the existing hold.
 */
export function detectUndeterminedFutureQuestion(question: string): boolean {
  return (
    UNDETERMINED_FUTURE_MARKERS.some((marker) => question.includes(marker)) &&
    UNDETERMINED_CONFIRMED_DEMAND_MARKERS.some((marker) => question.includes(marker)) &&
    UNDETERMINED_OUTCOME_MARKERS.some((marker) => question.includes(marker))
  );
}

/**
 * The conditional answer for an undetermined future outcome: the
 * result is not decided yet, so confirmed information does not
 * exist — stated plainly instead of the generic "could not
 * confirm" hold, and without any prediction.
 */
export function buildUndeterminedFutureAnswer(input: {
  question: string;
  language?: "ja" | "en";
}): string {
  if (input.language === "en") {
    return (
      "The outcome you asked about has not been decided yet, so there is no confirmed information to report at this point. " +
      "I will not answer with a prediction or a guess. Please check the official announcement once the result is final."
    );
  }
  return (
    "お尋ねの件は、まだ結果が確定していません。現時点で確定情報としてお伝えできる内容はなく、予想や推測で回答することはしません。" +
    "結果が確定した後は、公式の発表でご確認ください。"
  );
}
