import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import express from 'express';
import { chromium } from 'playwright';

import { critiqueRasterStructureV15, readRasterDimensionsV15 } from '../src/creative/rasterImageCriticV15.js';
import { createWorldClassImageV16Router } from '../src/creative/worldClassImageV16Router.js';
import { getCloudflareRasterStatusV15 } from '../src/creative/cloudflareRasterImageProviderV15.js';
import { planImageEditFreeShardsV1 } from '../src/release/OriginImageEditFreeShardPlanV1.js';
import {
  validateImageEditPrivateCorpusV1,
  type ImageEditPrivateTaskV1,
  type OriginImageEditPrivateCorpusV1,
} from '../src/release/OriginImageEditPrivateCorpusV1.js';

type CandidateEditEvidence = {
  caseId: string;
  family: ImageEditPrivateTaskV1['family'];
  turnIndex: number;
  instructionSha256: string;
  sourceImageSha256: string;
  outputImageSha256: string;
  identicalToSource: boolean;
  executionStatus: 'completed' | 'blocked' | 'failed' | 'quota-limited';
  durationMs: number;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  structuralCriticPassed: boolean;
  deliveryIntegrityPassed: boolean;
  providerId: string | null;
  modelId: string | null;
  failureCode: string | null;
};

const EMPTY_SHA256 = createHash('sha256').update(Buffer.alloc(0)).digest('hex');
const MAX_CORPUS_BYTES = 6_000_000;
const MAX_OUTPUT_BYTES = 12 * 1024 * 1024;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`IMAGE_EDIT_PRIVATE_REQUIRED_ENV_MISSING:${name}`);
  return value;
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeCode(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_:.-]{0,180}$/.test(value) ? value : fallback;
}

async function responseJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const value = await response.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function classifyFailure(status: number, code: string | null): CandidateEditEvidence['executionStatus'] {
  if (status === 429 || code === 'CLOUDFLARE_FREE_ALLOCATION_EXHAUSTED') return 'quota-limited';
  if (status === 403 || status === 409 || status === 422) return 'blocked';
  return 'failed';
}

function extension(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

async function verifyAllEditSourcesDecodedV1(tasks: readonly ImageEditPrivateTaskV1[]): Promise<void> {
  // Do this once per sealed corpus, before ANY outbound image inference.
  // A PNG header or matching hash is insufficient to prove decodable image pixels.
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    try {
      for (const task of tasks) {
        let actual: { width: number; height: number };
        try {
          actual = await page.evaluate(async (source) => {
            const image = new Image();
            image.src = source;
            await imgDecode(image);
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 1;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('NO_CANVAS');
            context.drawImage(image, 0, 0, 1, 1);
            context.getImageData(0, 0, 1, 1);
            return { width: image.naturalWidth, height: image.naturalHeight };
            async function imgDecode(img: HTMLImageElement) { await img.decode(); }
          }, task.sourceImageDataUrl);
        } catch {
          throw new Error('IMAGE_EDIT_PRIVATE_SOURCE_BROWSER_DECODE_FAILED');
        }
        if (actual.width < 1 || actual.height < 1 || actual.width >= 512 || actual.height >= 512) {
          throw new Error('IMAGE_EDIT_PRIVATE_SOURCE_BROWSER_DIMENSIONS_INVALID');
        }
      }
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

async function evaluateEditCase(
  baseUrl: string,
  task: ImageEditPrivateTaskV1,
  caseIndex: number,
  executionBudgetMs: number,
  outputDir: string,
  candidateSha: string,
): Promise<CandidateEditEvidence> {
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/creative/v1.6/world-class/edit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'image/png,image/jpeg,image/webp,application/json' },
      body: JSON.stringify({
        prompt: task.instruction,
        width: task.width,
        height: task.height,
        referenceImages: [task.sourceImageDataUrl],
      }),
      signal: AbortSignal.timeout(Math.min(Math.max(executionBudgetMs, 10_000), 120_000)),
    });
  } catch {
    return {
      caseId: task.caseId,
      family: task.family,
      turnIndex: task.turnIndex,
      instructionSha256: task.instructionSha256,
      sourceImageSha256: task.sourceImageSha256,
      outputImageSha256: EMPTY_SHA256,
      identicalToSource: false,
      executionStatus: 'failed',
      durationMs: Date.now() - started,
      mimeType: null,
      width: null,
      height: null,
      structuralCriticPassed: false,
      deliveryIntegrityPassed: false,
      providerId: null,
      modelId: null,
      failureCode: 'IMAGE_EDIT_PRIVATE_FETCH_FAILED',
    };
  }

  if (!response.ok) {
    const body = await responseJson(response);
    const code = safeCode(body?.code, `IMAGE_EDIT_PRIVATE_HTTP_${response.status}`);
    return {
      caseId: task.caseId,
      family: task.family,
      turnIndex: task.turnIndex,
      instructionSha256: task.instructionSha256,
      sourceImageSha256: task.sourceImageSha256,
      outputImageSha256: EMPTY_SHA256,
      identicalToSource: false,
      executionStatus: classifyFailure(response.status, code),
      durationMs: Date.now() - started,
      mimeType: null,
      width: null,
      height: null,
      structuralCriticPassed: false,
      deliveryIntegrityPassed: false,
      providerId: null,
      modelId: null,
      failureCode: code,
    };
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const typedMime = mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp' ? mime : null;
  const outputImageSha256 = sha256(bytes);
  const identicalToSource = outputImageSha256 === task.sourceImageSha256;
  const dimensions = typedMime ? readRasterDimensionsV15(bytes, typedMime) : null;
  const structural = typedMime
    ? critiqueRasterStructureV15(bytes, typedMime, task.width, task.height)
    : { passed: false };
  const providerId = response.headers.get('x-origin-visual-provider');
  const modelId = response.headers.get('x-origin-visual-model');
  const deliveryIntegrityPassed = Boolean(
    response.headers.get('x-origin-visual-verified') === 'true'
    && response.headers.get('x-origin-visual-sha256') === outputImageSha256
    && response.headers.get('x-origin-visual-task') === 'edit'
    && response.headers.get('x-origin-visual-reference-count') === '1'
    && response.headers.get('x-origin-free-only') === 'true'
    && response.headers.get('x-origin-cost-usd') === '0'
    && response.headers.get('x-origin-paid-fallback') === 'false'
    && response.headers.get('x-origin-secret-delivery') === 'server-only'
    && response.headers.get('x-origin-release-sha') === candidateSha
    && response.headers.get('x-origin-world-class-evaluation') === 'true'
    && !response.headers.get('x-origin-world-class-qualified-sha')
    && response.headers.get('x-origin-visual-quality-tier') === 'world-class-free'
    && response.headers.get('x-origin-visual-semantic-verified') === 'true'
    && providerId === 'cloudflare-workers-ai-free'
    && providerId
    && modelId
  );
  const qualified = Boolean(
    typedMime
    && bytes.length > 0
    && bytes.length <= MAX_OUTPUT_BYTES
    && dimensions?.width === task.width
    && dimensions?.height === task.height
    && structural.passed
    && deliveryIntegrityPassed
    && !identicalToSource
  );

  if (qualified && typedMime) {
    await fs.writeFile(
      path.join(outputDir, `case-${String(caseIndex + 1).padStart(2, '0')}.${extension(typedMime)}`),
      bytes,
      { mode: 0o600 },
    );
  }

  return {
    caseId: task.caseId,
    family: task.family,
    turnIndex: task.turnIndex,
    instructionSha256: task.instructionSha256,
    sourceImageSha256: task.sourceImageSha256,
    outputImageSha256,
    identicalToSource,
    executionStatus: 'completed',
    durationMs: Date.now() - started,
    mimeType: typedMime,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    structuralCriticPassed: Boolean(structural.passed),
    deliveryIntegrityPassed,
    providerId,
    modelId,
    failureCode: qualified ? null : identicalToSource ? 'IMAGE_EDIT_PRIVATE_IDENTICAL_FALSE_EDIT' : 'IMAGE_EDIT_PRIVATE_OUTPUT_VALIDATION_FAILED',
  };
}

async function main(): Promise<void> {
  const candidateSha = requiredEnv('ORIGIN_IMAGE_EDIT_CANDIDATE_SHA').toLowerCase();
  const expectedCorpusId = requiredEnv('ORIGIN_IMAGE_EDIT_CORPUS_ID');
  const shardText = requiredEnv('ORIGIN_IMAGE_EDIT_SHARD_INDEX');
  const planDigest = requiredEnv('ORIGIN_IMAGE_EDIT_SHARD_PLAN_DIGEST').toLowerCase();
  const pinnedDay = requiredEnv('ORIGIN_IMAGE_EDIT_SHARD_UTC_DAY');
  if (!/^(?:0|[1-7])$/.test(shardText) || !/^[a-f0-9]{64}$/.test(planDigest)
    || !/^\d{4}-\d{2}-\d{2}$/.test(pinnedDay)
    || new Date().toISOString().slice(0, 10) !== pinnedDay) {
    throw new Error('IMAGE_EDIT_FREE_SHARD_INPUT_INVALID');
  }
  const shardIndex = Number(shardText);
  requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  requiredEnv('CLOUDFLARE_API_TOKEN');
  // Verify Free plan before inspecting sealed source images or spending Neurons.
  const provider = await getCloudflareRasterStatusV15(process.env);
  if (!provider.ready || !provider.zeroCostVerified || provider.paidFallbackEnabled) {
    throw new Error('IMAGE_EDIT_FREE_SHARD_PROVIDER_UNVERIFIED');
  }
  const encoded = requiredEnv('ORIGIN_IMAGE_EDIT_PRIVATE_CORPUS_GZIP_B64');

  if (!/^[a-f0-9]{40}$/.test(candidateSha)) throw new Error('IMAGE_EDIT_PRIVATE_CANDIDATE_SHA_INVALID');
  if (encoded.length > MAX_CORPUS_BYTES || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('IMAGE_EDIT_PRIVATE_CORPUS_ENCODING_INVALID');

  let raw: Buffer;
  let corpus: OriginImageEditPrivateCorpusV1;
  try {
    raw = gunzipSync(Buffer.from(encoded, 'base64'), { maxOutputLength: MAX_CORPUS_BYTES });
    corpus = JSON.parse(raw.toString('utf8')) as OriginImageEditPrivateCorpusV1;
  } catch {
    throw new Error('IMAGE_EDIT_PRIVATE_CORPUS_PARSE_FAILED');
  }

  const blockers = [...validateImageEditPrivateCorpusV1(corpus)];
  if (corpus.corpusId !== expectedCorpusId) blockers.push('IMAGE_EDIT_PRIVATE_CORPUS_ID_MISMATCH');
  if (corpus.candidateSha.toLowerCase() !== candidateSha) blockers.push('IMAGE_EDIT_PRIVATE_CORPUS_SHA_MISMATCH');
  if (blockers.length) throw new Error('IMAGE_EDIT_PRIVATE_CORPUS_VALIDATION_FAILED');

  const corpusDigest = sha256(raw);
  const plan = planImageEditFreeShardsV1(candidateSha, corpusDigest, corpus.tasks.map(t => ({
    caseId: t.caseId, family: t.family, turnIndex: t.turnIndex,
    instructionSha256: t.instructionSha256, sourceImageSha256: t.sourceImageSha256,
    width: t.width, height: t.height,
  })));
  if (plan.planDigest !== planDigest || !plan.shards[shardIndex]) {
    throw new Error('IMAGE_EDIT_FREE_SHARD_PLAN_MISMATCH');
  }
  // Reject all malformed or non-decodable private reference images before the
  // evaluation server can invoke the Cloudflare model (paid fallback forbidden).
  await verifyAllEditSourcesDecodedV1(corpus.tasks);
  const shard = plan.shards[shardIndex];
  const selectedIds = new Set(shard.caseIds);
  if (selectedIds.size !== shard.caseIds.length || shard.caseIds.length > 2) {
    throw new Error('IMAGE_EDIT_FREE_SHARD_CASE_COUNT_INVALID');
  }
  const outputRoot = path.resolve(process.env.ORIGIN_IMAGE_EDIT_OUTPUT_DIR ?? 'test-results/image-edit-private-v16-shard');
  const imagesDir = path.join(outputRoot, 'candidate-images');
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '4mb' }));
  const runtimeEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ORIGIN_IMAGE_WORLD_CLASS_ENABLED: 'true',
    ORIGIN_IMAGE_WORLD_CLASS_EVAL: 'true',
    ORIGIN_IMAGE_ZERO_COST_MAX_ATTEMPTS: '2',
    ORIGIN_RELEASE_SHA: candidateSha,
    VERCEL_ENV: 'preview',
    NODE_ENV: 'test',
  };
  app.use(createWorldClassImageV16Router(runtimeEnv));
  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const cases: CandidateEditEvidence[] = [];
  const runBlockers: string[] = [];
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('IMAGE_EDIT_PRIVATE_SERVER_BIND_FAILED');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const status = await fetch(`${baseUrl}/api/creative/v1.6/world-class/status`, { signal: AbortSignal.timeout(30_000) });
    const statusBody = await responseJson(status);
    if (
      statusBody?.evaluationReady !== true
      || statusBody?.primaryReady !== true
      || statusBody?.releaseSha !== candidateSha
      || statusBody?.provider !== 'cloudflare-workers-ai-free'
      || statusBody?.model !== plan.model
      || statusBody?.freeOnly !== true
      || statusBody?.costUsd !== 0
      || statusBody?.paymentMethodRequired !== false
      || statusBody?.paidFallbackEnabled !== false
    ) throw new Error('IMAGE_EDIT_PRIVATE_RASTER_NOT_QUALIFIED');

    if (new Date().toISOString().slice(0, 10) !== pinnedDay) {
      throw new Error('IMAGE_EDIT_FREE_SHARD_UTC_DAY_ROLLOVER');
    }
    await fs.mkdir(imagesDir, { recursive: true });
    for (const [caseIndex, task] of corpus.tasks.entries()) {
      if (!selectedIds.has(task.caseId)) continue;
      const item = await evaluateEditCase(baseUrl, task, caseIndex, corpus.executionBudgetMs, imagesDir, candidateSha);
      cases.push(item);
      if (item.providerId !== 'cloudflare-workers-ai-free' || item.modelId !== plan.model) {
        runBlockers.push('IMAGE_EDIT_FREE_SHARD_EXACT_MODEL_DRIFT:' + item.caseId);
      }
      if (item.durationMs > corpus.executionBudgetMs) runBlockers.push(`IMAGE_EDIT_PRIVATE_EXECUTION_BUDGET_EXCEEDED:${item.caseId}`);
      if (item.executionStatus !== 'completed') runBlockers.push(`IMAGE_EDIT_PRIVATE_EXECUTION_NOT_COMPLETED:${item.caseId}`);
      if (item.identicalToSource) runBlockers.push(`IMAGE_EDIT_PRIVATE_IDENTICAL_FALSE_EDIT:${item.caseId}`);
      if (!item.structuralCriticPassed || !item.deliveryIntegrityPassed || item.failureCode) runBlockers.push(`IMAGE_EDIT_PRIVATE_OUTPUT_NOT_QUALIFIED:${item.caseId}`);
    }

    if (new Date().toISOString().slice(0, 10) !== pinnedDay) {
      runBlockers.push('IMAGE_EDIT_FREE_SHARD_UTC_DAY_ROLLOVER');
    }
    if (cases.length !== shard.caseIds.length
      || cases.some((item, index) => item.caseId !== shard.caseIds[index]
        || item.instructionSha256 !== shard.instructionSha256s[index]
        || item.sourceImageSha256 !== shard.sourceImageSha256s[index])) {
      runBlockers.push('IMAGE_EDIT_FREE_SHARD_INCOMPLETE_OR_TAMPERED');
    }

    const identities = new Set(cases.filter((item) => item.providerId && item.modelId).map((item) => `${item.providerId}::${item.modelId}`));
    if (identities.size !== 1) runBlockers.push('IMAGE_EDIT_PRIVATE_PROVIDER_IDENTITY_DRIFT');

    await fs.mkdir(outputRoot, { recursive: true });
    await fs.writeFile(path.join(outputRoot, 'public-tasks.json'), JSON.stringify({
      schemaVersion: 'origin.image-edit-private-public-tasks.v1',
      corpusId: corpus.corpusId,
      corpusDigest,
      candidateSha,
      executionBudgetMs: corpus.executionBudgetMs,
      evaluationMode: 'v16-free-edit-shard',
      planDigest: plan.planDigest,
      shardIndex,
      fullCorpusCases: 16,
      tasks: corpus.tasks.map((task) => ({
        caseId: task.caseId,
        family: task.family,
        turnIndex: task.turnIndex,
        instructionSha256: task.instructionSha256,
        sourceImageSha256: task.sourceImageSha256,
        width: task.width,
        height: task.height,
      })),
    }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });

    await fs.writeFile(path.join(outputRoot, 'candidate-evidence.json'), JSON.stringify({
      schemaVersion: 'origin.image-edit-private-candidate-evidence.v1',
      corpusId: corpus.corpusId,
      corpusDigest,
      candidateSha,
      evaluatorSha: candidateSha,
      originSystemId: 'origin-world-class-free-edit-v16',
      evaluationMode: 'v16-free-edit-shard',
      planDigest: plan.planDigest,
      shardIndex,
      fullCorpusCases: 16,
      freeOnly: cases.every(item => item.providerId === 'cloudflare-workers-ai-free'),
      totalCostUsd: 0,
      independentBlindEditQualityPassed: false,
      productionQualified: false,
      providerIdentities: [...identities],
      cases,
      blockers: [...new Set(runBlockers)],
      qualificationStatus: 'NOT_MEASURED',
      qualificationReason: 'blind reference outputs and independent judge scores are intentionally not produced by the candidate runner',
    }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });

    const completed = cases.filter((item) => item.executionStatus === 'completed').length;
    const technicallyQualified = cases.filter((item) => item.executionStatus === 'completed' && !item.failureCode).length;
    await fs.writeFile(path.join(outputRoot, 'candidate-summary.json'), JSON.stringify({
      schemaVersion: 'origin.image-edit-private-candidate-summary.v1',
      corpusId: corpus.corpusId,
      corpusDigest,
      candidateSha,
      attempted: cases.length,
      evaluationMode: 'v16-free-edit-shard',
      planDigest: plan.planDigest,
      shardIndex,
      fullCorpusCases: 16,
      freeOnly: true,
      totalCostUsd: 0,
      completed,
      technicallyQualified,
      providerIdentityCount: identities.size,
      blockers: [...new Set(runBlockers)],
      qualificationStatus: 'NOT_MEASURED',
    }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });

    await fs.writeFile(path.join(outputRoot, 'shard-manifest.json'), JSON.stringify({
      schemaVersion: 'origin.image-edit-free-shard-manifest.v1',
      candidateSha, corpusId: corpus.corpusId, corpusDigest,
      planDigest: plan.planDigest, shardIndex, utcDay: pinnedDay,
      githubRunId: process.env.GITHUB_RUN_ID || null,
      caseIds: cases.map(item => item.caseId),
      sourceImageSha256s: cases.map(item => item.sourceImageSha256),
      instructionSha256s: cases.map(item => item.instructionSha256),
      outputImageSha256s: cases.map(item => item.outputImageSha256),
      blockers: [...new Set(runBlockers)],
      paidFallbackEnabled: false, totalCostUsd: 0,
      trustedProviderUsageVerified: false,
      authenticatedGitHubArtifactProvenance: false,
      independentBlindEditQualityPassed: false,
      ownerVisualApproval: false,
      productionQualified: false,
    }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    if (runBlockers.length || cases.some(item => item.failureCode !== null)) {
      throw new Error('IMAGE_EDIT_FREE_SHARD_FAILED');
    }

    process.stdout.write(JSON.stringify({
      event: 'world-class-image-edit-private-shard-completed',
      corpusId: corpus.corpusId,
      corpusDigest,
      candidateSha,
      attempted: cases.length,
      completed,
      technicallyQualified,
      providerIdentityCount: identities.size,
      blockerCount: new Set(runBlockers).size,
      qualificationStatus: 'NOT_MEASURED',
    }) + '\n');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  process.stderr.write((/^[A-Z0-9_:-]{3,200}$/.test(message) ? message : 'IMAGE_EDIT_PRIVATE_RUN_FAILED') + '\n');
  process.exitCode = 1;
});
