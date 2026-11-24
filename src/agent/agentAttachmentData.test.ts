// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  agentDataUsesFileNameKeys,
  applyAgentDataNumericCopy,
  buildAgentAttachmentDataView,
  renderAgentDataRowsCsv,
  verifyAgentDataChunkCoverage,
  verifyAgentDataCoverage,
  verifyAgentDataLocalCoverage,
  AGENT_ATTACHMENT_CHUNK_MAX_CHARS,
} from './agentAttachmentData.js';

const FRUITS = [
  'id,item,amount',
  'A-1,りんご,120',
  'A-2,みかん,80',
  'A-3,ぶどう,300',
].join('\n');

describe('agentAttachmentData view building', () => {
  it('detects a CSV table, its key column and numeric aggregates', () => {
    const view = buildAgentAttachmentDataView([{ name: 'fruits.csv', text: FRUITS }]);
    expect(view.files).toHaveLength(1);
    expect(view.files[0].kind).toBe('table');
    expect(view.files[0].header).toEqual(['id', 'item', 'amount']);
    expect(view.files[0].keyColumn).toBe('id');
    expect(view.files[0].rowCount).toBe(3);
    expect(view.files[0].numericColumns).toEqual(['amount']);
    expect(view.keyField).toBe('id');
    expect(view.expectedKeys).toEqual(['A-1', 'A-2', 'A-3']);
    expect(view.numericColumns).toEqual(['amount']);
    expect(view.aggregates).toEqual({ amount: { sum: 500, count: 3, mean: 500 / 3 } });
    expect(view.totalChunks).toBe(1);
    expect(view.chunks[0].text).toBe(FRUITS);
  });

  it('splits a long table at the chunk cap and repeats the header in every chunk', () => {
    const lines = ['id,name'];
    for (let i = 0; i < 240; i += 1) lines.push(`R-${String(i).padStart(3, '0')},${'x'.repeat(30)}`);
    const view = buildAgentAttachmentDataView([{ name: 'big.csv', text: lines.join('\n') }]);
    // ~37 chars per row → ~94 rows per chunk → exactly 3 chunks. A
    // packing regression that flushes after the first chunk would
    // produce one chunk per remaining row and fail this count.
    expect(view.totalChunks).toBe(3);
    for (const chunk of view.chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(AGENT_ATTACHMENT_CHUNK_MAX_CHARS);
      expect(chunk.text.startsWith('id,name\n')).toBe(true);
    }
    // No row is lost or duplicated across the split.
    const bodyLines = view.chunks.flatMap((chunk) => chunk.text.split('\n').slice(1));
    expect(bodyLines).toHaveLength(240);
    expect(new Set(bodyLines).size).toBe(240);
    expect(view.expectedKeys).toHaveLength(240);
  });

  it('keeps a single over-long row whole in its own chunk', () => {
    const longRow = `L-1,${'y'.repeat(AGENT_ATTACHMENT_CHUNK_MAX_CHARS + 500)}`;
    const view = buildAgentAttachmentDataView([{ name: 'long.csv', text: `id,memo\n${longRow}` }]);
    expect(view.totalChunks).toBe(1);
    expect(view.chunks[0].text).toContain(longRow);
    expect(view.chunks[0].text.length).toBeGreaterThan(AGENT_ATTACHMENT_CHUNK_MAX_CHARS);
  });

  it('chunks prose by paragraphs and falls back to file-name keys', () => {
    const prose = ['First paragraph about apples.', '', 'Second paragraph about oranges.'].join('\n');
    const view = buildAgentAttachmentDataView([{ name: 'notes.txt', text: prose }]);
    expect(view.files[0].kind).toBe('prose');
    expect(view.keyField).toBe('file');
    expect(view.expectedKeys).toEqual(['notes.txt']);
    // Paragraphs pack into one chunk while they fit under the cap.
    expect(view.chunks.map((chunk) => chunk.text)).toEqual([
      'First paragraph about apples.\n\nSecond paragraph about oranges.',
    ]);
  });

  it('degrades a mixed file (table plus trailing prose) to prose, and indexes chunks globally', () => {
    // A file is one table or prose, never both: the trailing memo line
    // breaks the column consistency, so the whole file is prose and
    // nothing is misparsed into a partial table.
    const mixed = `${FRUITS}\n\n補足メモ: ぶどうは季節限定。`;
    const view = buildAgentAttachmentDataView([
      { name: 'fruits.csv', text: mixed },
      { name: 'memo.txt', text: 'Plain memo body.' },
    ]);
    expect(view.files[0].kind).toBe('prose');
    expect(view.keyField).toBe('file');
    expect(view.expectedKeys).toEqual(['fruits.csv', 'memo.txt']);
    expect(view.chunks.some((chunk) => chunk.text.includes('補足メモ'))).toBe(true);
    expect(view.chunks.some((chunk) => chunk.text.includes('Plain memo body.'))).toBe(true);
    // Chunk indices are global and sequential across files.
    expect(view.chunks.map((chunk) => chunk.index)).toEqual(view.chunks.map((_, i) => i));
  });

  it('does not treat inconsistent rows as a table', () => {
    const view = buildAgentAttachmentDataView([{ name: 'ragged.txt', text: 'a,b,c\n1,2\n3,4,5,6\n7' }]);
    expect(view.files[0].kind).toBe('prose');
    expect(view.keyField).toBe('file');
  });

  it('is deterministic: the same input builds the identical view', () => {
    const input = [{ name: 'fruits.csv', text: FRUITS }];
    expect(buildAgentAttachmentDataView(input)).toEqual(buildAgentAttachmentDataView(input));
  });
});

describe('agentAttachmentData coverage verification', () => {
  const view = buildAgentAttachmentDataView([{ name: 'fruits.csv', text: FRUITS }]);
  const fullRows = [
    { id: 'A-1', item: 'りんご', amount: '120', category: '通常' },
    { id: 'A-2', item: 'みかん', amount: '80', category: '通常' },
    { id: 'A-3', item: 'ぶどう', amount: '300', category: '高額' },
  ];

  it('passes when every key is covered once and numeric sums agree', () => {
    expect(verifyAgentDataCoverage(view, fullRows)).toEqual({ ok: true, coveredKeys: 3 });
  });

  it('fails with the missing keys when a row is dropped', () => {
    const result = verifyAgentDataCoverage(view, fullRows.slice(0, 2));
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.missing).toEqual(['A-3']);
      expect(result.covered).toBe(2);
      expect(result.expected).toBe(3);
    }
  });

  it('fails on duplicated and unexpected keys', () => {
    const result = verifyAgentDataCoverage(view, [...fullRows, fullRows[0], { id: 'X-9', amount: '1' }]);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.duplicated).toEqual(['A-1']);
      expect(result.unexpected).toEqual(['X-9']);
    }
  });

  it('fails when a numeric value no longer sums to the input aggregate', () => {
    const tampered = fullRows.map((row) => (row.id === 'A-3' ? { ...row, amount: '30' } : row));
    const result = verifyAgentDataCoverage(view, tampered);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.numericMismatch).toEqual(['amount']);
  });

  it('records the expected/output sums and their difference for a mismatching column (coverage observability follow-on)', () => {
    // A-3's 300 transcribed as 30 — a digit drop: the difference is
    // the whole story, and no value was unreadable.
    const tampered = fullRows.map((row) => (row.id === 'A-3' ? { ...row, amount: '30' } : row));
    const result = verifyAgentDataCoverage(view, tampered);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.numericDetails).toEqual([
        { column: 'amount', expectedSum: 500, outputSum: 230, difference: -270, unparseableCount: 0 },
      ]);
    }
  });

  it('counts output values the numeric parser cannot read, apart from the sum difference (coverage observability follow-on)', () => {
    // A-2's 80 written in a notation the parser rejects: the value
    // is excluded from the output sum AND counted, so this failure
    // signature (unparseableCount 1) is distinguishable from the
    // digit drop above (unparseableCount 0).
    const notated = fullRows.map((row) => (row.id === 'A-2' ? { ...row, amount: '八十' } : row));
    const result = verifyAgentDataCoverage(view, notated);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.numericMismatch).toEqual(['amount']);
      expect(result.numericDetails).toEqual([
        { column: 'amount', expectedSum: 500, outputSum: 420, difference: -80, unparseableCount: 1 },
      ]);
    }
  });

  it('ignores formatting differences in numeric values (commas, currency marks)', () => {
    const formatted = fullRows.map((row) => ({ ...row, amount: `${row.amount}円` }));
    expect(verifyAgentDataCoverage(view, formatted).ok).toBe(true);
  });
});

describe('agentAttachmentData deterministic numeric copy (Basel coverage diagnosis 案1)', () => {
  const view = buildAgentAttachmentDataView([{ name: 'fruits.csv', text: FRUITS }]);

  it('indexes the primary table numeric cells by key in the view', () => {
    expect(view.primaryNumericCellsByKey).toEqual({
      'A-1': { amount: '120' },
      'A-2': { amount: '80' },
      'A-3': { amount: '300' },
    });
  });

  it('replaces transcribed numeric cells with the input values, exactly', () => {
    // The production failure shape: several cells mistranscribed
    // at once (a dropped digit here, a swapped value there), every
    // value still parseable — the class no repair retry converges
    // on. After the copy the numeric column is the input's own.
    const rows = [
      { id: 'A-1', item: 'りんご', amount: '12', category: '通常' },
      { id: 'A-2', item: 'みかん', amount: '800', category: '通常' },
      { id: 'A-3', item: 'ぶどう', amount: '30', category: '高額' },
    ];
    expect(applyAgentDataNumericCopy(view, rows)).toBe(3);
    expect(rows.map((row) => row.amount)).toEqual(['120', '80', '300']);
    // Coverage over the copied rows passes: the gate now judges
    // key coverage and the generated columns, not transcription.
    expect(verifyAgentDataCoverage(view, rows)).toEqual({ ok: true, coveredKeys: 3 });
  });

  it('never touches non-numeric cells or model-generated columns', () => {
    const rows = [
      { id: 'A-1', item: '林檎（モデルの表記）', amount: '999', category: '高額' },
      { id: 'A-2', item: '蜜柑（モデルの表記）', amount: '999', category: '高額' },
      { id: 'A-3', item: '葡萄（モデルの表記）', amount: '999', category: '通常' },
    ];
    applyAgentDataNumericCopy(view, rows);
    expect(rows.map((row) => row.item)).toEqual(['林檎（モデルの表記）', '蜜柑（モデルの表記）', '葡萄（モデルの表記）']);
    expect(rows.map((row) => row.category)).toEqual(['高額', '高額', '通常']);
    expect(rows.map((row) => row.amount)).toEqual(['120', '80', '300']);
  });

  it('fills a numeric cell the model omitted on a matched row', () => {
    const rows = [{ id: 'A-1', item: 'りんご' } as Record<string, string>];
    expect(applyAgentDataNumericCopy(view, rows)).toBe(1);
    expect(rows[0].amount).toBe('120');
  });

  it('leaves rows whose key matches no input row untouched (fail-safe)', () => {
    const rows = [
      { id: 'X-9', item: '不明', amount: '777' },
      { item: 'キーなし', amount: '555' },
    ];
    expect(applyAgentDataNumericCopy(view, rows)).toBe(0);
    expect(rows[0].amount).toBe('777');
    expect(rows[1].amount).toBe('555');
  });

  it('is a no-op for a set without a keyed primary table', () => {
    const proseView = buildAgentAttachmentDataView([{ name: 'notes.txt', text: 'ただの文章です。\n\n表ではありません。' }]);
    expect(proseView.primaryNumericCellsByKey).toBeUndefined();
    const rows = [{ file: 'notes.txt', amount: '42' }];
    expect(applyAgentDataNumericCopy(proseView, rows)).toBe(0);
    expect(rows[0].amount).toBe('42');
  });
});

describe('renderAgentDataRowsCsv', () => {
  it('renders the key field first with first-seen column order and CSV quoting', () => {
    const view = buildAgentAttachmentDataView([{ name: 'fruits.csv', text: FRUITS }]);
    const csv = renderAgentDataRowsCsv(view, [
      { item: 'りんご', id: 'A-1', note: 'has,comma' },
      { id: 'A-2', item: 'みかん', note: 'plain' },
    ]);
    expect(csv).toBe('id,item,note\nA-1,りんご,"has,comma"\nA-2,みかん,plain');
  });
});

/**
 * The staged ALE day-1 set compositions, reproduced synthetically at
 * the same sizes (the staged bodies themselves live outside the
 * repo): K8s = 3 prose files / 4 chunks with the first file spanning
 * two chunks; M&A = 5 prose files / 17 chunks (4+3+3+1+6). Paragraphs
 * of 1,200 chars pack two per 3,500-char chunk; the K8s first file is
 * two 2,490-char paragraphs, which cannot pack together.
 */
function proseParagraphs(count: number, chars: number, seed: string): string {
  return Array.from({ length: count }, (_, i) => `${seed} paragraph ${i + 1}. `.padEnd(chars, 'x')).join('\n\n');
}

const K8S_SHAPE_FILES = [
  { name: 'cluster_state.txt', text: proseParagraphs(2, 2_490, 'cluster state') },
  { name: 'deployment.yaml', text: proseParagraphs(1, 2_178, 'deployment manifest') },
  { name: 'failing_pod.log', text: proseParagraphs(1, 3_980, 'pod log') },
];

const MA_SHAPE_FILES = [
  { name: 'announcement.txt', text: proseParagraphs(8, 1_200, 'announcement') },
  { name: 'buyer1_report.txt', text: proseParagraphs(6, 1_200, 'buyer one') },
  { name: 'buyer2_report.txt', text: proseParagraphs(6, 1_200, 'buyer two') },
  { name: 'document_manifest.json', text: '{"documents": ["announcement", "buyer1", "buyer2", "seller"]}' },
  { name: 'seller_report.txt', text: proseParagraphs(12, 1_200, 'seller') },
];

describe('agentAttachmentData staged prose compositions', () => {
  it('builds the K8s shape: all prose, 4 chunks, first file spanning two', () => {
    const view = buildAgentAttachmentDataView(K8S_SHAPE_FILES);
    expect(view.files.map((file) => file.kind)).toEqual(['prose', 'prose', 'prose']);
    expect(view.totalChunks).toBe(4);
    expect(view.chunks.map((chunk) => chunk.fileName)).toEqual([
      'cluster_state.txt', 'cluster_state.txt', 'deployment.yaml', 'failing_pod.log',
    ]);
    expect(view.keyField).toBe('file');
    expect(view.expectedKeys).toEqual(['cluster_state.txt', 'deployment.yaml', 'failing_pod.log']);
    expect(agentDataUsesFileNameKeys(view)).toBe(true);
  });

  it('builds the M&A shape: all prose, 17 chunks split 4+3+3+1+6', () => {
    const view = buildAgentAttachmentDataView(MA_SHAPE_FILES);
    expect(view.files.every((file) => file.kind === 'prose')).toBe(true);
    expect(view.totalChunks).toBe(17);
    expect(MA_SHAPE_FILES.map((file) => view.chunks.filter((chunk) => chunk.fileName === file.name).length))
      .toEqual([4, 3, 3, 1, 6]);
    expect(view.keyField).toBe('file');
    expect(agentDataUsesFileNameKeys(view)).toBe(true);
  });

  it('reports a table key as a real yardstick, including a column literally named file', () => {
    const tableView = buildAgentAttachmentDataView([{ name: 'fruits.csv', text: FRUITS }]);
    expect(agentDataUsesFileNameKeys(tableView)).toBe(false);
    const fileColumnView = buildAgentAttachmentDataView([
      { name: 'listing.csv', text: 'file,size\na.txt,10\nb.txt,20' },
    ]);
    expect(fileColumnView.keyField).toBe('file');
    expect(fileColumnView.expectedKeys).toEqual(['a.txt', 'b.txt']);
    expect(agentDataUsesFileNameKeys(fileColumnView)).toBe(false);
  });

  it('treats a table without any unique column as a file-name yardstick', () => {
    const view = buildAgentAttachmentDataView([{ name: 'dupes.csv', text: 'a,b\n1,x\n1,x' }]);
    expect(view.files[0].kind).toBe('table');
    expect(view.files[0].keyColumn).toBeUndefined();
    expect(view.keyField).toBe('file');
    expect(agentDataUsesFileNameKeys(view)).toBe(true);
  });
});

describe('agentAttachmentData heading-line tables (Basel fix A)', () => {
  it('recognizes a TSV behind a `## sheet:` heading line and keeps the heading out of the chunks', () => {
    const tsv = [
      '## sheet: Sheet1',
      'Event_ID\tLoss_Amount_CNY',
      'OR001\t100',
      'OR002\t250',
      'OR003\t50',
    ].join('\n');
    const view = buildAgentAttachmentDataView([{ name: 'events.tsv', text: tsv }]);
    expect(view.files[0].kind).toBe('table');
    expect(view.files[0].header).toEqual(['Event_ID', 'Loss_Amount_CNY']);
    expect(view.files[0].rowCount).toBe(3);
    expect(view.files[0].keyColumn).toBe('Event_ID');
    // The yardstick comes from the real rows, not from anything else.
    expect(view.keyField).toBe('Event_ID');
    expect(view.expectedKeys).toEqual(['OR001', 'OR002', 'OR003']);
    expect(view.aggregates).toEqual({ Loss_Amount_CNY: { sum: 400, count: 3, mean: 400 / 3 } });
    // The heading line is metadata of the export, not data: it appears
    // in no chunk, and the chunk opens with the real header line.
    expect(view.totalChunks).toBe(1);
    expect(view.chunks[0].text).not.toContain('## sheet:');
    expect(view.chunks[0].text.startsWith('Event_ID\tLoss_Amount_CNY\n')).toBe(true);
  });

  it('recognizes a CSV behind a title line', () => {
    const csv = [
      '四半期売上レポート',
      'id,item,amount',
      'A-1,りんご,120',
      'A-2,みかん,80',
    ].join('\n');
    const view = buildAgentAttachmentDataView([{ name: 'report.csv', text: csv }]);
    expect(view.files[0].kind).toBe('table');
    expect(view.files[0].header).toEqual(['id', 'item', 'amount']);
    expect(view.expectedKeys).toEqual(['A-1', 'A-2']);
    expect(view.chunks[0].text).not.toContain('四半期売上レポート');
  });

  it('keeps delimiter-free text prose: no line with a delimiter means no table', () => {
    const prose = ['見出し行', 'ただの文章の行', 'もう一行の文章'].join('\n');
    const view = buildAgentAttachmentDataView([{ name: 'notes.txt', text: prose }]);
    expect(view.files[0].kind).toBe('prose');
    expect(view.keyField).toBe('file');
  });

  it('does not promote a delimiter-bearing tail into a table when the head is prose', () => {
    // Heading skipping only moves the header candidate forward; the
    // column-consistency rule still judges the whole remainder, so a
    // prose memo with one CSV-looking line stays prose.
    const memo = ['会議メモ', '参加者は3名。次回は来週。', 'a,b', '短い'].join('\n');
    const view = buildAgentAttachmentDataView([{ name: 'memo.txt', text: memo }]);
    expect(view.files[0].kind).toBe('prose');
  });

  it('leaves a delimiter-first table byte-identical to the pre-fix behavior', () => {
    const view = buildAgentAttachmentDataView([{ name: 'fruits.csv', text: FRUITS }]);
    expect(view.files[0].kind).toBe('table');
    expect(view.chunks[0].text).toBe(FRUITS);
    expect(view.expectedKeys).toEqual(['A-1', 'A-2', 'A-3']);
  });
});

describe('agentAttachmentData chunk coverage (prose branch)', () => {
  const view = buildAgentAttachmentDataView(K8S_SHAPE_FILES);

  it('passes when the whole chunk range was processed and rows were produced', () => {
    expect(verifyAgentDataChunkCoverage(view, 4, 3)).toEqual({ ok: true, processedChunks: 4 });
  });

  it('fails when part of the chunk range was never processed', () => {
    const result = verifyAgentDataChunkCoverage(view, 3, 3);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.expectedChunks).toBe(4);
      expect(result.processedChunks).toBe(3);
    }
  });

  it('fails when the merged rows are empty even though every chunk ran', () => {
    const result = verifyAgentDataChunkCoverage(view, 4, 0);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.rowCount).toBe(0);
  });
});

describe('agentAttachmentData chunk-local yardsticks (Basel segment-2 fix)', () => {
  // A keyed table whose rows are ~70 chars each, so the 3,500-char
  // chunk cap splits it into several chunks.
  const lines = ['id,item,amount'];
  for (let i = 0; i < 100; i += 1) lines.push(`K-${String(i).padStart(3, '0')},${'x'.repeat(60)},${i}`);
  const BIG = lines.join('\n');
  const amountOf = (key: string) => String(Number(key.slice(2)));

  it('annotates the primary table chunks with their packed keys and numeric subtotals', () => {
    const view = buildAgentAttachmentDataView([
      { name: 'big.csv', text: BIG },
      { name: 'ref.csv', text: 'code,name\nEL1,Internal\nEL2,External' },
    ]);
    expect(view.primaryFileName).toBe('big.csv');
    const primaryChunks = view.chunks.filter((chunk) => chunk.fileName === 'big.csv');
    expect(primaryChunks.length).toBeGreaterThan(1);
    // The chunk-local key sets partition the whole-set yardstick, in
    // order, and each chunk's subtotal is the sum over its own rows.
    expect(primaryChunks.flatMap((chunk) => chunk.rowKeys ?? [])).toEqual(view.expectedKeys);
    for (const chunk of primaryChunks) {
      const keys = chunk.rowKeys ?? [];
      expect(chunk.numericSums).toEqual({ amount: keys.reduce((sum, key) => sum + Number(amountOf(key)), 0) });
    }
    // Non-primary chunks carry no yardstick: they are reference
    // material, never extraction targets.
    for (const chunk of view.chunks.filter((candidate) => candidate.fileName !== 'big.csv')) {
      expect(chunk.rowKeys).toBeUndefined();
      expect(chunk.numericSums).toBeUndefined();
    }
  });

  it('leaves file-name-key sets unannotated: no primary table, no chunk yardsticks', () => {
    const view = buildAgentAttachmentDataView(K8S_SHAPE_FILES);
    expect(view.primaryFileName).toBeUndefined();
    expect(view.chunks.every((chunk) => chunk.rowKeys === undefined && chunk.numericSums === undefined)).toBe(true);
  });

  it('passes the local check when a step accounts for exactly its chunks', () => {
    const view = buildAgentAttachmentDataView([{ name: 'big.csv', text: BIG }]);
    const [first, second] = view.chunks;
    const rowsOf = (chunk: (typeof view.chunks)[number]) =>
      (chunk.rowKeys ?? []).map((key) => ({ id: key, amount: amountOf(key) }));
    expect(verifyAgentDataLocalCoverage(view, [first], rowsOf(first))).toEqual({
      ok: true,
      coveredKeys: (first.rowKeys ?? []).length,
    });
    // A step completing two chunks pools their yardsticks.
    expect(verifyAgentDataLocalCoverage(view, [first, second], [...rowsOf(first), ...rowsOf(second)])).toEqual({
      ok: true,
      coveredKeys: (first.rowKeys ?? []).length + (second.rowKeys ?? []).length,
    });
  });

  it('localizes a dropped row to the chunk range that lost it', () => {
    const view = buildAgentAttachmentDataView([{ name: 'big.csv', text: BIG }]);
    const [first] = view.chunks;
    const keys = first.rowKeys ?? [];
    const rows = keys.slice(0, -1).map((key) => ({ id: key, amount: amountOf(key) }));
    const result = verifyAgentDataLocalCoverage(view, [first], rows);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.missing).toEqual([keys[keys.length - 1]]);
      expect(result.expected).toBe(keys.length);
      expect(result.covered).toBe(keys.length - 1);
    }
  });

  it('treats a key from a sibling chunk as unexpected locally, and a changed amount as a numeric mismatch', () => {
    const view = buildAgentAttachmentDataView([{ name: 'big.csv', text: BIG }]);
    const [first, second] = view.chunks;
    const keys = first.rowKeys ?? [];
    const foreign = (second.rowKeys ?? [])[0];
    const swapped = keys.map((key) => ({ id: key, amount: amountOf(key) }));
    swapped[0] = { id: foreign, amount: amountOf(foreign) };
    const swappedResult = verifyAgentDataLocalCoverage(view, [first], swapped);
    expect(swappedResult.ok).toBe(false);
    if (swappedResult.ok === false) {
      expect(swappedResult.unexpected).toEqual([foreign]);
      expect(swappedResult.missing).toEqual([keys[0]]);
    }
    const tampered = keys.map((key) => ({ id: key, amount: amountOf(key) }));
    tampered[0] = { id: keys[0], amount: String(Number(amountOf(keys[0])) + 500) };
    const tamperedResult = verifyAgentDataLocalCoverage(view, [first], tampered);
    expect(tamperedResult.ok).toBe(false);
    if (tamperedResult.ok === false) expect(tamperedResult.numericMismatch).toEqual(['amount']);
  });
});
