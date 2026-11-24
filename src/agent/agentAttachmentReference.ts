/**
 * Reference context for primary-table chunk calls (failure
 * diagnosis 2026-11-24, wave 2 measure 5).
 *
 * A rows classification is a join: each primary-table row must be
 * read against the set's definition tables (category codes,
 * business-line mappings). The chunk list fragments every file,
 * so until now a chunk call saw either a slice of the primary
 * table or a slice of a definition table — never the event and
 * its definitions in the same call — and the classification the
 * task exists for could not be performed from what the model was
 * shown. The reference block built here is attached to every
 * primary-table chunk call of a rows run: the set's definition
 * tables, deterministically projected to the columns a
 * classification reads and capped, from the files' own texts.
 *
 * Pure functions of the set's texts: no model, no I/O. What is
 * NOT a reference table is excluded structurally, never by name:
 * the primary table itself, the output schemas (their sample
 * rows are not definitions), prose files, and key/value
 * parameter tables (a Parameter/Value header) — those carry a
 * calculation's settings, not classification definitions, and
 * reach the deliverable through the deterministic assembly
 * (wave 2 measure 6) instead.
 */

/** Cap on the reference block attached to one primary-table chunk
 * call. The Basel definition tables project to roughly 3,600
 * chars; the cap leaves a primary chunk (~3,500) plus the fixed
 * instruction (~1,700) at roughly 13,000 chars worst case. */
export const AGENT_REFERENCE_CONTEXT_MAX_CHARS = 8_000;

const OUTPUT_SCHEMA_FILE_PATTERN = /\.schema\.(?:csv|tsv|json|txt)$/i;
const REFERENCE_CODE_COLUMN_PATTERN = /(?:^|_)code$/i;
const REFERENCE_NAME_COLUMN_PATTERN = /name/i;
const REFERENCE_KEYWORD_COLUMN_PATTERN = /indicator|keyword/i;
const REFERENCE_DEPARTMENT_COLUMN_PATTERN = /department/i;

/** The reference block's per-table header: the same bracketed
 * framing style as the chunk provenance frame, naming the file
 * the definitions come from. Built from char codes so this
 * module carries no literal framing of its own. */
function referenceHeader(fileName: string): string {
  const open = String.fromCharCode(0x3010);
  const close = String.fromCharCode(0x3011);
  const label = String.fromCharCode(0x53c2, 0x7167);
  return `${open}${label}: ${fileName}${close}\n`;
}

type ReferenceTable = { header: string[]; rows: string[][]; delimiter: string };

/** Minimal delimited-table read for reference projection: the same
 * heading-skip and delimiter rules as the data layer, without its
 * coverage machinery. Returns null for prose. */
function parseReferenceTable(text: string): ReferenceTable | null {
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
  const delimiter = tableLines[0].includes('\t') ? '\t' : tableLines[0].includes(',') ? ',' : null;
  if (!delimiter) return null;
  const header = tableLines[0].split(delimiter).map((cell) => cell.trim());
  if (header.length < 2) return null;
  const rows = tableLines.slice(1).map((line) => line.split(delimiter).map((cell) => cell.trim()));
  if (rows.some((row) => row.length !== header.length)) return null;
  return { header, rows, delimiter };
}

/** A key/value parameter table (header naming a parameter column
 * and a value column) carries settings, not definitions. */
function isParameterTable(table: ReferenceTable): boolean {
  const lowered = table.header.map((name) => name.trim().toLowerCase());
  return lowered.includes('parameter') && lowered.includes('value');
}

/** The columns a classification reads from a definition table:
 * the code, its names, the keyword guidance and the departments
 * it applies to. Long definition prose is projected out. When no
 * column matches, the table is used whole (the projection never
 * empties a table it does not understand). */
function projectReferenceTable(table: ReferenceTable): string {
  const keep = table.header.map((name) =>
    REFERENCE_CODE_COLUMN_PATTERN.test(name)
    || REFERENCE_NAME_COLUMN_PATTERN.test(name)
    || REFERENCE_KEYWORD_COLUMN_PATTERN.test(name)
    || REFERENCE_DEPARTMENT_COLUMN_PATTERN.test(name));
  const indexes = keep.some(Boolean)
    ? keep.map((kept, index) => (kept ? index : -1)).filter((index) => index >= 0)
    : table.header.map((_, index) => index);
  const render = (cells: string[]) => indexes.map((index) => cells[index] ?? '').join(table.delimiter);
  return [render(table.header), ...table.rows.map(render)].join('\n');
}

/**
 * Builds the reference block co-located with a primary-table
 * chunk: every non-primary reference table of the set, projected
 * and capped. Files are taken in set order; once the cap is
 * reached, later tables are omitted whole and a table that only
 * partly fits is cut on a row boundary — a definition is never
 * cut mid-row. Returns '' when the set has no reference table (a
 * single-table set's calls stay unchanged).
 */
export function buildAgentReferenceContext(
  files: readonly { name: string; text: string }[],
  primaryFileName: string | undefined,
): string {
  if (!primaryFileName) return '';
  const blocks: string[] = [];
  let used = 0;
  for (const file of files) {
    if (file.name === primaryFileName) continue;
    if (OUTPUT_SCHEMA_FILE_PATTERN.test(file.name)) continue;
    const table = parseReferenceTable(file.text);
    if (!table) continue;
    if (isParameterTable(table)) continue;
    const projected = projectReferenceTable(table);
    const header = referenceHeader(file.name);
    const lines = projected.split('\n');
    let taken = '';
    for (const line of lines) {
      const candidate = taken.length === 0 ? line : `${taken}\n${line}`;
      if (used + header.length + candidate.length > AGENT_REFERENCE_CONTEXT_MAX_CHARS) break;
      taken = candidate;
    }
    if (taken.length === 0) continue;
    const block = `${header}${taken}`;
    blocks.push(block);
    used += block.length + 1;
    if (used >= AGENT_REFERENCE_CONTEXT_MAX_CHARS) break;
  }
  return blocks.join('\n');
}
