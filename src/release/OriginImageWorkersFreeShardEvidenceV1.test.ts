// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { planImageWorkersFreeShardsV1 } from './OriginImageWorkersFreeShardPlanV1.js';
import { digestImageWorkersFreeReceiptV1, inspectImageWorkersFreeShardsV1 } from './OriginImageWorkersFreeShardEvidenceV1.js';
import type { ImageWorkersFreeShardReceiptV1 } from './OriginImageWorkersFreeShardEvidenceV1.js';

const HEAD = 'a'.repeat(40);
const CORPUS = 'b'.repeat(64);
const tasks = Array.from({ length: 24 }, (_, i) => ({
  caseId: 'sealed-image-' + i.toString().padStart(2, '0'),
  taskDigest: i.toString(16).padStart(64, '0'),
  width: 1024, height: 1024,
}));
const plan = planImageWorkersFreeShardsV1(HEAD, CORPUS, tasks);
const reviewTime = new Date('2026-10-20T12:00:00Z');

function receipt(index: number): ImageWorkersFreeShardReceiptV1 {
  const shard = plan.shards[index];
  const body = {
    schemaVersion: 'origin.image-workers-free-shard-receipt.v1' as const,
    candidateSha: HEAD, corpusDigest: CORPUS, planDigest: plan.planDigest, model: plan.model,
    shardIndex: index, workflowRunId: String(20000 + index),
    utcDay: '2026-10-' + String(index + 1).padStart(2, '0'),
    freeOnly: true as const, paidFallbackUsed: false as const,
    freePlanVerified: true as const, totalCostUsd: 0 as const,
    claimedGenerationNeurons: 5000, claimedQuotaAvailableBeforeNeurons: 9500,
    cases: shard.caseIds.map((caseId, i) => ({
      caseId, taskDigest: shard.taskDigests[i], outputSha256: 'c'.repeat(64),
      providerId: 'cloudflare-workers-ai-free' as const, costUsd: 0 as const,
      technicalPassed: true as const, semanticPassed: true as const, outputCompleted: true as const,
    })),
  };
  return { ...body, receiptDigest: digestImageWorkersFreeReceiptV1(body) };
}
function resign(packet: ImageWorkersFreeShardReceiptV1): ImageWorkersFreeShardReceiptV1 {
  const { receiptDigest: _old, ...body } = packet;
  return { ...body, receiptDigest: digestImageWorkersFreeReceiptV1(body) };
}
const allReceipts = () => plan.shards.map((_, i) => receipt(i));

describe('Workers Free image shard evidence continuity (metadata only)', () => {
  it('accepts complete 24-case hash continuity but NEVER claims provenance or quality qualification', () => {
    const result = inspectImageWorkersFreeShardsV1(plan, allReceipts(), reviewTime);
    expect(result).toMatchObject({
      expectedCases: 24, receivedCases: 24, receivedShards: 12,
      integrityPassed: true, trustedProvenanceVerified: false,
      independentBlindQualityPassed: false, productionQualified: false, blockers: [],
    });
  });

  it('rejects omissions, duplicate shards and same-day replays', () => {
    expect(inspectImageWorkersFreeShardsV1(plan, allReceipts().slice(0, 11), reviewTime).integrityPassed).toBe(false);
    const duplicate = allReceipts(); duplicate[1] = resign({ ...duplicate[1], shardIndex: 0 });
    expect(inspectImageWorkersFreeShardsV1(plan, duplicate, reviewTime).blockers).toContain('shard-1:DUPLICATE_SHARD_INDEX');
    const replay = allReceipts(); replay[1] = resign({ ...replay[1], utcDay: replay[0].utcDay });
    expect(inspectImageWorkersFreeShardsV1(plan, replay, reviewTime).blockers).toContain('shard-1:UTC_DAY_INVALID_OR_REUSED');
  });

  it('rejects different source SHA, corpus and altered case digest, including re-signed packets', () => {
    for (const update of [
      { candidateSha: 'f'.repeat(40) },
      { corpusDigest: 'e'.repeat(64) },
      { planDigest: 'd'.repeat(64) },
    ]) {
      const copies = allReceipts(); copies[0] = resign({ ...copies[0], ...update });
      expect(inspectImageWorkersFreeShardsV1(plan, copies, reviewTime).integrityPassed).toBe(false);
    }
    const altered = allReceipts();
    altered[0] = resign({ ...altered[0], cases: [{ ...altered[0].cases[0], taskDigest: 'e'.repeat(64) }, altered[0].cases[1]] });
    expect(inspectImageWorkersFreeShardsV1(plan, altered, reviewTime).blockers).toContain('shard-0:CASE_ORDER_OR_DIGEST_MISMATCH');
  });

  it('rejects paid, broken, quota-overspent, future and stale claims', () => {
    const p = allReceipts();
    p[0] = resign({ ...p[0], totalCostUsd: 0.01 as 0 });
    expect(inspectImageWorkersFreeShardsV1(plan, p, reviewTime).blockers).toContain('shard-0:ZERO_COST_POLICY_INVALID');
    const q = allReceipts();
    q[0] = resign({ ...q[0], claimedGenerationNeurons: 12000 });
    expect(inspectImageWorkersFreeShardsV1(plan, q, reviewTime).blockers).toContain('shard-0:CLAIMED_QUOTA_BUDGET_INVALID');
    const e = allReceipts();
    e[0] = resign({ ...e[0], utcDay: '2026-12-01' });
    expect(inspectImageWorkersFreeShardsV1(plan, e, reviewTime).blockers).toContain('shard-0:EXPIRED_OR_FUTURE_RECEIPT');
    expect(inspectImageWorkersFreeShardsV1(plan, allReceipts(), new Date('2026-12-15T00:00:00Z')).integrityPassed).toBe(false);
  });

  it('detects unauthorized changes even when the attacker does not rehash them', () => {
    const p = allReceipts();
    p[0] = { ...p[0], workflowRunId: '999' };
    expect(inspectImageWorkersFreeShardsV1(plan, p, reviewTime).blockers).toContain('shard-0:RECEIPT_DIGEST_INVALID');
  });

  it('rejects fake plan digests rather than trusting received shard list blindly', () => {
    expect(() => inspectImageWorkersFreeShardsV1({ ...plan, planDigest: '0'.repeat(64) }, allReceipts(), reviewTime)).toThrow('IMAGE_FREE_SHARD_PLAN_INVALID');
  });
});
