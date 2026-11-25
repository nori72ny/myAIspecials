import type { OriginBusinessPlanningProfile } from "./OriginBusinessPlanning.js";

// Deterministic numeric verification over premise-table RECORDS —
// wave 2, stage 0 (shadow), detection only.
//
// Design canon: DOCUMENT_WAVE1_FIX_AND_WAVE2_DESIGN_2026-11-25.md
// （第2波・欠陥4) and the K-05 staged rollout (shadow → annotate →
// enforce; the annotate and enforce stages need the owner's separate
// approval and are NOT implemented here). The 2026-11-25 production
// re-measurement (DOCUMENTS_REMEASURE_2026-11-25.md) showed the routing
// defects fixed but the arithmetic defects remaining in the answers
// themselves: a percentage computed as 1.2% where the figures give
// ≈6.2%, a monthly figure restated as an annual total at 10x, a goal
// restated in the wrong unit （千円 for 万円）.
//
// Why a separate module from the scan gate (OriginBusinessPlanning
// Audit): the scan gate reads free text — it locates figures and
// formulas by tolerant scanning, so a formula's operands are guesses
// recovered from prose. The planning instruction already obliges the
// model to open with a premise table in one fixed format (columns
// 指標 / 値 / 単位 / 対象期間 / 種別 / 根拠； a 計算結果 row's 根拠 cell
// is its formula, whose operands are other rows referenced by name).
// This module parses ONLY that structure into records —
// { name, value, unit, period, kind, formula, source } — and runs
// four purely deterministic checks over the record set:
//
// 1. Formula vs value: a formula record's declared formula is
//    re-evaluated from the referenced records' values and compared
//    with the record's stated value (BP-2's self-contradicting basis,
//    BP-6's digit slip, the re-measurement's 1.2% percentage).
// 2. Input-fact fidelity, verbatim: an input-fact record's value must
//    appear in the request / materials figure set exactly, after
//    deterministic unit conversion only (the scan gate's 2% agreement
//    band is deliberately NOT applied — BP-5's 10x budget restatement
//    and the 千円/万円 unit swap are outside any honest rounding).
// 3. Estimate vs goal: a revenue goal above the table's own
//    market-size estimate is a violation unless a share premise is
//    stated explicitly (BP-3's 15x contradiction).
// 4. Unit / period consistency: a formula that mixes monthly and
//    annual figures, or tax-included and tax-excluded figures, with
//    no explicit conversion constant (×12 / ÷12, ×1.1) is a
//    violation. The scan gate has no counterpart for this check.
//
// Stage 0 contract: the checker never alters an answer and never
// calls a model ($0). The routers invoke the shadow hook at the same
// connection point as the numeric audit gate's shadow log — that log
// stream is the only thing the two modules share — and the hook logs
// counts, codes and fixed vocabulary only, never answer text or
// record names (record names are model-generated text, not fixed
// vocabulary).

export type OriginPremiseRecordKind =
  | "input"
  | "formula"
  | "estimate"
  | "goal"
  | "assumption"
  | "undetermined"
  | "other";

type Dimension = "yen" | "count" | "ratio" | "plain";

export interface OriginPremiseRecord {
  name: string;
  /** The figure as written in the value cell, before unit scaling. */
  rawValue: number | null;
  /** Unit-normalised value (yen scaled to 円, % as a ratio). */
  value: number | null;
  dimension: Dimension | null;
  /** The declared unit cell text ("円", "万円", "%", "件", ...). */
  unit: string;
  /** The 対象期間 cell text ("" when the column is absent). */
  period: string;
  kind: OriginPremiseRecordKind;
  /** 式: the 根拠 cell of a formula （計算結果） row; "" otherwise. */
  formula: string;
  /** 出典: the 根拠 cell of a non-formula row; "" when absent. */
  source: string;
}

export type OriginPremiseRecordsViolationCode =
  | "RECORD_FORMULA_MISMATCH"
  | "RECORD_INPUT_FACT_MISMATCH"
  | "RECORD_ESTIMATE_GOAL_MISMATCH"
  | "RECORD_UNIT_PERIOD_MISMATCH";

export interface OriginPremiseRecordsViolation {
  code: OriginPremiseRecordsViolationCode;
  detail: Readonly<Record<string, string | number>>;
}

export interface OriginPremiseRecordsChecks {
  records: number;
  formulasChecked: number;
  formulasUnevaluable: number;
  inputFactsChecked: number;
  estimateGoalPairs: number;
  unitPeriodRelations: number;
}

export interface OriginPremiseRecordsResult {
  records: readonly OriginPremiseRecord[];
  violations: readonly OriginPremiseRecordsViolation[];
  checks: OriginPremiseRecordsChecks;
}

// ---------------------------------------------------------------------------
// Numeric text handling. Mirrors the figure-parsing conventions of
// OriginBusinessPlanningAudit (full-width digits, yen units) so both
// modules read the same numbers the same way.
// ---------------------------------------------------------------------------

const YEN_UNIT_VALUES: Record<string, number> = {
  "億円": 1e8,
  "万円": 1e4,
  "千円": 1e3,
  "円": 1,
  "億": 1e8,
  "万": 1e4,
};
const COUNT_UNITS = new Set(["件", "社", "人", "校", "名", "店舗", "回", "店"]);
const NUM_TOKEN_RE = /(\d[\d,]*\.?\d*)\s*(億円|万円|千円|円|億|万|％|%|件|社|人|校|名|店舗|回|店)?/g;

function normalizeText(text: string): string {
  return text
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/％/g, "%")
    .replace(/[，、]/g, ",")
    .replace(/．/g, ".")
    .replace(/(\d)[ 　](?=\d)/g, "$1");
}

interface NumToken {
  value: number;
  dimension: Dimension;
}

function tokenizeFigures(text: string): NumToken[] {
  const tokens: NumToken[] = [];
  NUM_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NUM_TOKEN_RE.exec(text)) !== null) {
    const raw = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(raw)) continue;
    const unit = match[2];
    let value = raw;
    let dimension: Dimension = "plain";
    if (unit && unit in YEN_UNIT_VALUES) {
      value = raw * YEN_UNIT_VALUES[unit];
      dimension = "yen";
    } else if (unit === "%") {
      value = raw / 100;
      dimension = "ratio";
    } else if (unit && COUNT_UNITS.has(unit)) {
      dimension = "count";
    }
    tokens.push({ value, dimension });
  }
  return tokens;
}

/** Rounded values agree within rounding distance (relative 2% or an
 * absolute half unit) — the same band the scan gate uses for stated
 * formula results, where the answer's own rounding is legitimate. */
function numbersAgree(computed: number, stated: number): boolean {
  if (!Number.isFinite(computed) || !Number.isFinite(stated)) return false;
  const diff = Math.abs(computed - stated);
  const scale = Math.max(Math.abs(computed), Math.abs(stated));
  return diff <= Math.max(0.5, scale * 0.02);
}

/** Rate agreement in percentage points (half a point floor), mirroring
 * the scan gate's formulaResultsAgree for ratio-stated results. */
function ratesAgree(computed: number, stated: number): boolean {
  if (!Number.isFinite(computed) || !Number.isFinite(stated)) return false;
  const diff = Math.abs(computed - stated);
  const scale = Math.max(Math.abs(computed), Math.abs(stated));
  return diff <= Math.max(0.005, scale * 0.02);
}

/** Verbatim equality for input facts: exact after unit conversion,
 * with only float-representation slack (1e-6 relative). No rounding
 * band — a restated figure is either the same figure or a different
 * one. */
function valuesVerbatimEqual(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= Math.max(1e-9, scale * 1e-6);
}

function roundForDetail(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function multiplyDimension(a: Dimension, b: Dimension): Dimension {
  if (a === "ratio") return b;
  if (b === "ratio") return a;
  if (a === "yen" || b === "yen") return "yen";
  if (a === "count" || b === "count") return "count";
  return "plain";
}

function divideDimension(a: Dimension, b: Dimension): Dimension {
  if (b === "ratio") return a;
  if (a === b) return "plain";
  if (b === "plain") return a;
  return "plain";
}

function sumDimension(a: Dimension, b: Dimension): Dimension | null {
  if (a === b) return a;
  if (a === "plain") return b;
  if (b === "plain") return a;
  return null;
}

// ---------------------------------------------------------------------------
// Record parsing: only the fixed-format premise table (a pipe table
// whose header carries 指標 / 値 / 種別） is read, and only its cells.
// Free text, prose basis cells and degraded (pipe-less) layouts are
// the scan gate's surface, not this module's.
// ---------------------------------------------------------------------------

function classifyRecordKind(kindCell: string): OriginPremiseRecordKind {
  if (kindCell.includes("入力事実")) return "input";
  if (kindCell.includes("計算結果") || kindCell.trim() === "式") return "formula";
  if (kindCell.includes("推定")) return "estimate";
  if (kindCell.includes("ゴール") || kindCell.includes("目標")) return "goal";
  if (kindCell.includes("仮置き") || kindCell.includes("仮定")) return "assumption";
  if (kindCell.includes("未確定")) return "undetermined";
  return "other";
}

const RECORD_VALUE_RE = /(\d[\d,]*\.?\d*)\s*(億円|万円|千円|円|億|万|％|%|件|社|人|校|名|店舗|回|店)?/;

/** A record's value is the first figure of its value cell, denominated
 * by the unit the value cell or the unit cell states — the same
 * reading the scan gate's premise parser uses. */
function parseRecordValue(
  valueCell: string,
  unitCell: string,
): { raw: number; value: number; dimension: Dimension } | null {
  const combined = `${valueCell.replace(/\*/g, "")} ${unitCell.replace(/\*/g, "")}`;
  const match = combined.match(RECORD_VALUE_RE);
  if (!match) return null;
  const raw = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(raw)) return null;
  const unit = match[2];
  if (unit && unit in YEN_UNIT_VALUES) return { raw, value: raw * YEN_UNIT_VALUES[unit], dimension: "yen" };
  if (unit === "%") return { raw, value: raw / 100, dimension: "ratio" };
  if (unit && COUNT_UNITS.has(unit)) return { raw, value: raw, dimension: "count" };
  return { raw, value: raw, dimension: "plain" };
}

interface PremiseRecordColumns {
  name: number;
  value: number;
  unit: number;
  period: number;
  kind: number;
  basis: number;
}

function premiseRecordColumnsOf(headerCells: readonly string[]): PremiseRecordColumns | null {
  const find = (needle: string) => headerCells.findIndex((cell) => cell.includes(needle));
  const name = find("指標");
  const kind = find("種別");
  const value = find("値");
  if (name < 0 || kind < 0 || value < 0) return null;
  return { name, value, unit: find("単位"), period: find("期間"), kind, basis: find("根拠") };
}

const TABLE_SEPARATOR_CELL_RE = /^:?-*:?$/;

/** Groups consecutive pipe-led lines into tables of trimmed cells. */
function parsePipeTables(lines: readonly string[]): string[][][] {
  const tables: string[][][] = [];
  let current: string[][] = [];
  const flush = () => {
    if (current.length > 0) tables.push(current);
    current = [];
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      flush();
      continue;
    }
    const cells = trimmed.split("|").map((cell) => cell.trim());
    // Drop the empty artefacts of the leading/trailing pipe.
    if (cells.length > 0 && cells[0] === "") cells.shift();
    if (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
    current.push(cells);
  }
  flush();
  return tables;
}

export function parseOriginPremiseRecords(answerText: string): OriginPremiseRecord[] {
  const lines = normalizeText(answerText).split("\n");
  for (const table of parsePipeTables(lines)) {
    if (table.length < 2) continue;
    const columns = premiseRecordColumnsOf(table[0]);
    if (!columns) continue;
    const records: OriginPremiseRecord[] = [];
    for (const cells of table.slice(1)) {
      if (cells.every((cell) => TABLE_SEPARATOR_CELL_RE.test(cell))) continue;
      const cell = (index: number) => (index >= 0 ? (cells[index] ?? "").trim() : "");
      const name = cell(columns.name).replace(/\*/g, "").trim();
      if (!name) continue;
      const kind = classifyRecordKind(cell(columns.kind));
      const parsed = parseRecordValue(cell(columns.value), cell(columns.unit));
      const basis = cell(columns.basis).replace(/\*/g, "").trim();
      records.push({
        name,
        rawValue: parsed?.raw ?? null,
        value: parsed?.value ?? null,
        dimension: parsed?.dimension ?? null,
        unit: cell(columns.unit).replace(/\*/g, "").trim(),
        period: cell(columns.period).replace(/\*/g, "").trim(),
        kind,
        formula: kind === "formula" ? basis : "",
        source: kind === "formula" ? "" : basis,
      });
    }
    if (records.length > 0) return records;
  }
  return [];
}

// ---------------------------------------------------------------------------
// Strict formula evaluation over records. The grammar is the one the
// instruction mandates for a 計算結果 row's 根拠 cell: operands are
// other rows referenced by name, or numeric literals (constants only),
// joined by × ÷ + − with parentheses. A parenthesised group directly
// after an operand is the readability annotation the instruction
// allows ("… コンバージョン率 (0.5)") and is skipped. Anything else —
// prose, an unknown name, a reference to the row itself — makes the
// formula unevaluable, never guessed.
// ---------------------------------------------------------------------------

type FormulaToken =
  | { type: "num"; value: number; dimension: Dimension; record: OriginPremiseRecord | null }
  | { type: "op"; op: "×" | "÷" | "+" | "-" }
  | { type: "open" }
  | { type: "close" };

const FORMULA_NUMBER_RE = /^(\d[\d,]*\.?\d*)\s*(億円|万円|千円|円|億|万|％|%|件|社|人|校|名|店舗|回|店)?/;

function readFormulaNumber(
  text: string,
  start: number,
): { value: number; dimension: Dimension; length: number } | null {
  const match = text.slice(start).match(FORMULA_NUMBER_RE);
  if (!match) return null;
  const raw = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(raw)) return null;
  const unit = match[2];
  let value = raw;
  let dimension: Dimension = "plain";
  if (unit && unit in YEN_UNIT_VALUES) {
    value = raw * YEN_UNIT_VALUES[unit];
    dimension = "yen";
  } else if (unit === "%") {
    value = raw / 100;
    dimension = "ratio";
  } else if (unit && COUNT_UNITS.has(unit)) {
    dimension = "count";
  }
  return { value, dimension, length: match[0].length };
}

/** Name keys for one record: the full name and the name with a
 * trailing parenthesised qualifier stripped, as in the scan gate. */
function recordNameKeys(record: OriginPremiseRecord): string[] {
  const keys = [record.name];
  const stripped = record.name.replace(/[（(][^）)]*[）)]$/, "").trim();
  if (stripped && stripped !== record.name) keys.push(stripped);
  return keys;
}

function buildNameIndex(
  records: readonly OriginPremiseRecord[],
  exclude: OriginPremiseRecord,
): Map<string, OriginPremiseRecord> {
  const entries: [string, OriginPremiseRecord][] = [];
  for (const record of records) {
    if (record === exclude || record.value === null) continue;
    for (const key of recordNameKeys(record)) entries.push([key, record]);
  }
  entries.sort((a, b) => b[0].length - a[0].length);
  const index = new Map<string, OriginPremiseRecord>();
  for (const [key, record] of entries) if (!index.has(key)) index.set(key, record);
  return index;
}

function tokenizeFormula(formula: string, nameIndex: Map<string, OriginPremiseRecord>): FormulaToken[] | null {
  const tokens: FormulaToken[] = [];
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === " " || ch === "　" || ch === "\t") { i += 1; continue; }
    if (ch === "(" || ch === "（") {
      const last = tokens[tokens.length - 1];
      if (last && last.type === "num") {
        // Annotation after an operand: skip the balanced group.
        let depth = 0;
        let j = i;
        for (; j < formula.length; j += 1) {
          if (formula[j] === "(" || formula[j] === "（") depth += 1;
          else if (formula[j] === ")" || formula[j] === "）") {
            depth -= 1;
            if (depth === 0) break;
          }
        }
        if (j >= formula.length) return null;
        i = j + 1;
        continue;
      }
      tokens.push({ type: "open" });
      i += 1;
      continue;
    }
    if (ch === ")" || ch === "）") { tokens.push({ type: "close" }); i += 1; continue; }
    if (ch === "×" || ch === "✕" || ch === "*") { tokens.push({ type: "op", op: "×" }); i += 1; continue; }
    if (ch === "÷" || ch === "/") { tokens.push({ type: "op", op: "÷" }); i += 1; continue; }
    if (ch === "+") { tokens.push({ type: "op", op: "+" }); i += 1; continue; }
    if (ch === "-" || ch === "−" || ch === "－") { tokens.push({ type: "op", op: "-" }); i += 1; continue; }
    // A row reference wins over a numeric literal at the same
    // position: row names may themselves start with a digit
    // ("3年目売上"), and the instruction's grammar makes a formula's
    // operands row references first, constants second.
    let matched = false;
    for (const [name, record] of nameIndex) {
      if (formula.startsWith(name, i)) {
        tokens.push({
          type: "num",
          value: record.value as number,
          dimension: record.dimension as Dimension,
          record,
        });
        i += name.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    if (ch >= "0" && ch <= "9") {
      const number = readFormulaNumber(formula, i);
      if (!number) return null;
      tokens.push({ type: "num", value: number.value, dimension: number.dimension, record: null });
      i += number.length;
      continue;
    }
    return null;
  }
  return tokens;
}

interface EvaluatedFormula {
  value: number;
  dimension: Dimension;
  /** Numeric literals the formula itself carries (constants). */
  literals: readonly number[];
  /** Records the formula references, in order of appearance. */
  operands: readonly OriginPremiseRecord[];
}

function evaluateFormulaTokens(tokens: readonly FormulaToken[]): EvaluatedFormula | null {
  let pos = 0;
  const peek = () => tokens[pos];
  function parseFactor(): { value: number; dimension: Dimension } | null {
    const token = peek();
    if (!token) return null;
    if (token.type === "num") {
      pos += 1;
      return { value: token.value, dimension: token.dimension };
    }
    if (token.type === "open") {
      pos += 1;
      const inner = parseExpression();
      if (!inner || peek()?.type !== "close") return null;
      pos += 1;
      return inner;
    }
    return null;
  }
  function parseTerm(): { value: number; dimension: Dimension } | null {
    let left = parseFactor();
    if (!left) return null;
    for (;;) {
      const token = peek();
      if (!token || token.type !== "op" || (token.op !== "×" && token.op !== "÷")) return left;
      pos += 1;
      const right = parseFactor();
      if (!right) return null;
      if (token.op === "÷") {
        if (right.value === 0) return null;
        left = { value: left.value / right.value, dimension: divideDimension(left.dimension, right.dimension) };
      } else {
        left = { value: left.value * right.value, dimension: multiplyDimension(left.dimension, right.dimension) };
      }
    }
  }
  function parseExpression(): { value: number; dimension: Dimension } | null {
    let left = parseTerm();
    if (!left) return null;
    for (;;) {
      const token = peek();
      if (!token || token.type !== "op" || (token.op !== "+" && token.op !== "-")) return left;
      pos += 1;
      const right = parseTerm();
      if (!right) return null;
      const dimension = sumDimension(left.dimension, right.dimension);
      if (dimension === null) return null;
      left = { value: token.op === "+" ? left.value + right.value : left.value - right.value, dimension };
    }
  }
  const result = parseExpression();
  if (!result || pos !== tokens.length || !Number.isFinite(result.value)) return null;
  if (!tokens.some((token) => token.type === "op")) return null;
  return {
    value: result.value,
    dimension: result.dimension,
    literals: tokens
      .filter((token): token is Extract<FormulaToken, { type: "num" }> => token.type === "num" && token.record === null)
      .map((token) => token.value),
    operands: tokens
      .filter((token): token is Extract<FormulaToken, { type: "num" }> => token.type === "num" && token.record !== null)
      .map((token) => token.record as OriginPremiseRecord),
  };
}

/** Evaluates a formula record's declared formula. A cell that states
 * the formula and then "= <worked form>" (or the reverse) is tried
 * segment by segment around the equals sign; the first segment that
 * tokenises and evaluates wins. */
function evaluateRecordFormula(
  record: OriginPremiseRecord,
  records: readonly OriginPremiseRecord[],
): EvaluatedFormula | null {
  const cell = record.formula.trim();
  if (!cell || cell === "-") return null;
  const nameIndex = buildNameIndex(records, record);
  const segments = /[=＝]/.test(cell) ? cell.split(/[=＝]/).map((segment) => segment.trim()).filter(Boolean) : [cell];
  for (const segment of segments) {
    const tokens = tokenizeFormula(segment, nameIndex);
    if (!tokens || tokens.length === 0) continue;
    const evaluated = evaluateFormulaTokens(tokens);
    if (evaluated) return evaluated;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The four deterministic checks (design 第2波・欠陥4).
// ---------------------------------------------------------------------------

/** Whether a computed value agrees with a record's stated value. A
 * ratio-stated record is compared as a rate (percentage-point
 * tolerance); otherwise the computed value must agree with the stated
 * figure in either its as-written scale or its unit-normalised scale
 * (a formula written without units is denominated in the value cell's
 * own unit — the scan gate's convention). */
function computedAgreesWithRecord(computed: number, computedDimension: Dimension, record: OriginPremiseRecord): boolean {
  if (record.value === null || record.rawValue === null) return false;
  if (record.dimension === "ratio" && (computedDimension === "plain" || computedDimension === "ratio")) {
    return ratesAgree(computed, record.value);
  }
  return numbersAgree(computed, record.value) || numbersAgree(computed, record.rawValue);
}

type PeriodTag = "month" | "year";

function periodTagOf(record: OriginPremiseRecord): PeriodTag | null {
  const text = `${record.name} ${record.unit} ${record.period}`;
  if (/月額|月次|毎月|月あたり|\/月|／月/.test(text)) return "month";
  if (/年額|年次|毎年|年あたり|年間|\/年|／年/.test(text)) return "year";
  return null;
}

function taxTagOf(record: OriginPremiseRecord): "included" | "excluded" | null {
  const text = `${record.name} ${record.unit} ${record.source} ${record.formula}`;
  if (text.includes("税込")) return "included";
  if (text.includes("税抜") || text.includes("税別")) return "excluded";
  return null;
}

const PERIOD_CONVERSION_LITERAL = 12;
const TAX_CONVERSION_LITERAL = 1.1;

export function checkOriginPremiseRecords(input: {
  answerText: string;
  /** The figure sources input facts are checked against, verbatim:
   * the request text and any materials text. When absent or empty the
   * input-fact check is skipped, not guessed (the scan gate's rule). */
  sourceTexts?: readonly string[];
}): OriginPremiseRecordsResult {
  const records = parseOriginPremiseRecords(input.answerText);
  const violations: OriginPremiseRecordsViolation[] = [];
  let formulasChecked = 0;
  let formulasUnevaluable = 0;
  let inputFactsChecked = 0;
  let estimateGoalPairs = 0;
  let unitPeriodRelations = 0;

  // Checks 1 and 4 share one evaluation per formula record.
  for (const record of records) {
    if (record.kind !== "formula") continue;
    const evaluated = evaluateRecordFormula(record, records);
    if (!evaluated) {
      formulasUnevaluable += 1;
      continue;
    }
    formulasChecked += 1;
    // 1. Formula vs value.
    if (record.value !== null && !computedAgreesWithRecord(evaluated.value, evaluated.dimension, record)) {
      violations.push({
        code: "RECORD_FORMULA_MISMATCH",
        detail: {
          computed: roundForDetail(evaluated.value),
          stated: roundForDetail(record.value),
          dimension: evaluated.dimension,
        },
      });
    }
    // 4. Unit / period consistency inside this computation: the
    // records taking part (the formula's operands and the result
    // record itself) must not mix monthly with annual figures, or
    // tax-included with tax-excluded figures, unless the formula
    // states the conversion constant itself.
    const periodTags = new Set<PeriodTag>();
    for (const participant of [...evaluated.operands, record]) {
      const tag = periodTagOf(participant);
      if (tag) periodTags.add(tag);
    }
    const taxTags = new Set<string>();
    for (const participant of [...evaluated.operands, record]) {
      const tag = taxTagOf(participant);
      if (tag) taxTags.add(tag);
    }
    if (periodTags.size > 1 || taxTags.size > 1) {
      unitPeriodRelations += 1;
      if (periodTags.size > 1 && !evaluated.literals.some((literal) => valuesVerbatimEqual(literal, PERIOD_CONVERSION_LITERAL))) {
        violations.push({ code: "RECORD_UNIT_PERIOD_MISMATCH", detail: { axis: "period" } });
      }
      if (taxTags.size > 1 && !evaluated.literals.some((literal) => valuesVerbatimEqual(literal, TAX_CONVERSION_LITERAL))) {
        violations.push({ code: "RECORD_UNIT_PERIOD_MISMATCH", detail: { axis: "tax" } });
      }
    }
  }

  // 2. Input facts, verbatim against the request / materials figures.
  const sourceTexts = (input.sourceTexts ?? []).filter((text) => text && text.trim().length > 0);
  if (sourceTexts.length > 0) {
    const sourceTokens: NumToken[] = [];
    for (const text of sourceTexts) sourceTokens.push(...tokenizeFigures(normalizeText(text)));
    for (const record of records) {
      if (record.kind !== "input" || record.value === null || record.dimension === null) continue;
      inputFactsChecked += 1;
      const stated = record.value;
      const statedDimension = record.dimension;
      const compatible = sourceTokens.filter(
        (token) => statedDimension === token.dimension || statedDimension === "plain" || token.dimension === "plain",
      );
      if (compatible.some((token) => valuesVerbatimEqual(stated, token.value))) continue;
      // A digit slip (10x / 1/10 against a figure the source did
      // state) is reported with the source's own figure, so the
      // shadow log shows the size of the slip.
      const shifted = compatible.find((token) => {
        if (token.value === 0) return false;
        const ratio = stated / token.value;
        return valuesVerbatimEqual(ratio, 10) || valuesVerbatimEqual(ratio, 0.1);
      });
      if (shifted) {
        violations.push({
          code: "RECORD_INPUT_FACT_MISMATCH",
          detail: {
            stated: roundForDetail(stated),
            sourceValue: roundForDetail(shifted.value),
            factor: roundForDetail(stated / shifted.value),
            dimension: statedDimension,
          },
        });
      } else {
        violations.push({
          code: "RECORD_INPUT_FACT_MISMATCH",
          detail: { stated: roundForDetail(stated), dimension: statedDimension },
        });
      }
    }
  }

  // 3. Estimate vs goal: a revenue goal above the table's own
  // market-size estimate needs an explicit share premise.
  const markets = records.filter(
    (record) => record.dimension === "yen" && record.kind === "estimate" && record.name.includes("市場規模"),
  );
  const goals = records.filter(
    (record) =>
      record.dimension === "yen" &&
      record.kind !== "estimate" &&
      (record.kind === "goal" || (record.name.includes("売上") && (record.name.includes("目標") || record.name.includes("ゴール")))),
  );
  const sharePremiseStated =
    records.some((record) => record.name.includes("シェア") || record.name.includes("占有率")) ||
    goals.some((goal) => goal.source.includes("シェア") || goal.formula.includes("シェア"));
  for (const market of markets) {
    for (const goal of goals) {
      if (market.value === null || goal.value === null) continue;
      estimateGoalPairs += 1;
      if (goal.value > market.value && !numbersAgree(goal.value, market.value) && !sharePremiseStated) {
        violations.push({
          code: "RECORD_ESTIMATE_GOAL_MISMATCH",
          detail: {
            marketEstimate: roundForDetail(market.value),
            goalAmount: roundForDetail(goal.value),
          },
        });
      }
    }
  }

  return {
    records,
    violations,
    checks: {
      records: records.length,
      formulasChecked,
      formulasUnevaluable,
      inputFactsChecked,
      estimateGoalPairs,
      unitPeriodRelations,
    },
  };
}

// ---------------------------------------------------------------------------
// Stage 0 (shadow) router hook. Invoked at the same connection point
// as the numeric audit gate's shadow log; audits the finished answer
// and records the outcome in the server log. The delivered answer is
// never read back or altered, the check is isolated in a try/catch so
// it cannot affect delivery, and the log fields carry codes, counts
// and fixed vocabulary only — no answer text, no record names.
// ---------------------------------------------------------------------------

export function logOriginBusinessPlanningPremiseRecordsShadow(input: {
  requestId: string;
  profile: OriginBusinessPlanningProfile | null;
  answerText: string;
  requestText?: string;
  logger?: (message: string, fields: Record<string, unknown>) => void;
}): OriginPremiseRecordsResult | null {
  if (!input.profile) return null;
  const logger = input.logger ?? ((message, fields) => console.info(message, fields));
  try {
    const result = checkOriginPremiseRecords({
      answerText: input.answerText,
      sourceTexts: input.requestText ? [input.requestText] : [],
    });
    logger("[origin-chat] business planning premise records (shadow)", {
      requestId: input.requestId,
      kind: input.profile.kind,
      recordCount: result.checks.records,
      violationCount: result.violations.length,
      violationCodes: [...new Set(result.violations.map((violation) => violation.code))],
      checks: result.checks,
    });
    return result;
  } catch (error) {
    logger("[origin-chat] business planning premise records (shadow) failed", {
      requestId: input.requestId,
      auditError: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  }
}
