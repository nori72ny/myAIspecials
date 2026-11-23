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
/** Analyzer segment size: one step processes at most this many chunks,
 * one sequential model call per chunk. Lowered from 4 to 2 after the
 * AGORA timeout (2026-11-23, run-4aaf8df2): a 4-chunk segment ran
 * ~104s in production — about 87% of the 120s function limit — so
 * one provider timeout plus its retry wait could not fit inside the
 * step at all. At 2 chunks a step runs at roughly 50s, leaving room
 * for one timeout and its retry inside the same step. Diagnosis:
 * AGENT_AGORA_PROVIDER_TIMEOUT_DIAGNOSIS_2026-11-23. The 4-chunk
 * value it replaces had been kept after the ALE wave-1 measurement
 * (2026-11-21), when an 8-chunk segment failed deterministically
 * with PROVIDER_RATE_LIMITED while a 4-chunk segment completed;
 * the 4-chunk segment was then measured to complete, but only just
 * inside the function limit, which the AGORA timeout exposed. */
export const AGENT_ATTACHMENT_MAX_CHUNKS_PER_STEP = 2;
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
  /**
   * Primary-table chunks only (Basel segment-2 fix, diagnosis
   * AGENT_BASEL_SEGMENT2_COVERAGE_DIAGNOSIS_2026-11-23 案2): the key
   * values of the rows packed into this chunk, in row order, and the
   * per-numeric-column sums over those rows. Annotated at view build
   * from the same parse that produced the chunk text, so the
   * analyzer verifies a step's output against exactly the rows that
   * step was shown — never against a second, divergent computation.
   */
  rowKeys?: string[];
  numericSums?: Record<string, number>;
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
  /**
   * The primary table's file name, present exactly when the primary
   * table carries the key column the coverage yardstick is anchored
   * on. The analyzer's `rows` contract is anchored on it (Basel
   * segment-2 fix, 案1): rows are extracted from this file's chunks
   * only; every other file is reference material.
   */
  primaryFileName?: string;
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
 * Table detection (design §3.2): the delimiter comes from the header
 * line; the file is a table when at least two non-empty lines remain
 * from the header on and (almost) every line splits into the header's
 * column count (≥2). Cell splitting is deliberately naive (no quote
 * awareness): a quoted CSV whose cells contain delimiters fails the
 * column-consistency check and is treated as prose rather than being
 * misparsed into a wrong table.
 *
 * Heading lines (Basel fix A, diagnosis
 * AGENT_BASEL_DATA_OUTPUT_INVALID_DIAGNOSIS_2026-11-23): spreadsheet
 * exports converted to TSV/CSV text commonly open with delimiter-free
 * heading lines — the ALE Basel set's files start with
 * `## sheet: Sheet1`, a line the dataset-side xlsx→TSV conversion
 * added (ORIGIN itself has no xlsx extraction that emits it). Judging
 * the delimiter from the literal first line made every such file
 * prose: the real table never anchored the coverage yardstick, which
 * a schema sample elsewhere in the set then hijacked. The header
 * candidate is therefore the first line that contains a delimiter at
 * all; delimiter-free lines before it are headings and are skipped —
 * they never enter the header, the rows or the chunks. When the first
 * line already carries a delimiter nothing is skipped and the
 * behavior is exactly the pre-fix one.
 */
function parseTable(text: string): ParsedTable | null {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  let headerIndex = 0;
  while (
    headerIndex < lines.length
    && !lines[headerIndex].includes('\t')
    && !lines[headerIndex].includes(',')
  ) {
    headerIndex += 1;
  }
  const tableLines = lines.slice(headerIndex);
  if (tableLines.length < 2) return null;
  const first = tableLines[0];
  const delimiter = first.includes('\t') ? '\t' : first.includes(',') ? ',' : null;
  if (!delimiter) return null;
  const split = (line: string) => line.split(delimiter).map((cell) => cell.trim());
  const header = split(first);
  if (header.length < 2) return null;
  const rows = tableLines.slice(1).map(split);
  const consistent = rows.filter((row) => row.length === header.length).length;
  if (consistent < Math.ceil(rows.length * 0.9)) return null;
  const keptRows = rows.filter((row) => row.length === header.length);
  const keptLines = tableLines.slice(1).filter((_, index) => rows[index].length === header.length);
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

function chunkTable(
  name: string,
  table: ParsedTable,
  startIndex: number,
): { chunks: AgentDataChunk[]; rowIndexesPerChunk: number[][] } {
  const headerLine = table.rowLines.length > 0
    ? tableHeaderLine(table)
    : '';
  const chunks: AgentDataChunk[] = [];
  const rowIndexesPerChunk: number[][] = [];
  let current: string[] = [];
  let currentRowIndexes: number[] = [];
  let currentChars = 0;
  const flush = () => {
    if (current.length === 0) return;
    chunks.push({ index: startIndex + chunks.length, fileName: name, text: [headerLine, ...current].join('\n') });
    rowIndexesPerChunk.push(currentRowIndexes);
    current = [];
    currentRowIndexes = [];
    currentChars = 0;
  };
  // rowLines[i] and rows[i] are the same kept row (both were filtered
  // by the same column-consistency predicate), so the index packed
  // here identifies the parsed row a chunk line came from.
  for (let rowIndex = 0; rowIndex < table.rowLines.length; rowIndex += 1) {
    const line = table.rowLines[rowIndex];
    let projected = currentChars + (current.length > 0 ? 1 : 0) + line.length;
    if (current.length > 0 && headerLine.length + 1 + projected > AGENT_ATTACHMENT_CHUNK_MAX_CHARS) {
      flush();
      // The projection was computed against the flushed chunk; the
      // fresh chunk starts from this line alone.
      projected = line.length;
    }
    current.push(line);
    currentRowIndexes.push(rowIndex);
    currentChars = projected;
  }
  flush();
  return { chunks, rowIndexesPerChunk };
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
  const tableChunkRowIndexes = new Map<string, Map<number, number[]>>();

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
      const packed = chunkTable(file.name, table, chunks.length);
      chunks.push(...packed.chunks);
      const perChunk = new Map<number, number[]>();
      packed.chunks.forEach((chunk, position) => perChunk.set(chunk.index, packed.rowIndexesPerChunk[position]));
      tableChunkRowIndexes.set(file.name, perChunk);
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

  // Chunk-local yardsticks for the primary table (Basel segment-2
  // fix, 案2): each primary chunk is annotated with the key values
  // of the rows packed into it and the per-column sums over those
  // rows, taken from the same parse that produced the chunk text.
  let primaryFileName: string | undefined;
  if (primary?.key && primaryName) {
    primaryFileName = primaryName;
    const primaryTable = primary.table;
    const keyColumnIndex = primary.key.index;
    const perChunk = tableChunkRowIndexes.get(primaryName);
    for (const chunk of chunks) {
      if (chunk.fileName !== primaryName) continue;
      const rowIndexes = perChunk?.get(chunk.index) ?? [];
      chunk.rowKeys = rowIndexes.map((rowIndex) => primaryTable.rows[rowIndex][keyColumnIndex]);
      const sums: Record<string, number> = {};
      for (const columnName of numericColumns) {
        const columnIndex = primaryTable.header.indexOf(columnName);
        if (columnIndex < 0) continue;
        let sum = 0;
        for (const rowIndex of rowIndexes) {
          const value = parseNumericCell(primaryTable.rows[rowIndex][columnIndex]);
          if (value !== null) sum += value;
        }
        sums[columnName] = sum;
      }
      chunk.numericSums = sums;
    }
  }

  return {
    files: profiles,
    chunks,
    totalChunks: chunks.length,
    keyField,
    expectedKeys,
    ...(primaryFileName ? { primaryFileName } : {}),
    numericColumns,
    aggregates,
  };
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
  return verifyCoverageAgainstYardstick(view, rows);
}

type AgentDataCoverageYardstick = {
  keyField: string;
  expectedKeys: readonly string[];
  numericColumns: readonly string[];
  aggregates: Readonly<Record<string, AgentDataAggregate>>;
};

function verifyCoverageAgainstYardstick(
  yardstick: AgentDataCoverageYardstick,
  rows: readonly AgentDataRow[],
): AgentDataCoverageResult {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row[yardstick.keyField];
    if (typeof key === 'string' && key.length > 0) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const expected = new Set(yardstick.expectedKeys);
  const missing = yardstick.expectedKeys.filter((key) => !counts.has(key));
  const duplicated = [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
  const unexpected = [...counts.keys()].filter((key) => !expected.has(key));

  const numericMismatch: string[] = [];
  for (const columnName of yardstick.numericColumns) {
    const aggregate = yardstick.aggregates[columnName];
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
    covered: yardstick.expectedKeys.filter((key) => counts.get(key) === 1).length,
    missing,
    duplicated,
    unexpected,
    numericMismatch,
  };
}

/**
 * The chunk-local coverage verification (Basel segment-2 fix, 案2):
 * the same all-or-nothing judgment as verifyAgentDataCoverage, taken
 * against the yardstick of one step's primary-table chunks — the
 * keys packed into those chunks, each exactly once, and the
 * per-column sums over their rows. Until now only the final step
 * verified anything, over the whole merged chain: the segment
 * holding every target row passed unverified and a shortfall
 * surfaced one segment later, in a step whose range held no target
 * at all, with no way to attribute it. A step that completes
 * primary-table chunks now answers for exactly those chunks; the
 * final whole-set verification above remains the last gate and its
 * meaning is unchanged.
 */
export function verifyAgentDataLocalCoverage(
  view: AgentAttachmentDataView,
  chunks: readonly AgentDataChunk[],
  rows: readonly AgentDataRow[],
): AgentDataCoverageResult {
  const expectedKeys: string[] = [];
  let rowCount = 0;
  for (const chunk of chunks) {
    expectedKeys.push(...(chunk.rowKeys ?? []));
    rowCount += chunk.rowKeys?.length ?? 0;
  }
  const aggregates: Record<string, AgentDataAggregate> = {};
  for (const columnName of view.numericColumns) {
    let sum = 0;
    let present = false;
    for (const chunk of chunks) {
      const chunkSum = chunk.numericSums?.[columnName];
      if (typeof chunkSum === 'number') { sum += chunkSum; present = true; }
    }
    if (present) aggregates[columnName] = { sum, count: rowCount, mean: rowCount > 0 ? sum / rowCount : 0 };
  }
  return verifyCoverageAgainstYardstick(
    { keyField: view.keyField, expectedKeys, numericColumns: view.numericColumns, aggregates },
    rows,
  );
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
