/**
 * Intent premise guard (I-5, PR1: ledger + shadow checks).
 *
 * Background (I-1 measurements R1-R3, 2026-11-21/22): the intent
 * incorporation fixes I-2/I-3/I-4 are prompt text, and prompt text only
 * holds probabilistically. Three failure classes survived every round:
 * (1) a corrected premise is not carried forward — the answer keeps
 * computing on the superseded value (REP-02: after 参加者50人→30人 the
 * next answer still derives 50脚）; (2) a stable fact is *stated*
 * correctly and then not *applied* — REP-01 round 3 opens with
 * 「消費税率は現在10%ですが」 and still computes the whole answer at
 * 15%; (3) fabricated citation shapes (〔出典: 公式税率計算例〕 with no
 * URL) dress up wrong values as sourced. The design
 * (INTENT_I5_DESIGN_2026-11-22) moves "corrected-premise persistence"
 * and "stable-fact application" from prompt policy to deterministic
 * code. This module is that code.
 *
 * What this module does, deterministically (no model call, no I/O, no
 * new storage — the ledger is re-derived from the request's messages
 * on every call, so nothing is retained):
 * - extractOriginPremiseLedger: premise ledger extraction as a pure
 *   function of the conversation: (a) user corrections (numeric
 *   re-assertions under a correction marker, categorical replacements
 *   including weak comparative corrections such as 「温泉より街歩きの
 *   方がいい」), (b) ORIGIN's own corrections (stable-fact statements
 *   and nonexistence statements in assistant turns), (c) user
 *   attributes. Extraction patterns are deliberately narrow; a missed
 *   correction is a known limitation, a false ledger entry is not
 *   acceptable (the acceptance gate is zero false positives on the
 *   R1-R3 replay).
 * - C-1 old-value reuse: the answer operatively uses a superseded
 *   numeric value from a user-correction entry. Negation/correction
 *   clauses and explicitly framed hypothetical clauses are excused.
 * - C-2 stable-fact applied value: for registry concepts (initially
 *   the consumption tax rate only), the rate actually *applied* in the
 *   answer's calculation (multiplication factors first, then the rate
 *   implied by a 税抜/税込 or 税額 pair, then — only when no
 *   calculation signal exists — explicit rate statements) must be one
 *   of the registry values. Judging the applied value, not whether a
 *   correction was stated, is what closes the REP-01 split. A user
 *   turn that explicitly frames a hypothetical （仮の話/もし/仮に/仮定）
 *   fences the check for that turn (FP-04).
 * - C-4 fabricated-citation form: a URL-less 〔出典: …〕 bracket whose
 *   label claims an authoritative source shape （公式/税率/消費税/
 *   計算方法/計算例/法令）. Narrowing note: the I-1 corpus shows
 *   URL-less brackets are also used for self-described general
 *   knowledge （「…に関する一般的知見」) and examples （例示データ）,
 *   including in must-not-fire records (CORR-01 R2), so the check
 *   fires only on authority-claiming labels; a label that says
 *   "general knowledge" does not fabricate a source.
 * C-3 (category residue) is intentionally not in this PR (PR4,
 * conditional on its own replay design).
 * - (b') self-anchor reset (G-2c; INTENT_R4_GENERATION
 *   COUNTERMEASURES_DESIGN_2026-11-23 section 3): round 4 exposed
 *   the shape (b) cannot reach — REP-01's first turn applied the
 *   wrong rate with no correction statement at all, and the applied
 *   computation itself became the conversation's anchor for every
 *   later turn. The extractor therefore also scans past assistant
 *   answers: when an answer applied a rate the registry does not
 *   allow (judged by the same applied-value extraction as C-2, and
 *   fenced the same way — an answer to an explicitly hypothetical
 *   user turn never counts), the ledger gains a correction entry
 *   for that concept whose provenance is the mismatch itself
 *   (selfAnchorAppliedRatePercent), superseding any statement-
 *   derived (b) entry for the concept. Its block line asserts the
 *   operative registry value and explicitly disowns the past
 *   computation, so the reset competes with the anchor in the raw
 *   history. An applied value is never itself taken into the
 *   ledger as a premise — the mismatch is used only to derive a
 *   correction. Derivation consults the registry, so it needs the
 *   request clock: a caller that passes no nowMs gets the
 *   fail-closed behaviour (no derivation), as does an expired
 *   registry entry.
 *
 * Mode: ORIGIN_INTENT_PREMISE_GUARD_MODE=off|shadow|enforce, default
 * off (mirrors the answer-verification mode discipline). "enforce"
 * resolves as a configured value but the effective mode stays
 * "shadow" until the enforce PR (I5-PR3) lands. PR1 shipped the
 * ledger, the shadow checks and the replay harness. PR2 adds, in
 * shadow only: the ledger block injection (section 3.2 of the
 * design) — the operative premises restated at the tail of every
 * route's system instruction, under its own character caps, never
 * counted in the route-3 compact contract — and the deterministic
 * arming decision (section 3.3) that joins premise-relevant turns
 * to the streaming router's buffer-armed set. Shadow still never
 * alters a delivered answer: injection changes what the model is
 * told, arming changes only when the text is released, and the
 * checks stay log-only. With the switch off the routers skip the
 * guard entirely, so behaviour is byte-identical to before this
 * module existed.
 *
 * Stable-fact registry entries follow the evidence-catalog discipline
 * (verifiedAt / reviewAfter / sourceDescription): an entry whose
 * reviewAfter has passed is inactive — the check fails closed and
 * stops until the fact is re-confirmed against a primary source.
 *
 * Logs carry counts, fixed codes and — for C-2 only — the applied
 * rate numbers (rates are public registry facts / ratios of stated
 * prices, never answer text). The runner never throws to its caller:
 * on an internal failure it logs the error name and reports an empty
 * result.
 */

import type { OriginChatMessage } from "./originProviderClient.js";

export type OriginIntentPremiseGuardMode = "off" | "shadow" | "enforce";

export function resolveOriginIntentPremiseGuardMode(
  env: NodeJS.ProcessEnv | undefined,
): OriginIntentPremiseGuardMode {
  const raw = env?.ORIGIN_INTENT_PREMISE_GUARD_MODE;
  if (raw === "shadow" || raw === "enforce") return raw;
  return "off";
}

export function resolveOriginIntentPremiseGuardEffectiveMode(
  env: NodeJS.ProcessEnv | undefined,
): OriginIntentPremiseGuardMode {
  const configured = resolveOriginIntentPremiseGuardMode(env);
  // The enforce entity (regeneration / deterministic landing) is
  // I5-PR3; until then a configured "enforce" runs as shadow.
  return configured === "enforce" ? "shadow" : configured;
}

/* ------------------------------------------------------------------ */
/* Stable-fact registry (evidence-catalog discipline)                  */
/* ------------------------------------------------------------------ */

export interface OriginStableFactEntry {
  id: string;
  /** Terms that bind this concept in user or answer text. */
  conceptTerms: readonly string[];
  /** Label naming this concept's rate as a ledger premise. */
  premiseLabel: string;
  /**
   * Allowed applied rates (percent numbers) for the concept. The
   * first is the standard rate: the operative premise a self-anchor
   * reset (G-2c) falls back to when the conversation carries no
   * statement-derived correction of its own.
   */
  allowedRatesPercent: readonly number[];
  verifiedAt: string;
  reviewAfter: string;
  sourceDescription: string;
}

export const ORIGIN_STABLE_FACT_REGISTRY: readonly OriginStableFactEntry[] = [
  {
    id: "consumption-tax-rate",
    conceptTerms: ["消費税"],
    premiseLabel: "消費税率",
    allowedRatesPercent: [10, 8],
    verifiedAt: "2026-11-22T00:00:00.000Z",
    reviewAfter: "2026-12-22T00:00:00.000Z",
    sourceDescription:
      "日本の消費税率：標準10%・軽減8%。2019年10月1日の軽減税率制度開始以来不変で、国税庁の一次情報（消費税の軽減税率制度・税率案内）に基づき2026-11-22に確認。reviewAfter（2026-12-22）を過ぎたら一次情報で再確認するまで本項目は fail closed（C-2 は停止する）。",
  },
];

export function isOriginStableFactEntryActive(
  entry: OriginStableFactEntry,
  nowMs: number,
): boolean {
  const reviewAfterMs = Date.parse(entry.reviewAfter);
  return Number.isFinite(reviewAfterMs) && nowMs <= reviewAfterMs;
}

/* ------------------------------------------------------------------ */
/* Premise ledger extraction                                           */
/* ------------------------------------------------------------------ */

export type OriginPremiseLedgerEntryKind =
  | "user-correction"
  | "assistant-correction"
  | "user-attribute";

export interface OriginPremiseLedgerNumericValue {
  /** Unit family: "money" (base 円), "headcount", "percent", or `unit:<unit>`. */
  family: string;
  /** Superseded value, normalised to the family base unit. */
  oldAmount: number;
  /** Operative value, normalised to the family base unit. */
  newAmount: number;
}

export interface OriginPremiseLedgerEntry {
  kind: OriginPremiseLedgerEntryKind;
  /** Attribute label when one could be named deterministically; null for topic replacements. */
  label: string | null;
  oldValue: string;
  newValue: string;
  numeric?: OriginPremiseLedgerNumericValue;
  /** Stable-fact concept id for assistant-correction entries bound to the registry. */
  conceptId?: string;
  /**
   * G-2c (b'): set when this correction was derived from an applied
   * value's mismatch with the registry — a past answer computed with
   * this rate — rather than from a correction statement (b). The
   * rate is a public registry-fact number, never answer text.
   */
  selfAnchorAppliedRatePercent?: number;
  /** Index into the messages array of the message that established this entry. */
  sourceMessageIndex: number;
}

const normalizeText = (text: string): string => text.normalize("NFKC");

const CORRECTION_MARKERS: readonly string[] = [
  "訂正",
  "やっぱり",
  "ではなく",
  "じゃなく",
  "間違",
  "変更",
];

interface NumericAssertion {
  label: string;
  family: string;
  baseAmount: number;
  surface: string;
}

function toFamilyBase(
  amount: number,
  unit: string,
): { family: string; baseAmount: number } {
  if (unit === "万円") return { family: "money", baseAmount: amount * 10_000 };
  if (unit === "円") return { family: "money", baseAmount: amount };
  if (unit === "人" || unit === "名" || unit === "脚" || unit === "席") {
    return { family: "headcount", baseAmount: amount };
  }
  if (unit === "%" || unit === "パーセント") {
    return { family: "percent", baseAmount: amount };
  }
  return { family: `unit:${unit}`, baseAmount: amount };
}

const NUMBER_TOKEN = String.raw`(\d[\d,]*(?:\.\d+)?)`;
const ASSERTION_PATTERNS: readonly RegExp[] = [
  // （名詞）は（手取り）?(数値)(単位) — 参加者は50人 / 月収は手取り30万円
  new RegExp(
    String.raw`([^\s、。・「」『』（）()]{1,10})は(?:手取り)?` +
      NUMBER_TOKEN +
      String.raw`\s*(万円|円|人|名|脚|席|%|パーセント|歳|個|件|回|台|日|月|年)`,
    "g",
  ),
  // （名詞）(数値)(単位)(助詞・区切り) — 税抜8,000円の / 参加者50人想定
  new RegExp(
    String.raw`([^\s、。・「」『』（）()はがをにへとやで]{1,10})` +
      NUMBER_TOKEN +
      String.raw`\s*(万円|円|人|名|脚|席)(?=[想でのはがをにへとや、。・\s「」『』]|$)`,
    "g",
  ),
];

function extractNumericAssertions(text: string): NumericAssertion[] {
  const assertions: NumericAssertion[] = [];
  for (const pattern of ASSERTION_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const label = match[1];
      const amount = Number.parseFloat(match[2].replace(/,/g, ""));
      const unit = match[3];
      if (!label || !unit || !Number.isFinite(amount)) continue;
      const { family, baseAmount } = toFamilyBase(amount, unit);
      assertions.push({
        label,
        family,
        baseAmount,
        surface: `${match[2]}${unit}`,
      });
    }
  }
  return assertions;
}

function extractCategoricalReplacements(
  text: string,
): { oldSpan: string; newSpan: string }[] {
  const pairs: { oldSpan: string; newSpan: string }[] = [];
  // 明示の置換え: Aじゃなくて、B （営業じゃなくて、エンジニアとして…）
  for (const match of text.matchAll(
    /([^\s、。・「」『』（）()]{1,8})じゃなくて、?([^\s、。・「」『』（）()がをにへとやはで]{1,8})/g,
  )) {
    pairs.push({ oldSpan: match[1], newSpan: match[2] });
  }
  // 弱い訂正: AよりBの方がいい （温泉より街歩きの方がいいな)
  for (const match of text.matchAll(
    /([^\s、。・「」『』（）()]{1,8})より([^\s、。・「」『』（）()がをにへとやはで]{1,10})の方がいい/g,
  )) {
    pairs.push({ oldSpan: match[1], newSpan: match[2] });
  }
  return pairs;
}

const USER_ATTRIBUTE_PATTERNS: readonly RegExp[] = [
  /私は(フリーランス|個人事業主|自営業|会社員|公務員|学生|主婦|主夫|経営者)/,
  /(フリーランス|個人事業主|自営業)として働いて/,
];

function upsertLedgerEntry(
  entries: OriginPremiseLedgerEntry[],
  entry: OriginPremiseLedgerEntry,
): void {
  const existingIndex = entries.findIndex(
    (candidate) =>
      candidate.kind === entry.kind &&
      candidate.label === entry.label &&
      candidate.conceptId === entry.conceptId,
  );
  if (existingIndex >= 0) entries[existingIndex] = entry;
  else entries.push(entry);
}

function findUserAssertedConceptRate(
  priorMessages: readonly OriginChatMessage[],
  conceptTerm: string,
): number | null {
  for (const message of priorMessages) {
    if (message.role !== "user") continue;
    const text = normalizeText(message.content ?? "");
    const match = new RegExp(
      `${conceptTerm}[^\\d%]{0,8}?(\\d+(?:\\.\\d+)?)\\s*%`,
    ).exec(text);
    if (match) {
      const rate = Number.parseFloat(match[1]);
      if (Number.isFinite(rate)) return rate;
    }
  }
  return null;
}

/**
 * Derives the premise ledger from the conversation. Pure: the same
 * (messages, nowMs) pair always yields the same ledger, and nothing
 * is stored. The optional nowMs is the request clock for the
 * registry-bound self-anchor derivation (G-2c); without it that
 * derivation fails closed.
 */
export function extractOriginPremiseLedger(
  messages: readonly OriginChatMessage[],
  nowMs?: number,
): OriginPremiseLedgerEntry[] {
  const entries: OriginPremiseLedgerEntry[] = [];
  const currentAssertions = new Map<string, NumericAssertion>();
  const seenCategorical = new Set<string>();

  messages.forEach((message, messageIndex) => {
    const text = normalizeText(message.content ?? "");
    if (message.role === "user") {
      const hasCorrectionMarker = CORRECTION_MARKERS.some((marker) =>
        text.includes(marker),
      );
      for (const assertion of extractNumericAssertions(text)) {
        // Exact label match first, then a suffix relation （広告予算 vs
        // 予算）: both name the same attribute in the measured corpus.
        let prior = currentAssertions.get(assertion.label);
        if (!prior) {
          for (const [knownLabel, known] of currentAssertions) {
            if (
              known.family === assertion.family &&
              (knownLabel.endsWith(assertion.label) ||
                assertion.label.endsWith(knownLabel)) &&
              Math.min(knownLabel.length, assertion.label.length) >= 2
            ) {
              prior = known;
              break;
            }
          }
        }
        if (
          prior &&
          hasCorrectionMarker &&
          prior.family === assertion.family &&
          prior.baseAmount !== assertion.baseAmount
        ) {
          upsertLedgerEntry(entries, {
            kind: "user-correction",
            label: assertion.label,
            oldValue: prior.surface,
            newValue: assertion.surface,
            numeric: {
              family: assertion.family,
              oldAmount: prior.baseAmount,
              newAmount: assertion.baseAmount,
            },
            sourceMessageIndex: messageIndex,
          });
        }
        currentAssertions.set(assertion.label, assertion);
      }
      for (const pair of extractCategoricalReplacements(text)) {
        const key = `${pair.oldSpan}->${pair.newSpan}`;
        if (seenCategorical.has(key)) continue;
        // Topic continuity: the replaced topic must have been raised by
        // the user before, otherwise this is a fresh preference, not a
        // correction of an earlier premise.
        const raisedBefore = messages
          .slice(0, messageIndex)
          .some(
            (prior) =>
              prior.role === "user" &&
              normalizeText(prior.content ?? "").includes(pair.oldSpan),
          );
        if (!raisedBefore) continue;
        seenCategorical.add(key);
        entries.push({
          kind: "user-correction",
          label: null,
          oldValue: pair.oldSpan,
          newValue: pair.newSpan,
          sourceMessageIndex: messageIndex,
        });
      }
      for (const pattern of USER_ATTRIBUTE_PATTERNS) {
        const match = pattern.exec(text);
        if (match) {
          upsertLedgerEntry(entries, {
            kind: "user-attribute",
            label: "職業",
            oldValue: "",
            newValue: match[1],
            sourceMessageIndex: messageIndex,
          });
        }
      }
      return;
    }
    // Assistant turns: ORIGIN's own corrections (b).
    const taxStatement =
      /消費税率は現在(\d+(?:\.\d+)?)%/.exec(text) ??
      /消費税は現在(\d+(?:\.\d+)?)%/.exec(text);
    if (taxStatement) {
      const correctedRate = Number.parseFloat(taxStatement[1]);
      const userRate = findUserAssertedConceptRate(
        messages.slice(0, messageIndex),
        "消費税",
      );
      if (
        Number.isFinite(correctedRate) &&
        userRate !== null &&
        userRate !== correctedRate
      ) {
        upsertLedgerEntry(entries, {
          kind: "assistant-correction",
          label: "消費税率",
          oldValue: `${userRate}%`,
          newValue: `${correctedRate}%`,
          numeric: {
            family: "percent",
            oldAmount: userRate,
            newAmount: correctedRate,
          },
          conceptId: "consumption-tax-rate",
          sourceMessageIndex: messageIndex,
        });
      }
    }
    const nonexistence =
      /[「『]([^」』]{2,40})[」』]という名称の(?:公的な)?制度は存在しません/.exec(
        text,
      );
    if (nonexistence) {
      entries.push({
        kind: "assistant-correction",
        label: nonexistence[1],
        oldValue: nonexistence[1],
        newValue: "存在しない",
        sourceMessageIndex: messageIndex,
      });
    }
  });

  deriveSelfAnchorResetEntries(messages, entries, nowMs);
  return entries;
}

/* ------------------------------------------------------------------ */
/* Self-anchor reset derivation (G-2c (b'))                            */
/* ------------------------------------------------------------------ */

/**
 * Scans past assistant answers for each active registry concept and,
 * when an answer applied a rate the registry does not allow, turns
 * the most recent such misapplication into a ledger correction entry
 * (see the module header). The judgement reuses C-2's applied-value
 * extraction verbatim — one definition of "applied" for the exit
 * check and the reset — and its fences: the concept must bind to the
 * answer (its term in the answer, or 税込 in the answer with the
 * term in the prompting user turn), and an answer to a user turn
 * that explicitly frames a hypothetical is skipped (FP-04). The
 * operative value the reset asserts is the conversation's own
 * statement-derived correction when that value is itself a registry
 * value, otherwise the registry's standard (first) allowed rate.
 * The entry supersedes the statement-derived (b) entry for the
 * concept via the ledger's upsert key: the reset line states the
 * same corrected premise and additionally disowns the computation
 * that anchors the wrong one.
 */
function deriveSelfAnchorResetEntries(
  messages: readonly OriginChatMessage[],
  entries: OriginPremiseLedgerEntry[],
  nowMs: number | undefined,
): void {
  for (const fact of ORIGIN_STABLE_FACT_REGISTRY) {
    if (!isOriginStableFactEntryActive(fact, nowMs ?? Number.NaN)) {
      continue;
    }
    const allowed = new Set<number>(fact.allowedRatesPercent);
    let latest: { rate: number; messageIndex: number } | null = null;
    messages.forEach((message, messageIndex) => {
      if (message.role !== "assistant") return;
      const answerText = normalizeText(message.content ?? "");
      let promptingUserText = "";
      for (let i = messageIndex - 1; i >= 0; i -= 1) {
        if (messages[i].role === "user") {
          promptingUserText = normalizeText(messages[i].content ?? "");
          break;
        }
      }
      if (
        HYPOTHETICAL_FENCE_MARKERS.some((marker) =>
          promptingUserText.includes(marker),
        )
      ) {
        return;
      }
      const conceptBound =
        fact.conceptTerms.some((term) => answerText.includes(term)) ||
        (answerText.includes("税込") &&
          fact.conceptTerms.some((term) => promptingUserText.includes(term)));
      if (!conceptBound) return;
      for (const rate of extractAppliedRates(answerText, promptingUserText)) {
        const isAllowed = [...allowed].some(
          (value) => Math.abs(value - rate) < 0.01,
        );
        if (!isAllowed) latest = { rate, messageIndex };
      }
    });
    if (latest === null) continue;
    const misapplied: { rate: number; messageIndex: number } = latest;
    const statementEntry = entries.find(
      (candidate) =>
        candidate.kind === "assistant-correction" &&
        candidate.conceptId === fact.id,
    );
    let operativeRate = fact.allowedRatesPercent[0];
    if (statementEntry?.numeric) {
      const stated = statementEntry.numeric.newAmount;
      if ([...allowed].some((value) => Math.abs(value - stated) < 0.01)) {
        operativeRate = stated;
      }
    }
    upsertLedgerEntry(entries, {
      kind: "assistant-correction",
      label: statementEntry?.label ?? fact.premiseLabel,
      oldValue: `${misapplied.rate}%`,
      newValue: `${operativeRate}%`,
      numeric: {
        family: "percent",
        oldAmount: misapplied.rate,
        newAmount: operativeRate,
      },
      conceptId: fact.id,
      sourceMessageIndex: misapplied.messageIndex,
      selfAnchorAppliedRatePercent: misapplied.rate,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Premise ledger block (design section 3.2)                           */
/* ------------------------------------------------------------------ */

/**
 * The ledger block restates only the operative premises at the tail
 * of the assembled instruction, so a corrected premise competes with
 * the history's raw text structurally instead of depending on the
 * model re-deriving it every turn (RC-1). It is a dynamic addendum
 * in the same layer as the planning augmentation: it is appended
 * after each route's instruction is built, is NOT part of the
 * route-3 compact base, and is not counted in that base's
 * 2,000-3,800 character contract; it carries its own caps here,
 * pinned by test. Worst case the block is 512 characters, which the
 * route-3 pre-send gate (characters/2) estimates at ~256 tokens —
 * inside the route's 6,000-token input budget next to the current
 * ~2,700-token planning-augmented payload. A ledger with nothing
 * injectable produces no block, so a conversation without a
 * correction keeps byte-identical instructions.
 */
export const ORIGIN_PREMISE_LEDGER_BLOCK_HEADER =
  "確定前提（この会話で確定済み。前提はこれだけを使う）：";
export const ORIGIN_PREMISE_LEDGER_BLOCK_MAX_ENTRIES = 8;
export const ORIGIN_PREMISE_LEDGER_BLOCK_MAX_LINE_CHARS = 64;
export const ORIGIN_PREMISE_LEDGER_BLOCK_MAX_CHARS = 512;

export interface OriginPremiseLedgerBlock {
  text: string;
  entryCount: number;
  omittedCount: number;
}

function renderPremiseLedgerLine(entry: OriginPremiseLedgerEntry): string {
  const label = entry.label ?? "";
  if (entry.kind === "user-attribute") {
    return `- ${label}：${entry.newValue}`;
  }
  if (
    entry.kind === "assistant-correction" &&
    entry.newValue === "存在しない"
  ) {
    return `- ${label}：存在しない`;
  }
  if (entry.selfAnchorAppliedRatePercent !== undefined) {
    // G-2c reset line: assert the operative value and disown the
    // past computation that applied the wrong one, in the design's
    // fixed form. If the line ever exceeds the per-line cap, the
    // generic fit drops this parenthetical first, leaving the bare
    // operative premise — never a truncated value.
    const head = label ? `- ${label}：${entry.newValue}` : `- ${entry.newValue}`;
    return `${head}（過去の回答で ${entry.oldValue} を使った計算があるが、それは誤った前提によるもの。現在の前提は ${entry.newValue}）`;
  }
  if (entry.numeric) {
    const head = label ? `- ${label}：${entry.newValue}` : `- ${entry.newValue}`;
    return `${head}（${entry.oldValue}から訂正済み）`;
  }
  // Categorical replacement: the new topic replaces the old one.
  const head = label ? `- ${label}：${entry.newValue}` : `- ${entry.newValue}`;
  return `${head}（${entry.oldValue}ではない）`;
}

/**
 * Fits one ledger line into the per-line cap. The parenthetical
 * annotation is dropped first; only the label (a topic name) may be
 * shortened after that — an operative value is never truncated. An
 * entry that still cannot fit is not rendered (the caller counts it
 * as omitted) rather than rendered in a corrupted form.
 */
function fitPremiseLedgerLine(
  entry: OriginPremiseLedgerEntry,
): string | null {
  const full = renderPremiseLedgerLine(entry);
  if (full.length <= ORIGIN_PREMISE_LEDGER_BLOCK_MAX_LINE_CHARS) return full;
  const bare = full.replace(/（[^（）]*）$/, "");
  if (bare.length <= ORIGIN_PREMISE_LEDGER_BLOCK_MAX_LINE_CHARS) return bare;
  if (!entry.label) return null;
  const excess = bare.length - ORIGIN_PREMISE_LEDGER_BLOCK_MAX_LINE_CHARS;
  const shortLabel = entry.label.slice(
    0,
    Math.max(0, entry.label.length - excess),
  );
  if (!shortLabel) return null;
  return bare.replace(entry.label, shortLabel);
}

/**
 * Builds the injection block from a ledger, or null when nothing is
 * injectable. Entries are taken in ledger order under the entry,
 * line and total caps; entries that do not fit are counted as
 * omitted, never silently merged or rewritten.
 */
export function buildOriginPremiseLedgerBlock(
  ledger: readonly OriginPremiseLedgerEntry[],
): OriginPremiseLedgerBlock | null {
  const lines: string[] = [];
  let omittedCount = 0;
  let totalChars = ORIGIN_PREMISE_LEDGER_BLOCK_HEADER.length;
  for (const entry of ledger) {
    const line = fitPremiseLedgerLine(entry);
    if (
      line === null ||
      lines.length >= ORIGIN_PREMISE_LEDGER_BLOCK_MAX_ENTRIES ||
      totalChars + 1 + line.length > ORIGIN_PREMISE_LEDGER_BLOCK_MAX_CHARS
    ) {
      omittedCount += 1;
      continue;
    }
    lines.push(line);
    totalChars += 1 + line.length;
  }
  if (lines.length === 0) return null;
  return {
    text: [ORIGIN_PREMISE_LEDGER_BLOCK_HEADER, ...lines].join("\n"),
    entryCount: lines.length,
    omittedCount,
  };
}

/* ------------------------------------------------------------------ */
/* Arming (design section 3.3)                                         */
/* ------------------------------------------------------------------ */

export type OriginPremiseGuardArmingReason =
  | "ledger-correction"
  | "registry-concept-assertion";

export interface OriginPremiseGuardArming {
  armed: boolean;
  reasons: OriginPremiseGuardArmingReason[];
}

function armingFromLedger(
  ledger: readonly OriginPremiseLedgerEntry[],
  messages: readonly OriginChatMessage[],
  nowMs: number,
): OriginPremiseGuardArming {
  const reasons: OriginPremiseGuardArmingReason[] = [];
  if (
    ledger.some(
      (entry) =>
        entry.kind === "user-correction" ||
        entry.kind === "assistant-correction",
    )
  ) {
    reasons.push("ledger-correction");
  }
  const latestUser = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  if (latestUser) {
    const text = normalizeText(latestUser.content ?? "");
    for (const entry of ORIGIN_STABLE_FACT_REGISTRY) {
      if (!isOriginStableFactEntryActive(entry, nowMs)) continue;
      const conceptPresent = entry.conceptTerms.some((term) =>
        text.includes(term),
      );
      if (
        conceptPresent &&
        /\d+(?:\.\d+)?\s*(?:%|パーセント)/.test(text)
      ) {
        reasons.push("registry-concept-assertion");
        break;
      }
    }
  }
  return { armed: reasons.length > 0, reasons };
}

/**
 * Deterministic arming for the premise guard — the turns where the
 * measured failures concentrate: (1) the conversation carries a
 * correction (a user correction or ORIGIN's own correction in the
 * ledger), so this and every later turn of that conversation is
 * armed; (2) the latest user turn asserts a rate for a stable-fact
 * registry concept (initially the consumption tax), whether or not
 * a correction has happened yet — FP-02's first turn. Arming only
 * joins the streaming router's buffer-armed set (the same trade-off
 * the existing gates make: a buffered answer loses progressive
 * display); in shadow it never changes the delivered text, and its
 * purpose is that a later enforce step (I5-PR3) can intervene
 * before release on exactly these turns.
 */
export function evaluateOriginPremiseGuardArming(input: {
  messages: readonly OriginChatMessage[];
  nowMs: number;
}): OriginPremiseGuardArming {
  return armingFromLedger(
    extractOriginPremiseLedger(input.messages, input.nowMs),
    input.messages,
    input.nowMs,
  );
}

/* ------------------------------------------------------------------ */
/* Per-request plan (routers, shadow mode)                             */
/* ------------------------------------------------------------------ */

export interface OriginPremiseGuardPlan {
  ledger: OriginPremiseLedgerEntry[];
  block: OriginPremiseLedgerBlock | null;
  arming: OriginPremiseGuardArming;
}

/**
 * The plan both routers compute once per request in shadow mode:
 * the ledger, the injection block (null when the ledger carries
 * nothing injectable) and the arming decision. Pure — re-derived
 * from the request's messages on every call, nothing is stored.
 */
export function planOriginPremiseGuard(input: {
  messages: readonly OriginChatMessage[];
  nowMs: number;
}): OriginPremiseGuardPlan {
  const ledger = extractOriginPremiseLedger(input.messages, input.nowMs);
  return {
    ledger,
    block: buildOriginPremiseLedgerBlock(ledger),
    arming: armingFromLedger(ledger, input.messages, input.nowMs),
  };
}

/* ------------------------------------------------------------------ */
/* Deterministic checks                                                */
/* ------------------------------------------------------------------ */

export type OriginPremiseGuardCheckKind =
  | "old-value-reuse"
  | "stable-fact-applied-value"
  | "fabricated-citation-form";

export interface OriginPremiseGuardViolation {
  check: OriginPremiseGuardCheckKind;
  /** Ledger entry index for C-1. */
  entryIndex?: number;
  /** Registry concept id for C-2. */
  conceptId?: string;
  /** Applied rates found in the answer (C-2; public-fact numbers only). */
  appliedRates?: number[];
}

const CLAUSE_SPLIT_PATTERN = /[。\n！？!?；;|]/;

const NEGATION_MARKERS: readonly string[] = [
  "ではなく",
  "じゃなく",
  "でなく",
  "ではない",
  "でない",
  "誤り",
  "間違い",
  "旧前提",
  "以前の",
  "訂正",
  "変更前",
  "なし",
];

const HYPOTHETICAL_MARKERS: readonly string[] = ["もし", "仮に", "仮定"];

const HYPOTHETICAL_FENCE_MARKERS: readonly string[] = [
  "仮の話",
  "仮に",
  "もし",
  "仮定",
];

function isExcusedClause(clause: string): boolean {
  return (
    NEGATION_MARKERS.some((marker) => clause.includes(marker)) ||
    HYPOTHETICAL_MARKERS.some((marker) => clause.includes(marker))
  );
}

function withCommas(value: number): string {
  return Math.trunc(value).toLocaleString("en-US");
}

function formatAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Old-value surface patterns. Answers write the same value with and
 * without a space before the unit （参加者 50 名 → 50 脚）, so matching
 * is whitespace-tolerant between the amount and the unit; a digit or
 * decimal point directly before the amount means a larger number
 * (150人 is not 50人）.
 */
function oldValueSurfacePatterns(
  numeric: OriginPremiseLedgerNumericValue,
): RegExp[] {
  const { family, oldAmount } = numeric;
  const pairs: { amount: string; unit: string }[] = [];
  if (family === "money") {
    pairs.push({ amount: withCommas(oldAmount), unit: "円" });
    pairs.push({ amount: formatAmount(oldAmount), unit: "円" });
    if (oldAmount >= 10_000 && oldAmount % 1_000 === 0) {
      pairs.push({ amount: formatAmount(oldAmount / 10_000), unit: "万円" });
    }
    if (oldAmount >= 10_000 && oldAmount % 10_000 === 0) {
      pairs.push({ amount: formatAmount(oldAmount / 10_000), unit: "万" });
    }
  } else if (family === "headcount") {
    for (const unit of ["人", "名", "脚", "席"]) {
      pairs.push({ amount: formatAmount(oldAmount), unit });
    }
  } else if (family === "percent") {
    pairs.push({ amount: formatAmount(oldAmount), unit: "%" });
    pairs.push({ amount: formatAmount(oldAmount), unit: "パーセント" });
  } else if (family.startsWith("unit:")) {
    const unit = family.slice("unit:".length);
    pairs.push({ amount: formatAmount(oldAmount), unit });
    pairs.push({ amount: withCommas(oldAmount), unit });
  }
  const seen = new Set<string>();
  const patterns: RegExp[] = [];
  for (const pair of pairs) {
    const key = `${pair.amount}|${pair.unit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    patterns.push(
      new RegExp(
        `(?<![0-9.,])${escapeRegExp(pair.amount)}\\s*${escapeRegExp(pair.unit)}`,
      ),
    );
  }
  return patterns;
}

/**
 * Removes verbatim quotations of user turns (「…」) from the answer
 * text: quoting the user's own words back is not the answer asserting
 * the superseded premise (the abstain/hold templates quote the query).
 */
function stripUserQuotations(
  answerText: string,
  messages: readonly OriginChatMessage[],
): string {
  let text = answerText;
  for (const message of messages) {
    if (message.role !== "user") continue;
    const quoted = normalizeText(message.content ?? "").trim();
    if (quoted.length < 4) continue;
    text = text.split(`「${quoted}」`).join("");
    text = text.split(`『${quoted}』`).join("");
  }
  return text;
}

function checkOldValueReuse(
  ledger: readonly OriginPremiseLedgerEntry[],
  answerText: string,
  messages: readonly OriginChatMessage[],
): OriginPremiseGuardViolation[] {
  const violations: OriginPremiseGuardViolation[] = [];
  const text = stripUserQuotations(normalizeText(answerText), messages);
  const clauses = text.split(CLAUSE_SPLIT_PATTERN);
  ledger.forEach((entry, entryIndex) => {
    if (entry.kind !== "user-correction" || !entry.numeric) return;
    const patterns = oldValueSurfacePatterns(entry.numeric);
    const hit = clauses.some(
      (clause) =>
        !isExcusedClause(clause) &&
        patterns.some((pattern) => pattern.test(clause)),
    );
    if (hit) violations.push({ check: "old-value-reuse", entryIndex });
  });
  return violations;
}

function findAmountAfter(
  pattern: RegExp,
  text: string,
): number | null {
  const match = pattern.exec(text);
  if (!match) return null;
  const amount = Number.parseFloat(match[1].replace(/,/g, ""));
  return Number.isFinite(amount) ? amount : null;
}

function impliedRate(part: number, base: number): number | null {
  if (base <= 0) return null;
  const rate = (part / base) * 100;
  const rounded = Math.round(rate);
  // Tax-inclusive prices are rounded to whole yen, so the implied rate
  // may sit slightly off the integer; beyond ±0.6 points it is not a
  // clean applied rate and is not judged.
  if (Math.abs(rate - rounded) > 0.6) return null;
  return rounded;
}

/**
 * Extracts the rates an answer actually applies, in signal order:
 * multiplication factors (the computation itself), then the rate
 * implied by a stated 税抜/税込 or 税額 pair, then — only when no
 * calculation signal exists — explicit rate statements adjacent to
 * the concept term in non-negated clauses.
 */
function extractAppliedRates(
  answerText: string,
  latestUserText: string,
): number[] {
  const rates = new Set<number>();
  for (const match of answerText.matchAll(/[×x*＊]\s*(\d+(?:\.\d+)?)/g)) {
    const factor = Number.parseFloat(match[1]);
    if (!Number.isFinite(factor)) continue;
    let rate: number | null = null;
    if (factor > 1 && factor < 2) rate = (factor - 1) * 100;
    else if (factor > 0 && factor < 1) rate = factor * 100;
    if (rate !== null && rate > 0 && rate <= 30) {
      rates.add(Math.round(rate * 100) / 100);
    }
  }
  const baseAmount =
    findAmountAfter(/(?:税抜|税別)(?:価格)?[^0-9]{0,8}?(\d[\d,]*)\s*円/, answerText) ??
    findAmountAfter(/(?:税抜|税別)(?:価格)?[^0-9]{0,8}?(\d[\d,]*)\s*円/, latestUserText);
  const inclusiveAmount = findAmountAfter(
    /税込(?:価格)?[^0-9]{0,8}?(\d[\d,]*)\s*円/,
    answerText,
  );
  if (baseAmount !== null && inclusiveAmount !== null && inclusiveAmount > baseAmount) {
    const rate = impliedRate(inclusiveAmount - baseAmount, baseAmount);
    if (rate !== null) rates.add(rate);
  }
  const taxAmount = findAmountAfter(
    /(?:消費税額|税額)[^0-9]{0,8}?(\d[\d,]*)\s*円/,
    answerText,
  );
  if (baseAmount !== null && taxAmount !== null) {
    const rate = impliedRate(taxAmount, baseAmount);
    if (rate !== null) rates.add(rate);
  }
  if (rates.size > 0) return [...rates];
  for (const clause of answerText.split(CLAUSE_SPLIT_PATTERN)) {
    if (NEGATION_MARKERS.some((marker) => clause.includes(marker))) continue;
    for (const match of clause.matchAll(
      /(?:消費税率|消費税額|消費税|税率)[^0-9%]{0,8}(\d+(?:\.\d+)?)\s*%/g,
    )) {
      const rate = Number.parseFloat(match[1]);
      if (Number.isFinite(rate)) rates.add(rate);
    }
    for (const match of clause.matchAll(/(\d+(?:\.\d+)?)\s*%(?:の消費税|の税率)/g)) {
      const rate = Number.parseFloat(match[1]);
      if (Number.isFinite(rate)) rates.add(rate);
    }
  }
  return [...rates];
}

function checkStableFactAppliedValue(
  ledger: readonly OriginPremiseLedgerEntry[],
  messages: readonly OriginChatMessage[],
  answerText: string,
  nowMs: number,
): { violations: OriginPremiseGuardViolation[]; appliedRates: number[] } {
  const violations: OriginPremiseGuardViolation[] = [];
  const appliedRates: number[] = [];
  const text = normalizeText(answerText);
  const latestUser = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  const latestUserText = latestUser ? normalizeText(latestUser.content ?? "") : "";

  for (const entry of ORIGIN_STABLE_FACT_REGISTRY) {
    if (!isOriginStableFactEntryActive(entry, nowMs)) continue;
    const conceptInAnswer = entry.conceptTerms.some((term) =>
      text.includes(term),
    );
    const conceptBound =
      conceptInAnswer ||
      (text.includes("税込") &&
        entry.conceptTerms.some((term) => latestUserText.includes(term)));
    if (!conceptBound) continue;
    // Explicit hypothetical framing in the user's latest turn fences
    // the check for this turn (FP-04: 「仮の話として…もし消費税が
    // 15%だったら」 is a legitimate hypothetical calculation).
    if (
      HYPOTHETICAL_FENCE_MARKERS.some((marker) =>
        latestUserText.includes(marker),
      )
    ) {
      continue;
    }
    const allowed = new Set<number>(entry.allowedRatesPercent);
    for (const ledgerEntry of ledger) {
      if (ledgerEntry.conceptId === entry.id && ledgerEntry.numeric) {
        allowed.add(ledgerEntry.numeric.newAmount);
      }
    }
    const candidates = extractAppliedRates(text, latestUserText);
    appliedRates.push(...candidates);
    const disallowed = candidates.filter(
      (rate) => ![...allowed].some((value) => Math.abs(value - rate) < 0.01),
    );
    if (disallowed.length > 0) {
      violations.push({
        check: "stable-fact-applied-value",
        conceptId: entry.id,
        appliedRates: candidates,
      });
    }
  }
  return { violations, appliedRates };
}

const FABRICATED_CITATION_AUTHORITY_MARKERS: readonly string[] = [
  "公式",
  "税率",
  "消費税",
  "計算方法",
  "計算例",
  "法令",
];

function checkFabricatedCitationForm(
  answerText: string,
): OriginPremiseGuardViolation[] {
  const violations: OriginPremiseGuardViolation[] = [];
  const text = normalizeText(answerText);
  for (const match of text.matchAll(/〔出典[:：]([^〕]*)〕/g)) {
    const label = match[1];
    if (/https?:\/\//.test(label)) continue;
    // A URL written immediately after the bracket (same clause) is
    // still a citation with a real URL, not the fabricated form.
    const after = text.slice(
      (match.index ?? 0) + match[0].length,
      (match.index ?? 0) + match[0].length + 48,
    );
    if (/https?:\/\//.test(after.split(CLAUSE_SPLIT_PATTERN)[0])) continue;
    if (
      FABRICATED_CITATION_AUTHORITY_MARKERS.some((marker) =>
        label.includes(marker),
      )
    ) {
      violations.push({ check: "fabricated-citation-form" });
    }
  }
  return violations;
}

/* ------------------------------------------------------------------ */
/* Combined check + shadow runner                                      */
/* ------------------------------------------------------------------ */

export interface OriginPremiseGuardResult {
  ledger: OriginPremiseLedgerEntry[];
  violations: OriginPremiseGuardViolation[];
  violationCounts: Record<OriginPremiseGuardCheckKind, number>;
  /** Applied rates seen by C-2 (numbers only; empty when C-2 did not run). */
  c2AppliedRates: number[];
}

const EMPTY_RESULT: OriginPremiseGuardResult = {
  ledger: [],
  violations: [],
  violationCounts: {
    "old-value-reuse": 0,
    "stable-fact-applied-value": 0,
    "fabricated-citation-form": 0,
  },
  c2AppliedRates: [],
};

export function checkOriginPremiseGuard(input: {
  messages: readonly OriginChatMessage[];
  answerText: string;
  nowMs: number;
}): OriginPremiseGuardResult {
  const ledger = extractOriginPremiseLedger(input.messages, input.nowMs);
  const c1 = checkOldValueReuse(ledger, input.answerText, input.messages);
  const c2 = checkStableFactAppliedValue(
    ledger,
    input.messages,
    input.answerText,
    input.nowMs,
  );
  const c4 = checkFabricatedCitationForm(input.answerText);
  const violations = [...c1, ...c2.violations, ...c4];
  return {
    ledger,
    violations,
    violationCounts: {
      "old-value-reuse": c1.length,
      "stable-fact-applied-value": c2.violations.length,
      "fabricated-citation-form": c4.length,
    },
    c2AppliedRates: c2.appliedRates,
  };
}

export interface OriginIntentPremiseGuardShadowInput {
  requestId: string;
  messages: readonly OriginChatMessage[];
  answerText: string;
  nowMs?: number;
  /** The I5-PR2 plan the router computed for this request, when it did. */
  plan?: OriginPremiseGuardPlan;
  logger?: (message: string, fields: Record<string, unknown>) => void;
}

/**
 * Shadow observation entry point used by both chat routers. Logs
 * counts and fixed codes only (plus C-2 applied-rate numbers) and
 * never alters the answer. Never throws.
 */
export function runOriginIntentPremiseGuardShadow(
  input: OriginIntentPremiseGuardShadowInput,
): OriginPremiseGuardResult {
  const logger =
    input.logger ?? ((message, fields) => console.info(message, fields));
  try {
    const result = checkOriginPremiseGuard({
      messages: input.messages,
      answerText: input.answerText,
      nowMs: input.nowMs ?? Date.now(),
    });
    const ledgerKindCounts = {
      userCorrection: 0,
      assistantCorrection: 0,
      userAttribute: 0,
      selfAnchorReset: 0,
    };
    for (const entry of result.ledger) {
      if (entry.kind === "user-correction") ledgerKindCounts.userCorrection += 1;
      else if (entry.kind === "assistant-correction") {
        ledgerKindCounts.assistantCorrection += 1;
      } else ledgerKindCounts.userAttribute += 1;
      if (entry.selfAnchorAppliedRatePercent !== undefined) {
        ledgerKindCounts.selfAnchorReset += 1;
      }
    }
    logger("[origin-chat] intent premise guard", {
      requestId: input.requestId,
      premiseGuardMode: "shadow",
      ledgerUserCorrections: ledgerKindCounts.userCorrection,
      ledgerAssistantCorrections: ledgerKindCounts.assistantCorrection,
      ledgerUserAttributes: ledgerKindCounts.userAttribute,
      ledgerSelfAnchorResets: ledgerKindCounts.selfAnchorReset,
      violationOldValueReuse: result.violationCounts["old-value-reuse"],
      violationStableFactAppliedValue:
        result.violationCounts["stable-fact-applied-value"],
      violationFabricatedCitationForm:
        result.violationCounts["fabricated-citation-form"],
      ...(result.c2AppliedRates.length > 0
        ? { c2AppliedRates: result.c2AppliedRates }
        : {}),
      ...(input.plan
        ? {
            premiseGuardBlockInjected: input.plan.block !== null,
            premiseGuardBlockChars: input.plan.block?.text.length ?? 0,
            premiseGuardBlockOmittedEntries:
              input.plan.block?.omittedCount ?? 0,
            premiseGuardArmed: input.plan.arming.armed,
            premiseGuardArmingReasons: [...input.plan.arming.reasons],
          }
        : {}),
    });
    return result;
  } catch (error) {
    logger("[origin-chat] intent premise guard failed", {
      requestId: input.requestId,
      premiseGuardMode: "shadow",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return EMPTY_RESULT;
  }
}
