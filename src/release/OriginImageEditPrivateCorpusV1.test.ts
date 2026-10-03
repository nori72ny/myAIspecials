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
const SOURCE_SHA = createHash('sha256').update(SOURCE_BYTES).digest('hex');
const SOURCE = `data:image/png;base64,${SOURCE_BYTES.toString('base64')}`;

function digest(value: string) {
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
