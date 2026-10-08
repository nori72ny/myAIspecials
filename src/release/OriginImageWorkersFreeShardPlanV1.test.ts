// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  IMAGE_WORKERS_FREE_QUOTA_V1,
  monolithicImageFreePlanIsSafeV1,
  planImageWorkersFreeShardsV1,
} from './OriginImageWorkersFreeShardPlanV1.js';

const SHA = 'a'.repeat(40);
const CORPUS = 'b'.repeat(64);
const tasks = Array.from({ length: 24 }, (_, index) => ({
  caseId: `private-case-${index.toString().padStart(2, '0')}`,
  taskDigest: index.toString(16).padStart(64, '0'),
  width: 1024,
  height: 1024,
}));

describe('Workers Free sealed image evaluation planning', () => {
  it('rejects the old one-day 24-case benchmark without spending money or neurons', () => {
    expect(monolithicImageFreePlanIsSafeV1(24)).toBe(false);
    expect(24 * IMAGE_WORKERS_FREE_QUOTA_V1.flux9bFirstMegapixelNeurons)
      .toBeGreaterThan(IMAGE_WORKERS_FREE_QUOTA_V1.dailyNeurons);
    expect(monolithicImageFreePlanIsSafeV1(-1)).toBe(false);
    expect(monolithicImageFreePlanIsSafeV1(1.1)).toBe(false);
  });

  it('pins 24 sealed case IDs to deterministic small shards, retaining their exact order', () => {
    const a = planImageWorkersFreeShardsV1(SHA, CORPUS, tasks);
    const b = planImageWorkersFreeShardsV1(SHA, CORPUS, tasks);
    expect(a).toEqual(b);
    expect(a.planDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(a.shards).toHaveLength(12);
    expect(a.shards.flatMap((shard) => shard.caseIds)).toEqual(tasks.map((t) => t.caseId));
    expect(a.shards.every((shard) => shard.caseIds.length <= 2 && shard.mustUseDistinctUtcDay)).toBe(true);
    expect(a.shards.every((shard) => shard.estimatedGenerationNeurons + a.reservedNeurons <= a.freeDailyNeurons)).toBe(true);
    expect(a.requiresLiveFreePlanAndQuotaProof).toBe(true);
    expect(a.manualOnly).toBe(true);
    expect(JSON.stringify(a)).not.toContain('prompt');
  });

  it('refuses to drop, duplicate, mutate, or mix held-out case identities', () => {
    expect(() => planImageWorkersFreeShardsV1(SHA, CORPUS, tasks.slice(0, 23))).toThrow();
    expect(() => planImageWorkersFreeShardsV1('bad', CORPUS, tasks)).toThrow();
    expect(() => planImageWorkersFreeShardsV1(SHA, 'bad', tasks)).toThrow();
    expect(() => planImageWorkersFreeShardsV1(SHA, CORPUS, [...tasks.slice(0, 23), tasks[0]])).toThrow();
    const corrupted = [...tasks];
    corrupted[4] = { ...corrupted[4], taskDigest: 'bad' };
    expect(() => planImageWorkersFreeShardsV1(SHA, CORPUS, corrupted)).toThrow();
  });

  it('reserves quota for the critic even with 1536 pixel images and potential repair', () => {
    const large = tasks.map(t => ({ ...t, width: 1536, height: 1536 }));
    const plan = planImageWorkersFreeShardsV1(SHA, CORPUS, large);
    expect(plan.shards.every((shard) => shard.caseIds.length <= 2)).toBe(true);
    expect(plan.shards.every((shard) => shard.estimatedGenerationNeurons + plan.reservedNeurons <= plan.freeDailyNeurons)).toBe(true);
    expect(plan.planDigest).not.toBe(planImageWorkersFreeShardsV1(SHA, CORPUS, tasks).planDigest);
  });
});
