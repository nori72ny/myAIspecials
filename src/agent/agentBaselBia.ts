/**
 * Deterministic Basel BIA assembly (failure diagnosis 2026-11-24,
 * 対策6, prior implementation — wave 2, agent lane).
 *
 * The capital calculation is never model work: the parameter table
 * of an attachment set has a known shape (an alpha coefficient and
 * one gross-income figure per year), so the Basic Indicator
 * Approach result is assembled here, deterministically, from the
 * set's own texts. Amounts are integer CNY; the alpha coefficient
 * is carried as an exact decimal rational (BigInt numerator /
 * denominator) so `0.15 × 1,990,000,000` is exact instead of a
 * binary-floating-point approximation. When the capital does not
 * come out whole, it is rounded half-up to the nearest integer and
 * the result says so (`capitalRounded`) — the goal states no
 * rounding rule, so the rounding is surfaced, never hidden.
 *
 * This module is a pure function of the attachment texts: no model,
 * no I/O, no logging. It fires only when a parameter table of the
 * expected shape is actually present; anything else yields null
 * and the caller fails closed rather than inventing inputs.
 */

export type BaselBiaInputs = {
  /** The alpha coefficient exactly as written in the table
   * (a decimal string such as "0.15"), kept verbatim so the
   * assembled JSON reports the input's own value. */
  alphaText: string;
  /** Gross income per fiscal year, keyed by the 4-digit year. */
  grossIncomeByYear: Readonly<Record<string, number>>;
};

export type BaselBiaResult = {
  alphaCoefficient: number;
  grossIncomeYears: Record<string, number>;
  positiveGiSumCny: number;
  numberOfYears: number;
  averageAnnualGiCny: number;
  orRegulatoryCapitalCny: number;
  /** True when the exact capital was not a whole number and the
   * reported value is the half-up rounding of it. */
  capitalRounded: boolean;
};

const ALPHA_KEY_PATTERN = /^alpha_coefficient$/i;
const GROSS_INCOME_KEY_PATTERN = /^gross_income_year_\d+_(\d{4})(?:_cny)?$/i;

function parseIntegerCell(raw: string): number | null {
  const cleaned = raw.replace(/[\s,]/g, '');
  if (!/^[+-]?\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isSafeInteger(value) ? value : null;
}

function isDecimalText(raw: string): boolean {
  return /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw.trim());
}

/**
 * Reads the BIA inputs out of a set's parameter table: a delimited
 * key/value table (header naming a parameter column and a value
 * column) carrying an `Alpha_Coefficient` row and at least one
 * `Gross_Income_Year_<n>_<YYYY>_CNY` row. Heading lines without a
 * delimiter (the spreadsheet-export `## sheet:` prefix) are skipped
 * the same way the data layer's table parser skips them. Returns
 * null when no file in the set has that shape, or when any value
 * the shape promises cannot be read — a partial read is not an
 * input.
 */
export function parseBaselBiaInputs(
  files: readonly { name: string; text: string }[],
): BaselBiaInputs | null {
  for (const file of files) {
    const lines = file.text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    let headerIndex = 0;
    while (
      headerIndex < lines.length
      && !lines[headerIndex].includes('\t')
      && !lines[headerIndex].includes(',')
    ) {
      headerIndex += 1;
    }
    const tableLines = lines.slice(headerIndex);
    if (tableLines.length < 2) continue;
    const delimiter = tableLines[0].includes('\t') ? '\t' : ',';
    const header = tableLines[0].split(delimiter).map((cell) => cell.trim().toLowerCase());
    const keyColumn = header.findIndex((cell) => cell === 'parameter' || cell === 'name' || cell === 'key');
    const valueColumn = header.findIndex((cell) => cell === 'value' || cell === 'amount');
    if (keyColumn < 0 || valueColumn < 0) continue;
    let alphaText: string | null = null;
    const grossIncomeByYear: Record<string, number> = {};
    let malformed = false;
    for (const line of tableLines.slice(1)) {
      const cells = line.split(delimiter).map((cell) => cell.trim());
      const key = cells[keyColumn] ?? '';
      const value = cells[valueColumn] ?? '';
      if (ALPHA_KEY_PATTERN.test(key)) {
        if (!isDecimalText(value)) { malformed = true; break; }
        alphaText = value;
        continue;
      }
      const giMatch = GROSS_INCOME_KEY_PATTERN.exec(key);
      if (giMatch) {
        const parsed = parseIntegerCell(value);
        if (parsed === null) { malformed = true; break; }
        grossIncomeByYear[giMatch[1]] = parsed;
      }
    }
    if (malformed) continue;
    if (alphaText === null) continue;
    if (Object.keys(grossIncomeByYear).length === 0) continue;
    return { alphaText, grossIncomeByYear };
  }
  return null;
}

/** A decimal string as an exact rational. The caller has already
 * validated the shape with `isDecimalText`. */
function decimalToRational(text: string): { numerator: bigint; denominator: bigint } {
  const trimmed = text.trim();
  const negative = trimmed.startsWith('-');
  const unsigned = trimmed.replace(/^[+-]/, '');
  const [intPart, fracPart = ''] = unsigned.split('.');
  const denominator = 10n ** BigInt(fracPart.length);
  const numerator = BigInt(intPart || '0') * denominator + BigInt(fracPart || '0');
  return { numerator: negative ? -numerator : numerator, denominator };
}

/**
 * The BIA computation (the goal's own rule): years with negative
 * or zero gross income contribute zero to the numerator, while the
 * denominator remains the full number of years.
 *   capital = alpha × (sum of positive GI) / number of years
 */
export function computeBaselBia(inputs: BaselBiaInputs): BaselBiaResult {
  const years = Object.keys(inputs.grossIncomeByYear).sort();
  const numberOfYears = years.length;
  let positiveSum = 0n;
  const grossIncomeYears: Record<string, number> = {};
  for (const year of years) {
    const value = inputs.grossIncomeByYear[year];
    grossIncomeYears[year] = value;
    if (value > 0) positiveSum += BigInt(value);
  }
  const { numerator, denominator } = decimalToRational(inputs.alphaText);
  const capitalDenominator = denominator * BigInt(numberOfYears);
  const capitalNumerator = positiveSum * numerator;
  const capitalRounded = capitalNumerator % capitalDenominator !== 0n;
  // Half-up rounding on the absolute value, sign reapplied.
  const absNumerator = capitalNumerator < 0n ? -capitalNumerator : capitalNumerator;
  const roundedAbs = (2n * absNumerator + capitalDenominator) / (2n * capitalDenominator);
  const capital = capitalNumerator < 0n ? -roundedAbs : roundedAbs;
  return {
    alphaCoefficient: Number(inputs.alphaText),
    grossIncomeYears,
    positiveGiSumCny: Number(positiveSum),
    numberOfYears,
    averageAnnualGiCny: Number(positiveSum) / numberOfYears,
    orRegulatoryCapitalCny: Number(capital),
    capitalRounded,
  };
}

/**
 * Assembles `capital_calculation.json`: exactly the six fields the
 * output schema names, in the schema's order, as JSON numbers.
 */
export function assembleCapitalCalculationJson(result: BaselBiaResult): string {
  const report = {
    alpha_coefficient: result.alphaCoefficient,
    gross_income_years: result.grossIncomeYears,
    positive_gi_sum_cny: result.positiveGiSumCny,
    number_of_years: result.numberOfYears,
    average_annual_gi_cny: result.averageAnnualGiCny,
    or_regulatory_capital_cny: result.orRegulatoryCapitalCny,
  };
  return JSON.stringify(report, null, 2);
}

/** Convenience composition: set texts → assembled JSON, or null
 * when the set carries no readable BIA parameter table. */
export function assembleCapitalCalculationFromFiles(
  files: readonly { name: string; text: string }[],
): { inputs: BaselBiaInputs; result: BaselBiaResult; json: string } | null {
  const inputs = parseBaselBiaInputs(files);
  if (!inputs) return null;
  const result = computeBaselBia(inputs);
  return { inputs, result, json: assembleCapitalCalculationJson(result) };
}
