import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { readRasterDimensionsV15 } from '../src/creative/rasterImageCriticV15.js';
import { planImageWorkersFreeShardsV1 } from '../src/release/OriginImageWorkersFreeShardPlanV1.js';

type J = Record<string, unknown>;
function need(ok: unknown, code: string): asserts ok {
  if (!ok) throw new Error('IMAGE_SHARD_LOCAL_' + code);
}
function digest(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
async function readJson(file: string): Promise<J> {
  const info = await fs.lstat(file);
  need(info.isFile() && info.size > 0 && info.size <= 5_000_000, 'JSON_FILE_INVALID');
  const data: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
  need(data && typeof data === 'object' && !Array.isArray(data), 'JSON_OBJECT_INVALID');
  return data as J;
}
function array(value: unknown): J[] {
  need(Array.isArray(value) && value.every(v => !!v && typeof v === 'object' && !Array.isArray(v)), 'ROWS_INVALID');
  return value as J[];
}
async function main() {
  const root = path.resolve(process.env.ORIGIN_IMAGE_SHARD_BUNDLE_ROOT?.trim() || '');
  const sha = process.env.ORIGIN_IMAGE_CANDIDATE_SHA?.trim().toLowerCase() || '';
  const expectedPlan = process.env.ORIGIN_IMAGE_SHARD_PLAN_DIGEST?.trim().toLowerCase() || '';
  need(root && /^[a-f0-9]{40}$/.test(sha) && /^[a-f0-9]{64}$/.test(expectedPlan), 'INPUT_INVALID');
  const one = await readJson(path.join(root, 'shard-0', 'public-tasks.json'));
  need(one.candidateSha === sha && one.fullCorpusCases === 24
    && one.evaluationMode === 'single-free-shard'
    && typeof one.corpusDigest === 'string' && /^[a-f0-9]{64}$/.test(one.corpusDigest),
    'CORPUS_IDENTITY_INVALID');
  const publicTasks = array(one.tasks);
  need(publicTasks.length === 24, 'TASK_COUNT_INVALID');
  const corpusDigest = one.corpusDigest as string;
  const plan = planImageWorkersFreeShardsV1(sha, corpusDigest, publicTasks.map(v => ({
    caseId: String(v.caseId), taskDigest: String(v.taskDigest),
    width: Number(v.width), height: Number(v.height),
  })));
  need(plan.planDigest === expectedPlan, 'PLAN_DIGEST_MISMATCH');
  const frozenPublic = JSON.stringify({ ...one, shardIndex: null });
  const ranks = new Map(publicTasks.map((task, index) => [task.caseId, index]));
  const seenDays = new Set<string>();
  const seenRunIds = new Set<string>();
  const seenImageHashes = new Set<string>();
  const modelIds = new Set<string>();
  const shardEvidenceHashes: string[] = [];
  let total = 0;
  const browser = await chromium.launch({ headless: true });
  try {
  for (const shard of plan.shards) {
    const dir = path.join(root, 'shard-' + shard.index);
    const [pub, ev, summary, manifest] = await Promise.all([
      readJson(path.join(dir, 'public-tasks.json')),
      readJson(path.join(dir, 'candidate-evidence.json')),
      readJson(path.join(dir, 'candidate-summary.json')),
      readJson(path.join(dir, 'shard-manifest.json')),
    ]);
    // Each sanitized public record binds to its own shard index, while the frozen
    // 24-task corpus metadata must be identical across all twelve daily runs.
    need(pub.shardIndex === shard.index, 'PUBLIC_SHARD_INDEX_INVALID');
    need(JSON.stringify({ ...pub, shardIndex: null }) === frozenPublic,
      'PUBLIC_TASKS_MUTATED');
    for (const x of [ev, summary, manifest]) {
      need(x.candidateSha === sha && x.corpusDigest === corpusDigest
        && x.planDigest === expectedPlan && x.shardIndex === shard.index,
        'SHARD_IDENTITY_INVALID');
    }
    need(ev.evaluatorSha === sha && ev.evaluationMode === 'single-free-shard'
      && ev.totalCostUsd === 0 && ev.maxImageCostUsd === 0 && ev.maxTotalCostUsd === 0
      && Array.isArray(ev.blockers) && ev.blockers.length === 0, 'COST_OR_EVALUATOR_INVALID');
    need(summary.totalCostUsd === 0 && summary.attempted === shard.caseIds.length
      && summary.completed === shard.caseIds.length
      && summary.technicallyPassed === shard.caseIds.length
      && Array.isArray(summary.failures) && summary.failures.length === 0
      && Array.isArray(summary.blockers) && summary.blockers.length === 0,
      'SHARD_NOT_FULLY_PASSED');
    need(manifest.freeOnly === true && manifest.totalCostUsd === 0
      && manifest.trustedQuotaUsageVerified === false
      && manifest.trustedProvenanceVerified === false
      && manifest.blindBenchmarkPassed === false
      && manifest.productionQualified === false, 'MANIFEST_CLAIM_INVALID');
    const day = String(manifest.utcDay);
    const run = String(manifest.githubRunId);
    const date = new Date(day + 'T00:00:00.000Z');
    need(/^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(date.getTime())
      && date.toISOString().slice(0, 10) === day && !seenDays.has(day),
      'REUSED_OR_INVALID_UTC_DAY');
    need(/^[1-9][0-9]{0,19}$/.test(run) && !seenRunIds.has(run), 'REUSED_OR_INVALID_RUN_ID');
    seenDays.add(day);
    seenRunIds.add(run);
    const cases = array(ev.cases);
    need(cases.length === shard.caseIds.length
      && JSON.stringify(manifest.caseIds) === JSON.stringify(shard.caseIds)
      && JSON.stringify(manifest.expectedCaseIds) === JSON.stringify(shard.caseIds)
      && JSON.stringify(manifest.expectedTaskDigests) === JSON.stringify(shard.taskDigests),
      'SHARD_CASES_INVALID');
    const imageDir = path.join(dir, 'candidate-images');
    const files = await fs.readdir(imageDir);
    need(files.length === cases.length, 'IMAGE_FILE_COUNT_INVALID');
    for (const [local, item] of cases.entries()) {
      need(item.caseId === shard.caseIds[local]
        && item.taskDigest === shard.taskDigests[local]
        && item.providerId === 'cloudflare-workers-ai-free'
        && item.costUsd === 0 && item.failureCode === null, 'CASE_STATUS_INVALID');
      const o = item.output as J | null;
      const t = o?.technical as J | undefined;
      const s = item.semantic as J | null;
      need(o?.executionStatus === 'completed' && t && Object.values(t).every(v => v === true)
        && s?.passed === true && s.safetyPassed === true, 'CASE_QUALITY_INVALID');
      const outputHash = String(o.imageSha256);
      need(/^[a-f0-9]{64}$/.test(outputHash) && !seenImageHashes.has(outputHash)
        && (manifest.outputSha256s as unknown[])[local] === outputHash,
        'CASE_OUTPUT_DIGEST_INVALID');
      seenImageHashes.add(outputHash);
      const globalIndex = ranks.get(item.caseId);
      need(typeof globalIndex === 'number', 'CASE_NOT_PRECOMMITTED');
      const prefix = 'case-' + String(globalIndex + 1).padStart(2, '0') + '.';
      const names = files.filter(name => name.startsWith(prefix) && /\.(png|webp|jpg)$/.test(name));
      need(names.length === 1, 'OUTPUT_FILENAME_INVALID');
      const imgPath = path.join(imageDir, names[0]);
      const st = await fs.lstat(imgPath);
      need(st.isFile() && st.size >= 1024 && st.size <= 16 * 1024 * 1024, 'IMAGE_SIZE_INVALID');
      const bytes = await fs.readFile(imgPath);
      need(digest(bytes) === outputHash, 'IMAGE_BYTES_SHA256_MISMATCH');
      const mime = names[0].endsWith('.png') ? 'image/png'
        : names[0].endsWith('.webp') ? 'image/webp' : 'image/jpeg';
      const d = readRasterDimensionsV15(bytes, mime);
      need(d && d.width === item.actualWidth && d.height === item.actualHeight,
        'IMAGE_DIMENSIONS_OR_TYPE_INVALID');
      // Actual browser decoding; a forged PNG/JPEG/WebP header is not a valid image.
      const page = await browser.newPage();
      try {
        const decoded = await page.evaluate(async ({ imageUrl }) => {
          const img = new Image();
          img.src = imageUrl;
          await img.decode();
          const canvas = document.createElement('canvas');
          canvas.width = 1;
          canvas.height = 1;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('CANVAS_UNAVAILABLE');
          ctx.drawImage(img, 0, 0, 1, 1);
          ctx.getImageData(0, 0, 1, 1);
          return { width: img.naturalWidth, height: img.naturalHeight };
        }, { imageUrl: 'data:' + mime + ';base64,' + bytes.toString('base64') });
        need(decoded.width === d.width && decoded.height === d.height,
          'BROWSER_DECODE_DIMENSIONS_MISMATCH');
      } catch {
        throw new Error('IMAGE_SHARD_LOCAL_BROWSER_DECODE_FAILED');
      } finally {
        await page.close();
      }
      need(item.modelId === '@cf/black-forest-labs/flux-2-klein-9b', 'EXACT_9B_MODEL_REQUIRED');
      modelIds.add(item.modelId as string);
      total += 1;
    }
    shardEvidenceHashes.push(digest(JSON.stringify(ev)));
  }
  } finally {
    await browser.close();
  }
  need(total === 24 && seenImageHashes.size === 24 && seenDays.size === plan.shards.length
    && seenRunIds.size === plan.shards.length && modelIds.size === 1,
    'ROUND_INCOMPLETE_OR_MODEL_DRIFT');
  const report = {
    schemaVersion: 'origin.image-free-shard-local-integrity.v1',
    candidateSha: sha, corpusDigest, planDigest: expectedPlan,
    imageCaseCount: total, distinctUtcDays: seenDays.size,
    shardEvidenceHashes, localBytesAndMetadataIntegrityPassed: true,
    // Local files are not authenticated GitHub artifacts or independent blind judges.
    authenticatedGitHubArtifactProvenance: false,
    liveFreeQuotaUsageVerified: false,
    independentBlindQualityPassed: false,
    ownerVisualApproval: false,
    productionQualified: false,
  };
  await fs.writeFile(path.join(root, 'local-integrity-report.json'),
    JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(JSON.stringify(report) + '\n');
}
main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : '';
  process.stderr.write((/^IMAGE_SHARD_LOCAL_[A-Z0-9_:]{3,160}$/.test(message)
    ? message : 'IMAGE_SHARD_LOCAL_VERIFY_FAILED') + '\n');
  process.exitCode = 1;
});
