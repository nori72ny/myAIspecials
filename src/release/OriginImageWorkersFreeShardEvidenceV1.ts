import { createHash } from 'node:crypto';

import type { ImageWorkersFreeShardPlanV1 } from './OriginImageWorkersFreeShardPlanV1.js';

/**
 * Checks image evidence continuity across distinct Workers Free UTC days.
 * This is INTEGRITY-ONLY. Untrusted uploaded JSON does not establish its own
 * GitHub run identity, actual provider quota or independent blind quality.
 * A separate trusted artifact/provenance verifier and blind scorer are required.
 */
export type ImageWorkersFreeShardReceiptV1 = Readonly<{
  schemaVersion: 'origin.image-workers-free-shard-receipt.v1';
  candidateSha: string;
  corpusDigest: string;
  planDigest: string;
  model: '@cf/black-forest-labs/flux-2-klein-9b';
  shardIndex: number;
  workflowRunId: string;
  utcDay: string;
  freeOnly: true;
  paidFallbackUsed: false;
  freePlanVerified: true;
  totalCostUsd: 0;
  claimedGenerationNeurons: number;
  claimedQuotaAvailableBeforeNeurons: number;
  cases: readonly Readonly<{
    caseId: string;
    taskDigest: string;
    outputSha256: string;
    providerId: 'cloudflare-workers-ai-free';
    costUsd: 0;
    technicalPassed: true;
    semanticPassed: true;
    outputCompleted: true;
  }>[];
  receiptDigest: string;
}>;

export type ImageWorkersFreeShardsIntegrityReportV1 = Readonly<{
  schemaVersion: 'origin.image-workers-free-shard-integrity-report.v1';
  candidateSha: string;
  corpusDigest: string;
  planDigest: string;
  expectedCases: 24;
  receivedCases: number;
  receivedShards: number;
  blockers: readonly string[];
  integrityPassed: boolean;
  trustedProvenanceVerified: false;
  independentBlindQualityPassed: false;
  productionQualified: false;
}>;

const SHA256 = /^[a-f0-9]{64}$/;
const SHA40 = /^[a-f0-9]{40}$/;
const UTC_DAY = /^\d{4}-\d{2}-\d{2}$/;
const RUN_ID = /^[1-9][0-9]{0,19}$/;
const MAX_AGE_DAYS = 31;
const DAY_MS = 24 * 60 * 60 * 1000;

function sha(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function digestImageWorkersFreeReceiptV1(
  receipt: Omit<ImageWorkersFreeShardReceiptV1, 'receiptDigest'>,
): string {
  return sha(receipt);
}

function validDay(value: unknown): number | null {
  if (typeof value !== 'string' || !UTC_DAY.test(value)) return null;
  const date = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date.getTime();
}

function validPlan(plan: ImageWorkersFreeShardPlanV1): boolean {
  if (!plan || plan.schemaVersion !== 'origin.image-workers-free-shard-plan.v1'
    || !SHA40.test(plan.candidateSha) || !SHA256.test(plan.corpusDigest)
    || !SHA256.test(plan.planDigest) || plan.shards?.length < 1) return false;
  const identity = { candidateSha: plan.candidateSha, corpusDigest: plan.corpusDigest, model: plan.model, shards: plan.shards };
  if (sha(identity) !== plan.planDigest) return false;
  if (plan.model !== '@cf/black-forest-labs/flux-2-klein-9b'
    || plan.freeDailyNeurons !== 10_000
    || plan.requiresLiveFreePlanAndQuotaProof !== true
    || plan.manualOnly !== true) return false;
  const all = plan.shards.flatMap(s => s.caseIds);
  if (all.length !== 24 || new Set(all).size !== 24) return false;
  return plan.shards.every((s, index) => s.index === index
    && s.mustUseDistinctUtcDay === true
    && s.caseIds.length >= 1
    && s.caseIds.length <= 2
    && s.taskDigests.length === s.caseIds.length
    && s.taskDigests.every(d => SHA256.test(d))
    && s.estimatedGenerationNeurons + plan.reservedNeurons <= plan.freeDailyNeurons);
}

export function inspectImageWorkersFreeShardsV1(
  plan: ImageWorkersFreeShardPlanV1,
  receipts: readonly ImageWorkersFreeShardReceiptV1[],
  now: Date = new Date(),
): ImageWorkersFreeShardsIntegrityReportV1 {
  if (!validPlan(plan)) throw new Error('IMAGE_FREE_SHARD_PLAN_INVALID');
  if (!Number.isFinite(now.getTime())) throw new Error('IMAGE_FREE_SHARD_REVIEW_TIME_INVALID');
  const blockers: string[] = [];
  const seenIndexes = new Set<number>();
  const seenUtcDays = new Set<string>();
  const seenRunIds = new Set<string>();
  const seenCases = new Set<string>();
  if (!Array.isArray(receipts) || receipts.length > plan.shards.length) {
    blockers.push('IMAGE_FREE_SHARD_RECEIPT_COUNT_INVALID');
  }
  for (const [receiptOffset, packet] of (Array.isArray(receipts) ? receipts : []).entries()) {
    const label = 'shard-' + receiptOffset;
    if (!packet || packet.schemaVersion !== 'origin.image-workers-free-shard-receipt.v1') {
      blockers.push(label + ':INVALID_SCHEMA'); continue;
    }
    if (packet.candidateSha !== plan.candidateSha
      || packet.corpusDigest !== plan.corpusDigest || packet.planDigest !== plan.planDigest
      || packet.model !== plan.model) blockers.push(label + ':EXACT_IDENTITY_MISMATCH');
    if (!Number.isInteger(packet.shardIndex) || !plan.shards[packet.shardIndex]) {
      blockers.push(label + ':SHARD_INDEX_INVALID'); continue;
    }
    if (seenIndexes.has(packet.shardIndex)) blockers.push(label + ':DUPLICATE_SHARD_INDEX');
    seenIndexes.add(packet.shardIndex);
    if (!RUN_ID.test(packet.workflowRunId) || seenRunIds.has(packet.workflowRunId)) {
      blockers.push(label + ':RUN_ID_INVALID_OR_REUSED');
    }
    seenRunIds.add(packet.workflowRunId);
    const utcMs = validDay(packet.utcDay);
    if (utcMs === null || seenUtcDays.has(packet.utcDay)) blockers.push(label + ':UTC_DAY_INVALID_OR_REUSED');
    seenUtcDays.add(packet.utcDay);
    if (utcMs !== null) {
      if (utcMs > now.getTime() || now.getTime() - utcMs >= MAX_AGE_DAYS * DAY_MS) {
        blockers.push(label + ':EXPIRED_OR_FUTURE_RECEIPT');
      }
    }
    if (packet.freeOnly !== true || packet.paidFallbackUsed !== false
      || packet.freePlanVerified !== true || packet.totalCostUsd !== 0) {
      blockers.push(label + ':ZERO_COST_POLICY_INVALID');
    }
    if (!Number.isFinite(packet.claimedGenerationNeurons)
      || packet.claimedGenerationNeurons < 0
      || !Number.isFinite(packet.claimedQuotaAvailableBeforeNeurons)
      || packet.claimedQuotaAvailableBeforeNeurons < 0
      || packet.claimedQuotaAvailableBeforeNeurons > plan.freeDailyNeurons
      || packet.claimedGenerationNeurons > packet.claimedQuotaAvailableBeforeNeurons) {
      blockers.push(label + ':CLAIMED_QUOTA_BUDGET_INVALID');
    }
    if (!SHA256.test(packet.receiptDigest)
      || digestImageWorkersFreeReceiptV1((({ receiptDigest: _digest, ...rest }) => rest)(packet)) !== packet.receiptDigest) {
      blockers.push(label + ':RECEIPT_DIGEST_INVALID');
    }
    const expected = plan.shards[packet.shardIndex];
    if (!Array.isArray(packet.cases)
      || packet.cases.length !== expected.caseIds.length
      || packet.cases.some((item, index) => item?.caseId !== expected.caseIds[index]
        || item?.taskDigest !== expected.taskDigests[index])) {
      blockers.push(label + ':CASE_ORDER_OR_DIGEST_MISMATCH');
    }
    for (const item of (Array.isArray(packet.cases) ? packet.cases : [])) {
      if (!item || typeof item.caseId !== 'string') {
        blockers.push(label + ':CASE_ENTRY_INVALID'); continue;
      }
      if (seenCases.has(item.caseId)) blockers.push(label + ':DUPLICATE_CASE');
      seenCases.add(item.caseId);
      if (!SHA256.test(item.outputSha256)
        || item.providerId !== 'cloudflare-workers-ai-free'
        || item.costUsd !== 0 || item.technicalPassed !== true
        || item.semanticPassed !== true || item.outputCompleted !== true) {
        blockers.push(label + ':OUTPUT_OR_QUALITY_EVIDENCE_INVALID');
      }
    }
  }
  for (const shard of plan.shards) {
    if (!seenIndexes.has(shard.index)) blockers.push('MISSING_SHARD:' + shard.index);
  }
  for (const id of plan.shards.flatMap(s => s.caseIds)) {
    if (!seenCases.has(id)) blockers.push('MISSING_CASE:' + id);
  }
  const uniqueBlockers = [...new Set(blockers)];
  return {
    schemaVersion: 'origin.image-workers-free-shard-integrity-report.v1',
    candidateSha: plan.candidateSha, corpusDigest: plan.corpusDigest, planDigest: plan.planDigest,
    expectedCases: 24, receivedCases: seenCases.size, receivedShards: seenIndexes.size,
    blockers: uniqueBlockers, integrityPassed: uniqueBlockers.length === 0,
    trustedProvenanceVerified: false, independentBlindQualityPassed: false, productionQualified: false,
  };
}
