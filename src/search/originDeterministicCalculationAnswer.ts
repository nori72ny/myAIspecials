/**
 * Deterministic calculation questions — Q9-01 fix (full audit
 * round 3, 2026-11-28; the calculation half of round-9 measure 3,
 * ROUND9_DESIGN_MEASURE3_2026-11-28 §2, brought forward).
 *
 * 「200万円の消費税10%込みの金額は？」 was refused / source-summarised
 * in production (cf6e3100) while the same calculation with a
 * different amount had been answered correctly one release earlier
 * (eeb1ea86). The bisection is in the routing layers, not in the
 * model: with the result cue changed to いくらですか the question
 * escapes to the direct path at BOTH layers (classifier rule
 * deterministic-calculation, policy exemption
 * isSuppliedPriceArithmeticRequest), while the 金額は？ cue matches
 * no enumerated cue in either layer, 消費税 trips the classifier's
 * POLICY_SIGNAL, and the question lands in grounded research —
 * where its fate depends on live search and synthesis outcomes.
 * The exemption family is an enumerated list of surface shapes, so
 * any calculation phrasing nobody enumerated falls through; and
 * the only deterministic net behind it
 * (groundedDeterministicCalculation) sits at the grounded path's
 * ZERO-source exit and parses only the amount-の-rate and discount
 * constructions — in Q9-01 research returned a source, so the net
 * never even ran.
 *
 * This module owns the calculation the way
 * originDeterministicDateAnswer owns the clock question: a
 * WHOLE-QUESTION strict parser over enumerated constructions
 * (tax-inclusive / tax-exclusive / tax amount, percent-of,
 * percent-off, one binary operation, unit conversion, temperature
 * conversion), a deterministic answer builder, a classifier guard
 * and a policy exemption, and a branch in each chat router ahead
 * of the grounded branch. A question that merely CONTAINS a
 * calculation — extra clauses, a comparison of two rates, a
 * request to research — does not parse and keeps its existing
 * route, and a tax question whose rate is not supplied (「消費税
 * 込みの金額は？」 with no rate, 「最新の税率は何%？」) does not
 * parse either: the rate would have to come from outside the
 * question, so it is not a function of the question's own numbers.
 * No search, no model, no freshness gate.
 */

export type OriginDeterministicCalculationQuestion =
  | {
      kind: "tax-included" | "tax-excluded" | "tax-amount" | "percent-of" | "percent-off";
      language: "ja";
      /** The noun phrase naming what is computed, e.g. 「200万円の消費税10%込みの金額」. */
      leadSurface: string;
      /** The computed result, in yen (rounded per the kind's rule). */
      resultYen: number;
      /** True when whole-yen rounding changed the value (stated in the answer). */
      rounded: boolean;
    }
  | {
      kind: "percent-of-unit";
      language: "ja";
      leadSurface: string;
      resultValue: number;
      /** The unit surface the result is expressed in (the amount's own surface). */
      unitSurface: string;
    }
  | {
      kind: "arithmetic";
      language: "ja";
      /** The equation as displayed, e.g. 「200円 + 300円」. */
      expressionSurface: string;
      resultValue: number;
      unitSurface: string;
    }
  | {
      kind: "unit-conversion" | "temperature-conversion";
      language: "ja";
      leadSurface: string;
      resultValue: number;
      /** Word-form temperature answers carry a 華氏/摂氏 prefix before the number. */
      resultPrefix: string;
      unitSurface: string;
    }
  | {
      kind: "division-by-zero";
      language: "ja";
    };

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

const MAGNITUDE_MULTIPLIER: Readonly<Record<string, number>> = {
  "億": 100_000_000,
  "万": 10_000,
};

/**
 * A yen amount token: digit runs joined by magnitude units
 * (1億2000万, 9000万, 5000). Runs on the NFKC + separator-stripped
 * copy, so it only ever faces plain digit runs (the classifier's
 * CodeQL discipline: no overlapping quantifiers over digit classes).
 */
const AMOUNT_TOKEN = String.raw`((?:\d+(?:\.\d+)?\s*[億万]\s*)+|\d+(?:\.\d+)?)`;

function parseYenAmountToken(token: string): number | null {
  let total = 0;
  let matched = false;
  for (const segment of token.replace(/\s+/g, "").matchAll(/(\d+(?:\.\d+)?)(億|万)?/g)) {
    matched = true;
    total += Number(segment[1]) * (segment[2] ? MAGNITUDE_MULTIPLIER[segment[2]] : 1);
  }
  return matched && Number.isFinite(total) ? total : null;
}

/** A rate token: a number with % / パーセント / 割 (a 割 rate converts ×10). */
const RATE_TOKEN = String.raw`(\d+(?:\.\d+)?)\s*(%|パーセント|割)`;

interface ParsedRate {
  percent: number;
  surface: string;
}

function rateFromMatch(match: RegExpMatchArray, numberIndex: number, unitIndex: number): ParsedRate {
  const value = Number(match[numberIndex]);
  const unit = match[unitIndex];
  return {
    percent: unit === "割" ? value * 10 : value,
    surface: `${match[numberIndex]}${unit}`,
  };
}

/**
 * The ask / teach tails a whole question may end with after its
 * construction: a bare は, a result-amount ask （いくら/何円/いくつ）,
 * a polite copula, or a を教えてください framing. Anything else
 * after the construction (another clause, a comparison, a request
 * for grounds) leaves the remainder unconsumed and the anchored
 * match fails — the same discipline as the date parser's trailing
 * set.
 */
const ASK_TAIL = String.raw`(?:は|の)?(?:いくら|何円|いくつ)?(?:ですか|です|でしょう|かな|だ|なの|の)?`;
const TEACH_TAIL = String.raw`(?:を)?教えて(?:ください|下さい)?`;
const TAIL = `(?:${ASK_TAIL}|${TEACH_TAIL})`;

/** Sentence-final punctuation stripped before shape matching (manual loop, no regex on user input). */
const TRAILING_PUNCTUATION: ReadonlySet<string> = new Set(["。", ".", "？", "?", "！", "!"]);

function questionCore(message: string): string {
  const normalized = message
    .normalize("NFKC")
    .replace(/(\d),(?=\d)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  let coreEnd = normalized.length;
  while (coreEnd > 0 && TRAILING_PUNCTUATION.has(normalized[coreEnd - 1] as string)) coreEnd -= 1;
  return normalized.slice(0, coreEnd).trim();
}

/* ------------------------------------------------------------------ */
/* Number / yen formatting (the grounded fallback's established form)  */
/* ------------------------------------------------------------------ */

/** Trim a computed number to at most `maxDecimals` decimals, without trailing zeros. */
function formatNumber(value: number, maxDecimals: number): string {
  const factor = 10 ** maxDecimals;
  const rounded = Math.round(value * factor) / factor;
  const text = String(rounded === 0 ? 0 : rounded);
  const [integerPart, ...rest] = text.split(".");
  const signed = integerPart.startsWith("-");
  const digits = signed ? integerPart.slice(1) : integerPart;
  const withCommas = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${signed ? "-" : ""}${withCommas}${rest.length > 0 ? `.${rest.join(".")}` : ""}`;
}

function formatYen(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const body = Number.isInteger(rounded)
    ? String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    : formatNumber(rounded, 2);
  // A whole 万円 form rides along when it is exact at the
  // 100-yen grain: 5,580,000円（558万円） — the form the asker
  // most likely expects back for a magnitude amount.
  if (Number.isInteger(rounded) && rounded >= 10_000 && rounded % 100 === 0) {
    return `${body}円（${formatNumber(rounded / 10_000, 2)}万円）`;
  }
  return `${body}円`;
}

/** Whole-yen rounding for tax results; the flag is stated in the answer when it bites. */
function roundYen(value: number): { result: number; rounded: boolean } {
  const result = Math.round(value);
  return { result, rounded: Math.abs(value - result) > 1e-9 };
}

/* ------------------------------------------------------------------ */
/* Tax constructions                                                   */
/* ------------------------------------------------------------------ */

function taxIncluded(amountYen: number, amountSurface: string, rate: ParsedRate): OriginDeterministicCalculationQuestion {
  const { result, rounded } = roundYen((amountYen * (100 + rate.percent)) / 100);
  return {
    kind: "tax-included",
    language: "ja",
    leadSurface: `${amountSurface}の消費税${rate.surface}込みの金額`,
    resultYen: result,
    rounded,
  };
}

function taxExcluded(amountYen: number, leadSurface: string, rate: ParsedRate): OriginDeterministicCalculationQuestion {
  const { result, rounded } = roundYen((amountYen * 100) / (100 + rate.percent));
  return { kind: "tax-excluded", language: "ja", leadSurface, resultYen: result, rounded };
}

function parseTaxConstructions(core: string): OriginDeterministicCalculationQuestion | null {
  // A1: 「200万円の消費税10%込みの金額は？」 — the Q9-01 shape. An
  // optional 税抜 prefix names the amount's basis and changes
  // nothing: the supplied rate is applied to the supplied amount.
  const a1 = core.match(new RegExp(
    `^(?:税抜(?:き)?)?${AMOUNT_TOKEN}\\s*円\\s*の消費税${RATE_TOKEN}込み(?:の(?:金額|価格|値段|合計|総額))?${TAIL}$`,
  ));
  if (a1) {
    const amountYen = parseYenAmountToken(a1[1]);
    if (amountYen === null) return null;
    return taxIncluded(amountYen, `${a1[1].replace(/\s+/g, "")}円`, rateFromMatch(a1, 2, 3));
  }
  // A2: 「200万円に消費税10%を加えた金額は？」 / 「200万円に10%の消費税を加えた金額は？」
  const a2 = core.match(new RegExp(
    `^${AMOUNT_TOKEN}\\s*円\\s*に(?:消費税${RATE_TOKEN}|${RATE_TOKEN}の消費税)を加えた(?:金額|価格|合計|総額)?${TAIL}$`,
  ));
  if (a2) {
    const amountYen = parseYenAmountToken(a2[1]);
    if (amountYen === null) return null;
    const rate = a2[2] !== undefined ? rateFromMatch(a2, 2, 3) : rateFromMatch(a2, 4, 5);
    return taxIncluded(amountYen, `${a2[1].replace(/\s+/g, "")}円`, rate);
  }
  // B1: 「税込220万円（消費税10%込み）の税抜金額は？」
  const b1 = core.match(new RegExp(
    `^(?:税込(?:み)?)?${AMOUNT_TOKEN}\\s*円\\s*[（(]消費税${RATE_TOKEN}込み[）)]の税抜(?:き)?(?:の)?(?:金額|価格|値段)?${TAIL}$`,
  ));
  if (b1) {
    const amountYen = parseYenAmountToken(b1[1]);
    if (amountYen === null) return null;
    const rate = rateFromMatch(b1, 2, 3);
    const amountSurface = `${b1[1].replace(/\s+/g, "")}円`;
    return taxExcluded(amountYen, `${amountSurface}（消費税${rate.surface}込み）の税抜金額`, rate);
  }
  // B2: 「消費税10%込みで200万円の商品の税抜価格は？」
  const b2 = core.match(new RegExp(
    `^消費税${RATE_TOKEN}込み(?:で|の)${AMOUNT_TOKEN}\\s*円(?:の商品)?の税抜(?:き)?(?:価格|金額|値段)?${TAIL}$`,
  ));
  if (b2) {
    const amountYen = parseYenAmountToken(b2[3]);
    if (amountYen === null) return null;
    const rate = rateFromMatch(b2, 1, 2);
    const amountSurface = `${b2[3].replace(/\s+/g, "")}円`;
    return taxExcluded(amountYen, `消費税${rate.surface}込みの${amountSurface}の税抜金額`, rate);
  }
  // B3: 「200万円の消費税10%抜きの金額は？」
  const b3 = core.match(new RegExp(
    `^${AMOUNT_TOKEN}\\s*円\\s*の消費税${RATE_TOKEN}抜き(?:の)?(?:金額|価格|値段)?${TAIL}$`,
  ));
  if (b3) {
    const amountYen = parseYenAmountToken(b3[1]);
    if (amountYen === null) return null;
    const rate = rateFromMatch(b3, 2, 3);
    const amountSurface = `${b3[1].replace(/\s+/g, "")}円`;
    return taxExcluded(amountYen, `${amountSurface}の消費税${rate.surface}抜きの金額`, rate);
  }
  // B4: the tax portion of a tax-inclusive amount:
  // 「消費税10%込みで220万円のうち消費税額は？」 /
  // 「税込220万円（消費税10%込み）のうち消費税額は？」
  const b4 = core.match(new RegExp(
    `^(?:消費税${RATE_TOKEN}込み(?:で|の)${AMOUNT_TOKEN}\\s*円(?:の商品)?|(?:税込(?:み)?)?${AMOUNT_TOKEN}\\s*円\\s*[（(]消費税${RATE_TOKEN}込み[）)])のうち消費税(?:額)?${TAIL}$`,
  ));
  if (b4) {
    // Group layout: branch 1 (rate-first) is rate 1/2 + amount 3;
    // branch 2 (amount-first) is amount 4 + rate 5/6.
    const rate = b4[1] !== undefined ? rateFromMatch(b4, 1, 2) : rateFromMatch(b4, 5, 6);
    const amountToken = b4[1] !== undefined ? b4[3] : b4[4];
    const amountYen = parseYenAmountToken(amountToken ?? "");
    if (amountYen === null) return null;
    const amountSurface = `${(amountToken ?? "").replace(/\s+/g, "")}円`;
    const { result, rounded } = roundYen(amountYen - (amountYen * 100) / (100 + rate.percent));
    return {
      kind: "tax-amount",
      language: "ja",
      leadSurface: `消費税${rate.surface}込みの${amountSurface}のうち消費税額`,
      resultYen: result,
      rounded,
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Percent constructions                                               */
/* ------------------------------------------------------------------ */

/**
 * Count / measure units for percent-of questions: the surface the
 * amount carries, and the 何-tails that ask for the result in that
 * unit. The result is expressed in the amount's own surface.
 */
const PERCENT_UNIT_TAILS: Readonly<Record<string, readonly string[]>> = {
  "人": ["何人"],
  "個": ["何個"],
  "本": ["何本"],
  "枚": ["何枚"],
  "台": ["何台"],
  "件": ["何件"],
  "冊": ["何冊"],
  "匹": ["何匹"],
  "頭": ["何頭"],
  "羽": ["何羽"],
  "杯": ["何杯"],
  "箱": ["何箱"],
  "袋": ["何袋"],
  "セット": ["何セット"],
  "キログラム": ["何キログラム", "何kg"],
  "kg": ["何kg", "何キログラム"],
  "グラム": ["何グラム", "何g"],
  "g": ["何g", "何グラム"],
  "ミリグラム": ["何ミリグラム", "何mg"],
  "mg": ["何mg", "何ミリグラム"],
  "キロメートル": ["何キロメートル", "何km"],
  "km": ["何km", "何キロメートル"],
  "メートル": ["何メートル", "何m"],
  "m": ["何m", "何メートル"],
  "センチメートル": ["何センチメートル", "何cm"],
  "cm": ["何cm", "何センチメートル"],
  "ミリメートル": ["何ミリメートル", "何mm"],
  "mm": ["何mm", "何ミリメートル"],
  "リットル": ["何リットル", "何L", "何l"],
  "L": ["何L", "何リットル"],
  "l": ["何l", "何L", "何リットル"],
  "ミリリットル": ["何ミリリットル", "何ml"],
  "ml": ["何ml", "何ミリリットル"],
};

const PERCENT_UNIT_PATTERN = Object.keys(PERCENT_UNIT_TAILS)
  .sort((a, b) => b.length - a.length)
  .join("|");

function parsePercentConstructions(core: string): OriginDeterministicCalculationQuestion | null {
  // Percent-off first: 「200万円の10%引き」 also contains the plain
  // percent-of shape's head, and the discount reading is the one
  // the asker means (the grounded fallback's ordering).
  const off = core.match(new RegExp(
    `^${AMOUNT_TOKEN}\\s*円\\s*の${RATE_TOKEN}引き(?:の(?:金額|価格|値段))?${TAIL}$`,
  ));
  if (off) {
    const amountYen = parseYenAmountToken(off[1]);
    if (amountYen === null) return null;
    const rate = rateFromMatch(off, 2, 3);
    const amountSurface = `${off[1].replace(/\s+/g, "")}円`;
    return {
      kind: "percent-off",
      language: "ja",
      leadSurface: `${amountSurface}の${rate.surface}引き`,
      resultYen: (amountYen * (100 - rate.percent)) / 100,
      rounded: false,
    };
  }
  // Percent-of a yen amount: 「9000万円の6.2%はいくらですか」 and,
  // with the tax named, the tax on the amount:
  // 「200万円の消費税10%はいくらですか」.
  const ofYen = core.match(new RegExp(
    `^${AMOUNT_TOKEN}\\s*円\\s*の(消費税)?${RATE_TOKEN}${TAIL}$`,
  ));
  if (ofYen) {
    const amountYen = parseYenAmountToken(ofYen[1]);
    if (amountYen === null) return null;
    const rate = rateFromMatch(ofYen, 3, 4);
    const amountSurface = `${ofYen[1].replace(/\s+/g, "")}円`;
    return {
      kind: "percent-of",
      language: "ja",
      leadSurface: `${amountSurface}の${ofYen[2] ?? ""}${rate.surface}`,
      resultYen: (amountYen * rate.percent) / 100,
      rounded: false,
    };
  }
  // Percent-of a count / measure: 「40人の75%は何人ですか」.
  const ofUnit = core.match(new RegExp(
    `^(\\d+(?:\\.\\d+)?)\\s*(${PERCENT_UNIT_PATTERN})\\s*の${RATE_TOKEN}(?:は)?(何[^\\s?？]{0,6}?|いくつ)?(?:ですか|です|でしょう|かな|だ|なの|の)?$`,
  ));
  if (ofUnit) {
    const unitSurface = ofUnit[2];
    const tail = ofUnit[5];
    if (tail !== undefined && tail !== "いくつ") {
      const accepted = PERCENT_UNIT_TAILS[unitSurface] ?? [];
      if (!accepted.includes(tail)) return null;
    }
    if (tail === "いくつ" && !["人", "個", "本", "枚", "台", "件", "冊", "匹", "頭", "羽", "杯", "箱", "袋", "セット"].includes(unitSurface)) return null;
    const rate = rateFromMatch(ofUnit, 3, 4);
    const amount = Number(ofUnit[1]);
    return {
      kind: "percent-of-unit",
      language: "ja",
      leadSurface: `${ofUnit[1]}${unitSurface}の${rate.surface}`,
      resultValue: (amount * rate.percent) / 100,
      unitSurface,
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Arithmetic: one binary operation                                    */
/* ------------------------------------------------------------------ */

const ARITHMETIC_UNIT_PATTERN = PERCENT_UNIT_PATTERN;

function arithmeticResult(
  a: number,
  aUnit: string,
  op: "+" | "-" | "×" | "÷",
  b: number,
  bUnit: string,
): OriginDeterministicCalculationQuestion | null {
  const aSurface = `${formatNumber(a, 6)}${aUnit}`;
  // A percent second operand makes the operation a percent-of,
  // whatever the operator glyph (「40人×75%」, 「200円の10%」の
  // 乗算形）: the result carries the first operand's unit.
  if (bUnit === "%" || bUnit === "パーセント") {
    if (op !== "×") return null;
    return {
      kind: "percent-of-unit",
      language: "ja",
      leadSurface: `${aSurface}の${formatNumber(b, 6)}%`,
      resultValue: (a * b) / 100,
      unitSurface: aUnit,
    };
  }
  const unitSurface = aUnit || bUnit;
  if (aUnit && bUnit && aUnit !== bUnit) return null;
  if (op === "÷" && b === 0) return { kind: "division-by-zero", language: "ja" };
  const resultValue = op === "+" ? a + b : op === "-" ? a - b : op === "×" ? a * b : a / b;
  if (!Number.isFinite(resultValue)) return null;
  const bSurface = `${formatNumber(b, 6)}${bUnit}`;
  return {
    kind: "arithmetic",
    language: "ja",
    expressionSurface: `${aSurface} ${op} ${bSurface}`,
    resultValue,
    unitSurface,
  };
}

function parseArithmetic(core: string): OriginDeterministicCalculationQuestion | null {
  // Symbolic: 「200 + 300」, 「200円+300円は？」, 「40人×75%」.
  // After NFKC the full-width operators ＋－＝＊ are folded to
  // ASCII; × ÷ ✕ remain as-is.
  const symbolic = core.match(new RegExp(
    `^(\\d+(?:\\.\\d+)?)\\s*(円|${ARITHMETIC_UNIT_PATTERN})?\\s*(\\+|-|×|✕|\\*|÷|\\/)\\s*(\\d+(?:\\.\\d+)?)\\s*(円|%|パーセント)?\\s*(?:=)?(?:は)?(?:いくら|何円|いくつ)?(?:ですか|です|でしょう|かな|だ|なの|の)?$`,
  ));
  if (symbolic) {
    const aUnit = symbolic[2] ?? "";
    // A non-yen unit on the first operand is only meaningful with
    // a percent second operand (percent-of); a plain operation
    // over counts is not one of the enumerated shapes.
    const bUnitRaw = symbolic[5] ?? "";
    if (aUnit !== "" && aUnit !== "円" && bUnitRaw !== "%" && bUnitRaw !== "パーセント") return null;
    const op = symbolic[3] === "*" || symbolic[3] === "✕" ? "×" : symbolic[3] === "/" ? "÷" : symbolic[3] as "+" | "-" | "×" | "÷";
    return arithmeticResult(Number(symbolic[1]), aUnit, op, Number(symbolic[4]), bUnitRaw);
  }
  // Verbal forms over yen / bare numbers.
  const verbal: ReadonlyArray<{
    pattern: RegExp;
    op: "+" | "-" | "×" | "÷";
  }> = [
    { pattern: /^(\d+(?:\.\d+)?)\s*(円)?と(\d+(?:\.\d+)?)\s*(円)?の合計(?:は)?(?:いくら|何円)?(?:ですか|です|でしょう|かな|だ|なの|の)?$/, op: "+" },
    { pattern: /^(\d+(?:\.\d+)?)\s*(円)?に(\d+(?:\.\d+)?)\s*(円)?を(?:足すと|加えると)(?:いくら|何円|いくつ)?(?:ですか|です|でしょう|かな|だ|なの|の)?$/, op: "+" },
    { pattern: /^(\d+(?:\.\d+)?)\s*(円)?から(\d+(?:\.\d+)?)\s*(円)?を(?:引くと|引いた(?:金額|残り|値段)?(?:は)?)(?:いくら|何円)?(?:ですか|です|でしょう|かな|だ|なの|の)?$/, op: "-" },
    { pattern: /^(\d+(?:\.\d+)?)\s*(円)?に(\d+(?:\.\d+)?)を(?:掛けると|かけると)(?:いくら|何円|いくつ)?(?:ですか|です|でしょう|かな|だ|なの|の)?$/, op: "×" },
    { pattern: /^(\d+(?:\.\d+)?)\s*(円)?を(\d+(?:\.\d+)?)\s*(人)?(?:で割ると|で等分すると|等分すると)(?:1人|一人)?(?:あたり)?(?:いくら|何円|いくつ)?(?:ですか|です|でしょう|かな|だ|なの|の)?$/, op: "÷" },
  ];
  for (const { pattern, op } of verbal) {
    const match = core.match(pattern);
    if (!match) continue;
    const aUnit = match[2] ?? "";
    const bUnit = op === "÷" ? "" : (match[4] ?? "");
    if (aUnit && bUnit && aUnit !== bUnit) return null;
    return arithmeticResult(Number(match[1]), aUnit, op, Number(match[3]), bUnit);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Unit conversion                                                     */
/* ------------------------------------------------------------------ */

interface ConversionUnit {
  dimension: "length" | "weight" | "volume";
  /** Factor to the dimension's base unit (m / kg / L). */
  toBase: number;
}

const CONVERSION_UNITS: Readonly<Record<string, ConversionUnit>> = {
  "キロメートル": { dimension: "length", toBase: 1000 },
  "km": { dimension: "length", toBase: 1000 },
  "メートル": { dimension: "length", toBase: 1 },
  "m": { dimension: "length", toBase: 1 },
  "センチメートル": { dimension: "length", toBase: 0.01 },
  "cm": { dimension: "length", toBase: 0.01 },
  "ミリメートル": { dimension: "length", toBase: 0.001 },
  "mm": { dimension: "length", toBase: 0.001 },
  "マイル": { dimension: "length", toBase: 1609.344 },
  "インチ": { dimension: "length", toBase: 0.0254 },
  "フィート": { dimension: "length", toBase: 0.3048 },
  "ヤード": { dimension: "length", toBase: 0.9144 },
  "トン": { dimension: "weight", toBase: 1000 },
  "t": { dimension: "weight", toBase: 1000 },
  "キログラム": { dimension: "weight", toBase: 1 },
  "kg": { dimension: "weight", toBase: 1 },
  "グラム": { dimension: "weight", toBase: 0.001 },
  "g": { dimension: "weight", toBase: 0.001 },
  "ポンド": { dimension: "weight", toBase: 0.45359237 },
  "リットル": { dimension: "volume", toBase: 1 },
  "L": { dimension: "volume", toBase: 1 },
  "l": { dimension: "volume", toBase: 1 },
  "ミリリットル": { dimension: "volume", toBase: 0.001 },
  "ml": { dimension: "volume", toBase: 0.001 },
  "cc": { dimension: "volume", toBase: 0.001 },
};

const CONVERSION_UNIT_PATTERN = Object.keys(CONVERSION_UNITS)
  .sort((a, b) => b.length - a.length)
  .join("|");

function conversionResult(
  value: number,
  fromSurface: string,
  toSurface: string,
): OriginDeterministicCalculationQuestion | null {
  const from = CONVERSION_UNITS[fromSurface];
  const to = CONVERSION_UNITS[toSurface];
  if (!from || !to || from.dimension !== to.dimension) return null;
  return {
    kind: "unit-conversion",
    language: "ja",
    leadSurface: `${formatNumber(value, 6)}${fromSurface}`,
    resultValue: (value * from.toBase) / to.toBase,
    resultPrefix: "",
    unitSurface: toSurface,
  };
}

function parseUnitConversion(core: string): OriginDeterministicCalculationQuestion | null {
  const e1 = core.match(new RegExp(
    `^(\\d+(?:\\.\\d+)?)\\s*(${CONVERSION_UNIT_PATTERN})は(?:何|いくつ)(${CONVERSION_UNIT_PATTERN})(?:ですか|です|でしょう|かな|だ|なの|の)?$`,
  ));
  if (e1) return conversionResult(Number(e1[1]), e1[2], e1[3]);
  const e2 = core.match(new RegExp(
    `^(\\d+(?:\\.\\d+)?)\\s*(${CONVERSION_UNIT_PATTERN})は(${CONVERSION_UNIT_PATTERN})で(?:いくつ|何)?(?:ですか|です|でしょう|かな|だ|なの|の)?$`,
  ));
  if (e2) return conversionResult(Number(e2[1]), e2[2], e2[3]);
  const e3 = core.match(new RegExp(
    `^(\\d+(?:\\.\\d+)?)\\s*(${CONVERSION_UNIT_PATTERN})を(${CONVERSION_UNIT_PATTERN})に(?:換算|変換)すると(?:いくつ|何)?(?:ですか|です|でしょう|かな|だ|なの|の)?$`,
  ));
  if (e3) return conversionResult(Number(e3[1]), e3[2], e3[3]);
  // Temperature: the only dimension whose conversion is not a
  // ratio. NFKC folds ℃/℉ to °C/°F.
  const t1 = core.match(
    /^摂氏(-?\d+(?:\.\d+)?)度は華氏(?:何度)?(?:ですか|です|でしょう|かな|だ|なの|の)?$/,
  );
  if (t1) {
    const value = Number(t1[1]);
    return {
      kind: "temperature-conversion",
      language: "ja",
      leadSurface: `摂氏${formatNumber(value, 6)}度`,
      resultValue: (value * 9) / 5 + 32,
      resultPrefix: "華氏",
      unitSurface: "度",
    };
  }
  const t2 = core.match(
    /^華氏(-?\d+(?:\.\d+)?)度は摂氏(?:何度)?(?:ですか|です|でしょう|かな|だ|なの|の)?$/,
  );
  if (t2) {
    const value = Number(t2[1]);
    return {
      kind: "temperature-conversion",
      language: "ja",
      leadSurface: `華氏${formatNumber(value, 6)}度`,
      resultValue: ((value - 32) * 5) / 9,
      resultPrefix: "摂氏",
      unitSurface: "度",
    };
  }
  const t3 = core.match(
    /^(-?\d+(?:\.\d+)?)\s*°Cは°?Fで(?:何度|いくつ)?(?:ですか|です|でしょう|かな|だ|なの|の)?$/,
  );
  if (t3) {
    const value = Number(t3[1]);
    return {
      kind: "temperature-conversion",
      language: "ja",
      leadSurface: `${formatNumber(value, 6)}°C`,
      resultValue: (value * 9) / 5 + 32,
      resultPrefix: "",
      unitSurface: "°F",
    };
  }
  const t4 = core.match(
    /^(-?\d+(?:\.\d+)?)\s*°Fは°?Cで(?:何度|いくつ)?(?:ですか|です|でしょう|かな|だ|なの|の)?$/,
  );
  if (t4) {
    const value = Number(t4[1]);
    return {
      kind: "temperature-conversion",
      language: "ja",
      leadSurface: `${formatNumber(value, 6)}°F`,
      resultValue: ((value - 32) * 5) / 9,
      resultPrefix: "",
      unitSurface: "°C",
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Parser / builder                                                    */
/* ------------------------------------------------------------------ */

/**
 * Parse a whole question into a deterministic calculation, or null
 * when the question is anything else. The shapes are an enumerated
 * set — extending them is a deliberate act (each new shape must
 * keep the both-direction tests green), not a parser relaxation.
 */
export function parseOriginDeterministicCalculationQuestion(
  message: string,
): OriginDeterministicCalculationQuestion | null {
  const core = questionCore(message ?? "");
  if (!core || !/\d/.test(core)) return null;
  return (
    parseTaxConstructions(core)
    ?? parsePercentConstructions(core)
    ?? parseArithmetic(core)
    ?? parseUnitConversion(core)
  );
}

/**
 * The deterministic answer: the result first, with the computed
 * construction stated in the same sentence — the form the grounded
 * calculation fallback established. Tax results are whole yen;
 * when the rounding bites, the answer says so (round-9 measure 3
 * §2.2: a rounded answer names its rounding).
 */
export function buildOriginDeterministicCalculationAnswer(
  question: OriginDeterministicCalculationQuestion,
): string {
  switch (question.kind) {
    case "tax-included":
    case "tax-excluded":
    case "tax-amount":
    case "percent-of":
    case "percent-off": {
      const roundingNote = question.rounded ? "（円未満は四捨五入しました）" : "";
      return `${question.leadSurface}は、${formatYen(question.resultYen)}です${roundingNote}。`;
    }
    case "percent-of-unit":
      return `${question.leadSurface}は、${formatNumber(question.resultValue, 2)}${question.unitSurface}です。`;
    case "arithmetic":
      return `${question.expressionSurface} = ${formatNumber(question.resultValue, 6)}${question.unitSurface}です。`;
    case "unit-conversion":
      return `${question.leadSurface}は、${formatNumber(question.resultValue, 6)}${question.unitSurface}です。`;
    case "temperature-conversion":
      return `${question.leadSurface}は、${question.resultPrefix}${formatNumber(question.resultValue, 6)}${question.unitSurface}です。`;
    case "division-by-zero":
      return "0で割ることはできないため、計算できません。";
  }
}
