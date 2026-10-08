import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import express from 'express';
import { chromium, type Browser } from 'playwright';

import { createWorldClassImageV16Router } from '../src/creative/worldClassImageV16Router.js';
import { readRasterDimensionsV15 } from '../src/creative/rasterImageCriticV15.js';
import { scoreRasterPixelsV15 } from '../src/creative/rasterTechnicalCriticV15.js';
import { critiqueCloudflareRasterSemanticV15 } from '../src/creative/cloudflareRasterSemanticCriticV15.js';
import type { ImageBenchmarkOutputV15, ImageTechnicalEvidenceV15 } from '../src/release/OriginImageBlindBenchmarkV15.js';
import {
  validateImagePrivateCorpusV1,
  type ImagePrivateTaskV1,
  type OriginImagePrivateCorpusV1,
} from '../src/release/OriginImagePrivateCorpusV1.js';

type CandidateCaseEvidence = {
  caseId: string;
  family: ImagePrivateTaskV1['family'];
  challengeTags: ImagePrivateTaskV1['challengeTags'];
  promptSha256: string;
  width: number;
  height: number;
  requiresText: boolean;
  taskDigest: string;
  effectivePromptSha256: string;
  output: ImageBenchmarkOutputV15;
  failureCode: string | null;
  providerId: string | null;
  modelId: string | null;
  costUsd: number | null;
  actualWidth: number | null;
  actualHeight: number | null;
  expectedAspectRatio: string;
  semantic: {
    passed: boolean;
    safetyPassed: boolean;
    safetyIssues: readonly string[];
    score: number;
    issues: readonly string[];
    model: string;
  } | null;
};

const EMPTY_SHA256 = createHash('sha256').update(Buffer.alloc(0)).digest('hex');
const RATIOS = ['1:1','3:2','2:3','4:3','3:4','16:9','9:16'] as const;
const MAX_PERSISTED_IMAGE_BYTES = 16 * 1024 * 1024;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`WORLD_CLASS_IMAGE_PRIVATE_REQUIRED_ENV_MISSING:${name}`);
  return value;
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function emptyTechnical(): ImageTechnicalEvidenceV15 {
  return {
    signatureValid: false,
    dimensionsValid: false,
    structuralCriticPassed: false,
    technicalCriticPassed: false,
    safetyPassed: false,
    deliveryIntegrityPassed: false,
  };
}

function safeCode(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_:.-]{0,180}$/.test(value) ? value : fallback;
}

async function errorJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const value = await response.json();
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function classifyFailure(status: number, code: string | null): ImageBenchmarkOutputV15['executionStatus'] {
  if (status === 429) return 'quota-limited';
  if (status === 400 || status === 403 || status === 409 || status === 422) return 'blocked';
  return 'failed';
}

function extension(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

function nearestRatio(width: number, height: number): { label: string; value: number } {
  const target = width / height;
  let bestLabel = '1:1';
  let bestValue = 1;
  let delta = Infinity;
  for (const ratio of RATIOS) {
    const [a, b] = ratio.split(':').map(Number);
    const value = a / b;
    const current = Math.abs(target - value);
    if (current < delta) {
      delta = current;
      bestLabel = ratio;
      bestValue = value;
    }
  }
  return { label: bestLabel, value: bestValue };
}

function effectivePrompt(task: ImagePrivateTaskV1): string {
  const base = task.prompt.normalize('NFKC').trim();
  const negative = task.negativePrompt?.normalize('NFKC').trim();
  return negative ? `${base}\nAvoid these visible defects or elements: ${negative}` : base;
}

async function pixelCritic(browser: Browser, bytes: Buffer, mimeType: string) {
  const page = await browser.newPage();
  try {
    const dataUrl = `data:${mimeType};base64,${bytes.toString('base64')}`;
    const decoded = await page.evaluate(async ({ dataUrl }) => {
      const image = new Image();
      image.decoding = 'async';
      const loaded = new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('WORLD_CLASS_IMAGE_PRIVATE_BROWSER_DECODE_FAILED'));
      });
      image.src = dataUrl;
      await loaded;
      const naturalWidth = image.naturalWidth || image.width;
      const naturalHeight = image.naturalHeight || image.height;
      if (!naturalWidth || !naturalHeight) {
        throw new Error('WORLD_CLASS_IMAGE_PRIVATE_BROWSER_DIMENSIONS_INVALID');
      }
      const longest = Math.max(naturalWidth, naturalHeight);
      const scale = Math.min(1, 96 / longest);
      const width = Math.max(2, Math.round(naturalWidth * scale));
      const height = Math.max(2, Math.round(naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('WORLD_CLASS_IMAGE_PRIVATE_BROWSER_CANVAS_UNAVAILABLE');
      context.drawImage(image, 0, 0, width, height);
      const data = context.getImageData(0, 0, width, height).data;
      return { width, height, pixels: Array.from(data) };
    }, { dataUrl });
    return scoreRasterPixelsV15(
      Uint8ClampedArray.from(decoded.pixels),
      decoded.width,
      decoded.height,
    );
  } finally {
    await page.close();
  }
}

async function evaluateCase(
  baseUrl: string,
  browser: Browser,
  task: ImagePrivateTaskV1,
  caseIndex: number,
  budgetMs: number,
  outputDir: string,
  candidateSha: string,
  runtimeEnv: NodeJS.ProcessEnv,
): Promise<CandidateCaseEvidence> {
  const started = Date.now();
  const prompt = effectivePrompt(task);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/creative/v1.6/world-class/generate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'image/png,image/jpeg,image/webp,application/json',
      },
      body: JSON.stringify({
        prompt,
        width: task.width,
        height: task.height,
      }),
      signal: AbortSignal.timeout(Math.min(Math.max(budgetMs, 10_000), 180_000)),
    });
  } catch {
    const ratio = nearestRatio(task.width, task.height);
    return {
      caseId: task.caseId,
      family: task.family,
      challengeTags: task.challengeTags,
      promptSha256: task.promptSha256,
      width: task.width,
      height: task.height,
      requiresText: task.requiresText,
      taskDigest: task.taskDigest,
      effectivePromptSha256: sha256(prompt),
      output: {
        blindKey: 'ORIGIN',
        systemId: 'origin-world-class-zero-cost',
        role: 'origin',
        executionStatus: 'failed',
        durationMs: Date.now() - started,
        imageSha256: EMPTY_SHA256,
        technical: emptyTechnical(),
      },
      failureCode: 'WORLD_CLASS_IMAGE_PRIVATE_FETCH_FAILED',
      providerId: null,
      modelId: null,
      costUsd: null,
      actualWidth: null,
      actualHeight: null,
      expectedAspectRatio: ratio.label,
      semantic: null,
    };
  }

  if (!response.ok) {
    const body = await errorJson(response);
    const code = safeCode(body?.code, `WORLD_CLASS_IMAGE_PRIVATE_HTTP_${response.status}`);
    const ratio = nearestRatio(task.width, task.height);
    return {
      caseId: task.caseId,
      family: task.family,
      challengeTags: task.challengeTags,
      promptSha256: task.promptSha256,
      width: task.width,
      height: task.height,
      requiresText: task.requiresText,
      taskDigest: task.taskDigest,
      effectivePromptSha256: sha256(prompt),
      output: {
        blindKey: 'ORIGIN',
        systemId: 'origin-world-class-zero-cost',
        role: 'origin',
        executionStatus: classifyFailure(response.status, code),
        durationMs: Date.now() - started,
        imageSha256: EMPTY_SHA256,
        technical: emptyTechnical(),
      },
      failureCode: code,
      providerId: null,
      modelId: null,
      costUsd: null,
      actualWidth: null,
      actualHeight: null,
      expectedAspectRatio: ratio.label,
      semantic: null,
    };
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const typedMime = mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp' ? mime : null;
  const actualSha = sha256(bytes);
  const dimensions = typedMime ? readRasterDimensionsV15(bytes, typedMime) : null;
  const expectedRatio = nearestRatio(task.width, task.height);
  const actualRatio = dimensions ? dimensions.width / dimensions.height : 0;
  const ratioDelta = dimensions ? Math.abs(actualRatio - expectedRatio.value) / expectedRatio.value : Infinity;
  const dimensionsValid = Boolean(
    dimensions
      && dimensions.width >= 512
      && dimensions.height >= 512
      && dimensions.width <= 4096
      && dimensions.height <= 4096
      && ratioDelta <= 0.03
  );
  const structuralCriticPassed = Boolean(
    typedMime
      && dimensionsValid
      && bytes.length >= 1024
      && bytes.length <= MAX_PERSISTED_IMAGE_BYTES
  );

  let technicalCriticPassed = false;
  try {
    technicalCriticPassed = typedMime
      ? (await pixelCritic(browser, bytes, typedMime)).passed
      : false;
  } catch {
    technicalCriticPassed = false;
  }

  const providerId = response.headers.get('x-origin-visual-provider');
  const modelId = response.headers.get('x-origin-visual-model');
  const costUsd = Number(response.headers.get('x-origin-cost-usd') ?? NaN);
  const deliveryIntegrityPassed = Boolean(
    response.headers.get('x-origin-visual-verified') === 'true'
      && response.headers.get('x-origin-visual-sha256') === actualSha
      && response.headers.get('x-origin-release-sha') === candidateSha
      && response.headers.get('x-origin-world-class-evaluation') === 'true'
      && !response.headers.get('x-origin-world-class-qualified-sha')
      && response.headers.get('x-origin-free-only') === 'true'
      && response.headers.get('x-origin-paid-fallback') === 'false'
      && response.headers.get('x-origin-secret-delivery') === 'server-only'
      && response.headers.get('x-origin-visual-quality-tier') === 'world-class-free'
      && providerId === 'cloudflare-workers-ai-free'
      && Boolean(modelId)
      && Number.isFinite(costUsd)
      && costUsd === 0
  );

  let semantic: CandidateCaseEvidence['semantic'] = null;
  let semanticFailureCode: string | null = null;
  if (typedMime) {
    try {
      const result = await critiqueCloudflareRasterSemanticV15({
        originalRequest: prompt,
        bytes,
        mimeType: typedMime,
      }, runtimeEnv);
      semantic = {
        passed: result.passed,
        safetyPassed: result.safetyPassed,
        safetyIssues: [...result.safetyIssues],
        score: result.score,
        issues: [...result.issues],
        model: result.model,
      };
    } catch (error) {
      semanticFailureCode = safeCode(
        error instanceof Error ? error.message : null,
        'WORLD_CLASS_IMAGE_PRIVATE_SEMANTIC_CRITIC_FAILED',
      );
    }
  }

  const technical: ImageTechnicalEvidenceV15 = {
    signatureValid: Boolean(typedMime && dimensions),
    dimensionsValid,
    structuralCriticPassed,
    technicalCriticPassed,
    safetyPassed: semantic?.safetyPassed === true,
    deliveryIntegrityPassed,
  };

  const passed = Object.values(technical).every(Boolean);
  if (!Number.isInteger(caseIndex) || caseIndex < 0 || caseIndex >= 24) {
    throw new Error('WORLD_CLASS_IMAGE_PRIVATE_CASE_INDEX_INVALID');
  }
  const artifactFile = `case-${String(caseIndex + 1).padStart(2, '0')}.${extension(typedMime ?? '')}`;
  const networkWriteSafe = passed
    && typedMime !== null
    && bytes.length > 0
    && bytes.length <= MAX_PERSISTED_IMAGE_BYTES
    && dimensionsValid
    && technicalCriticPassed
    && semantic?.safetyPassed === true
    && deliveryIntegrityPassed;

  if (networkWriteSafe) {
    // Candidate bytes are stored only after technical, safety, exact-SHA and spend-envelope checks.
    // codeql[js/http-to-file-access]
    await fs.writeFile(path.join(outputDir, artifactFile), bytes, { mode: 0o600 });
  }

  return {
    caseId: task.caseId,
    family: task.family,
    challengeTags: task.challengeTags,
    promptSha256: task.promptSha256,
    width: task.width,
    height: task.height,
    requiresText: task.requiresText,
    taskDigest: task.taskDigest,
    effectivePromptSha256: sha256(prompt),
    output: {
      blindKey: 'ORIGIN',
      systemId: 'origin-world-class-zero-cost',
      role: 'origin',
      executionStatus: 'completed',
      durationMs: Date.now() - started,
      imageSha256: actualSha,
      technical,
    },
    failureCode: passed
      ? null
      : (semanticFailureCode
        ?? (semantic?.safetyPassed === false
          ? 'WORLD_CLASS_IMAGE_PRIVATE_OUTPUT_SAFETY_FAILED'
          : 'WORLD_CLASS_IMAGE_PRIVATE_TECHNICAL_VALIDATION_FAILED')),
    providerId,
    modelId,
    costUsd: Number.isFinite(costUsd) ? costUsd : null,
    actualWidth: dimensions?.width ?? null,
    actualHeight: dimensions?.height ?? null,
    expectedAspectRatio: expectedRatio.label,
    semantic,
  };
}

async function main(): Promise<void> {
  const candidateSha = requiredEnv('ORIGIN_IMAGE_CANDIDATE_SHA').toLowerCase();
  const expectedCorpusId = requiredEnv('ORIGIN_IMAGE_CORPUS_ID');
  requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  requiredEnv('CLOUDFLARE_API_TOKEN');

  if (!/^[a-f0-9]{40}$/.test(candidateSha)) {
    throw new Error('WORLD_CLASS_IMAGE_PRIVATE_CANDIDATE_SHA_INVALID');
  }

  const runtimeEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ORIGIN_IMAGE_WORLD_CLASS_ENABLED: 'true',
    ORIGIN_IMAGE_WORLD_CLASS_EVAL: 'true',
    ORIGIN_RELEASE_SHA: candidateSha,
    ORIGIN_IMAGE_ZERO_COST_MAX_ATTEMPTS: '2',
    VERCEL_ENV: 'preview',
    NODE_ENV: 'test',
  };

  const outputRoot = path.resolve(
    process.env.ORIGIN_IMAGE_OUTPUT_DIR ?? 'test-results/image-private-world-class',
  );
  const imagesDir = path.join(outputRoot, 'candidate-images');

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  app.use(createWorldClassImageV16Router(runtimeEnv));
  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const browser = await chromium.launch({ headless: true });
  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('WORLD_CLASS_IMAGE_PRIVATE_SERVER_BIND_FAILED');
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const status = await fetch(
      `${baseUrl}/api/creative/v1.6/world-class/status`,
      { signal: AbortSignal.timeout(30_000) },
    );
    const statusBody = await errorJson(status);
    if (
      statusBody?.evaluationReady !== true
      || statusBody?.primaryReady !== true
      || statusBody?.releaseSha !== candidateSha
      || statusBody?.provider !== 'cloudflare-workers-ai-free'
      || statusBody?.freeOnly !== true
      || statusBody?.costUsd !== 0
      || statusBody?.paidFallbackEnabled !== false
    ) {
      throw new Error('WORLD_CLASS_IMAGE_PRIVATE_PROVIDER_NOT_READY');
    }

    // Decode the sealed corpus only after the real provider capability preflight passes.
    const encoded = requiredEnv('ORIGIN_IMAGE_PRIVATE_CORPUS_GZIP_B64');
    if (encoded.length > 4_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      throw new Error('WORLD_CLASS_IMAGE_PRIVATE_CORPUS_ENCODING_INVALID');
    }

    let raw: Buffer;
    let corpus: OriginImagePrivateCorpusV1;
    try {
      raw = gunzipSync(Buffer.from(encoded, 'base64'), { maxOutputLength: 4_000_000 });
      corpus = JSON.parse(raw.toString('utf8')) as OriginImagePrivateCorpusV1;
    } catch {
      throw new Error('WORLD_CLASS_IMAGE_PRIVATE_CORPUS_PARSE_FAILED');
    }

    const blockers = [...validateImagePrivateCorpusV1(corpus)];
    if (corpus.corpusId !== expectedCorpusId) blockers.push('WORLD_CLASS_IMAGE_PRIVATE_CORPUS_ID_MISMATCH');
    if (corpus.candidateSha.toLowerCase() !== candidateSha) blockers.push('WORLD_CLASS_IMAGE_PRIVATE_CORPUS_SHA_MISMATCH');
    if (blockers.length) throw new Error('WORLD_CLASS_IMAGE_PRIVATE_CORPUS_VALIDATION_FAILED');

    const cases: CandidateCaseEvidence[] = [];
    const runBlockers: string[] = [];
    const corpusDigest = sha256(raw);
    let totalCostUsd = 0;

    await fs.mkdir(imagesDir, { recursive: true });
    for (const [caseIndex, task] of corpus.tasks.entries()) {
      const item = await evaluateCase(
        baseUrl,
        browser,
        task,
        caseIndex,
        corpus.executionBudgetMs,
        imagesDir,
        candidateSha,
        runtimeEnv,
      );
      cases.push(item);
      if (item.costUsd !== null) totalCostUsd += item.costUsd;
      if (item.costUsd !== 0) runBlockers.push(`WORLD_CLASS_IMAGE_PRIVATE_NONZERO_COST:${item.caseId}`);
      if (item.output.durationMs > corpus.executionBudgetMs) {
        runBlockers.push(`WORLD_CLASS_IMAGE_PRIVATE_EXECUTION_BUDGET_EXCEEDED:${item.caseId}`);
      }
    }

    if (cases.length !== corpus.tasks.length) {
      runBlockers.push('WORLD_CLASS_IMAGE_PRIVATE_INCOMPLETE_CASE_SET');
    }

    const identities = new Set(
      cases
        .filter((item) => item.providerId && item.modelId)
        .map((item) => `${item.providerId}::${item.modelId}`),
    );
    if (identities.size !== 1) {
      runBlockers.push('WORLD_CLASS_IMAGE_PRIVATE_PROVIDER_IDENTITY_DRIFT');
    }

    await fs.mkdir(outputRoot, { recursive: true });
    await fs.writeFile(path.join(outputRoot, 'public-tasks.json'), JSON.stringify({
      schemaVersion: 'origin.world-class-image-private-public-tasks.v2',
      corpusId: corpus.corpusId,
      corpusDigest,
      candidateSha,
      executionBudgetMs: corpus.executionBudgetMs,
      dimensionPolicy: 'provider-native-1k-nearest-supported-ratio-within-3pct',
      tasks: corpus.tasks.map((task) => ({
        caseId: task.caseId,
        family: task.family,
        challengeTags: [...task.challengeTags],
        promptSha256: task.promptSha256,
        width: task.width,
        height: task.height,
        requiresText: task.requiresText,
        taskDigest: task.taskDigest,
      })),
    }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });

    await fs.writeFile(path.join(outputRoot, 'candidate-evidence.json'), JSON.stringify({
      schemaVersion: 'origin.world-class-image-private-candidate-evidence.v2',
      corpusId: corpus.corpusId,
      corpusDigest,
      candidateSha,
      evaluatorSha: candidateSha,
      originSystemId: 'origin-world-class-zero-cost',
      executionBudgetMs: corpus.executionBudgetMs,
      providerIdentities: [...identities],
      maxImageCostUsd: 0,
      maxTotalCostUsd: 0,
      totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
      cases,
      blockers: [...new Set(runBlockers)],
    }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });

    const completed = cases.filter((item) => item.output.executionStatus === 'completed').length;
    const technicallyPassed = cases.filter(
      (item) => item.output.executionStatus === 'completed'
        && Object.values(item.output.technical).every(Boolean),
    ).length;

    await fs.writeFile(path.join(outputRoot, 'candidate-summary.json'), JSON.stringify({
      schemaVersion: 'origin.world-class-image-private-candidate-summary.v2',
      corpusId: corpus.corpusId,
      corpusDigest,
      candidateSha,
      attempted: cases.length,
      completed,
      technicallyPassed,
      providerIdentityCount: identities.size,
      totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
      blockers: [...new Set(runBlockers)],
      failures: cases
        .filter((item) => item.failureCode)
        .map((item) => ({
          caseId: item.caseId,
          failureCode: item.failureCode,
          status: item.output.executionStatus,
        })),
    }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });

    process.stdout.write(JSON.stringify({
      event: 'world-class-image-private-round-completed',
      corpusId: corpus.corpusId,
      corpusDigest,
      candidateSha,
      attempted: cases.length,
      completed,
      technicallyPassed,
      providerIdentityCount: identities.size,
      totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
      blockerCount: new Set(runBlockers).size,
    }) + '\n');
  } finally {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  process.stderr.write((/^[A-Z0-9_:-]{3,200}$/.test(message)
    ? message
    : 'WORLD_CLASS_IMAGE_PRIVATE_RUN_FAILED') + '\n');
  process.exitCode = 1;
});
