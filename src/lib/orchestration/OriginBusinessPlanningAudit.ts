import {
  ORIGIN_BUSINESS_PLANNING_EXECUTION_PLAN_KINDS,
  ORIGIN_BUSINESS_PLANNING_REQUIRED_PARTS,
  type OriginBusinessPlanningKind,
  type OriginBusinessPlanningProfile,
} from "./OriginBusinessPlanning.js";

// Deterministic numeric audit gate for business planning / marketing
// answers — stage 1: detection + shadow mode; stage 2: enforcement.
//
// Design canon: NUMERIC_AUDIT_GATE_DESIGN_2026-11-16.md. Two production
// measurements (2026-11-16, rounds 1 and 2) showed that strengthening the
// instruction does not make the model's arithmetic or part coverage
// reliable, so the finished answer is re-checked by deterministic code:
// explicit formulas are recomputed, itemised breakdowns are summed,
// funnel stage counts are multiplied by their stated rates, population
// shares are re-derived, and the required parts for the kind are checked
// for presence. No model call is made. In shadow mode (the default) the
// routers only log the result; the pure audit result is the single
// connection point the enforcement stage consumes.
//
// Stage 2 (enforcement) is selected per deployment with the env switch
// ORIGIN_BUSINESS_PLANNING_AUDIT_MODE=shadow|enforce (default shadow).
// Enforcement never calls a model and never invents content:
// - a FORMULA_RESULT_MISMATCH whose stated result sits unambiguously
//   next to its formula is replaced by the recomputed value, and the
//   fix is kept only when a full re-audit of the corrected text shows
//   the violation gone and no new violation created;
// - every violation that cannot be corrected that way (and every
//   structural gap: missing parts, unlabelled assumptions, missing
//   owner/deadline, a deadline date already in the past, mixed yen /
//   dollar amounts with no stated conversion) is disclosed to the user
//   in a plain-language note appended to the answer, instead of being
//   passed through silently.
// Regeneration and answer suppression (design options (a) and the
// 差し止め form) are deliberately not implemented: regeneration needs
// an extra model call, and suppressing a mostly sound answer would
// break it; the note is the warning step of the staged rollout.
//
// Violation details carry numbers and fixed vocabulary only (part names,
// stage names) — never excerpts of the answer text — so the audit logs
// hold no personal information.
//
// Premise-table extension (round 5, detection only): since the premise
// table (前提表) became a standard part of planning answers, the table
// itself is re-checked — the arithmetic stated in a row's basis cell is
// recomputed against the row's value cell (operands may be other rows,
// referenced by name), rows labelled as input facts are compared with
// the figures the request itself supplied, and a revenue goal that
// exceeds the table's own market-size estimate is recorded. Round 5
// showed the defect centre moving into the table (a basis formula
// contradicting its own value cell, a digit slip shrinking a funnel, a
// budget restated at 10x), which the line-based checks cannot reach.
// The new codes are never auto-corrected by the stage-2 fixer: which
// cell of a row is wrong cannot be decided deterministically.
//
// Monotonicity check (detection 12, 2026-11-20 — knowhow 案3,
// EXTERNAL_KNOWHOW_BUSINESS_DOCS_2026-11-19 §3): a direction sanity
// check over funnel (stage count, sub-1 rate) pairs, as an extension of
// the funnel check (detection 4). Dividing a downstream count by a
// rate below 1 must grow it, and multiplying an upstream count by a
// rate below 1 must shrink it; an inverted pair is therefore wrong no
// matter what the exact product is. This reaches the failure type B
// chain (a digit slip collapsing a funnel — round 5 BP-6: 商談 500
// backcast at 30% stated as SQL 167) in the shapes the exact checks
// cannot: a premise row whose basis is prose the formula scanner
// cannot evaluate, and a body pair whose product still falls inside
// detection 4's agreement band. The check is SHADOW-ONLY by
// construction: its code is deliberately absent from the stage-2
// disclosure note's numeric code set and from the formula fixer's
// scope, so even in enforce mode it never alters or annotates an
// answer; it exists to size the defect class in the shadow log before
// any enforcement decision (which needs the owner's separate approval,
// like every enforcement step of this gate).

export type OriginBusinessPlanningAuditViolationCode =
  | "FORMULA_RESULT_MISMATCH"
  | "TOTAL_SUM_MISMATCH"
  | "BREAKDOWN_SUM_MISMATCH"
  | "FUNNEL_RATE_MISMATCH"
  | "POPULATION_SHARE_MISMATCH"
  | "MIXED_CURRENCY"
  | "DEADLINE_PAST"
  | "REQUIRED_PART_MISSING"
  | "ASSUMPTION_LABELLING_MISSING"
  | "OWNER_MISSING"
  | "DEADLINE_MISSING"
  | "PREMISE_FORMULA_MISMATCH"
  | "PREMISE_INPUT_FACT_MISMATCH"
  | "PREMISE_ESTIMATE_GOAL_MISMATCH"
  | "MONOTONICITY_MISMATCH";

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
  currencyMixes: number;
  deadlineDates: number;
  premiseFormulas: number;
  premiseInputFacts: number;
  premiseEstimateGoals: number;
  monotonicityPairs: number;
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

/** Formula results stated as a percent need a tolerance in percentage
 * points, not in answer units: the shared half-unit floor of
 * numbersAgree (0.5) would wave through a stated 20% for a computed
 * 0.50 (round 3 BP-5: "1,500 ÷ 3,000" labelled 20%). Half a percentage
 * point (0.005) is the same half-unit rule expressed for rates, and
 * honest roundings (1/6 stated as 17%) stay inside it. */
function formulaResultsAgree(computed: number, stated: number, statedToken: NumToken): boolean {
  if (statedToken.dimension !== "ratio") return numbersAgree(computed, stated);
  if (!Number.isFinite(computed) || !Number.isFinite(stated)) return false;
  const diff = Math.abs(computed - stated);
  const scale = Math.max(Math.abs(computed), Math.abs(stated));
  return diff <= Math.max(0.005, scale * 0.02);
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
      if (!formulaResultsAgree(expr.computed, stated.value, stated)) {
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
// 6. Currency-mix check: a plan whose goal is stated in yen but whose
// derivation (a backcast line carrying a formula or a revenue keyword)
// runs in dollars, with no conversion basis anywhere in the answer,
// mixes two currencies that cannot be compared as stated (round 3
// BP-4: a ¥1,000,000 monthly ARR goal backed out as 200 × $500 =
// $100,000). A dollar figure that is merely mentioned (a tool price)
// never fires: a derivation line is required, and any conversion
// vocabulary (換算・為替・ドル円) suppresses the check entirely.
// ---------------------------------------------------------------------------

const CURRENCY_CONVERSION_RE = /(?:換算|為替|ドル円|円ドル)/;
const YEN_AMOUNT_RE = /\d[\d,]*\.?\d*\s*(?:億円|万円|千円|円)/g;
const DOLLAR_AMOUNT_RE = /\$\s*\d[\d,]*\.?\d*|\d[\d,]*\.?\d*\s*(?:ドル|USD)/g;
const DOLLAR_AMOUNT_PRESENT_RE = /\$\s*\d|\d[\d,]*\.?\d*\s*(?:ドル|USD)/;
const DERIVATION_LINE_RE = /(?:×|÷|=|＝|≈|ARR|売上|収益|合計|逆算|Backcast)/;

function checkCurrencyMix(text: string, violations: OriginBusinessPlanningAuditViolation[]): number {
  if (CURRENCY_CONVERSION_RE.test(text)) return 0;
  const yenAmounts = text.match(YEN_AMOUNT_RE)?.length ?? 0;
  const dollarAmounts = text.match(DOLLAR_AMOUNT_RE)?.length ?? 0;
  if (yenAmounts === 0 || dollarAmounts === 0) return 0;
  const derived = text
    .split("\n")
    .some((line) => DOLLAR_AMOUNT_PRESENT_RE.test(line) && DERIVATION_LINE_RE.test(line));
  if (!derived) return 0;
  violations.push({
    code: "MIXED_CURRENCY",
    detail: { yenAmounts, dollarAmounts },
  });
  return 1;
}

// ---------------------------------------------------------------------------
// 7. Past-deadline check: an explicit calendar date (YYYY年M月D日 or
// YYYY-MM-DD) on a deadline line (期限・締切・までに) that is already
// past cannot be a plan deadline (round 3 BP-2/BP-7 carried 2024–2025
// deadlines). The detector needs the current date, so it only runs
// when the caller supplies one; dates are compared as Asia/Tokyo
// calendar days, and a deadline of today is not past. Mentions of past
// dates without deadline context (a results report) never fire.
// ---------------------------------------------------------------------------

const FULL_DATE_RES: readonly RegExp[] = [
  /(\d{4})年(\d{1,2})月(\d{1,2})日/g,
  /(\d{4})[-/‐‑‒–—](\d{1,2})[-/‐‑‒–—](\d{1,2})/g,
];
const DEADLINE_CONTEXT_RE = /(?:期限|締切|デッドライン|までに|まで)/;

function jstCalendarDay(now: Date): readonly [number, number, number] {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return [jst.getUTCFullYear(), jst.getUTCMonth() + 1, jst.getUTCDate()];
}

function checkPastDeadlines(
  lines: readonly string[],
  now: Date,
  violations: OriginBusinessPlanningAuditViolation[],
): number {
  const [todayYear, todayMonth, todayDay] = jstCalendarDay(now);
  let examined = 0;
  const reported = new Set<string>();
  for (const line of lines) {
    if (!DEADLINE_CONTEXT_RE.test(line)) continue;
    for (const pattern of FULL_DATE_RES) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line)) !== null) {
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        if (month < 1 || month > 12 || day < 1 || day > 31) continue;
        examined += 1;
        const past =
          year < todayYear ||
          (year === todayYear && (month < todayMonth || (month === todayMonth && day < todayDay)));
        const key = `${year}-${month}-${day}`;
        if (past && !reported.has(key)) {
          reported.add(key);
          violations.push({ code: "DEADLINE_PAST", detail: { year, month, day } });
        }
      }
    }
  }
  return examined;
}

// ---------------------------------------------------------------------------
// 8. Required parts / assumption labelling / owner & deadline. Presence is
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
// a general noun mention ("担当者のフォローアップ"). Markdown emphasis
// between the keyword and its colon ("**担当**：…", the shape every
// round-3 execution plan used) is still the assignment form; without
// the emphasis allowance the round-3 BP-2 answer was a false positive.
const OWNER_ASSIGNMENT_RE = /(?:担当(?:者)?[\s*＊]*[：:]|担当は|責任者[\s*＊]*(?:[：:]|は)|を担当|担当部署)/;
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
// 9. Premise-table checks: the premise table （前提表） is located by its
// header （指標 / 値 / 単位 / 種別 / 根拠）, in pipe form or in the
// degraded space-separated form one round-5 answer used, and its rows
// are re-checked three ways (formula vs value, input-fact fidelity
// against the request, estimate vs goal). See the file header for why
// these are detection-only.
// ---------------------------------------------------------------------------

type PremiseKindClass = "input" | "computed" | "estimate" | "assumption" | "other";

interface PremiseValue {
  /** The number as written in the value cell, before unit scaling. */
  raw: number;
  /** Unit-normalised value (yen scaled, % as a ratio). */
  value: number;
  dimension: Dimension;
}

interface PremiseRow {
  name: string;
  kindClass: PremiseKindClass;
  basis: string;
  value: PremiseValue | null;
}

function classifyPremiseKind(kindCell: string): PremiseKindClass {
  if (kindCell.includes("入力事実")) return "input";
  if (kindCell.includes("計算結果")) return "computed";
  if (kindCell.includes("推定")) return "estimate";
  if (kindCell.includes("仮置き") || kindCell.includes("仮定")) return "assumption";
  return "other";
}

const PREMISE_VALUE_RE = /(\d[\d,]*\.?\d*)\s*(億円|万円|千円|円|億|万|％|%|件|社|人|校|名|店舗|回)?/;

/** A row's value is the first figure of its value cell, denominated by
 * the unit the value cell or the unit cell states ("800,000" + 円,
 * "100" + 万円, "50% (0.5)" + %). */
function parsePremiseValue(valueCell: string, unitCell: string): PremiseValue | null {
  const combined = `${valueCell.replace(/\*/g, "")} ${unitCell.replace(/\*/g, "")}`;
  const match = combined.match(PREMISE_VALUE_RE);
  if (!match) return null;
  const raw = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(raw)) return null;
  const unit = match[2];
  if (unit && unit in YEN_UNIT_VALUES) return { raw, value: raw * YEN_UNIT_VALUES[unit], dimension: "yen" };
  if (unit === "%" || unit === "％") return { raw, value: raw / 100, dimension: "ratio" };
  if (unit && (COUNT_UNITS.has(unit) || unit === "店")) return { raw, value: raw, dimension: "count" };
  return { raw, value: raw, dimension: "plain" };
}

interface PremiseColumns {
  name: number;
  value: number;
  unit: number;
  kind: number;
  basis: number;
}

function premiseColumnsOf(headerCells: readonly string[]): PremiseColumns | null {
  const find = (needle: string) => headerCells.findIndex((cell) => cell.includes(needle));
  const name = find("指標");
  const kind = find("種別");
  const value = find("値");
  if (name < 0 || kind < 0 || value < 0) return null;
  return { name, value, unit: find("単位"), kind, basis: find("根拠") };
}

function premiseRowFromCells(cells: readonly string[], columns: PremiseColumns): PremiseRow | null {
  const cell = (index: number) => (index >= 0 ? (cells[index] ?? "").trim() : "");
  const name = cell(columns.name).replace(/\*/g, "").trim();
  if (!name) return null;
  return {
    name,
    kindClass: classifyPremiseKind(cell(columns.kind)),
    basis: cell(columns.basis),
    value: parsePremiseValue(cell(columns.value), cell(columns.unit)),
  };
}

const TABLE_SEPARATOR_CELL_RE = /^:?-*:?$/;

function parsePremiseRows(lines: readonly string[]): PremiseRow[] {
  // Pipe form: the table whose header carries 指標 and 種別.
  for (const table of parseTables(lines)) {
    if (table.rows.length < 2) continue;
    const columns = premiseColumnsOf(table.rows[0]);
    if (!columns) continue;
    const rows: PremiseRow[] = [];
    for (const cells of table.rows.slice(1)) {
      if (cells.every((cell) => TABLE_SEPARATOR_CELL_RE.test(cell.trim()))) continue;
      const row = premiseRowFromCells(cells, columns);
      if (row) rows.push(row);
    }
    if (rows.length > 0) return rows;
  }
  // Degraded form (round 5 BP-5): no pipes and no heading — a header
  // line whose fields are separated by runs of spaces, followed by
  // rows in the same shape whose 種別 field classifies.
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*\|/.test(lines[i])) continue;
    const fields = lines[i].split(/\s{2,}/).map((field) => field.trim()).filter((field) => field.length > 0);
    if (fields.length < 5) continue;
    const columns = premiseColumnsOf(fields);
    if (!columns) continue;
    const rows: PremiseRow[] = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const rowFields = lines[j].split(/\s{2,}/).map((field) => field.trim()).filter((field) => field.length > 0);
      if (rowFields.length < 5) break;
      const row = premiseRowFromCells(rowFields, columns);
      if (!row || row.kindClass === "other") break;
      rows.push(row);
    }
    if (rows.length > 0) return rows;
  }
  return [];
}

// --- Arithmetic over a basis cell -----------------------------------------

interface EvaluatedExpression {
  value: number;
  dimension: Dimension;
}

type ExpressionToken =
  | { type: "num"; value: number; dimension: Dimension }
  | { type: "op"; op: "×" | "÷" | "+" | "-" }
  | { type: "open" }
  | { type: "close" };

const EXPRESSION_NUMBER_RE = /^(\d[\d,]*\.?\d*)\s*(億円|万円|千円|円|億|万|％|%|件|社|人|校|名|店舗|回)?/;

function readExpressionNumber(
  text: string,
  start: number,
): { value: number; dimension: Dimension; length: number } | null {
  const match = text.slice(start).match(EXPRESSION_NUMBER_RE);
  if (!match) return null;
  const raw = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(raw)) return null;
  const unit = match[2];
  let value = raw;
  let dimension: Dimension = "plain";
  if (unit && unit in YEN_UNIT_VALUES) {
    value = raw * YEN_UNIT_VALUES[unit];
    dimension = "yen";
  } else if (unit === "%" || unit === "％") {
    value = raw / 100;
    dimension = "ratio";
  } else if (unit && (COUNT_UNITS.has(unit) || unit === "店")) {
    dimension = "count";
  }
  return { value, dimension, length: match[0].length };
}

/** Tokenises a string that must be nothing but numbers, units,
 * operators and parentheses; any other character rejects it, so prose
 * is never mistaken for a formula. */
function tokenizeNumericExpression(text: string): ExpressionToken[] | null {
  const tokens: ExpressionToken[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === " " || ch === "　" || ch === "\t") { i += 1; continue; }
    if (ch === "(" || ch === "（") { tokens.push({ type: "open" }); i += 1; continue; }
    if (ch === ")" || ch === "）") { tokens.push({ type: "close" }); i += 1; continue; }
    if (ch === "×" || ch === "✕" || ch === "*") { tokens.push({ type: "op", op: "×" }); i += 1; continue; }
    if (ch === "÷" || ch === "/") { tokens.push({ type: "op", op: "÷" }); i += 1; continue; }
    if (ch === "+") { tokens.push({ type: "op", op: "+" }); i += 1; continue; }
    if (ch === "-" || ch === "−" || ch === "－") { tokens.push({ type: "op", op: "-" }); i += 1; continue; }
    if (ch >= "0" && ch <= "9") {
      const number = readExpressionNumber(text, i);
      if (!number) return null;
      tokens.push({ type: "num", value: number.value, dimension: number.dimension });
      i += number.length;
      continue;
    }
    return null;
  }
  return tokens;
}

function sumDimension(a: Dimension, b: Dimension): Dimension | null {
  if (a === b) return a;
  if (a === "plain") return b;
  if (b === "plain") return a;
  return null;
}

function evaluateExpressionTokens(tokens: readonly ExpressionToken[]): EvaluatedExpression | null {
  let pos = 0;
  const peek = () => tokens[pos];
  function parseFactor(): EvaluatedExpression | null {
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
  function parseTerm(): EvaluatedExpression | null {
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
  function parseExpression(): EvaluatedExpression | null {
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
  return result;
}

function evaluatePureNumericExpression(text: string): EvaluatedExpression | null {
  const tokens = tokenizeNumericExpression(text);
  if (!tokens || tokens.length === 0) return null;
  return evaluateExpressionTokens(tokens);
}

/** Rows are referenced from other rows' basis cells by name; the
 * registered keys are the full name and the name with a trailing
 * parenthesised qualifier stripped ("受注単価（平均）" → "受注単価",
 * "商談数（計算結果）" → "商談数"). Longest keys win at scan time. */
function buildPremiseNameIndex(rows: readonly PremiseRow[]): Map<string, PremiseRow> {
  const entries: [string, PremiseRow][] = [];
  for (const row of rows) {
    if (!row.value) continue;
    entries.push([row.name, row]);
    const stripped = row.name.replace(/[（(][^）)]*[）)]$/, "").trim();
    if (stripped && stripped !== row.name) entries.push([stripped, row]);
  }
  entries.sort((a, b) => b[0].length - a[0].length);
  const index = new Map<string, PremiseRow>();
  for (const [key, row] of entries) if (!index.has(key)) index.set(key, row);
  return index;
}

/** Scans a basis cell that names its operands ("商談目標 ÷ 0.30",
 * "受注目標 ÷ 商談→受注 コンバージョン率 (0.5)") into an evaluable
 * expression. A parenthesised group counts only when its content is a
 * self-contained numeric expression. An operand that directly follows
 * another operand is an annotation — the rate restated in parentheses,
 * or the worked example "(200 ÷ 0.5)" — never a second operand, and an
 * operator counts only between operands. */
function scanPremiseBasis(basis: string, nameIndex: Map<string, PremiseRow>): EvaluatedExpression | null {
  const items: ExpressionToken[] = [];
  let i = 0;
  while (i < basis.length) {
    const ch = basis[i];
    if (ch === " " || ch === "　" || ch === "\t") { i += 1; continue; }
    if (ch === "(" || ch === "（") {
      let depth = 0;
      let j = i;
      for (; j < basis.length; j += 1) {
        if (basis[j] === "(" || basis[j] === "（") depth += 1;
        else if (basis[j] === ")" || basis[j] === "）") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      if (j >= basis.length) return null;
      const inner = evaluatePureNumericExpression(basis.slice(i + 1, j));
      if (inner) items.push({ type: "num", value: inner.value, dimension: inner.dimension });
      i = j + 1;
      continue;
    }
    if (ch === "×" || ch === "✕" || ch === "*") { items.push({ type: "op", op: "×" }); i += 1; continue; }
    if (ch === "÷") { items.push({ type: "op", op: "÷" }); i += 1; continue; }
    if (ch === "+") { items.push({ type: "op", op: "+" }); i += 1; continue; }
    if (ch >= "0" && ch <= "9") {
      const number = readExpressionNumber(basis, i);
      if (!number) return null;
      items.push({ type: "num", value: number.value, dimension: number.dimension });
      i += number.length;
      continue;
    }
    let matched = false;
    for (const [name, row] of nameIndex) {
      if (row.value && basis.startsWith(name, i)) {
        items.push({ type: "num", value: row.value.value, dimension: row.value.dimension });
        i += name.length;
        matched = true;
        break;
      }
    }
    if (!matched) i += 1;
  }
  const reduced: ExpressionToken[] = [];
  for (const item of items) {
    const last = reduced[reduced.length - 1];
    if (item.type === "op") {
      if (last && last.type === "num") reduced.push(item);
    } else if (item.type === "num") {
      if (!last || last.type === "op") reduced.push(item);
    }
  }
  if (reduced.length > 0 && reduced[reduced.length - 1].type === "op") reduced.pop();
  if (!reduced.some((item) => item.type === "op")) return null;
  return evaluateExpressionTokens(reduced);
}

/** The arithmetic a row's basis states, when it states any: a literal
 * formula written after "=" ("… = 3,400 ÷ 0.02") wins; otherwise the
 * basis is scanned for named operands. A bare number after "=" is the
 * result restated, not a formula, and is skipped. */
function evaluatePremiseBasis(row: PremiseRow, nameIndex: Map<string, PremiseRow>): EvaluatedExpression | null {
  const basis = row.basis;
  if (!basis || basis === "-") return null;
  if (/[=＝]/.test(basis)) {
    for (const segment of basis.split(/[=＝]/).slice(1)) {
      const trimmed = segment.trim();
      if (!/\d/.test(trimmed) || !/[×÷+*/]/.test(trimmed)) continue;
      const evaluated = evaluatePureNumericExpression(trimmed);
      if (evaluated) return evaluated;
    }
  }
  return scanPremiseBasis(basis, nameIndex);
}

function checkPremiseFormulas(
  rows: readonly PremiseRow[],
  nameIndex: Map<string, PremiseRow>,
  violations: OriginBusinessPlanningAuditViolation[],
): number {
  let checked = 0;
  for (const row of rows) {
    if (!row.value) continue;
    const evaluated = evaluatePremiseBasis(row, nameIndex);
    if (!evaluated) continue;
    checked += 1;
    // A formula written without units is denominated in the value
    // cell's own unit, so it is compared with the figure as written;
    // a dimensioned formula is compared after unit normalisation.
    const stated = evaluated.dimension === "plain" ? row.value.raw : row.value.value;
    const statedToken: NumToken = { value: row.value.value, dimension: row.value.dimension, start: 0, end: 0 };
    const agrees =
      evaluated.dimension === "plain"
        ? numbersAgree(evaluated.value, stated)
        : formulaResultsAgree(evaluated.value, stated, statedToken);
    if (!agrees) {
      violations.push({
        code: "PREMISE_FORMULA_MISMATCH",
        detail: { computed: roundForDetail(evaluated.value), stated: roundForDetail(stated), dimension: evaluated.dimension },
      });
    }
  }
  return checked;
}

// --- Input-fact fidelity ----------------------------------------------------

function checkPremiseInputFacts(
  rows: readonly PremiseRow[],
  requestText: string,
  violations: OriginBusinessPlanningAuditViolation[],
): number {
  const briefTokens: NumToken[] = [];
  for (const line of normalizeAuditText(requestText).split("\n")) briefTokens.push(...tokenizeLine(line));
  let checked = 0;
  for (const row of rows) {
    if (row.kindClass !== "input" || !row.value) continue;
    checked += 1;
    const stated = row.value;
    const compatible = briefTokens.filter(
      (token) => stated.dimension === token.dimension || stated.dimension === "plain" || token.dimension === "plain",
    );
    if (compatible.some((token) => numbersAgree(stated.value, token.value))) continue;
    // A digit slip (10x / 1/10 against a figure the request did state)
    // is the round-5 BP-5 shape; it is reported with the brief's own
    // figure so the shadow log shows the size of the slip.
    const shifted = compatible.find((token) => {
      if (token.value === 0) return false;
      const ratio = stated.value / token.value;
      return numbersAgree(ratio, 10) || numbersAgree(ratio, 0.1);
    });
    if (shifted) {
      violations.push({
        code: "PREMISE_INPUT_FACT_MISMATCH",
        detail: {
          stated: roundForDetail(stated.value),
          briefValue: roundForDetail(shifted.value),
          factor: roundForDetail(stated.value / shifted.value),
          dimension: stated.dimension,
        },
      });
    } else {
      violations.push({
        code: "PREMISE_INPUT_FACT_MISMATCH",
        detail: { stated: roundForDetail(stated.value), dimension: stated.dimension },
      });
    }
  }
  return checked;
}

// --- Estimate vs goal -------------------------------------------------------

function checkPremiseEstimateGoal(
  rows: readonly PremiseRow[],
  violations: OriginBusinessPlanningAuditViolation[],
): number {
  const markets = rows.filter(
    (row) =>
      row.value?.dimension === "yen" &&
      row.name.includes("市場規模") &&
      (row.kindClass === "estimate" || row.name.includes("推定")),
  );
  const goals = rows.filter(
    (row) =>
      row.value?.dimension === "yen" &&
      row.name.includes("売上") &&
      (row.name.includes("目標") || row.name.includes("ゴール")) &&
      row.kindClass !== "estimate",
  );
  let checked = 0;
  for (const market of markets) {
    for (const goal of goals) {
      if (!market.value || !goal.value) continue;
      checked += 1;
      if (goal.value.value > market.value.value && !numbersAgree(goal.value.value, market.value.value)) {
        violations.push({
          code: "PREMISE_ESTIMATE_GOAL_MISMATCH",
          detail: {
            marketEstimate: roundForDetail(market.value.value),
            goalAmount: roundForDetail(goal.value.value),
          },
        });
      }
    }
  }
  return checked;
}

function checkPremiseTable(
  lines: readonly string[],
  requestText: string | undefined,
  violations: OriginBusinessPlanningAuditViolation[],
): { formulas: number; inputFacts: number; estimateGoals: number } {
  const rows = parsePremiseRows(lines);
  if (rows.length === 0) return { formulas: 0, inputFacts: 0, estimateGoals: 0 };
  const nameIndex = buildPremiseNameIndex(rows);
  return {
    formulas: checkPremiseFormulas(rows, nameIndex, violations),
    inputFacts: requestText ? checkPremiseInputFacts(rows, requestText, violations) : 0,
    estimateGoals: checkPremiseEstimateGoal(rows, violations),
  };
}

// ---------------------------------------------------------------------------
// 12. Monotonicity (direction sanity over funnel stage/rate pairs).
//
// Two surfaces, one rule: with a conversion rate below 1 between two
// funnel stages, the downstream count must be strictly smaller than the
// upstream count.
//
// - Premise table (direction "backcast"): the upstream stage's row is
//   derived by dividing the downstream count by the rate, so its value
//   must exceed the downstream row's value. The connecting rate comes
//   from a rate row named for the pair ("SQL→商談転換率"), or from a
//   sub-1 literal divisor stated in the upstream row's basis — the
//   second source is what lets the check fire when the basis is prose
//   the premise-formula scanner cannot evaluate (detection 9 silent).
//   Sensitivity rows are excluded: a sensitivity figure is the same
//   chain under a varied premise, not the stage's count (its value may
//   legitimately exceed the next stage's — round 5 BP-7).
// - Body (direction "forward"): the stated-rate pairs and stage counts
//   the funnel check already extracts. A pair is reported only when
//   detection 4 did not already flag it, so the new code measures
//   exactly the additive reach (a product inside the agreement band
//   whose direction is still inverted).
//
// Equal counts never fire: a stage pair stated at the same count (a
// 100%-ish handoff written without a rate, or a rounded small chain)
// is not a direction defect this check can prove.
// ---------------------------------------------------------------------------

/** Funnel stages in flow order, as premise-table rows name them. */
const FUNNEL_STAGE_ORDER = ["リーチ", "リード", "MQL", "SQL", "商談", "受注"] as const;

/** One premise row per funnel stage: the first count row whose name
 * carries the stage, excluding rate rows (name carries 率 or →) and
 * sensitivity rows (name carries 感度）. */
function premiseStageCountRows(rows: readonly PremiseRow[]): { stage: string; row: PremiseRow; count: number }[] {
  const found: { stage: string; row: PremiseRow; count: number }[] = [];
  for (const stage of FUNNEL_STAGE_ORDER) {
    const row = rows.find(
      (candidate) =>
        candidate.value?.dimension === "count" &&
        candidate.name.includes(stage) &&
        !candidate.name.includes("感度") &&
        !candidate.name.includes("→") &&
        !candidate.name.includes("率"),
    );
    if (row?.value) found.push({ stage, row, count: row.value.value });
  }
  return found;
}

/** The sub-1 rate a rate row assigns to the flow upstream → downstream
 * ("SQL→商談転換率" at 30%, or a plain decimal 0.30), or null. */
function premisePairRate(rows: readonly PremiseRow[], upstream: string, downstream: string): number | null {
  const pair = `${upstream}→${downstream}`;
  for (const row of rows) {
    if (!row.value || !row.name.includes(pair)) continue;
    if (!/(率|コンバージョン)/.test(row.name)) continue;
    if (row.value.dimension !== "ratio" && row.value.dimension !== "plain") continue;
    if (row.value.value > 0 && row.value.value < 1) return row.value.value;
  }
  return null;
}

/** The sub-1 rate an upstream row's basis divides by, when the divisor
 * is stated as a literal after the division sign ("商談目標 ÷ 0.30",
 * "= 34 ÷ 0.50", the "(0.5)" annotation after a rate name). An integer
 * divisor is a count, not a rate, and never qualifies. */
function premiseBasisDivisorRate(row: PremiseRow): number | null {
  const divAt = row.basis.search(/[÷/]/);
  if (divAt < 0) return null;
  const rest = row.basis.slice(divAt + 1);
  const percent = rest.match(/(\d+\.?\d*)\s*[%％]/);
  if (percent) {
    const rate = Number(percent[1]) / 100;
    if (rate > 0 && rate < 1) return rate;
  }
  for (const match of rest.matchAll(/\d+\.\d+/g)) {
    const value = Number(match[0]);
    if (value > 0 && value < 1) return value;
  }
  return null;
}

function checkMonotonicity(
  text: string,
  lines: readonly string[],
  violations: OriginBusinessPlanningAuditViolation[],
): number {
  let pairs = 0;
  const firedPairs = new Set<string>();
  const fire = (stageFrom: string, stageTo: string, rate: number, stageFromCount: number, stageToCount: number, direction: "backcast" | "forward") => {
    const key = `${stageFrom}->${stageTo}`;
    if (firedPairs.has(key)) return;
    firedPairs.add(key);
    violations.push({
      code: "MONOTONICITY_MISMATCH",
      detail: {
        stageFrom,
        stageTo,
        rate: roundForDetail(rate),
        stageFromCount,
        stageToCount,
        direction,
      },
    });
  };

  // Premise-table pairs: adjacent stages among the rows present.
  const rows = parsePremiseRows(lines);
  const stageRows = premiseStageCountRows(rows);
  for (let i = 0; i + 1 < stageRows.length; i += 1) {
    const upstream = stageRows[i];
    const downstream = stageRows[i + 1];
    if (!upstream || !downstream) continue;
    const rate = premisePairRate(rows, upstream.stage, downstream.stage) ?? premiseBasisDivisorRate(upstream.row);
    if (rate === null) continue;
    pairs += 1;
    if (downstream.count > upstream.count) {
      fire(upstream.stage, downstream.stage, rate, upstream.count, downstream.count, "backcast");
    }
  }

  // Body pairs: the funnel check's own extractions, additive only.
  const counts = extractStageCounts(text);
  for (const { from, to, rate } of extractStatedRates(lines)) {
    if (rate >= 1) continue;
    const input = counts.get(from);
    const output = counts.get(to);
    if (input === undefined || output === undefined) continue;
    pairs += 1;
    if (output <= input) continue;
    const alreadyFlagged = violations.some(
      (violation) => violation.code === "FUNNEL_RATE_MISMATCH" && violation.detail.stageFrom === from && violation.detail.stageTo === to,
    );
    if (alreadyFlagged) continue;
    fire(from, to, rate, input, output, "forward");
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Entry points.
// ---------------------------------------------------------------------------

export function auditOriginBusinessPlanningAnswer(
  profile: OriginBusinessPlanningProfile,
  answerText: string,
  options?: { now?: Date; requestText?: string },
): OriginBusinessPlanningAuditResult {
  const text = normalizeAuditText(answerText);
  const lines = text.split("\n");
  const violations: OriginBusinessPlanningAuditViolation[] = [];
  const formulas = checkFormulas(lines, violations);
  const totals = checkTotals(lines, text, violations);
  const breakdowns = checkBreakdowns(text, violations);
  const funnelRates = checkFunnel(text, lines, violations);
  const shares = checkPopulationShares(text, violations);
  const currencyMixes = checkCurrencyMix(text, violations);
  const deadlineDates = options?.now ? checkPastDeadlines(lines, options.now, violations) : 0;
  const premise = checkPremiseTable(lines, options?.requestText, violations);
  const monotonicityPairs = checkMonotonicity(text, lines, violations);
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
      currencyMixes,
      deadlineDates,
      premiseFormulas: premise.formulas,
      premiseInputFacts: premise.inputFacts,
      premiseEstimateGoals: premise.estimateGoals,
      monotonicityPairs,
      partsPresent: parts.present,
      partsRequired: parts.required,
    },
  };
}

/**
 * Shared shadow-log emission: the stage-1 log line, used verbatim by
 * both the shadow hook below and the gate's shadow branch, so the two
 * paths can never drift apart.
 */
function emitOriginBusinessPlanningAuditShadowLog(
  logger: (message: string, fields: Record<string, unknown>) => void,
  requestId: string,
  result: OriginBusinessPlanningAuditResult,
): void {
  logger("[origin-chat] business planning audit (shadow)", {
    requestId,
    kind: result.kind,
    violationCount: result.violations.length,
    violationCodes: [...new Set(result.violations.map((violation) => violation.code))],
    missingParts: result.violations
      .filter((violation) => violation.code === "REQUIRED_PART_MISSING")
      .map((violation) => String(violation.detail.part)),
    checks: result.checks,
  });
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
  requestText?: string;
  logger?: (message: string, fields: Record<string, unknown>) => void;
}): OriginBusinessPlanningAuditResult | null {
  if (!input.profile) return null;
  const logger = input.logger ?? ((message, fields) => console.info(message, fields));
  try {
    const result = auditOriginBusinessPlanningAnswer(input.profile, input.answerText, {
      requestText: input.requestText,
    });
    emitOriginBusinessPlanningAuditShadowLog(logger, input.requestId, result);
    return result;
  } catch (error) {
    logger("[origin-chat] business planning audit (shadow) failed", {
      requestId: input.requestId,
      auditError: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Stage 2: enforcement. Selected by ORIGIN_BUSINESS_PLANNING_AUDIT_MODE
// (default shadow). See the file header for the enforcement contract:
// deterministic formula fixes verified by re-audit, and a plain-language
// disclosure note for everything that cannot be corrected safely.
// ---------------------------------------------------------------------------

export type OriginBusinessPlanningAuditMode = "shadow" | "enforce";

export function resolveOriginBusinessPlanningAuditMode(
  env: NodeJS.ProcessEnv | undefined,
): OriginBusinessPlanningAuditMode {
  return env?.ORIGIN_BUSINESS_PLANNING_AUDIT_MODE === "enforce" ? "enforce" : "shadow";
}

/** Normalisation that never changes a line's length (full-width digits
 * and punctuation map one character to one character; the thousand
 * separator space-joining of normalizeAuditText is deliberately not
 * applied), so token spans computed on the result are valid spans of
 * the original line. */
function lengthPreservingNormalize(line: string): string {
  return line
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/％/g, "%")
    .replace(/[，、]/g, ",")
    .replace(/．/g, ".");
}

interface FormulaFixCandidate {
  lineIndex: number;
  start: number;
  end: number;
  replacement: string;
  violationKey: string;
}

function violationKey(violation: OriginBusinessPlanningAuditViolation): string {
  return `${violation.code}|${JSON.stringify(violation.detail)}`;
}

const SCALED_YEN_UNITS = new Set(["千円", "万円", "億円", "億", "万"]);
const BEFORE_FORMULA_GAPS = new Set(["", "（", "(", "：", ":", "=", "＝", "≈"]);
const RANGE_SUFFIX_RE = /^(?:以上|以下|未満|超|〜|~)/;

function formatFixedNumber(rendered: number, originalNumberText: string): string {
  let text =
    Math.abs(rendered - Math.round(rendered)) < 1e-9
      ? String(Math.round(rendered))
      : String(Math.round(rendered * 100) / 100);
  if (originalNumberText.includes(",")) {
    const [intPart, ...rest] = text.split(".");
    const grouped = String(Number(intPart)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    text = rest.length > 0 ? `${grouped}.${rest.join(".")}` : grouped;
  }
  return text;
}

/**
 * Finds the formula mismatches of the original audit that can be
 * corrected deterministically: the line carries exactly one formula,
 * its stated result sits immediately next to the formula (an explicit
 * "= N" after it, or the value the formula's parenthesis explains), the
 * audit flagged the same computed/stated pair, and the recomputed value
 * can be rendered in the stated value's own unit without guessing a
 * scale. Anything else is left for the disclosure note.
 */
function findFormulaFixCandidates(
  answerText: string,
  violations: readonly OriginBusinessPlanningAuditViolation[],
): FormulaFixCandidate[] {
  const formulaViolations = violations.filter((violation) => violation.code === "FORMULA_RESULT_MISMATCH");
  if (formulaViolations.length === 0) return [];
  const candidates: FormulaFixCandidate[] = [];
  const lines = answerText.split("\n");
  lines.forEach((originalLine, lineIndex) => {
    const line = lengthPreservingNormalize(originalLine);
    const tokens = tokenizeLine(line);
    if (tokens.length < 2) return;
    const expressions = findFormulas(line, tokens);
    if (expressions.length !== 1) return;
    const expr = expressions[0];
    const consumed = new Set<NumToken>(expr.tokens);
    // Resolution provenance: an explicit "= N" after the formula is
    // unambiguous; the closest-token fallback only counts when that
    // token directly precedes the formula (the value its parenthesis
    // explains, or "result = formula" order).
    let stated: NumToken | null = null;
    for (const token of tokens) {
      if (token.start < expr.end || consumed.has(token)) continue;
      const between = line.slice(expr.end, token.start).replace(/[\s*＊]/g, "");
      if (between === "=" || between === "＝" || between === "≈") stated = token;
      break;
    }
    if (!stated) {
      const closest = resolveStatedResult(line, expr, tokens, consumed);
      if (!closest || closest.end > expr.start) return;
      const gap = line.slice(closest.end, expr.start).replace(/[\s*＊]/g, "");
      if (!BEFORE_FORMULA_GAPS.has(gap)) return;
      stated = closest;
    }
    if (formulaResultsAgree(expr.computed, stated.value, stated)) return;
    const matched = formulaViolations.find(
      (violation) =>
        violation.detail.computed === roundForDetail(expr.computed) &&
        violation.detail.stated === roundForDetail(stated.value),
    );
    if (!matched) return;
    // The recomputed value must be renderable in the stated unit
    // without inventing a scale: a percent is replaced only by a rate,
    // a scaled yen unit (万円・億円) only by a value the formula itself
    // denominated in yen, and range/comparison suffixes (以上・〜)
    // change the claim's shape, so those are never rewritten.
    if (expr.computed < 0) return;
    if (stated.dimension === "ratio" && expr.computed > 1) return;
    if (!dimensionAccepts(expr.dimension, stated.dimension)) return;
    if (RANGE_SUFFIX_RE.test(originalLine.slice(stated.end))) return;
    const span = line.slice(stated.start, stated.end);
    const spanMatch = span.match(/^(\d[\d,]*\.?\d*)\s*(.*)$/);
    if (!spanMatch) return;
    const numberText = spanMatch[1];
    const unitText = spanMatch[2];
    if (SCALED_YEN_UNITS.has(unitText) && expr.dimension !== "yen") return;
    if (unitText === "円" && expr.dimension !== "yen" && expr.dimension !== "plain") return;
    let rendered: number;
    if (unitText === "%") rendered = expr.computed * 100;
    else if (unitText in YEN_UNIT_VALUES) rendered = expr.computed / YEN_UNIT_VALUES[unitText];
    else rendered = expr.computed;
    if (!Number.isFinite(rendered)) return;
    const suffix = originalLine.slice(stated.start, stated.end).slice(numberText.length);
    candidates.push({
      lineIndex,
      start: stated.start,
      end: stated.end,
      replacement: `${formatFixedNumber(rendered, numberText)}${suffix}`,
      violationKey: violationKey(matched),
    });
  });
  return candidates;
}

function applyFormulaFixCandidates(answerText: string, candidates: readonly FormulaFixCandidate[]): string {
  const lines = answerText.split("\n");
  for (const candidate of candidates) {
    const line = lines[candidate.lineIndex];
    lines[candidate.lineIndex] =
      line.slice(0, candidate.start) + candidate.replacement + line.slice(candidate.end);
  }
  return lines.join("\n");
}

/** A fix set is kept only when the re-audit of the corrected text is a
 * sub-multiset of the original violations minus the fixed ones: every
 * fixed violation is gone and no new violation appeared anywhere
 * (a corrected figure can feed another detector, e.g. a funnel input). */
function formulaFixesAreSafe(
  before: readonly OriginBusinessPlanningAuditViolation[],
  candidates: readonly FormulaFixCandidate[],
  after: readonly OriginBusinessPlanningAuditViolation[],
): boolean {
  const allowed = new Map<string, number>();
  for (const violation of before) {
    allowed.set(violationKey(violation), (allowed.get(violationKey(violation)) ?? 0) + 1);
  }
  for (const candidate of candidates) {
    const count = allowed.get(candidate.violationKey) ?? 0;
    if (count <= 0) return false;
    allowed.set(candidate.violationKey, count - 1);
  }
  for (const violation of after) {
    const count = allowed.get(violationKey(violation)) ?? 0;
    if (count <= 0) return false;
    allowed.set(violationKey(violation), count - 1);
  }
  return true;
}

const NUMERIC_VIOLATION_CODES: readonly OriginBusinessPlanningAuditViolationCode[] = [
  "FORMULA_RESULT_MISMATCH",
  "TOTAL_SUM_MISMATCH",
  "BREAKDOWN_SUM_MISMATCH",
  "FUNNEL_RATE_MISMATCH",
  "POPULATION_SHARE_MISMATCH",
  "PREMISE_FORMULA_MISMATCH",
  "PREMISE_INPUT_FACT_MISMATCH",
  "PREMISE_ESTIMATE_GOAL_MISMATCH",
];

function buildAuditDisclosureNote(
  remaining: readonly OriginBusinessPlanningAuditViolation[],
  fixedCount: number,
  language: "ja" | "en",
): { text: string; codes: OriginBusinessPlanningAuditViolationCode[] } | null {
  const sentences: { codes: OriginBusinessPlanningAuditViolationCode[]; text: string }[] = [];
  const present = (code: OriginBusinessPlanningAuditViolationCode) =>
    remaining.some((violation) => violation.code === code);
  if (fixedCount > 0) {
    sentences.push({
      codes: [],
      text:
        language === "ja"
          ? "数値の一部を、回答に記載された計算式に合わせて修正しました。"
          : "Some figures were corrected to match the calculations stated in the answer.",
    });
  }
  const numericPresent = NUMERIC_VIOLATION_CODES.filter(present);
  if (numericPresent.length > 0) {
    sentences.push({
      codes: numericPresent,
      text:
        language === "ja"
          ? "計算の記載と結果が一致していない数値があります。お使いになる前に、数値を確認してください。"
          : "Some figures do not match the calculations stated for them. Please check the numbers before using them.",
    });
  }
  if (present("MIXED_CURRENCY")) {
    sentences.push({
      codes: ["MIXED_CURRENCY"],
      text:
        language === "ja"
          ? "円とドルの金額が混ざっています。換算の前提が書かれていないため、そのままでは金額を比べられません。"
          : "Yen and dollar amounts are mixed, and no conversion basis is stated, so the amounts cannot be compared as they are.",
    });
  }
  const pastDeadlines = remaining.filter((violation) => violation.code === "DEADLINE_PAST");
  if (pastDeadlines.length > 0) {
    const dates = pastDeadlines
      .map((violation) => ({
        year: Number(violation.detail.year),
        month: Number(violation.detail.month),
        day: Number(violation.detail.day),
      }))
      .sort((a, b) => a.year - b.year || a.month - b.month || a.day - b.day);
    const shown = dates.slice(0, 2).map((date) =>
      language === "ja"
        ? `${date.year}年${date.month}月${date.day}日`
        : `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`,
    );
    const suffix = dates.length > shown.length ? (language === "ja" ? " など" : ", and others") : "";
    sentences.push({
      codes: ["DEADLINE_PAST"],
      text:
        language === "ja"
          ? `期限として、すでに過ぎた日付（${shown.join("、")}${suffix}）が含まれています。`
          : `A deadline date that has already passed (${shown.join(", ")}${suffix}) is included.`,
    });
  }
  const missingParts = [
    ...new Set(
      remaining
        .filter((violation) => violation.code === "REQUIRED_PART_MISSING")
        .map((violation) => String(violation.detail.part)),
    ),
  ];
  if (missingParts.length > 0) {
    sentences.push({
      codes: ["REQUIRED_PART_MISSING"],
      text:
        language === "ja"
          ? `この回答には${missingParts.map((part) => `「${part}」`).join("")}の項目が含まれていません。`
          : `This answer does not include the following required sections: ${missingParts.join(", ")}.`,
    });
  }
  if (present("ASSUMPTION_LABELLING_MISSING")) {
    sentences.push({
      codes: ["ASSUMPTION_LABELLING_MISSING"],
      text:
        language === "ja"
          ? "数値の一部は仮置き（仮定）ですが、その表示がありません。"
          : "Some figures are assumptions, but they are not labelled as such.",
    });
  }
  if (present("OWNER_MISSING")) {
    sentences.push({
      codes: ["OWNER_MISSING"],
      text: language === "ja" ? "担当の記載がありません。" : "No owner is assigned in the plan.",
    });
  }
  if (present("DEADLINE_MISSING")) {
    sentences.push({
      codes: ["DEADLINE_MISSING"],
      text: language === "ja" ? "期限の記載がありません。" : "No deadline is stated in the plan.",
    });
  }
  if (sentences.length === 0) return null;
  const header = language === "ja" ? "**自動チェックで気づいた点**" : "**Points found by an automatic check**";
  return {
    text: `\n\n---\n\n${header}\n${sentences.map((sentence) => `- ${sentence.text}`).join("\n")}`,
    codes: sentences.flatMap((sentence) => sentence.codes),
  };
}

export interface OriginBusinessPlanningAuditGateOutcome {
  mode: OriginBusinessPlanningAuditMode;
  /** The text to deliver: the original in shadow mode, the corrected
   * and/or note-appended text in enforce mode. */
  answerText: string;
  result: OriginBusinessPlanningAuditResult | null;
  fixedCount: number;
  notedCodes: readonly OriginBusinessPlanningAuditViolationCode[];
  remainingViolations: readonly OriginBusinessPlanningAuditViolation[];
}

/**
 * Router-facing gate for both modes. Shadow mode reproduces the
 * stage-1 behaviour exactly (audit + log, text untouched). Enforce
 * mode applies the deterministic formula fixes that survive a full
 * re-audit and appends the disclosure note for the rest. The gate is
 * isolated in a try/catch: any audit failure delivers the original
 * text, exactly as in shadow mode.
 */
export function applyOriginBusinessPlanningAuditGate(input: {
  requestId: string;
  profile: OriginBusinessPlanningProfile | null;
  answerText: string;
  requestText?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  language?: "ja" | "en";
  logger?: (message: string, fields: Record<string, unknown>) => void;
}): OriginBusinessPlanningAuditGateOutcome {
  const mode = resolveOriginBusinessPlanningAuditMode(input.env);
  const unchanged: OriginBusinessPlanningAuditGateOutcome = {
    mode,
    answerText: input.answerText,
    result: null,
    fixedCount: 0,
    notedCodes: [],
    remainingViolations: [],
  };
  if (!input.profile) return unchanged;
  const logger = input.logger ?? ((message, fields) => console.info(message, fields));
  try {
    const result = auditOriginBusinessPlanningAnswer(input.profile, input.answerText, {
      now: input.now,
      requestText: input.requestText,
    });
    if (mode === "shadow") {
      emitOriginBusinessPlanningAuditShadowLog(logger, input.requestId, result);
      return { ...unchanged, result, remainingViolations: result.violations };
    }
    let answerText = input.answerText;
    let remaining: readonly OriginBusinessPlanningAuditViolation[] = result.violations;
    let fixedCount = 0;
    const candidates = findFormulaFixCandidates(input.answerText, result.violations);
    if (candidates.length > 0) {
      const fixedText = applyFormulaFixCandidates(input.answerText, candidates);
      const after = auditOriginBusinessPlanningAnswer(input.profile, fixedText, {
        now: input.now,
        requestText: input.requestText,
      });
      if (formulaFixesAreSafe(result.violations, candidates, after.violations)) {
        answerText = fixedText;
        remaining = after.violations;
        fixedCount = candidates.length;
      }
    }
    const note = buildAuditDisclosureNote(remaining, fixedCount, input.language ?? "ja");
    if (note) answerText += note.text;
    logger("[origin-chat] business planning audit (enforce)", {
      requestId: input.requestId,
      kind: result.kind,
      mode,
      fixedCount,
      notedCodes: note?.codes ?? [],
      remainingViolationCount: remaining.length,
      remainingViolationCodes: [...new Set(remaining.map((violation) => violation.code))],
      checks: result.checks,
    });
    return {
      mode,
      answerText,
      result,
      fixedCount,
      notedCodes: note?.codes ?? [],
      remainingViolations: remaining,
    };
  } catch (error) {
    logger("[origin-chat] business planning audit (gate) failed", {
      requestId: input.requestId,
      auditError: error instanceof Error ? error.name : "UnknownError",
    });
    return unchanged;
  }
}
