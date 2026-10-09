import { createHash } from 'node:crypto';
import { IMAGE_WORKERS_FREE_QUOTA_V1 } from './OriginImageWorkersFreeShardPlanV1.js';

/**
 * Separate image-EDIT held-out coverage: 8 edit families x 2 cases, 16 total.
 * Source/reference hashes are frozen. This is a Free-cap *plan*, never usage proof.
 */
export type ImageEditFreeTaskIdentityV1 = Readonly<{
  caseId: string;
  family: string;
  turnIndex: number;
  instructionSha256: string;
  sourceImageSha256: string;
  width: number;
  height: number;
}>;

export type ImageEditFreeShardPlanV1 = Readonly<{
  schemaVersion: 'origin.image-edit-free-shard-plan.v1';
  candidateSha: string;
  corpusDigest: string;
  planDigest: string;
  model: '@cf/black-forest-labs/flux-2-klein-9b';
  maxDailyNeurons: 10000;
  reservedCriticNeurons: number;
  shards: readonly Readonly<{
    index: number;
    caseIds: readonly string[];
    sourceImageSha256s: readonly string[];
    instructionSha256s: readonly string[];
    estimatedMaxGenerationNeurons: number;
    differentUtcDayRequired: true;
  }>[];
  allSixteenCasesRequired: true;
  realQuotaProofRequired: true;
  exactShaRequired: true;
  blindEditBenchmarkPassed: false;
  productionQualified: false;
}>;

const SHA40 = /^[a-f0-9]{40}$/i;
const SHA64 = /^[a-f0-9]{64}$/i;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/;
const SOURCE_MAX_MP = (511 * 511) / (1024 * 1024);

export function planImageEditFreeShardsV1(
  candidateSha: string,
  corpusDigest: string,
  tasks: readonly ImageEditFreeTaskIdentityV1[],
): ImageEditFreeShardPlanV1 {
  if (!SHA40.test(candidateSha) || !SHA64.test(corpusDigest)) {
    throw new Error('IMAGE_EDIT_FREE_PLAN_IDENTITY_INVALID');
  }
  if (!Array.isArray(tasks) || tasks.length !== 16) {
    throw new Error('IMAGE_EDIT_FREE_PLAN_REQUIRES_16_CASES');
  }
  const seen = new Set<string>();
  const families = new Map<string, number>();
  const shards: {
    index: number; caseIds: string[]; sourceImageSha256s: string[];
    instructionSha256s: string[]; estimatedMaxGenerationNeurons: number;
    differentUtcDayRequired: true;
  }[] = [];
  const reserve = IMAGE_WORKERS_FREE_QUOTA_V1.reservedNeuronsForVisionCriticAndUnknownUsage;
  for (const task of tasks) {
    if (!ID.test(task.caseId) || seen.has(task.caseId)
      || !ID.test(task.family)
      || !SHA64.test(task.instructionSha256) || !SHA64.test(task.sourceImageSha256)
      || !Number.isInteger(task.turnIndex) || task.turnIndex < 1 || task.turnIndex > 8
      || !Number.isInteger(task.width) || !Number.isInteger(task.height)
      || task.width < 256 || task.width >= 512 || task.height < 256 || task.height >= 512) {
      throw new Error('IMAGE_EDIT_FREE_PLAN_TASK_INVALID');
    }
    seen.add(task.caseId);
    families.set(task.family, (families.get(task.family) || 0) + 1);
    const mp = task.width * task.height / (1024 * 1024);
    const firstMp = IMAGE_WORKERS_FREE_QUOTA_V1.flux9bFirstMegapixelNeurons
      + Math.max(0, mp - 1) * IMAGE_WORKERS_FREE_QUOTA_V1.flux9bAdditionalMegapixelNeurons;
    const sourceNeurons = SOURCE_MAX_MP * IMAGE_WORKERS_FREE_QUOTA_V1.flux9bAdditionalMegapixelNeurons;
    const budget = Math.ceil((firstMp + sourceNeurons)
      * IMAGE_WORKERS_FREE_QUOTA_V1.maxGenerationAttemptsPerCase * 100) / 100;
    let current = shards[shards.length - 1];
    if (!current || current.caseIds.length >= 2
      || current.estimatedMaxGenerationNeurons + budget + reserve > IMAGE_WORKERS_FREE_QUOTA_V1.dailyNeurons) {
      current = {
        index: shards.length, caseIds: [], sourceImageSha256s: [],
        instructionSha256s: [], estimatedMaxGenerationNeurons: 0,
        differentUtcDayRequired: true,
      };
      shards.push(current);
    }
    current.caseIds.push(task.caseId);
    current.sourceImageSha256s.push(task.sourceImageSha256.toLowerCase());
    current.instructionSha256s.push(task.instructionSha256.toLowerCase());
    current.estimatedMaxGenerationNeurons =
      Math.ceil((current.estimatedMaxGenerationNeurons + budget) * 100) / 100;
    if (current.estimatedMaxGenerationNeurons + reserve > IMAGE_WORKERS_FREE_QUOTA_V1.dailyNeurons) {
      throw new Error('IMAGE_EDIT_FREE_PLAN_DAILY_QUOTA_UNSAFE');
    }
  }
  if (families.size !== 8 || [...families.values()].some(count => count !== 2)
    || shards.length !== 8) throw new Error('IMAGE_EDIT_FREE_PLAN_FAMILY_OR_SHARD_COVERAGE_INVALID');
  const identity = {
    candidateSha: candidateSha.toLowerCase(), corpusDigest: corpusDigest.toLowerCase(),
    model: '@cf/black-forest-labs/flux-2-klein-9b' as const,
    shards,
  };
  const planDigest = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  return {
    schemaVersion: 'origin.image-edit-free-shard-plan.v1',
    ...identity, planDigest, maxDailyNeurons: 10000,
    reservedCriticNeurons: reserve,
    allSixteenCasesRequired: true, realQuotaProofRequired: true, exactShaRequired: true,
    blindEditBenchmarkPassed: false, productionQualified: false,
  };
}
