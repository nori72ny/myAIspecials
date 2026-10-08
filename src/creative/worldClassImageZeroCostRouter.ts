import { createHash } from 'node:crypto';
import { Router, type Request, type Response as ExpressResponse } from 'express';
import { detectSensitiveConversation } from '../legacy/originChatValidation.js';
import {
  generateCloudflareRasterImageV15,
  getCloudflareRasterStatusV15,
} from './cloudflareRasterImageProviderV15.js';
import {
  readRasterDimensionsV15,
  type RasterReferenceImageV15,
} from './rasterImageProviderV15.js';
import { critiqueCloudflareRasterSemanticV15 } from './cloudflareRasterSemanticCriticV15.js';
import { compileWorldClassImagePromptV16 } from './worldClassImagePromptCompilerV16.js';

const FULL_SHA = /^[0-9a-f]{40}$/i;
const MAX_REFERENCE_IMAGES = 4;
const MAX_REFERENCE_IMAGE_BYTES = 768 * 1024;

type ParsedRequest = {
  prompt: string;
  width?: number;
  height?: number;
  referenceImages: RasterReferenceImageV15[];
};

function bool(env: NodeJS.ProcessEnv, key: string): boolean {
  return env[key]?.trim().toLowerCase() === 'true';
}
function releaseSha(env: NodeJS.ProcessEnv): string {
  const value = env.VERCEL_GIT_COMMIT_SHA ?? env.ORIGIN_RELEASE_SHA ?? '';
  return FULL_SHA.test(value) ? value.toLowerCase() : 'unknown';
}
function qualified(env: NodeJS.ProcessEnv): boolean {
  const current = releaseSha(env);
  const approved = env.ORIGIN_IMAGE_WORLD_CLASS_QUALIFIED_SHA?.trim().toLowerCase() ?? '';
  return current !== 'unknown' && approved === current;
}
function evaluationBypassAllowed(env: NodeJS.ProcessEnv): boolean {
  if (!bool(env, 'ORIGIN_IMAGE_WORLD_CLASS_EVAL')) return false;
  const vercelEnv = env.VERCEL_ENV?.trim().toLowerCase();
  const nodeEnv = env.NODE_ENV?.trim().toLowerCase();
  // Evaluation must never be enabled by an unknown or missing deployment context.
  return (vercelEnv === 'preview' || vercelEnv === 'development') && nodeEnv !== 'production';
}
function fail(res: ExpressResponse, status: number, code: string, message: string) {
  return res.status(status).json({
    ok: false,
    code,
    message,
    retryable: status >= 500,
    worldClassMode: true,
    freeOnly: true,
    costUsd: 0,
    paidFallbackUsed: false,
    paidFallbackEnabled: false,
    secretDelivery: 'server-only',
  });
}
function sensitive(body: unknown): boolean {
  let text = '';
  try {
    const row = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
    text = JSON.stringify({ ...row, referenceImages: row.referenceImages ? '[reference-images]' : undefined });
  } catch {
    return true;
  }
  return detectSensitiveConversation([{ role: 'user', content: text }]).length > 0;
}

function dataUriReference(value: string): RasterReferenceImageV15 {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new Error('INVALID_WORLD_CLASS_REFERENCE_IMAGE');
  const mimeType = match[1] as RasterReferenceImageV15['mimeType'];
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length < 64 || bytes.length > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error('WORLD_CLASS_REFERENCE_BYTES_EXCEEDED');
  }
  const size = readRasterDimensionsV15(bytes, mimeType);
  if (!size || size.width >= 512 || size.height >= 512) {
    throw new Error('WORLD_CLASS_REFERENCE_DIMENSION_OUT_OF_BOUNDS');
  }
  return { bytes, mimeType, width: size.width, height: size.height };
}

function parse(body: unknown, editing: boolean): ParsedRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('INVALID_WORLD_CLASS_IMAGE_REQUEST');
  const row = body as Record<string, unknown>;
  const allowed = new Set(editing ? ['prompt', 'width', 'height', 'referenceImages'] : ['prompt', 'width', 'height']);
  if (Object.keys(row).some((key) => !allowed.has(key))) throw new Error('INVALID_WORLD_CLASS_IMAGE_FIELD');
  const prompt = typeof row.prompt === 'string' ? row.prompt.normalize('NFKC').trim() : '';
  if (!prompt || prompt.length > 1400) throw new Error('INVALID_WORLD_CLASS_IMAGE_PROMPT');
  if ((row.width === undefined) !== (row.height === undefined)) throw new Error('INVALID_WORLD_CLASS_IMAGE_DIMENSION_PAIR');
  const width = row.width;
  const height = row.height;
  if (width !== undefined && (!Number.isInteger(width) || Number(width) < 256 || Number(width) > 1536)) {
    throw new Error('INVALID_WORLD_CLASS_IMAGE_DIMENSION');
  }
  if (height !== undefined && (!Number.isInteger(height) || Number(height) < 256 || Number(height) > 1536)) {
    throw new Error('INVALID_WORLD_CLASS_IMAGE_DIMENSION');
  }

  const rawRefs = editing ? row.referenceImages : [];
  if (editing && (!Array.isArray(rawRefs) || rawRefs.length < 1 || rawRefs.length > MAX_REFERENCE_IMAGES)) {
    throw new Error('INVALID_WORLD_CLASS_REFERENCE_COUNT');
  }
  const referenceImages = (Array.isArray(rawRefs) ? rawRefs : []).map((value) => {
    if (typeof value !== 'string') throw new Error('INVALID_WORLD_CLASS_REFERENCE_IMAGE');
    return dataUriReference(value);
  });
  return {
    prompt,
    width: width as number | undefined,
    height: height as number | undefined,
    referenceImages,
  };
}

function exactTextCandidates(prompt: string): string[] {
  const values = new Set<string>();
  for (const match of prompt.matchAll(/[「『"“]([^」』"”]{1,80})[」』"”]/g)) {
    const value = match[1]?.trim();
    if (value) values.add(value);
  }
  for (const match of prompt.matchAll(/(?:¥|￥|\$)\s?[\d,.]+(?:円)?/g)) values.add(match[0].trim());
  return [...values].slice(0, 8);
}

function boundedCompiledPrompt(original: string, compiled: string, editing: boolean): string {
  if (compiled.length <= 2000) return compiled;
  return [
    'PRIMARY INSTRUCTION:',
    original,
    '',
    'EXECUTION CONSTRAINTS:',
    '- Follow the instruction exactly. Do not add unrequested subjects, text, logos, watermarks, borders, or clutter.',
    '- Preserve requested visible text exactly and keep anatomy, geometry, perspective, lighting, materials, and composition coherent.',
    editing ? '- Edit only the requested regions and preserve all untouched content.' : '',
    '- Produce professional, artifact-free output suitable for direct use.',
  ].filter(Boolean).join('\n');
}

function remediationPrompt(original: string, issues: readonly string[], summary: string): string {
  const feedback = [summary, ...issues].map((value) => value.trim()).filter(Boolean).slice(0, 8);
  return [
    original,
    '',
    'QUALITY REPAIR:',
    'Regenerate from scratch while preserving every explicit user instruction.',
    ...feedback.map((item) => `- Correct this visible defect: ${item}`),
    '- Do not add new subjects, text, logos, or decorative elements that were not requested.',
  ].join('\n');
}

export function createWorldClassImageZeroCostRouter(env: NodeJS.ProcessEnv = process.env) {
  const router = Router();

  router.get('/api/creative/v1.6/world-class/status', async (_req, res) => {
    const cloudflare = await getCloudflareRasterStatusV15(env).catch(() => null);
    const isQualified = qualified(env);
    const primaryReady = Boolean(cloudflare?.ready && cloudflare.zeroCostVerified && !cloudflare.paidFallbackEnabled);
    const ready = isQualified && primaryReady;
    const evaluationReady = Boolean(primaryReady && (isQualified || evaluationBypassAllowed(env)));
    return res.status(ready ? 200 : 503).json({
      ok: ready,
      ready,
      evaluationReady,
      enabled: true,
      qualified: isQualified,
      releaseSha: releaseSha(env),
      qualifiedSha: env.ORIGIN_IMAGE_WORLD_CLASS_QUALIFIED_SHA?.trim().toLowerCase() || null,
      provider: 'cloudflare-workers-ai-free',
      model: cloudflare?.model ?? '@cf/black-forest-labs/flux-2-klein-9b',
      primaryReady,
      // Standard-tier generation is a separate V1.5 capability, never a V1.6 world-class substitute.
      standardFallbackReady: false,
      standardFallbackProvider: null,
      routingPolicy: 'zero-cost-quality-first-v1',
      qualityLoop: 'generate -> free semantic critic -> one bounded repair attempt',
      benchmarkGate: '24-case blind benchmark vs references + independent judges',
      publicationPolicy: 'exact-sha-qualified-only',
      freeOnly: true,
      costUsd: 0,
      dailyFreeAllocationPolicy: 'fail-closed-on-provider-free-quota-exhaustion',
      paidFallbackEnabled: false,
      paymentMethodRequired: false,
      secretDelivery: 'server-only',
    });
  });

  const handler = (editing: boolean) => async (req: Request, res: ExpressResponse) => {
    if (sensitive(req.body)) return fail(res, 422, 'SENSITIVE_INPUT_BLOCKED', '機密情報の可能性があるため外部画像モデルへ送信しません。');

    let input: ParsedRequest;
    try {
      input = parse(req.body, editing);
    } catch (error) {
      return fail(
        res,
        400,
        error instanceof Error ? error.message : 'INVALID_WORLD_CLASS_IMAGE_REQUEST',
        '画像生成リクエストが不正です。',
      );
    }

    if (!qualified(env) && !evaluationBypassAllowed(env)) {
      return fail(res, 503, 'WORLD_CLASS_IMAGE_SHA_NOT_QUALIFIED', 'blind品質評価を通過したexact SHAだけが本番利用できます。');
    }

    const cloudflare = await getCloudflareRasterStatusV15(env).catch(() => null);
    const primaryReady = Boolean(cloudflare?.ready && cloudflare.zeroCostVerified && !cloudflare.paidFallbackEnabled);
    const promptPlan = compileWorldClassImagePromptV16(input.prompt, editing);
    const compiledPrompt = boundedCompiledPrompt(input.prompt, promptPlan.prompt, editing);
    const exactText = exactTextCandidates(input.prompt);

    let finalResult: Awaited<ReturnType<typeof generateCloudflareRasterImageV15>> | null = null;
    let finalCritic: Awaited<ReturnType<typeof critiqueCloudflareRasterSemanticV15>> | null = null;
    let attempts = 0;
    const providerTier = 'world-class-free' as const;

    if (primaryReady) {
      let workingPrompt = compiledPrompt;
      const maxAttempts = env.ORIGIN_IMAGE_ZERO_COST_MAX_ATTEMPTS === '1' ? 1 : 2;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        attempts = attempt;
        try {
          finalResult = await generateCloudflareRasterImageV15({
            prompt: workingPrompt,
            width: input.width,
            height: input.height,
            referenceImages: input.referenceImages,
          }, env);
          if (editing && input.referenceImages.some((reference) =>
            createHash('sha256').update(reference.bytes).digest('hex') === finalResult?.sha256)) {
            // A reference passed through unchanged is NOT evidence that the edit succeeded.
            return fail(res, 422, 'WORLD_CLASS_FREE_EDIT_UNCHANGED', '元画像が変更されなかったため編集結果として返却しません。');
          }
          finalCritic = await critiqueCloudflareRasterSemanticV15({
            originalRequest: input.prompt,
            exactText,
            bytes: finalResult.bytes,
            mimeType: finalResult.mimeType,
          }, env);
        } catch (error) {
          const code = error instanceof Error ? error.message : 'ZERO_COST_IMAGE_PROVIDER_FAILED';
          return fail(res, 503, code, '無料画像生成枠または無料品質検査を利用できません。課金経路には切り替えません。');
        }
        if (finalCritic.passed) break;
        if (attempt < maxAttempts) {
          const repaired = remediationPrompt(input.prompt, finalCritic.issues, finalCritic.summary);
          const repairPlan = compileWorldClassImagePromptV16(repaired, editing);
          workingPrompt = boundedCompiledPrompt(repaired, repairPlan.prompt, editing);
        }
      }

      if (!finalResult || !finalCritic?.passed) {
        return fail(res, 422, 'WORLD_CLASS_FREE_IMAGE_QUALITY_GATE_FAILED', '無料生成結果が品質基準に達しなかったため返却しません。');
      }
    } else {
      // A standard image must not satisfy a world-class route, including when qualified SHA matches.
      return fail(res, 503, 'ZERO_COST_WORLD_CLASS_PROVIDER_UNAVAILABLE', '高品質の無料画像プロバイダが利用できません。標準品質への無断切替は行いません。');
    }

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', finalResult.mimeType);
    res.setHeader('X-Origin-Visual-Verified', 'true');
    res.setHeader('X-Origin-Visual-Task', editing ? 'edit' : 'generate');
    res.setHeader('X-Origin-Visual-Reference-Count', String(input.referenceImages.length));
    res.setHeader('X-Origin-Visual-Quality-Tier', providerTier);
    res.setHeader('X-Origin-Visual-Provider', finalResult.providerId);
    res.setHeader('X-Origin-Visual-Model', finalResult.model);
    res.setHeader('X-Origin-Visual-Sha256', finalResult.sha256);
    res.setHeader('X-Origin-Visual-Prompt-Profile', promptPlan.profile);
    res.setHeader('X-Origin-Visual-Semantic-Verified', 'true');
    res.setHeader('X-Origin-Visual-Semantic-Score', String(finalCritic?.score ?? 0));
    res.setHeader('X-Origin-Visual-Attempts', String(attempts));
    res.setHeader('X-Origin-Release-Sha', releaseSha(env));
    if (qualified(env)) res.setHeader('X-Origin-World-Class-Qualified-Sha', releaseSha(env));
    else if (evaluationBypassAllowed(env)) res.setHeader('X-Origin-World-Class-Evaluation', 'true');
    res.setHeader('X-Origin-Cost-Usd', '0');
    res.setHeader('X-Origin-Free-Only', 'true');
    res.setHeader('X-Origin-Paid-Fallback', 'false');
    res.setHeader('X-Origin-Secret-Delivery', 'server-only');
    return res.status(200).send(finalResult.bytes);
  };

  router.post('/api/creative/v1.6/world-class/generate', handler(false));
  router.post('/api/creative/v1.6/world-class/edit', handler(true));
  return router;
}
