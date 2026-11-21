/**
 * Deterministic data layer for agent attachment steps (agent
 * file-input foundation, F2; design AGENT_FILE_INPUT_DESIGN_2026-11-18
 * §3.2, §3.3, §3.5, §4.1).
 *
 * Everything in this module is a pure function of the attachment
 * texts: the reader tool, the analyzer tool and the /plan handler all
 * derive the same profile, the same chunk list and the same expected
 * key set from the same input, so the coverage verification compares
 * the model's output against exactly the yardstick the reader
 * published — never against a second, divergent computation. No model
 * is consulted here and nothing is logged; file bodies flow through
 * these functions only inside the server.
 *
 * Chunking (design §4.1): at most 3,500 chars of data per chunk,
 * boundaries on row / paragraph breaks only. A single row or paragraph
 * longer than the cap forms its own chunk whole — a line is never cut
 * in the middle to satisfy the cap, because a cut row is a lost row
 * for coverage purposes.
 */

export const AGENT_ATTACHMENT_CHUNK_MAX_CHARS = 3_500;
export const AGENT_ATTACHMENT_MAX_CHUNKS_PER_STEP = 8;
export const AGENT_ATTACHMENT_MAX_CHUNKS_PER_RUN = 48;
/** Goal-derived analyzer instruction cap (design §3.3): the fixed
 * template plus this stays within the 1,700-char instruction pin. */
export const AGENT_ATTACHMENT_INSTRUCTION_MAX_CHARS = 800;
export const AGENT_ATTACHMENT_INSTRUCTION_TOTAL_MAX_CHARS = 1_700;

export type AgentAttachmentDataInput = { name: string; text: string };

export type AgentDataFileProfile = {
  name: string;
  kind: 'table' | 'prose';
  charCount: number;
  /** Table files: header cells, data-row count, and the detected key /
   * numeric columns. Prose files carry none of these. */
  header?: string[];
  rowCount?: number;
  keyColumn?: string;
  numericColumns?: string[];
};

export type AgentDataChunk = {
  /** Global chunk index across the whole set, in file order. */
  index: number;
  fileName: string;
  text: string;
};

export type AgentDataAggregate = { sum: number; count: number; mean: number };

export interface AgentAttachmentDataView {
  files: AgentDataFileProfile[];
  chunks: AgentDataChunk[];
  totalChunks: number;
  /**
   * The coverage yardstick for `rows` output: the field name every
   * output row must carry (`keyField`) and the exact set of values it
   * must cover once each (`expectedKeys`). Sourced from the primary
   * table file's key column when one exists; otherwise each file is
   * one item and the key is the file name.
   */
  keyField: string;
  expectedKeys: string[];
  /** Numeric columns of the primary table (the key-bearing one, else
   * the first table), with aggregates recomputed from the input. */
  numericColumns: string[];
  aggregates: Readonly<Record<string, AgentDataAggregate>>;
}

type ParsedTable = {
  header: string[];
  /** Raw lines (header excluded), kept verbatim for chunking. */
  rowLines: string[];
  /** Trimmed cell values per data row, for key/numeric detection. */
  rows: string[][];
  delimiter: string;
};

function parseNumericCell(raw: string): number | null {
  const cleaned = raw.replace(/[\s,¥円%]/g, '');
  if (!cleaned || !/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Table detection (design §3.2): the delimiter comes from the first
 * non-empty line; the file is a table when at least two non-empty
 * lines remain and (almost) every line splits into the header's
 * column count (≥2). Cell splitting is deliberately naive (no quote
 * awareness): a quoted CSV whose cells contain delimiters fails the
 * column-consistency check and is treated as prose rather than being
 * misparsed into a wrong table.
 */
function parseTable(text: string): ParsedTable | null {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return null;
  const first = lines[0];
  const delimiter = first.includes('\t') ? '\t' : first.includes(',') ? ',' : null;
  if (!delimiter) return null;
  const split = (line: string) => line.split(delimiter).map((cell) => cell.trim());
  const header = split(first);
  if (header.length < 2) return null;
  const rows = lines.slice(1).map(split);
  const consistent = rows.filter((row) => row.length === header.length).length;
  if (consistent < Math.ceil(rows.length * 0.9)) return null;
  const keptRows = rows.filter((row) => row.length === header.length);
  const keptLines = lines.slice(1).filter((_, index) => rows[index].length === header.length);
  return { header, rowLines: keptLines, rows: keptRows, delimiter };
}

function detectKeyColumn(table: ParsedTable): { index: number; name: string } | null {
  for (let column = 0; column < table.header.length; column += 1) {
    const values = table.rows.map((row) => row[column]);
    if (values.length === 0) continue;
    if (values.some((value) => value.length === 0)) continue;
    if (new Set(values).size !== values.length) continue;
    return { index: column, name: table.header[column] || `column-${column + 1}` };
  }
  return null;
}

function detectNumericColumns(table: ParsedTable): string[] {
  const numeric: string[] = [];
  for (let column = 0; column < table.header.length; column += 1) {
    if (table.rows.length === 0) break;
    if (table.rows.every((row) => parseNumericCell(row[column]) !== null)) {
      numeric.push(table.header[column] || `column-${column + 1}`);
    }
  }
  return numeric;
}

function chunkTable(name: string, table: ParsedTable, startIndex: number): AgentDataChunk[] {
  const headerLine = table.rowLines.length > 0
    ? tableHeaderLine(table)
    : '';
  const chunks: AgentDataChunk[] = [];
  let current: string[] = [];
  let currentChars = 0;
  const flush = () => {
    if (current.length === 0) return;
    chunks.push({ index: startIndex + chunks.length, fileName: name, text: [headerLine, ...current].join('\n') });
    current = [];
    currentChars = 0;
  };
  for (const line of table.rowLines) {
    let projected = currentChars + (current.length > 0 ? 1 : 0) + line.length;
    if (current.length > 0 && headerLine.length + 1 + projected > AGENT_ATTACHMENT_CHUNK_MAX_CHARS) {
      flush();
      // The projection was computed against the flushed chunk; the
      // fresh chunk starts from this line alone.
      projected = line.length;
    }
    current.push(line);
    currentChars = projected;
  }
  flush();
  return chunks;
}

function tableHeaderLine(table: ParsedTable): string {
  return table.header.join(table.delimiter);
}

function chunkProse(name: string, text: string, startIndex: number): AgentDataChunk[] {
  const paragraphs = text.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter((paragraph) => paragraph.length > 0);
  const units = paragraphs.length > 0 ? paragraphs : [text.trim()].filter((value) => value.length > 0);
  const chunks: AgentDataChunk[] = [];
  let current: string[] = [];
  let currentChars = 0;
  const flush = () => {
    if (current.length === 0) return;
    chunks.push({ index: startIndex + chunks.length, fileName: name, text: current.join('\n\n') });
    current = [];
    currentChars = 0;
  };
  for (const unit of units) {
    let projected = currentChars + (current.length > 0 ? 2 : 0) + unit.length;
    if (current.length > 0 && projected > AGENT_ATTACHMENT_CHUNK_MAX_CHARS) {
      flush();
      projected = unit.length;
    }
    current.push(unit);
    currentChars = projected;
  }
  flush();
  return chunks;
}

/**
 * Builds the full deterministic view of a set's texts: per-file
 * profiles, the global chunk list, the coverage yardstick and the
 * locally recomputed aggregates. The primary table is the first table
 * file with a key column (else the first table file); its key column
 * and numeric columns anchor coverage and aggregates.
 */
export function buildAgentAttachmentDataView(files: readonly AgentAttachmentDataInput[]): AgentAttachmentDataView {
  const profiles: AgentDataFileProfile[] = [];
  const chunks: AgentDataChunk[] = [];
  const tables = new Map<string, { table: ParsedTable; key: { index: number; name: string } | null; numeric: string[] }>();

  for (const file of files) {
    const table = parseTable(file.text);
    if (table) {
      const key = detectKeyColumn(table);
      const numeric = detectNumericColumns(table);
      tables.set(file.name, { table, key, numeric });
      profiles.push({
        name: file.name,
        kind: 'table',
        charCount: file.text.length,
        header: table.header,
        rowCount: table.rows.length,
        ...(key ? { keyColumn: key.name } : {}),
        ...(numeric.length > 0 ? { numericColumns: numeric } : {}),
      });
      chunks.push(...chunkTable(file.name, table, chunks.length));
    } else {
      profiles.push({ name: file.name, kind: 'prose', charCount: file.text.length });
      chunks.push(...chunkProse(file.name, file.text, chunks.length));
    }
  }

  const primaryName = profiles.find((profile) => profile.kind === 'table' && tables.get(profile.name)?.key)?.name
    ?? profiles.find((profile) => profile.kind === 'table')?.name;
  const primary = primaryName ? tables.get(primaryName) : undefined;

  let keyField = 'file';
  let expectedKeys = files.map((file) => file.name);
  if (primary?.key) {
    keyField = primary.key.name;
    expectedKeys = primary.table.rows.map((row) => row[primary.key!.index]);
  }

  const aggregates: Record<string, AgentDataAggregate> = {};
  const numericColumns = primary?.numeric ?? [];
  if (primary) {
    for (const columnName of numericColumns) {
      const columnIndex = primary.table.header.indexOf(columnName);
      if (columnIndex < 0) continue;
      let sum = 0;
      let count = 0;
      for (const row of primary.table.rows) {
        const value = parseNumericCell(row[columnIndex]);
        if (value !== null) { sum += value; count += 1; }
      }
      if (count > 0) aggregates[columnName] = { sum, count, mean: sum / count };
    }
  }

  return { files: profiles, chunks, totalChunks: chunks.length, keyField, expectedKeys, numericColumns, aggregates };
}

export type AgentDataRow = Record<string, string>;

export type AgentDataCoverageResult =
  | { ok: true; coveredKeys: number }
  | {
      ok: false;
      expected: number;
      covered: number;
      missing: string[];
      duplicated: string[];
      unexpected: string[];
      numericMismatch: string[];
    };

/**
 * The coverage verification (design §3.5.1): for `rows` output, every
 * expected key must appear exactly once, no foreign key may appear,
 * and for each numeric column the output rows carry under the input's
 * column name, the values must sum to the input's own sum (a per-row
 * two-decimal rounding tolerance absorbs model-side rounding; the
 * values themselves are supposed to be copied verbatim, which the
 * analyzer instruction demands).
 */
export function verifyAgentDataCoverage(
  view: AgentAttachmentDataView,
  rows: readonly AgentDataRow[],
): AgentDataCoverageResult {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row[view.keyField];
    if (typeof key === 'string' && key.length > 0) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const expected = new Set(view.expectedKeys);
  const missing = view.expectedKeys.filter((key) => !counts.has(key));
  const duplicated = [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
  const unexpected = [...counts.keys()].filter((key) => !expected.has(key));

  const numericMismatch: string[] = [];
  for (const columnName of view.numericColumns) {
    const aggregate = view.aggregates[columnName];
    if (!aggregate) continue;
    let outputSum = 0;
    let seen = 0;
    for (const row of rows) {
      const raw = row[columnName];
      if (typeof raw !== 'string') continue;
      const value = parseNumericCell(raw);
      if (value !== null) { outputSum += value; seen += 1; }
    }
    if (seen === 0) continue;
    const tolerance = 0.01 * Math.max(1, aggregate.count);
    if (Math.abs(outputSum - aggregate.sum) > tolerance) numericMismatch.push(columnName);
  }

  if (missing.length === 0 && duplicated.length === 0 && unexpected.length === 0 && numericMismatch.length === 0) {
    return { ok: true, coveredKeys: expected.size };
  }
  return {
    ok: false,
    expected: expected.size,
    covered: view.expectedKeys.filter((key) => counts.get(key) === 1).length,
    missing,
    duplicated,
    unexpected,
    numericMismatch,
  };
}

/**
 * Whether the rows yardstick is a real table key. When no table file
 * carries a key column, `expectedKeys` degenerates to the set's file
 * names and `keyField` to the literal 'file' — a yardstick that asks
 * the model to emit each file name exactly once. That says nothing
 * about the content, and it cannot be satisfied reliably when a file
 * spans several chunks: the per-chunk model calls are independent,
 * so no call can know whether another chunk of the same file already
 * emitted its name (ALE day-1, 2026-11-21: the K8s set's
 * cluster_state.txt spans two chunks and failed coverage
 * deterministically). Coverage for such sets is verified on
 * deterministic facts instead (verifyAgentDataChunkCoverage); the
 * key-multiset verification above stays in force for sets with a
 * real table key.
 */
export function agentDataUsesFileNameKeys(view: AgentAttachmentDataView): boolean {
  return !view.files.some(
    (file) => file.kind === 'table' && file.keyColumn !== undefined && file.keyColumn === view.keyField,
  );
}

export type AgentDataChunkCoverageResult =
  | { ok: true; processedChunks: number }
  | { ok: false; expectedChunks: number; processedChunks: number; rowCount: number };

/**
 * Coverage for `rows` output over a file-name-key set (design §3.5.1,
 * prose branch): the deterministic facts are the processed chunk
 * range and a non-empty result. Every chunk of the set must have
 * been presented to the model across the analyzer chain — each step
 * either processes its whole range or fails the step, and the final
 * step checks the predecessor bundle's recorded processed count
 * plus its own range against the set's total, so a skipped or
 * double-counted range fails the equality — and the merged rows
 * must not be empty: rows over a non-empty set that extract nothing
 * are an empty result, not coverage. Content correctness was never
 * what the file-name key check verified either; where a real table
 * key exists, the stricter key/numeric verification applies instead.
 */
export function verifyAgentDataChunkCoverage(
  view: AgentAttachmentDataView,
  processedChunks: number,
  rowCount: number,
): AgentDataChunkCoverageResult {
  if (processedChunks === view.totalChunks && rowCount > 0) {
    return { ok: true, processedChunks };
  }
  return { ok: false, expectedChunks: view.totalChunks, processedChunks, rowCount };
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Renders merged `rows` output as CSV text for the document step:
 * the key field first, then the remaining fields in first-seen
 * order. */
export function renderAgentDataRowsCsv(view: AgentAttachmentDataView, rows: readonly AgentDataRow[]): string {
  const columns: string[] = [view.keyField];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(row[column] ?? '')).join(','));
  }
  return lines.join('\n');
}
