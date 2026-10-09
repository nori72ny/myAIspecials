import { createHash } from 'node:crypto';

/**
 * Free-only, planning-time image evaluation budget. This is intentionally NOT
 * proof of actual remaining Workers AI Neurons, nor permission to start a run.
 * Every execution day still needs a verified Free plan and unused allocation.
 */
export const IMAGE_WORKERS_FREE_QUOTA_V1 = Object.freeze({
  dailyNeurons: 10_000,
  flux9bFirstMegapixelNeurons: 1_363.64,
  flux9bAdditionalMegapixelNeurons: 181.82,
  maxGenerationAttemptsPerCase: 2,
  reservedNeuronsForVisionCriticAndUnknownUsage: 3_000,
  maxCasesPerShard: 2,
  caseCount: 24,
} as const);

type FrozenTask = Readonly<{
  caseId: string;
  taskDigest: string;
  width: number;
  height: number;
}>;

export type ImageWorkersFreeShardPlanV1 = Readonly<{
  schemaVersion: 'origin.image-workers-free-shard-plan.v1';
  candidateSha: string;
  corpusDigest: string;
  planDigest: string;
  freeDailyNeurons: number;
  reservedNeurons: number;
  model: '@cf/black-forest-labs/flux-2-klein-9b';
  estimatedFirstAttemptNeurons: number;
  requiresLiveFreePlanAndQuotaProof: true;
  manualOnly: true;
  shards: readonly Readonly<{
    index: number;
    caseIds: readonly string[];
    taskDigests: readonly string[];
    estimatedGenerationNeurons: number;
    mustUseDistinctUtcDay: true;
  }>[];
}>;

const SHA40 = /^[a-f0-9]{40}$/i;
const SHA64 = /^[a-f0-9]{64}$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/;

function minimum9bNeuronsPerOutput(width: number, height: number): number {
  const megapixels = width * height / (1024 * 1024);
  const extraMegapixels = Math.max(0, megapixels - 1);
  return IMAGE_WORKERS_FREE_QUOTA_V1.flux9bFirstMegapixelNeurons
    + extraMegapixels * IMAGE_WORKERS_FREE_QUOTA_V1.flux9bAdditionalMegapixelNeurons;
}

/** 24 first-megapixel outputs alone exceed Workers Free's 10,000 Neurons/day. */
export function monolithicImageFreePlanIsSafeV1(caseCount: number): boolean {
  return Number.isInteger(caseCount) && caseCount >= 0
    && caseCount * IMAGE_WORKERS_FREE_QUOTA_V1.flux9bFirstMegapixelNeurons
      + IMAGE_WORKERS_FREE_QUOTA_V1.reservedNeuronsForVisionCriticAndUnknownUsage
        <= IMAGE_WORKERS_FREE_QUOTA_V1.dailyNeurons;
}

/**
 * Creates immutable shard IDs from the validated sealed corpus's original order.
 * No prompt text is needed or returned. This is NOT a runtime quota ledger.
 */
export function planImageWorkersFreeShardsV1(
  candidateSha: string,
  corpusDigest: string,
  tasks: readonly FrozenTask[],
): ImageWorkersFreeShardPlanV1 {
  if (!SHA40.test(candidateSha) || !SHA64.test(corpusDigest)) {
    throw new Error('IMAGE_FREE_SHARD_EXACT_IDENTITY_REQUIRED');
  }
  if (!Array.isArray(tasks) || tasks.length !== IMAGE_WORKERS_FREE_QUOTA_V1.caseCount) {
    throw new Error('IMAGE_FREE_SHARD_24_CASES_REQUIRED');
  }
  const seen = new Set<string>();
  for (const task of tasks) {
    if (!SAFE_ID.test(task.caseId) || !SHA64.test(task.taskDigest)
      || seen.has(task.caseId)
      || !Number.isInteger(task.width) || !Number.isInteger(task.height)
      || task.width < 256 || task.height < 256
      || task.width > 1536 || task.height > 1536) {
      throw new Error('IMAGE_FREE_SHARD_TASK_INVALID_OR_DUPLICATED');
    }
    seen.add(task.caseId);
  }

  const policy = IMAGE_WORKERS_FREE_QUOTA_V1;
  const shards: Array<{
    index: number;
    caseIds: string[];
    taskDigests: string[];
    estimatedGenerationNeurons: number;
    mustUseDistinctUtcDay: true;
  }> = [];
  let estimatedFirstAttemptNeurons = 0;

  for (const task of tasks) {
    const first = minimum9bNeuronsPerOutput(task.width, task.height);
    estimatedFirstAttemptNeurons += first;
    // Price planning pessimistically assumes the permitted one repair for EVERY case.
    const projected = first * policy.maxGenerationAttemptsPerCase;
    if (projected + policy.reservedNeuronsForVisionCriticAndUnknownUsage > policy.dailyNeurons) {
      throw new Error('IMAGE_FREE_SHARD_SINGLE_CASE_EXCEEDS_DAY_BUDGET');
    }
    let current = shards[shards.length - 1];
    if (!current
      || current.caseIds.length >= policy.maxCasesPerShard
      || current.estimatedGenerationNeurons + projected
        + policy.reservedNeuronsForVisionCriticAndUnknownUsage > policy.dailyNeurons) {
      current = {
        index: shards.length,
        caseIds: [],
        taskDigests: [],
        estimatedGenerationNeurons: 0,
        mustUseDistinctUtcDay: true,
      };
      shards.push(current);
    }
    current.caseIds.push(task.caseId);
    current.taskDigests.push(task.taskDigest.toLowerCase());
    current.estimatedGenerationNeurons = Math.ceil(
      (current.estimatedGenerationNeurons + projected) * 100,
    ) / 100;
  }
  const frozenIdentity = {
    candidateSha: candidateSha.toLowerCase(),
    corpusDigest: corpusDigest.toLowerCase(),
    model: '@cf/black-forest-labs/flux-2-klein-9b' as const,
    shards,
  };
  const planDigest = createHash('sha256').update(JSON.stringify(frozenIdentity)).digest('hex');
  return Object.freeze({
    schemaVersion: 'origin.image-workers-free-shard-plan.v1',
    ...frozenIdentity,
    planDigest,
    freeDailyNeurons: policy.dailyNeurons,
    reservedNeurons: policy.reservedNeuronsForVisionCriticAndUnknownUsage,
    estimatedFirstAttemptNeurons: Math.ceil(estimatedFirstAttemptNeurons * 100) / 100,
    requiresLiveFreePlanAndQuotaProof: true,
    manualOnly: true,
  });
}
