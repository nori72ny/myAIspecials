/**
 * Deterministic department → business-line check (B-2, rerun
 * diagnosis AGENT_RERUN_20261127_DIAGNOSIS_2026-11-27 §2.2).
 *
 * The Basel rerun's business-line errors were systematic, not
 * random: every brokerage-department event （证券营业部/经纪业务部，
 * mapped to BL8 零售经纪 by the set's own mapping table) was
 * classified into a neighboring line, and the one department the
 * table names for BL3 was read as BL4 — while the analyzer had
 * the mapping table in its reference block the whole time. A
 * stated mapping is not a matter of judgment: when the set
 * itself declares which line a department belongs to, the
 * output rows are checked against that declaration
 * deterministically, the same way the numeric copy checks
 * copied numbers.
 *
 * The check is deliberately narrow:
 * - It reads the mapping from the set's own files (a delimited
 *   table whose header carries a BL-code column and a
 *   departments column) — no mapping is baked into the code, so
 *   a set without such a table is untouched, byte-identical.
 * - A department the table names for two different lines is
 *   ambiguous and dropped from the map: no correction is ever
 *   made on an ambiguous basis.
 * - An event whose department the table does NOT name is left
 *   exactly as the model classified it and reported in
 *   `unmappedDepartments` — the check never assigns a line
 *   without a basis in the materials (the diagnosis's rule for
 *   unmapped departments).
 * - Corrections are recorded (event key, department, from, to)
 *   in the bundle as observability, in the style of the
 *   coverage block's discarded-row count.
 */

import type { AgentDataRow } from './agentAttachmentData.js';

export type AgentBusinessLineCorrection = {
  key: string;
  department: string;
  from: string;
  to: string;
};

export type AgentBusinessLineCheck = {
  corrections: AgentBusinessLineCorrection[];
  /** Departments of checked events that the set's mapping table
   * does not name (unique, first-seen order, capped). Their rows
   * were left as classified — never assigned without basis. */
  unmappedDepartments: string[];
};

const UNMAPPED_DEPARTMENTS_MAX = 20;

type BaselTextFile = { name: string; text: string };

/** Splits one delimited table file into header + rows of cells,
 * in the BaselBia style: `## sheet:` heading lines are skipped
 * and the delimiter is the header line's own (tab, else comma).
 * Returns null when no header line carries both wanted columns. */
function parseDelimitedTable(
  files: readonly BaselTextFile[],
  wantedColumns: readonly string[],
): { header: string[]; rows: string[][] } | null {
  for (const file of files) {
    const lines = file.text.split(/\r?\n/).filter((line) => line.trim().length > 0 && !line.startsWith('## '));
    if (lines.length < 2) continue;
    const delimiter = lines[0].includes('\t') ? '\t' : ',';
    const header = lines[0].split(delimiter).map((cell) => cell.trim());
    if (!wantedColumns.every((column) => header.includes(column))) continue;
    return {
      header,
      rows: lines.slice(1).map((line) => line.split(delimiter).map((cell) => cell.trim())),
    };
  }
  return null;
}

/**
 * The set's department → business-line map, from the mapping
 * table the set itself carries (a `BL_Code` column and a
 * `Key_Departments` column of comma-separated department
 * names). Null when the set carries no such table. A department
 * named under two different lines is removed — ambiguous
 * entries correct nothing.
 */
export function parseBusinessLineDepartmentMap(
  files: readonly BaselTextFile[],
): ReadonlyMap<string, string> | null {
  const table = parseDelimitedTable(files, ['BL_Code', 'Key_Departments']);
  if (!table) return null;
  const codeIndex = table.header.indexOf('BL_Code');
  const departmentsIndex = table.header.indexOf('Key_Departments');
  const map = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const row of table.rows) {
    const code = (row[codeIndex] ?? '').normalize('NFKC').trim();
    if (!/^BL\d+$/.test(code)) continue;
    for (const rawDepartment of (row[departmentsIndex] ?? '').split(/[,、，]/)) {
      const department = rawDepartment.normalize('NFKC').trim();
      if (!department) continue;
      const existing = map.get(department);
      if (existing !== undefined && existing !== code) {
        ambiguous.add(department);
      } else {
        map.set(department, code);
      }
    }
  }
  for (const department of ambiguous) map.delete(department);
  return map.size > 0 ? map : null;
}

/**
 * Each event's involved department, from the set's event table
 * (an `Event_ID` column and an `Involved_Department` column),
 * keyed by event id. Null when the set carries no such table.
 */
export function parseEventDepartments(
  files: readonly BaselTextFile[],
): ReadonlyMap<string, string> | null {
  const table = parseDelimitedTable(files, ['Event_ID', 'Involved_Department']);
  if (!table) return null;
  const idIndex = table.header.indexOf('Event_ID');
  const departmentIndex = table.header.indexOf('Involved_Department');
  const departments = new Map<string, string>();
  for (const row of table.rows) {
    const id = (row[idIndex] ?? '').trim();
    const department = (row[departmentIndex] ?? '').normalize('NFKC').trim();
    if (id && department && !departments.has(id)) departments.set(id, department);
  }
  return departments.size > 0 ? departments : null;
}

/** The output's business-line column: the required output
 * column the schema names for it, else a row key of that name.
 * Undefined when the output carries no business-line column at
 * all — then there is nothing to check. */
function businessLineColumnOf(
  rows: readonly AgentDataRow[],
  requiredOutputColumns?: readonly string[],
): string | undefined {
  const fromSchema = (requiredOutputColumns ?? []).find((column) => /business/i.test(column) && /line/i.test(column));
  if (fromSchema) return fromSchema;
  for (const row of rows) {
    const key = Object.keys(row).find((column) => /^business_?line$/i.test(column));
    if (key) return key;
  }
  return undefined;
}

/**
 * Checks the final rows against the set's department mapping,
 * correcting in place any row whose event's department the
 * mapping names for a different line. Returns null — and
 * touches nothing — when the set carries no mapping table, no
 * event-department table, or no business-line column: every
 * other set's behavior is unchanged.
 */
export function applyBusinessLineDepartmentCheck(input: {
  files: readonly BaselTextFile[];
  rows: AgentDataRow[];
  keyField: string;
  requiredOutputColumns?: readonly string[];
}): AgentBusinessLineCheck | null {
  const departmentMap = parseBusinessLineDepartmentMap(input.files);
  if (!departmentMap) return null;
  const departmentByEvent = parseEventDepartments(input.files);
  if (!departmentByEvent) return null;
  const column = businessLineColumnOf(input.rows, input.requiredOutputColumns);
  if (!column) return null;
  const corrections: AgentBusinessLineCorrection[] = [];
  const unmappedDepartments: string[] = [];
  for (const row of input.rows) {
    const key = (row[input.keyField] ?? '').trim();
    if (!key) continue;
    const department = departmentByEvent.get(key);
    if (!department) continue;
    const mapped = departmentMap.get(department);
    if (mapped === undefined) {
      if (!unmappedDepartments.includes(department) && unmappedDepartments.length < UNMAPPED_DEPARTMENTS_MAX) {
        unmappedDepartments.push(department);
      }
      continue;
    }
    const current = (row[column] ?? '').normalize('NFKC').trim();
    if (current !== mapped) {
      corrections.push({ key, department, from: current, to: mapped });
      row[column] = mapped;
    }
  }
  return { corrections, unmappedDepartments };
}
