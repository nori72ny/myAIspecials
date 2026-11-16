import {
  ORIGIN_BUSINESS_PLANNING_EXECUTION_PLAN_KINDS,
  ORIGIN_BUSINESS_PLANNING_REQUIRED_PARTS,
  type OriginBusinessPlanningKind,
  type OriginBusinessPlanningProfile,
} from "./OriginBusinessPlanning.js";

// Deterministic numeric audit gate for business planning / marketing
// answers — stage 1: detection + shadow mode.
//
// Design canon: NUMERIC_AUDIT_GATE_DESIGN_2026-11-16.md. Two production
// measurements (2026-11-16, rounds 1 and 2) showed that strengthening the
// instruction does not make the model's arithmetic or part coverage
// reliable, so the finished answer is re-checked by deterministic code:
// explicit formulas are recomputed, itemised breakdowns are summed,
// funnel stage counts are multiplied by their stated rates, population
// shares are re-derived, and the required parts for the kind are checked
// for presence. No model call is made and nothing here changes the
// delivered answer: the routers only log the result (shadow mode). The
// pure audit result is the single connection point a later enforcement
// stage consumes.
//
// Violation details carry numbers and fixed vocabulary only (part names,
// stage names) — never excerpts of the answer text — so the shadow log
// holds no personal information.

export type OriginBusinessPlanningAuditViolationCode =
  | "FORMULA_RESULT_MISMATCH"
  | "TOTAL_SUM_MISMATCH"
  | "BREAKDOWN_SUM_MISMATCH"
  | "FUNNEL_RATE_MISMATCH"
  | "POPULATION_SHARE_MISMATCH"
  | "REQUIRED_PART_MISSING"
  | "ASSUMPTION_LABELLING_MISSING"
  | "OWNER_MISSING"
  | "DEADLINE_MISSING";

export interface OriginBusinessPlanningAuditViolation {
  code: OriginBusinessPlanningAuditViolationCode;
  detail: Readonly<Record<string, string | number | readonly string[] | readonly number[]>>;
}

export interface OriginBusinessPlanningAuditChecks {
  formulas: number;
  totals: number;
  breakdowns: number;
  funnelRates: number;
  shares: number;
  partsPresent: number;
  partsRequired: number;
}

export interface OriginBusinessPlanningAuditResult {
  kind: OriginBusinessPlanningKind;
  violations: readonly OriginBusinessPlanningAuditViolation[];
  checks: OriginBusinessPlanningAuditChecks;
}

// ---------------------------------------------------------------------------
// Shared numeric text handling. Mirrors the figure-parsing conventions of
// OriginBusinessPlanning (full-width digits, yen units) so both modules
// read the same numbers the same way.
// ---------------------------------------------------------------------------

type Dimension = "yen" | "count" | "ratio" | "plain";

interface NumToken {
  value: number;
  dimension: Dimension;
  start: number;
  end: number;
}

const YEN_UNIT_VALUES: Record<string, number> = {
  "億円": 1e8,
  "万円": 1e4,
  "千円": 1e3,
  "円": 1,
  "億": 1e8,
  "万": 1e4,
};
const COUNT_UNITS = new Set(["件", "社", "人", "校", "名", "店舗", "回"]);
const NUM_TOKEN_RE = /(\d[\d,]*\.?\d*)\s*(億円|万円|千円|円|億|万|％|%|件|社|人|校|名|店舗|回)?/g;

function normalizeAuditText(text: string): string {
  return text
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/％/g, "%")
    .replace(/[，、]/g, ",")
    .replace(/．/g, ".")
    // Thousand separators written as spaces ("8 000 000") join back up.
    .replace(/(\d)[ \u2009\u202f](?=\d)/g, "$1");
}

function tokenizeLine(line: string): NumToken[] {
  const tokens: NumToken[] = [];
  NUM_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NUM_TOKEN_RE.exec(line)) !== null) {
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
    tokens.push({ value, dimension, start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

/** Rounded values agree when they are within rounding distance: the
 * answers round aggressively ("約", "≈"), so the gate allows a relative
 * 2% or an absolute half unit, whichever is larger. A digit slip (10x) or
 * a wrong-direction division is far outside this band. */
function numbersAgree(computed: number, stated: number): boolean {
  if (!Number.isFinite(computed) || !Number.isFinite(stated)) return false;
  const diff = Math.abs(computed - stated);
  const scale = Math.max(Math.abs(computed), Math.abs(stated));
  return diff <= Math.max(0.5, scale * 0.02);
}

function roundForDetail(value: number): number {
  return Math.round(value * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// 1. Formula check: a line's explicit arithmetic (numbers joined by × / ÷)
// is recomputed and compared with the result the same line states — after
// an equals sign, before a parenthesised formula, or in another cell of
// the same table row.
// ---------------------------------------------------------------------------

const OPERATOR_CHARS = new Set(["×", "÷", "*", "✕"]);

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

interface FormulaExpression {
  tokens: readonly NumToken[];
  computed: number;
  dimension: Dimension;
  start: number;
  end: number;
}

function findFormulas(line: string, tokens: readonly NumToken[]): FormulaExpression[] {
  const expressions: FormulaExpression[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    // An expression starts at a token that is not already the continuation
    // of a previous expression on this line.
    if (expressions.some((expr) => expr.tokens.includes(tokens[i]))) continue;
    const chain: NumToken[] = [tokens[i]];
    const ops: string[] = [];
    let cursor = i;
    for (;;) {
      const next = tokens[cursor + 1];
      if (!next) break;
      const between = line.slice(tokens[cursor].end, next.start);
      // Between two operands there must be exactly one operator; a short
      // word prefix on the next operand ("× 月額5万円") is allowed.
      const segment = between.match(/^\s*([×÷*✕])\s*[^\d×÷*|＝=≈]{0,5}$/);
      if (!segment || !OPERATOR_CHARS.has(segment[1])) break;
      ops.push(segment[1]);
      chain.push(next);
      cursor += 1;
    }
    if (ops.length === 0) continue;
    let value = chain[0].value;
    let dimension = chain[0].dimension;
    let valid = true;
    for (let k = 0; k < ops.length; k += 1) {
      const operand = chain[k + 1];
      if (ops[k] === "÷") {
        if (operand.value === 0) { valid = false; break; }
        value /= operand.value;
        dimension = divideDimension(dimension, operand.dimension);
      } else {
        value *= operand.value;
        dimension = multiplyDimension(dimension, operand.dimension);
      }
    }
    if (!valid || !Number.isFinite(value)) continue;
    expressions.push({
      tokens: chain,
      computed: value,
      dimension,
      start: chain[0].start,
      end: chain[chain.length - 1].end,
    });
    i = cursor;
  }
  return expressions;
}

function dimensionAccepts(computed: Dimension, candidate: Dimension): boolean {
  if (computed === "plain") return true;
  if (computed === "yen") return candidate === "yen";
  if (computed === "count") return candidate === "count" || candidate === "plain";
  return candidate === "ratio" || candidate === "plain";
}

function resolveStatedResult(
  line: string,
  expr: FormulaExpression,
  tokens: readonly NumToken[],
  consumed: ReadonlySet<NumToken>,
): NumToken | null {
  // (a) An explicit "= N" right after the expression wins. The gap may
  // carry markdown bold markers and spaces ("≈ **2,000件**").
  for (const token of tokens) {
    if (token.start < expr.end || consumed.has(token)) continue;
    const between = line.slice(expr.end, token.start).replace(/[\s*＊]/g, "");
    if (between === "=" || between === "＝" || between === "≈") return token;
    break;
  }
  // (b) Otherwise the closest unconsumed, dimension-compatible number on
  // the same line (the value a parenthesised formula explains, or the
  // result cell of the same table row). A percent equal to one of the
  // expression's own ratio operands is the rate being applied, never the
  // result, and is excluded.
  const ratioOperands = expr.tokens.filter((token) => token.dimension === "ratio").map((token) => token.value);
  let best: NumToken | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const token of tokens) {
    if (consumed.has(token) || !dimensionAccepts(expr.dimension, token.dimension)) continue;
    if (token.dimension === "ratio" && ratioOperands.some((operand) => numbersAgree(operand, token.value))) continue;
    const distance = token.end <= expr.start ? expr.start - token.end : token.start - expr.end;
    if (distance < bestDistance) {
      best = token;
      bestDistance = distance;
    }
  }
  return best;
}

function checkFormulas(lines: readonly string[], violations: OriginBusinessPlanningAuditViolation[]): number {
  let checked = 0;
  for (const line of lines) {
    const tokens = tokenizeLine(line);
    if (tokens.length < 2) continue;
    const expressions = findFormulas(line, tokens);
    if (expressions.length === 0) continue;
    const consumed = new Set<NumToken>();
    for (const expr of expressions) for (const token of expr.tokens) consumed.add(token);
    for (const expr of expressions) {
      const stated = resolveStatedResult(line, expr, tokens, consumed);
      if (!stated) continue;
      checked += 1;
      if (!numbersAgree(expr.computed, stated.value)) {
        violations.push({
          code: "FORMULA_RESULT_MISMATCH",
          detail: { computed: roundForDetail(expr.computed), stated: roundForDetail(stated.value), dimension: expr.dimension },
        });
      }
    }
  }
  return checked;
}

// ---------------------------------------------------------------------------
// 2. Total check: an explicit total (a 合計 row in a table, or a "合計：X"
// statement right after a table) must equal the sum of the itemised
// amounts in that table. Collection is scoped to the one table so prose
// repetitions of the same amounts are never double-counted.
// ---------------------------------------------------------------------------

interface TableBlock {
  startLine: number;
  endLine: number;
  rows: readonly (readonly string[])[];
}

function parseTables(lines: readonly string[]): TableBlock[] {
  const tables: TableBlock[] = [];
  let current: { startLine: number; rows: string[][] } | null = null;
  const flush = (endLine: number) => {
    if (current && current.rows.length > 0) {
      tables.push({ startLine: current.startLine, endLine, rows: current.rows });
    }
    current = null;
  };
  lines.forEach((line, index) => {
    if (/^\s*\|/.test(line)) {
      if (!current) current = { startLine: index, rows: [] };
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      current.rows.push(cells);
    } else {
      flush(index - 1);
    }
  });
  flush(lines.length - 1);
  return tables;
}

function firstTokenInCell(cell: string): NumToken | null {
  const tokens = tokenizeLine(cell.replace(/\*/g, ""));
  return tokens.length > 0 ? tokens[0] : null;
}

function sumTableColumn(table: TableBlock, column: number, dimension: Dimension, excludeRow: number): { sum: number; items: number } {
  let sum = 0;
  let items = 0;
  table.rows.forEach((row, rowIndex) => {
    if (rowIndex === excludeRow) return;
    const cell = row[column];
    if (cell === undefined) return;
    const token = firstTokenInCell(cell);
    if (token && token.dimension === dimension) {
      sum += token.value;
      items += 1;
    }
  });
  return { sum, items };
}

function checkTotals(
  lines: readonly string[],
  text: string,
  violations: OriginBusinessPlanningAuditViolation[],
): number {
  let checked = 0;
  const tables = parseTables(lines);
  const tablesWithOwnTotal = new Set<TableBlock>();
  // (a) A 合計 row inside the table.
  for (const table of tables) {
    for (let r = 0; r < table.rows.length; r += 1) {
      const row = table.rows[r];
      if (!row.some((cell) => cell.includes("合計"))) continue;
      for (let c = 0; c < row.length; c += 1) {
        const token = firstTokenInCell(row[c]);
        if (!token || (token.dimension !== "yen" && token.dimension !== "count")) continue;
        const { sum, items } = sumTableColumn(table, c, token.dimension, r);
        if (items < 2) continue;
        checked += 1;
        tablesWithOwnTotal.add(table);
        if (!numbersAgree(sum, token.value)) {
          violations.push({
            code: "TOTAL_SUM_MISMATCH",
            detail: { computedSum: roundForDetail(sum), statedTotal: roundForDetail(token.value), dimension: token.dimension },
          });
        }
      }
    }
  }
  // (b) A "合計：X" statement whose itemisation is the table right before it.
  const totalStatement = /(?:^|\n)[^\n]*?合計[：:]\s*約?\s*/g;
  let match: RegExpExecArray | null;
  while ((match = totalStatement.exec(text)) !== null) {
    const after = text.slice(match.index + match[0].length);
    const tokenMatch = after.match(/^(\d[\d,]*\.?\d*)\s*(億円|万円|千円|円|億|万|件|社|人|校|名|店舗|回)?/);
    if (!tokenMatch) continue;
    const totalKeywordIndex = match.index + match[0].indexOf("合計");
    const statementLine = text.slice(0, totalKeywordIndex).split("\n").length - 1;
    const table = [...tables].reverse().find((t) => t.endLine < statementLine && !tablesWithOwnTotal.has(t));
    if (!table) continue;
    const raw = Number(tokenMatch[1].replace(/,/g, ""));
    const unit = tokenMatch[2];
    const dimension: Dimension = unit && unit in YEN_UNIT_VALUES ? "yen" : unit ? "count" : "plain";
    const stated = unit && unit in YEN_UNIT_VALUES ? raw * YEN_UNIT_VALUES[unit] : raw;
    if (dimension === "plain") continue;
    // The amount column is the one (past the label column) where at least
    // two rows carry an amount of the same dimension.
    for (let c = 1; c < (table.rows[0]?.length ?? 0); c += 1) {
      const { sum, items } = sumTableColumn(table, c, dimension, -1);
      if (items < 2) continue;
      checked += 1;
      if (!numbersAgree(sum, stated)) {
        violations.push({
          code: "TOTAL_SUM_MISMATCH",
          detail: { computedSum: roundForDetail(sum), statedTotal: roundForDetail(stated), dimension },
        });
      }
      break;
    }
  }
  return checked;
}

// ---------------------------------------------------------------------------
// 3. Breakdown check: a channel/means list that itemises contributions to
// a stage must add up to the required count the answer itself states for
// that stage. Monthly figures are annualised when the answer works on a
// 12-month frame. Fewer than two contributions never fire.
// ---------------------------------------------------------------------------

const STAGE_ALIASES: Record<string, string> = {
  "リード": "リード",
  "商談": "商談",
  "受注": "受注",
  "成約": "受注",
  "購入": "受注",
};
const REQUIRED_COUNT_RE = /必要(?:な)?(リード|商談|受注|成約|購入)件?数(?:（[^）]*）)?[：:は]?\s*約?([\d,]+)\s*件/g;
const BREAKDOWN_CONTEXT_RE = /(?:獲得手段|チャネル|流入経路|獲得経路|集客経路)/;
const ANNUAL_COUNT_RE = /(?:年間|12か月で|1年で)\s*約?([\d,]+)\s*件/;
const MONTHLY_COUNT_RE = /月間\s*約?([\d,]+)\s*件/;

function checkBreakdowns(text: string, violations: OriginBusinessPlanningAuditViolation[]): number {
  let checked = 0;
  const required = new Map<string, number>();
  REQUIRED_COUNT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = REQUIRED_COUNT_RE.exec(text)) !== null) {
    const stage = STAGE_ALIASES[match[1]];
    if (stage && !required.has(stage)) required.set(stage, Number(match[2].replace(/,/g, "")));
  }
  if (required.size === 0) return 0;
  const blocks = text.split(/\n\s*\n/);
  for (const block of blocks) {
    if (!BREAKDOWN_CONTEXT_RE.test(block)) continue;
    for (const [stage, requiredCount] of required) {
      if (!block.includes(stage)) continue;
      const contributions: number[] = [];
      for (const line of block.split("\n")) {
        const annual = line.match(ANNUAL_COUNT_RE);
        if (annual) {
          contributions.push(Number(annual[1].replace(/,/g, "")));
          continue;
        }
        const monthly = line.match(MONTHLY_COUNT_RE);
        if (monthly && text.includes("12か月")) contributions.push(Number(monthly[1].replace(/,/g, "")) * 12);
      }
      if (contributions.length < 2) continue;
      checked += 1;
      const sum = contributions.reduce((acc, value) => acc + value, 0);
      if (!numbersAgree(sum, requiredCount)) {
        violations.push({
          code: "BREAKDOWN_SUM_MISMATCH",
          detail: { stage, computedSum: sum, statedTotal: requiredCount },
        });
      }
    }
  }
  return checked;
}

// ---------------------------------------------------------------------------
// 4. Funnel check: when a stage-to-stage rate is stated with its pair
// (「（リードから購入）」, an arrow pair, or the fixed named rates
// 成約率 = 商談→受注 / 商談化率 = リード→商談) and both stage counts are
// stated, input × rate must reproduce the output count. Aspirational
// rates ("引き上げる余地" etc.) are improvement talk, not the plan's
// operating rates, and are skipped; a missing stage count never fires.
// ---------------------------------------------------------------------------

const FUNNEL_STAGE_COUNT_PATTERNS: readonly ((text: string) => Map<string, number>)[] = [
  (text) => collectStageCounts(text, /必要(?:な)?(リード|商談|受注|成約|購入)件?数(?:（[^）]*）)?[：:は]?\s*約?([\d,]+)\s*件/g),
  (text) => collectStageCounts(text, /(リード|商談|受注|成約|購入)(?:獲得)?件?数[：:＝=]\s*約?([\d,]+)\s*件/g),
  (text) => collectStageCounts(text, /([\d,]+)\s*件の(リード|商談|受注|成約|購入)/g, true),
  (text) => collectStageCounts(text, /([\d,]+)\s*件(リード|商談|受注|成約|購入)/g, true),
  (text) => collectStageCounts(text, /(リード|商談|受注|成約|購入)[^。\n|]{0,10}?([\d,]+)\s*件/g),
];

function collectStageCounts(text: string, pattern: RegExp, valueFirst = false): Map<string, number> {
  const found = new Map<string, number>();
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    // A monthly flow figure ("月間250件のリード") is a per-month rate of
    // acquisition, not the stage's total count; value-first patterns skip
    // it so a channel bullet can never pose as the funnel total.
    if (valueFirst && /(?:月間|月)\s*$/.test(text.slice(0, match.index))) continue;
    const stage = STAGE_ALIASES[valueFirst ? match[2] : match[1]];
    const value = Number((valueFirst ? match[1] : match[2]).replace(/,/g, ""));
    if (stage && Number.isFinite(value) && !found.has(stage)) found.set(stage, value);
  }
  return found;
}

function extractStageCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const pattern of FUNNEL_STAGE_COUNT_PATTERNS) {
    for (const [stage, value] of pattern(text)) {
      if (!counts.has(stage)) counts.set(stage, value);
    }
  }
  return counts;
}

interface StatedRate {
  from: string;
  to: string;
  rate: number;
}

const ASPIRATIONAL_RATE_RE = /(?:引き上げ|向上させ|改善|高め|アップさせ|余地)/;
const EXPLICIT_PAIR_RE = /(リード|商談|受注|成約|購入|MQL|SQL)\s*から\s*(リード|商談|受注|成約|購入|MQL|SQL)/;
const ARROW_PAIR_RE = /(リード|商談|受注|成約|購入)\s*(?:→|->)\s*(リード|商談|受注|成約|購入)(?:への)?(?:転換率|率)?[^%\d]{0,16}?(\d+\.?\d*)\s*%/;
const NAMED_RATE_RES: readonly { pattern: RegExp; from: string; to: string }[] = [
  { pattern: /成約率\s*[：:は]?\s*約?\s*(\d+\.?\d*)\s*%/, from: "商談", to: "受注" },
  { pattern: /商談化率\s*[：:は]?\s*約?\s*(\d+\.?\d*)\s*%/, from: "リード", to: "商談" },
];

function extractStatedRates(lines: readonly string[]): StatedRate[] {
  const rates: StatedRate[] = [];
  const push = (from: string, to: string, rawPercent: number) => {
    const fromStage = STAGE_ALIASES[from] ?? from;
    const toStage = STAGE_ALIASES[to] ?? to;
    const rate = rawPercent / 100;
    if (rate <= 0 || rate > 1) return;
    if (!rates.some((r) => r.from === fromStage && r.to === toStage && r.rate === rate)) {
      rates.push({ from: fromStage, to: toStage, rate });
    }
  };
  for (const line of lines) {
    if (ASPIRATIONAL_RATE_RE.test(line)) continue;
    const pair = line.match(EXPLICIT_PAIR_RE);
    if (pair) {
      // The rate belonging to an explicit pair is the percent closest to
      // the pair label on the same line.
      const percents = [...line.matchAll(/(\d+\.?\d*)\s*%/g)];
      const labelIndex = pair.index ?? 0;
      let best: number | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const percent of percents) {
        const distance = Math.abs((percent.index ?? 0) - labelIndex);
        if (distance < bestDistance) {
          best = Number(percent[1]);
          bestDistance = distance;
        }
      }
      if (best !== null) push(pair[1], pair[2], best);
    }
    const arrow = line.match(ARROW_PAIR_RE);
    if (arrow) push(arrow[1], arrow[2], Number(arrow[3]));
    for (const named of NAMED_RATE_RES) {
      const namedMatch = line.match(named.pattern);
      if (namedMatch) push(named.from, named.to, Number(namedMatch[1]));
    }
  }
  return rates;
}

function checkFunnel(text: string, lines: readonly string[], violations: OriginBusinessPlanningAuditViolation[]): number {
  let checked = 0;
  const counts = extractStageCounts(text);
  if (counts.size < 2) return 0;
  for (const rate of extractStatedRates(lines)) {
    const input = counts.get(rate.from);
    const output = counts.get(rate.to);
    if (input === undefined || output === undefined) continue;
    checked += 1;
    const computed = input * rate.rate;
    if (!numbersAgree(computed, output)) {
      violations.push({
        code: "FUNNEL_RATE_MISMATCH",
        detail: {
          stageFrom: rate.from,
          stageTo: rate.to,
          rate: roundForDetail(rate.rate),
          inputCount: input,
          computedOutput: roundForDetail(computed),
          statedOutput: output,
        },
      });
    }
  }
  return checked;
}

// ---------------------------------------------------------------------------
// 5. Population share check: inside one block, a count explicitly marked
// as the population ("…を対象に"), a share percent, and a count explicitly
// presented as derived from that population ("潜在需要は…") must satisfy
// population × share (or its complement) = derived count.
// ---------------------------------------------------------------------------

const POPULATION_BASE_RE = /([\d,]+)\s*(件|社|人|校|名|店舗)(?:を対象に|を母数に|が全体|の総数)/;
const POPULATION_DERIVED_RE = /(?:潜在需要|需要|該当数|相当数)[はが]?\s*約?\s*([\d,]+)\s*(件|社|人|校|名|店舗)/;
const PERCENT_RE = /(\d+\.?\d*)\s*%/g;

function checkPopulationShares(text: string, violations: OriginBusinessPlanningAuditViolation[]): number {
  let checked = 0;
  for (const block of text.split(/\n\s*\n/)) {
    const base = block.match(POPULATION_BASE_RE);
    const derived = block.match(POPULATION_DERIVED_RE);
    if (!base || !derived || base[2] !== derived[2]) continue;
    const percents = [...block.matchAll(PERCENT_RE)].map((m) => Number(m[1]) / 100).filter((p) => p > 0 && p < 1);
    if (percents.length === 0) continue;
    checked += 1;
    const baseValue = Number(base[1].replace(/,/g, ""));
    const derivedValue = Number(derived[1].replace(/,/g, ""));
    const candidates = new Set<number>();
    for (const p of percents) {
      candidates.add(baseValue * p);
      candidates.add(baseValue * (1 - p));
    }
    if (![...candidates].some((candidate) => numbersAgree(candidate, derivedValue))) {
      violations.push({
        code: "POPULATION_SHARE_MISMATCH",
        detail: {
          base: baseValue,
          statedDerived: derivedValue,
          shares: [...new Set(percents.map(roundForDetail))],
        },
      });
    }
  }
  return checked;
}

// ---------------------------------------------------------------------------
// 6. Required parts / assumption labelling / owner & deadline. Presence is
// a deterministic heading-and-keyword match against the part vocabulary
// owned by OriginBusinessPlanning (the same lists the instruction renders
// as its checklist); it signals coverage, not substantive quality.
// ---------------------------------------------------------------------------

const PART_ALIASES: Record<string, readonly string[]> = {
  "目的とゴール": ["目的とゴール", "目的", "ゴール", "目標"],
  "対象": ["対象", "ターゲット", "ペルソナ", "ICP"],
  "提供価値": ["提供価値", "価値提案", "提供する価値"],
  "市場・競合の見立て": ["市場・競合の見立て", "市場", "競合"],
  "施策とチャネル": ["施策とチャネル", "施策", "チャネル", "獲得手段", "集客"],
  "数値の逆算": ["数値の逆算", "逆算", "必要な数値", "計算根拠", "数値の分解"],
  "KPIと計測方法": ["KPIと計測方法", "KPI", "計測", "測定"],
  "リスクと代替案": ["リスクと代替案", "リスク", "代替案"],
  "次の一手": ["次の一手", "次にやること", "次のステップ", "次のアクション"],
};

// An owner counts only in assignment form ("担当：…", "担当は…"), never as
// a general noun mention ("担当者のフォローアップ").
const OWNER_ASSIGNMENT_RE = /(?:担当(?:者)?\s*[：:]|担当は|責任者\s*[：:は]|を担当|担当部署)/;
const DEADLINE_RE = /(?:期限|締切|デッドライン|\d{1,2}月\d{1,2}日|\d+\s*(?:週間|か月|ヶ月|日)以内|(?:月末|週末|年末|年度末)まで)/;

function checkParts(
  kind: OriginBusinessPlanningKind,
  text: string,
  violations: OriginBusinessPlanningAuditViolation[],
): { present: number; required: number } {
  const parts = ORIGIN_BUSINESS_PLANNING_REQUIRED_PARTS[kind];
  const sections = parts.filter((part) => part !== "仮置き");
  let present = 0;
  for (const part of sections) {
    const aliases = PART_ALIASES[part] ?? [part];
    if (aliases.some((alias) => text.includes(alias))) {
      present += 1;
    } else {
      violations.push({ code: "REQUIRED_PART_MISSING", detail: { part } });
    }
  }
  if (parts.includes("仮置き") && !/(?:仮置き|仮定)/.test(text)) {
    violations.push({ code: "ASSUMPTION_LABELLING_MISSING", detail: { part: "仮置き" } });
  }
  if (ORIGIN_BUSINESS_PLANNING_EXECUTION_PLAN_KINDS.has(kind)) {
    if (!OWNER_ASSIGNMENT_RE.test(text)) violations.push({ code: "OWNER_MISSING", detail: {} });
    if (!DEADLINE_RE.test(text)) violations.push({ code: "DEADLINE_MISSING", detail: {} });
  }
  return { present, required: sections.length };
}

// ---------------------------------------------------------------------------
// Entry points.
// ---------------------------------------------------------------------------

export function auditOriginBusinessPlanningAnswer(
  profile: OriginBusinessPlanningProfile,
  answerText: string,
): OriginBusinessPlanningAuditResult {
  const text = normalizeAuditText(answerText);
  const lines = text.split("\n");
  const violations: OriginBusinessPlanningAuditViolation[] = [];
  const formulas = checkFormulas(lines, violations);
  const totals = checkTotals(lines, text, violations);
  const breakdowns = checkBreakdowns(text, violations);
  const funnelRates = checkFunnel(text, lines, violations);
  const shares = checkPopulationShares(text, violations);
  const parts = checkParts(profile.kind, text, violations);
  return {
    kind: profile.kind,
    violations,
    checks: {
      formulas,
      totals,
      breakdowns,
      funnelRates,
      shares,
      partsPresent: parts.present,
      partsRequired: parts.required,
    },
  };
}

/**
 * Shadow-mode hook for the chat routers: audits a finished planning
 * answer and records the outcome in the server log, in the same
 * structured style as the routers' other observability lines. The
 * delivered answer is never read back or altered, the audit is isolated
 * in a try/catch so it cannot affect delivery, and the log fields carry
 * codes, counts, and fixed part names only — no answer text.
 */
export function logOriginBusinessPlanningAuditShadow(input: {
  requestId: string;
  profile: OriginBusinessPlanningProfile | null;
  answerText: string;
  logger?: (message: string, fields: Record<string, unknown>) => void;
}): OriginBusinessPlanningAuditResult | null {
  if (!input.profile) return null;
  const logger = input.logger ?? ((message, fields) => console.info(message, fields));
  try {
    const result = auditOriginBusinessPlanningAnswer(input.profile, input.answerText);
    logger("[origin-chat] business planning audit (shadow)", {
      requestId: input.requestId,
      kind: result.kind,
      violationCount: result.violations.length,
      violationCodes: [...new Set(result.violations.map((violation) => violation.code))],
      missingParts: result.violations
        .filter((violation) => violation.code === "REQUIRED_PART_MISSING")
        .map((violation) => String(violation.detail.part)),
      checks: result.checks,
    });
    return result;
  } catch (error) {
    logger("[origin-chat] business planning audit (shadow) failed", {
      requestId: input.requestId,
      auditError: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  }
}
