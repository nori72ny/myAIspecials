/**
 * Multi-file deliverable support (failure diagnosis 2026-11-24,
 * 対策6).
 *
 * A goal may name several deliverable files; the single-file
 * specification (`extractAttachmentOutputFileSpec`) can only
 * express one `output/<name>.json|md`, so a goal naming three
 * files produced one title-derived document instead. The helpers
 * here are the pure core of the multi-file path:
 *
 * - `extractAttachmentOutputFileSpecs` lists the goal's
 *   deliverables (csv / json / txt / md) in the order named.
 * - `renderRowsCsvWithColumns` draws rows in a FIXED column
 *   order (the output schema's), unlike the rows renderer's
 *   first-seen order: a deliverable whose column order the
 *   schema fixes must not depend on which chunk reported first.
 * - `renderExecutionLog` generates the run log from the run's
 *   deterministic trace — the files inspected, the rules
 *   applied, the BIA steps with the actual numbers — never from
 *   model prose.
 *
 * Wiring lives in the planner (one document step per file), the
 * analyzer (the BIA inputs ride the final bundle) and the
 * document step's role assembly in the tool registry.
 */

import type { BaselBiaResult } from './agentBaselBia.js';

export type AttachmentOutputFileFormat = 'csv' | 'json' | 'txt' | 'markdown';

export type AttachmentOutputFileEntry = {
  filename: string;
  format: AttachmentOutputFileFormat;
};

/** The document-step role a deliverable file is assembled by
 * (対策6 layer 3). Carried as the step's `outputRole` param; the
 * registry assembles each role deterministically from the
 * analyzer bundle. */
export type AgentOutputRole = 'rows-csv' | 'capital-json' | 'execution-log';

const OUTPUT_FILENAME_PATTERN = /([A-Za-z0-9][A-Za-z0-9._-]*\.(csv|json|txt|md|markdown))\b/g;
const OUTPUT_SCHEMA_NAME_PATTERN = /\.schema\./i;
const REQUIRED_OUTPUTS_HEADING_PATTERN = /required outputs/i;
const MAX_OUTPUT_FILES = 4;
const MAX_OUTPUT_FILENAME_CHARS = 120;

/**
 * Lists a goal's deliverable files in the order the goal names
 * them. Unlike the single-file `extractAttachmentOutputFileSpec`
 * (json / md, `output/<name>` form only), this reads the bulleted
 * "Required Outputs" style as well and admits csv and txt. Two
 * exclusions keep input files out of the list: when the goal has
 * a "Required Outputs" section, only that section is scanned (the
 * inputs section names the set's files, schemas included), and
 * `*.schema.*` names are never deliverables — a schema is an
 * input even when an outputs item references it ("in the format
 * of execution_log.schema.txt"). The planner, not the detector,
 * decides which roles it can build; an unbuildable entry keeps
 * the multi-file mode off rather than being half-supported here.
 */
export function extractAttachmentOutputFileSpecs(goal: string): AttachmentOutputFileEntry[] {
  const normalized = goal.normalize('NFKC');
  const headingIndex = normalized.search(REQUIRED_OUTPUTS_HEADING_PATTERN);
  const scope = headingIndex >= 0 ? normalized.slice(headingIndex) : normalized;
  const entries: AttachmentOutputFileEntry[] = [];
  for (const match of scope.matchAll(OUTPUT_FILENAME_PATTERN)) {
    const filename = match[1];
    if (filename.length > MAX_OUTPUT_FILENAME_CHARS) continue;
    if (OUTPUT_SCHEMA_NAME_PATTERN.test(filename)) continue;
    if (entries.some((entry) => entry.filename === filename)) continue;
    const extension = match[2].toLowerCase();
    const format: AttachmentOutputFileFormat = extension === 'csv'
      ? 'csv'
      : extension === 'json'
        ? 'json'
        : extension === 'txt'
          ? 'txt'
          : 'markdown';
    entries.push({ filename, format });
    if (entries.length >= MAX_OUTPUT_FILES) break;
  }
  return entries;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Renders rows as CSV in a FIXED column order (the output
 * schema's). Cells a row does not carry render empty —
 * completeness is the coverage / required-columns gates'
 * judgment, not the renderer's.
 */
export function renderRowsCsvWithColumns(
  rows: readonly Record<string, string>[],
  columns: readonly string[],
): string {
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(row[column] ?? '')).join(','));
  }
  return lines.join('\n');
}

export type ExecutionLogFileProfile = {
  name: string;
  kind: string;
  rowCount?: number;
  charCount: number;
};

export type ExecutionLogInput = {
  /** The set's files as inspected (the reader's profile shape). */
  files: readonly ExecutionLogFileProfile[];
  /** The deliverable file names produced, in plan order. */
  outputs: readonly string[];
  /** Required output columns of the set's schema, when present. */
  requiredColumns?: readonly string[];
  /** The final bundle's coverage block, when recorded. */
  coverage?: { totalChunks: number; processedChunks: number; keyCount?: number; discardedRows?: number };
  /** The primary table's deterministic aggregates, when present. */
  aggregates?: Readonly<Record<string, { sum: number; count: number }>>;
  /** The BIA outcome, when the set carried a parameter table. */
  bia?: BaselBiaResult;
};

/**
 * Generates `execution_log.txt` from the run's deterministic
 * trace: the files inspected, the rules applied and — when a BIA
 * was assembled — its steps with the actual numbers. This is the
 * text the log's schema asks for ("Describe the files inspected,
 * rules applied, and BIA calculation steps"), produced from facts
 * the pipeline itself recorded; no model prose enters it.
 */
export function renderExecutionLog(input: ExecutionLogInput): string {
  const lines: string[] = ['Execution Log', ''];
  lines.push('Files inspected:');
  for (const file of input.files) {
    const detail = file.kind === 'table' && typeof file.rowCount === 'number'
      ? `table, ${file.rowCount} data row(s), ${file.charCount} char(s)`
      : `${file.kind}, ${file.charCount} char(s)`;
    lines.push(`- ${file.name}: ${detail}`);
  }
  lines.push('');
  lines.push('Rules applied:');
  lines.push('- One output row per input event, keyed by the primary table key; numeric columns copied verbatim from the input.');
  if (input.requiredColumns && input.requiredColumns.length > 0) {
    lines.push(`- Required output columns enforced: ${input.requiredColumns.join(', ')}.`);
  }
  if (input.coverage) {
    lines.push(`- Coverage verified deterministically: ${input.coverage.processedChunks}/${input.coverage.totalChunks} chunk(s) processed${typeof input.coverage.keyCount === 'number' ? `, ${input.coverage.keyCount} key(s)` : ''}.`);
  }
  if (input.aggregates) {
    for (const [column, aggregate] of Object.entries(input.aggregates)) {
      lines.push(`- Input aggregate ${column}: sum ${aggregate.sum} over ${aggregate.count} value(s).`);
    }
  }
  if (input.bia) {
    const bia = input.bia;
    lines.push('');
    lines.push('BIA calculation steps:');
    lines.push(`- Alpha coefficient: ${bia.alphaCoefficient}.`);
    for (const [year, value] of Object.entries(bia.grossIncomeYears)) {
      lines.push(`- Gross income ${year}: ${value} CNY${value > 0 ? '' : ' (non-positive: contributes 0 to the numerator, still counts in the denominator)'}.`);
    }
    lines.push(`- Positive gross income sum: ${bia.positiveGiSumCny} CNY over ${bia.numberOfYears} year(s).`);
    lines.push(`- Average annual gross income: ${bia.positiveGiSumCny} / ${bia.numberOfYears} = ${bia.averageAnnualGiCny} CNY.`);
    lines.push(`- OR regulatory capital: ${bia.alphaCoefficient} * ${bia.averageAnnualGiCny} = ${bia.orRegulatoryCapitalCny} CNY${bia.capitalRounded ? ' (rounded to the nearest integer)' : ''}.`);
  }
  lines.push('');
  lines.push(`Outputs written: ${input.outputs.join(', ')}.`);
  return lines.join('\n');
}
