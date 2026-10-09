// @vitest-environment node
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readBoundedImageEvaluationArtifactV1 } from '../../scripts/read-bounded-image-evaluation-artifact-v1';

describe('offline image evaluation artifact bounded no-follow reader', () => {
  it('reads one verified regular-file descriptor within its byte cap', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'origin-image-eval-read-'));
    try {
      const p = path.join(dir, 'evidence.json');
      await writeFile(p, '{"caseId":"case-01"}');
      const bytes = await readBoundedImageEvaluationArtifactV1(p, 512);
      expect(bytes.toString('utf8')).toBe('{"caseId":"case-01"}');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('rejects oversized, empty, symlinked or nonregular evidence', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'origin-image-eval-read-'));
    try {
      const actual = path.join(dir, 'actual.json');
      const link = path.join(dir, 'link.json');
      const empty = path.join(dir, 'empty.json');
      await writeFile(actual, '0123456789');
      await writeFile(empty, '');
      await symlink(actual, link);
      await expect(readBoundedImageEvaluationArtifactV1(actual, 9)).rejects.toThrow('IMAGE_EVAL_ARTIFACT_SIZE_OR_TYPE_INVALID');
      await expect(readBoundedImageEvaluationArtifactV1(empty, 100)).rejects.toThrow('IMAGE_EVAL_ARTIFACT_SIZE_OR_TYPE_INVALID');
      await expect(readBoundedImageEvaluationArtifactV1(link, 100)).rejects.toThrow();
      await expect(readBoundedImageEvaluationArtifactV1(dir, 100)).rejects.toThrow();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('refuses unsafe byte limits before any filesystem read', async () => {
    for (const limit of [0, -1, NaN, Infinity, 16 * 1024 * 1024 + 1]) {
      await expect(readBoundedImageEvaluationArtifactV1('nonexistent', limit))
        .rejects.toThrow('IMAGE_EVAL_ARTIFACT_LIMIT_INVALID');
    }
  });
});
