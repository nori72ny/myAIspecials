// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildAgentAttachmentDataView,
  renderAgentDataRowsCsv,
  verifyAgentDataCoverage,
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

  it('ignores formatting differences in numeric values (commas, currency marks)', () => {
    const formatted = fullRows.map((row) => ({ ...row, amount: `${row.amount}円` }));
    expect(verifyAgentDataCoverage(view, formatted).ok).toBe(true);
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
