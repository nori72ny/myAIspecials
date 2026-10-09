// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { IMAGE_EDIT_FAMILIES_V1 } from './OriginImageEditBlindBenchmarkV1.js';
import { planImageEditFreeShardsV1 } from './OriginImageEditFreeShardPlanV1.js';
const SHA = 'a'.repeat(40);
const CORPUS = 'b'.repeat(64);
const tasks = IMAGE_EDIT_FAMILIES_V1.flatMap((family, familyIndex) =>
  Array.from({ length: 2 }, (_, index) => ({
    caseId: 'edit-' + familyIndex + '-' + index,
    family, turnIndex: index + 1,
    instructionSha256: (familyIndex * 2 + index + 1).toString(16).padStart(64, '0'),
    sourceImageSha256: (familyIndex * 2 + index + 101).toString(16).padStart(64, '0'),
    width: 480, height: 480,
  })));
describe('V1.6 sealed Free image-edit shards', () => {
  it('freezes all 16 edit tasks and their source/instruction hashes without leakable text', () => {
    const a = planImageEditFreeShardsV1(SHA, CORPUS, tasks);
    const b = planImageEditFreeShardsV1(SHA, CORPUS, tasks);
    expect(a).toEqual(b);
    expect(a.planDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(a.shards).toHaveLength(8);
    expect(a.shards.flatMap(s => s.caseIds)).toEqual(tasks.map(t => t.caseId));
    expect(a.shards.every(s => s.caseIds.length === 2 && s.differentUtcDayRequired)).toBe(true);
    expect(a.shards.every(s => s.estimatedMaxGenerationNeurons + a.reservedCriticNeurons <= a.maxDailyNeurons)).toBe(true);
    expect(a.realQuotaProofRequired).toBe(true);
    expect(a.blindEditBenchmarkPassed).toBe(false);
    expect(a.productionQualified).toBe(false);
    expect(JSON.stringify(a)).not.toContain('sourceImageDataUrl');
    expect(JSON.stringify(a)).not.toContain('instruction:');
  });
  it('rejects missing, duplicate, tampered and imbalanced family groups', () => {
    expect(() => planImageEditFreeShardsV1(SHA, CORPUS, tasks.slice(1))).toThrow();
    expect(() => planImageEditFreeShardsV1('wrong', CORPUS, tasks)).toThrow();
    expect(() => planImageEditFreeShardsV1(SHA, 'wrong', tasks)).toThrow();
    expect(() => planImageEditFreeShardsV1(SHA, CORPUS, [...tasks.slice(0,15), tasks[0]])).toThrow();
    const altered = [...tasks];
    altered[0] = { ...altered[0], sourceImageSha256: 'bad' };
    expect(() => planImageEditFreeShardsV1(SHA, CORPUS, altered)).toThrow();
    const imbalanced = [...tasks];
    imbalanced[0] = { ...imbalanced[0], family: tasks[2].family };
    expect(() => planImageEditFreeShardsV1(SHA, CORPUS, imbalanced)).toThrow();
  });
  it('changes plan digest with source, instructions or task order', () => {
    const standard = planImageEditFreeShardsV1(SHA, CORPUS, tasks).planDigest;
    const t1 = [...tasks]; t1[1] = { ...t1[1], sourceImageSha256: 'c'.repeat(64) };
    const t2 = [...tasks]; t2[1] = { ...t2[1], instructionSha256: 'd'.repeat(64) };
    const t3 = [...tasks]; [t3[0], t3[1]] = [t3[1], t3[0]];
    expect(planImageEditFreeShardsV1(SHA, CORPUS, t1).planDigest).not.toBe(standard);
    expect(planImageEditFreeShardsV1(SHA, CORPUS, t2).planDigest).not.toBe(standard);
    expect(planImageEditFreeShardsV1(SHA, CORPUS, t3).planDigest).not.toBe(standard);
  });
});
