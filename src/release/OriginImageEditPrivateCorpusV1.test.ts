import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { IMAGE_EDIT_FAMILIES_V1 } from './OriginImageEditBlindBenchmarkV1';
import {
  ORIGIN_IMAGE_EDIT_PRIVATE_CORPUS_SCHEMA,
  validateImageEditPrivateCorpusV1,
  type ImageEditPrivateTaskV1,
  type OriginImageEditPrivateCorpusV1,
} from './OriginImageEditPrivateCorpusV1';

const NOW = Date.parse('2026-10-04T00:00:00Z');
const SOURCE_BYTES = Buffer.alloc(128, 7);
// Syntactically valid PNG header and declared dimensions; the live shard runner
// additionally requires Chromium to fully decode every input reference.
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(SOURCE_BYTES, 0);
Buffer.from('IHDR', 'ascii').copy(SOURCE_BYTES, 12);
SOURCE_BYTES.writeUInt32BE(320, 16);
SOURCE_BYTES.writeUInt32BE(320, 20);
const SOURCE_SHA = createHash('sha256').update(SOURCE_BYTES).digest('hex');
const SOURCE = `data:image/png;base64,${SOURCE_BYTES.toString('base64')}`;

function digest(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function task(index: number, family: (typeof IMAGE_EDIT_FAMILIES_V1)[number]): ImageEditPrivateTaskV1 {
  const instruction = `edit instruction ${index + 1}`;
  return {
    caseId: `edit-${String(index + 1).padStart(2, '0')}`,
    family,
    instruction,
    instructionSha256: digest(instruction),
    sourceImageDataUrl: SOURCE,
    sourceImageSha256: SOURCE_SHA,
    width: 256,
    height: 256,
    turnIndex: (index % 3) + 1,
  };
}

function corpus(): OriginImageEditPrivateCorpusV1 {
  const tasks: ImageEditPrivateTaskV1[] = [];
  let index = 0;
  for (const family of IMAGE_EDIT_FAMILIES_V1) {
    for (let count = 0; count < 2; count += 1) tasks.push(task(index++, family));
  }
  return {
    schema: ORIGIN_IMAGE_EDIT_PRIVATE_CORPUS_SCHEMA,
    corpusId: 'private-edit-v1',
    candidateSha: 'a'.repeat(40),
    createdAt: '2026-10-03T00:00:00Z',
    expiresAt: '2026-10-10T00:00:00Z',
    executionBudgetMs: 60_000,
    tasks,
  };
}

describe('image edit private corpus v1', () => {
  it('accepts a complete fresh 16-task corpus', () => {
    expect(validateImageEditPrivateCorpusV1(corpus(), NOW)).toEqual([]);
  });

  it('rejects a source digest mismatch without exposing source bytes', () => {
    const base = corpus();
    const first = base.tasks[0];
    const broken = { ...first, sourceImageSha256: 'b'.repeat(64) };
    const blockers = validateImageEditPrivateCorpusV1({ ...base, tasks: [broken, ...base.tasks.slice(1)] }, NOW);
    expect(blockers).toContain(`IMAGE_EDIT_PRIVATE_CORPUS_SOURCE_INVALID:${first.caseId}`);
    expect(JSON.stringify(blockers)).not.toContain(SOURCE);
  });

  it('rejects syntactically invalid or falsely labeled sources even with correct hashes', () => {
    const original = corpus();
    const item = original.tasks[0];
    const bogus = Buffer.alloc(128, 9);
    const bad = { ...item, sourceImageDataUrl: 'data:image/png;base64,' + bogus.toString('base64'),
      sourceImageSha256: digest(bogus) };
    const badMime = { ...item, sourceImageDataUrl: SOURCE.replace('image/png', 'image/webp') };
    const invalid = validateImageEditPrivateCorpusV1({ ...original,
      tasks: [bad, ...original.tasks.slice(1)] }, NOW);
    const mismatch = validateImageEditPrivateCorpusV1({ ...original,
      tasks: [badMime, ...original.tasks.slice(1)] }, NOW);
    expect(invalid).toContain('IMAGE_EDIT_PRIVATE_CORPUS_SOURCE_INVALID:' + item.caseId);
    expect(mismatch).toContain('IMAGE_EDIT_PRIVATE_CORPUS_SOURCE_INVALID:' + item.caseId);
    expect(JSON.stringify(invalid)).not.toContain(bogus.toString('base64'));
  });

  it('fails closed on incomplete family coverage and stale evidence', () => {
    const base = corpus();
    const blockers = validateImageEditPrivateCorpusV1({
      ...base,
      createdAt: '2026-09-01T00:00:00Z',
      expiresAt: '2026-09-02T00:00:00Z',
      tasks: base.tasks.slice(0, 15),
    }, NOW);
    expect(blockers).toContain('IMAGE_EDIT_PRIVATE_CORPUS_STALE_OR_FUTURE');
    expect(blockers).toContain('IMAGE_EDIT_PRIVATE_CORPUS_REQUIRES_16_TASKS');
  });
});
