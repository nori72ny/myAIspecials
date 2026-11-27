/**
 * Deterministic calculation fallback (round 7, measure C-2;
 * ANSWER_ROUND7_DIAGNOSIS_2026-11-27 §5.2).
 *
 * The safety net behind C-1's routing exemptions. A question whose
 * every input is supplied by the asker — an amount of money and a
 * percentage of it — is arithmetic, not research: no source can
 * add anything to it. C-1 keeps the known shapes of that question
 * out of the grounded-research route entirely, but the exemption
 * family is a list of shapes, and a new phrasing can slip past it.
 * When that happens the question lands in grounded research, and a
 * source-retrieval failure there used to refuse the whole answer
 * (Q6-01's production shape: "9000万円の6.2%はいくらですか？"
 * refused twice because sources could not be fetched).
 *
 * This module is the net at that landing: when research produced
 * no sources and the question still parses as the deterministic
 * amount × percentage construction, the answer is COMPUTED —
 * exactly, from the question's own numbers, with no source and no
 * model — instead of refused. The construction is deliberately
 * narrow:
 *
 *  - one yen amount, magnitudes included (9000万円, 1億2000万円);
 *  - one rate stated against it with の: a percentage
 *    (% / パーセント), a 割 proportion, or a discount
 *    (%引き / 割引);
 *  - a result-seeking cue somewhere in the question
 *    (いくら / 何円 / 教えて / ですか / 計算 …).
 *
 * Anything else — a second amount, a rate with no amount, a
 * question about a current external rate — does not parse, and
 * the caller's ordinary refusal stands exactly as before.
 */

export interface DeterministicCalculation {
  kind: "percent-of" | "percent-off";
  /** The supplied amount, in yen. */
  amountYen: number;
  /** The effective rate, in percent (a 割 rate is converted ×10). */
  ratePercent: number;
  /** The computed result, in yen. */
  resultYen: number;
  /** The deterministic answer body. */
  text: string;
}

const MAGNITUDE_MULTIPLIER: Readonly<Record<string, number>> = {
  "億": 100_000_000,
  "万": 10_000,
};

/**
 * A yen amount token: digit runs joined by magnitude units
 * (1億2000万, 9000万, 5000), at least one digit overall. Runs on
 * the NFKC + separator-stripped copy, so it only ever faces plain
 * digit runs (the classifier's CodeQL discipline).
 */
const AMOUNT_TOKEN = String.raw`((?:\d+(?:\.\d+)?\s*[億万]\s*)*\d*(?:\.\d+)?)`;

function parseYenAmountToken(token: string): number | null {
  let total = 0;
  let matched = false;
  for (const segment of token.matchAll(/(\d+(?:\.\d+)?)\s*(億|万)?/g)) {
    matched = true;
    total += Number(segment[1]) * (segment[2] ? MAGNITUDE_MULTIPLIER[segment[2]] : 1);
  }
  return matched && Number.isFinite(total) ? total : null;
}

interface ParsedConstruction {
  kind: "percent-of" | "percent-off";
  amountYen: number;
  amountSurface: string;
  ratePercent: number;
  rateSurface: string;
}

function parseConstruction(normalized: string): ParsedConstruction | null {
  // Discount first: "の10%引き" and "の3割引" also contain the
  // plain percentage / 割 shapes, and the discount reading is the
  // one the asker means.
  const discount = normalized.match(
    new RegExp(
      `${AMOUNT_TOKEN}\\s*円\\s*の\\s*(\\d+(?:\\.\\d+)?)\\s*(%|パーセント|割)\\s*引`,
    ),
  );
  if (discount) {
    const amountYen = parseYenAmountToken(discount[1]);
    if (amountYen === null) return null;
    const rate = Number(discount[2]);
    return {
      kind: "percent-off",
      amountYen,
      amountSurface: `${discount[1].replace(/\s+/g, "")}円`,
      ratePercent: discount[3] === "割" ? rate * 10 : rate,
      rateSurface: `${discount[2]}${discount[3]}`,
    };
  }
  const percentOf = normalized.match(
    new RegExp(
      `${AMOUNT_TOKEN}\\s*円\\s*の\\s*(\\d+(?:\\.\\d+)?)\\s*(%|パーセント|割)`,
    ),
  );
  if (percentOf) {
    const amountYen = parseYenAmountToken(percentOf[1]);
    if (amountYen === null) return null;
    const rate = Number(percentOf[2]);
    return {
      kind: "percent-of",
      amountYen,
      amountSurface: `${percentOf[1].replace(/\s+/g, "")}円`,
      ratePercent: percentOf[3] === "割" ? rate * 10 : rate,
      rateSurface: `${percentOf[2]}${percentOf[3]}`,
    };
  }
  return null;
}

/** Trim a computed number to at most 2 decimals, without trailing zeros. */
function trimmedNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function formatYen(value: number, language: "ja" | "en"): string {
  const rounded = Math.round(value * 100) / 100;
  const body = Number.isInteger(rounded)
    ? String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    : trimmedNumber(rounded);
  if (language === "en") return `${body} yen`;
  // A whole 万円 form rides along when it is exact at the
  // 100-yen grain: 5,580,000円（558万円） — the form the asker
  // most likely expects back for a magnitude amount.
  if (Number.isInteger(rounded) && rounded >= 10_000 && rounded % 100 === 0) {
    return `${body}円（${trimmedNumber(rounded / 10_000)}万円）`;
  }
  return `${body}円`;
}

const RESULT_CUE = /(?:いくら|何円|教えて|ですか|でしょう|計算|求め)/;

/**
 * Compute the answer when the message is the deterministic
 * amount × percentage construction; null otherwise. Pure: no
 * clock, no network, no model.
 */
export function tryDeterministicCalculationFallback(
  message: string,
  language: "ja" | "en",
): DeterministicCalculation | null {
  if (!RESULT_CUE.test(message)) return null;
  const normalized = message.normalize("NFKC").replace(/(\d),(?=\d)/g, "$1");
  const parsed = parseConstruction(normalized);
  if (!parsed) return null;
  const resultYen =
    parsed.kind === "percent-off"
      ? (parsed.amountYen * (100 - parsed.ratePercent)) / 100
      : (parsed.amountYen * parsed.ratePercent) / 100;
  if (!Number.isFinite(resultYen)) return null;
  const resultText = formatYen(resultYen, language);
  const text =
    language === "en"
      ? parsed.kind === "percent-off"
        ? `${parsed.amountSurface} with ${parsed.rateSurface} off is ${resultText}.`
        : `${parsed.rateSurface} of ${parsed.amountSurface} is ${resultText}.`
      : parsed.kind === "percent-off"
        ? `${parsed.amountSurface}の${parsed.rateSurface}引きは、${resultText}です。`
        : `${parsed.amountSurface}の${parsed.rateSurface}は、${resultText}です。`;
  return {
    kind: parsed.kind,
    amountYen: parsed.amountYen,
    ratePercent: parsed.ratePercent,
    resultYen,
    text,
  };
}
