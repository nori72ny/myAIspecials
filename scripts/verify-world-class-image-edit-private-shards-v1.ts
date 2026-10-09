import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { readBoundedImageEvaluationArtifactV1 } from './read-bounded-image-evaluation-artifact-v1.js';
import path from 'node:path';
import { chromium } from 'playwright';

import { readRasterDimensionsV15 } from '../src/creative/rasterImageCriticV15.js';
import { planImageEditFreeShardsV1 } from '../src/release/OriginImageEditFreeShardPlanV1.js';

type Row = Record<string, unknown>;
const SHA256 = /^[a-f0-9]{64}$/;
function requireValid(value: unknown, code: string): asserts value {
  if (!value) throw new Error('IMAGE_EDIT_SHARD_AUDIT_' + code);
}
function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}
async function readJson(file: string): Promise<Row> {
  const jsonBytes = await readBoundedImageEvaluationArtifactV1(file, 4_000_000);
  const raw: unknown = JSON.parse(jsonBytes.toString('utf8'));
  requireValid(raw && typeof raw === 'object' && !Array.isArray(raw), 'JSON_OBJECT_INVALID');
  return raw as Row;
}
function rows(raw: unknown): Row[] {
  requireValid(Array.isArray(raw) && raw.every(v => v && typeof v === 'object' && !Array.isArray(v)),
    'ROWS_INVALID');
  return raw as Row[];
}
async function verify() {
  const rootEnv = process.env.ORIGIN_IMAGE_EDIT_SHARD_BUNDLE_ROOT?.trim();
  const sha = process.env.ORIGIN_IMAGE_EDIT_CANDIDATE_SHA?.trim().toLowerCase() || '';
  const planDigest = process.env.ORIGIN_IMAGE_EDIT_SHARD_PLAN_DIGEST?.trim().toLowerCase() || '';
  requireValid(rootEnv && /^[a-f0-9]{40}$/.test(sha) && SHA256.test(planDigest),
    'EXACT_INPUT_REQUIRED');
  const root = path.resolve(rootEnv);
  const first = await readJson(path.join(root, 'shard-0', 'public-tasks.json'));
  requireValid(first.candidateSha === sha && first.fullCorpusCases === 16
    && first.evaluationMode === 'v16-free-edit-shard'
    && typeof first.corpusDigest === 'string' && SHA256.test(first.corpusDigest),
    'FROZEN_CORPUS_INVALID');
  const corpusDigest = first.corpusDigest as string;
  const publicCases = rows(first.tasks);
  requireValid(publicCases.length === 16, 'PUBLIC_EDIT_TASKS_INVALID');
  const plan = planImageEditFreeShardsV1(sha, corpusDigest, publicCases.map(task => ({
    caseId: String(task.caseId), family: String(task.family),
    turnIndex: Number(task.turnIndex),
    instructionSha256: String(task.instructionSha256),
    sourceImageSha256: String(task.sourceImageSha256),
    width: Number(task.width), height: Number(task.height),
  })));
  requireValid(plan.planDigest === planDigest && plan.shards.length === 8,
    'IMMUTABLE_EDIT_PLAN_INVALID');
  const provenance = await readJson(path.join(root, 'github-provenance.json'));
  requireValid(provenance.candidateSha === sha && provenance.corpusDigest === corpusDigest
    && provenance.planDigest === planDigest
    && provenance.editCaseCountRequired === 16
    && provenance.usesExactV16EditingRoute === true
    && provenance.downloadedViaAuthenticatedGithubCLI === true
    && provenance.trustedGithubRunAndArtifactMetadata === true
    && provenance.productionQualified === false,
    'REPORTED_PROVENANCE_INCOMPLETE');
  const trustedRuns = rows(provenance.shards);
  requireValid(trustedRuns.length === 8, 'TRUSTED_RUN_SET_INCOMPLETE');

  const frozenPublic = JSON.stringify({ ...first, shardIndex: null });
  const ranks = new Map(publicCases.map((task, i) => [task.caseId, i]));
  const seenDays = new Set<string>();
  const seenRuns = new Set<string>();
  const seenImages = new Set<string>();
  const models = new Set<string>();
  const shardDigests: string[] = [];
  let total = 0;
  const browser = await chromium.launch({ headless: true });
  try {
    for (const shard of plan.shards) {
      const dir = path.join(root, 'shard-' + shard.index);
      const [pub, evidence, summary, manifest] = await Promise.all([
        readJson(path.join(dir, 'public-tasks.json')),
        readJson(path.join(dir, 'candidate-evidence.json')),
        readJson(path.join(dir, 'candidate-summary.json')),
        readJson(path.join(dir, 'shard-manifest.json')),
      ]);
      requireValid(pub.shardIndex === shard.index
        && JSON.stringify({ ...pub, shardIndex: null }) === frozenPublic,
        'PUBLIC_TASKS_DRIFTED');
      for (const packet of [evidence, summary, manifest]) {
        requireValid(packet.candidateSha === sha && packet.corpusDigest === corpusDigest
          && packet.planDigest === planDigest && packet.shardIndex === shard.index,
          'CANDIDATE_OR_SHARD_IDENTITY_DRIFT');
      }
      requireValid(evidence.evaluatorSha === sha
        && evidence.originSystemId === 'origin-world-class-free-edit-v16'
        && evidence.evaluationMode === 'v16-free-edit-shard'
        && evidence.totalCostUsd === 0 && evidence.freeOnly === true
        && evidence.productionQualified === false
        && evidence.independentBlindEditQualityPassed === false
        && Array.isArray(evidence.blockers) && evidence.blockers.length === 0,
        'EDIT_EVIDENCE_INVALID');
      requireValid(summary.attempted === shard.caseIds.length
        && summary.completed === shard.caseIds.length
        && summary.technicallyQualified === shard.caseIds.length
        && summary.totalCostUsd === 0
        && Array.isArray(summary.blockers) && summary.blockers.length === 0
        && summary.qualificationStatus === 'NOT_MEASURED',
        'EDIT_SUMMARY_INVALID');
      requireValid(manifest.totalCostUsd === 0 && manifest.paidFallbackEnabled === false
        && manifest.productionQualified === false
        && manifest.independentBlindEditQualityPassed === false
        && manifest.trustedProviderUsageVerified === false
        && manifest.authenticatedGitHubArtifactProvenance === false
        && Array.isArray(manifest.blockers) && manifest.blockers.length === 0,
        'EDIT_MANIFEST_UNTRUSTED_OR_INVALID');
      const trusted = trustedRuns[shard.index];
      const day = String(manifest.utcDay);
      const run = String(manifest.githubRunId);
      const date = new Date(day + 'T00:00:00.000Z');
      requireValid(trusted.shardIndex === shard.index
        && trusted.githubRunId === Number(run) && trusted.utcDay === day
        && trusted.markerName === 'origin-image-free-edit-shard-started-'
          + sha + '-' + corpusDigest + '-' + shard.index
        && trusted.outputArtifactName === 'origin-image-free-edit-shard-output-'
          + sha + '-' + shard.index + '-' + run
        && typeof trusted.artifactDigest === 'string'
        && /^sha256:[a-f0-9]{64}$/.test(trusted.artifactDigest)
        && /^[1-9][0-9]{0,19}$/.test(run) && !seenRuns.has(run)
        && /^\d{4}-\d{2}-\d{2}$/.test(day)
        && !Number.isNaN(date.getTime())
        && date.toISOString().slice(0, 10) === day
        && !seenDays.has(day), 'EDIT_DAY_OR_RUN_REPLAYED');
      seenDays.add(day);
      seenRuns.add(run);
      requireValid(JSON.stringify(manifest.caseIds) === JSON.stringify(shard.caseIds)
        && JSON.stringify(manifest.sourceImageSha256s) === JSON.stringify(shard.sourceImageSha256s)
        && JSON.stringify(manifest.instructionSha256s) === JSON.stringify(shard.instructionSha256s),
        'SOURCE_INSTRUCTION_CASE_DRIFT');
      const cases = rows(evidence.cases);
      requireValid(cases.length === shard.caseIds.length, 'EDIT_CASE_COUNT_INCOMPLETE');
      const imageDir = path.join(dir, 'candidate-images');
      const filenames = await fs.readdir(imageDir);
      requireValid(filenames.length === cases.length, 'EDIT_IMAGE_FILE_SET_INVALID');
      for (const [index, item] of cases.entries()) {
        requireValid(item.caseId === shard.caseIds[index]
          && item.sourceImageSha256 === shard.sourceImageSha256s[index]
          && item.instructionSha256 === shard.instructionSha256s[index]
          && item.executionStatus === 'completed'
          && item.structuralCriticPassed === true
          && item.deliveryIntegrityPassed === true
          && item.identicalToSource === false
          && item.providerId === 'cloudflare-workers-ai-free'
          && item.failureCode === null, 'EDIT_CASE_INVALID');
        const imageSha = String(item.outputImageSha256);
        requireValid(SHA256.test(imageSha) && !seenImages.has(imageSha)
          && (manifest.outputImageSha256s as unknown[])[index] === imageSha
          && imageSha !== item.sourceImageSha256,
          'EDIT_OUTPUT_REUSED_OR_UNCHANGED');
        seenImages.add(imageSha);
        const globalIndex = ranks.get(item.caseId);
        requireValid(typeof globalIndex === 'number', 'CASE_NOT_PRECOMMITTED');
        const prefix = 'case-' + String(globalIndex + 1).padStart(2, '0') + '.';
        const candidates = filenames.filter(name => name.startsWith(prefix)
          && /\.(png|webp|jpg)$/.test(name));
        requireValid(candidates.length === 1, 'EDIT_IMAGE_FILENAME_INVALID');
        const filepath = path.join(imageDir, candidates[0]);
        const image = await readBoundedImageEvaluationArtifactV1(filepath, 12 * 1024 * 1024);
        requireValid(image.length >= 1024, 'EDIT_IMAGE_SIZE_INVALID');
        requireValid(sha256(image) === imageSha, 'EDIT_IMAGE_BYTES_CHANGED');
        const mime = candidates[0].endsWith('.png') ? 'image/png'
          : candidates[0].endsWith('.webp') ? 'image/webp' : 'image/jpeg';
        const dimensions = readRasterDimensionsV15(image, mime);
        requireValid(dimensions && dimensions.width === item.width
          && dimensions.height === item.height, 'EDIT_IMAGE_DIMENSIONS_INVALID');
        const page = await browser.newPage();
        try {
          const decoded = await page.evaluate(async (input) => {
            const img = new Image();
            img.src = input;
            await img.decode();
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 1;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('IMAGE_CANVAS_INVALID');
            context.drawImage(img, 0, 0, 1, 1);
            context.getImageData(0, 0, 1, 1);
            return { width: img.naturalWidth, height: img.naturalHeight };
          }, 'data:' + mime + ';base64,' + image.toString('base64'));
          requireValid(decoded.width === dimensions.width
            && decoded.height === dimensions.height, 'EDIT_IMAGE_BROWSER_DECODE_INVALID');
        } finally {
          await page.close();
        }
        requireValid(item.modelId === '@cf/black-forest-labs/flux-2-klein-9b',
          'EDIT_EXACT_9B_MODEL_REQUIRED');
        models.add(item.modelId as string);
        total++;
      }
      shardDigests.push(sha256(JSON.stringify(evidence)));
    }
  } finally {
    await browser.close();
  }
  requireValid(total === 16 && seenImages.size === 16 && seenRuns.size === 8
    && seenDays.size === 8 && models.size === 1,
    'EDIT_BENCHMARK_ROUND_INCOMPLETE');
  const report = {
    schemaVersion: 'origin.image-free-edit-shard-local-integrity.v1',
    candidateSha: sha, corpusDigest, planDigest,
    editCaseCount: 16, distinctUtcDays: seenDays.size,
    distinctRunIds: seenRuns.size, shardEvidenceDigests: shardDigests,
    localEditImagesAndMetadataVerified: true,
    // Editing locality, instruction fidelity and preserved identity require blind visual judges.
    sourcePreservationBlindlyEvaluated: false,
    authenticatedGithubMetadataIndependentlyRechecked: false,
    liveCloudflareQuotaUsageVerified: false,
    independentBlindEditQualityPassed: false,
    ownerVisualApproval: false,
    productionQualified: false,
  };
  await fs.writeFile(path.join(root, 'edit-local-integrity-report.json'),
    JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(JSON.stringify({
    event: 'world-class-image-edit-16-case-integrity-verified',
    editCaseCount: 16, planDigest, productionQualified: false,
  }) + '\n');
}
verify().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : '';
  process.stderr.write((/^IMAGE_EDIT_SHARD_AUDIT_[A-Z0-9_]{3,160}$/.test(message)
    ? message : 'IMAGE_EDIT_SHARD_AUDIT_FAILED') + '\n');
  process.exitCode = 1;
});
