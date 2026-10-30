import { createHash } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { detectSensitiveConversation } from '../legacy/originChatValidation.js';
import { type RasterImageRequestV15, type RasterImageResultV15, type RasterReferenceImageV15 } from './rasterImageProviderV15.js';
import {
  selectRasterProviderV15,
  selectRasterProviderExcludingV15,
} from './rasterProviderRegistryV15.js';
import { planRasterVisualRequestV15 } from './rasterVisualPlannerV15.js';
import { critiqueRasterStructureV15, readRasterDimensionsV15 } from './rasterImageCriticV15.js';
import { rasterVisualTemplatesV15 } from './rasterVisualTemplatesV15.js';
import { candidatePolicyForRasterRequestV15 } from './rasterTechnicalCriticV15.js';
import { CLOUDFLARE_RASTER_SEMANTIC_MODEL_V15, critiqueCloudflareRasterSemanticV15 } from './cloudflareRasterSemanticCriticV15.js';

const BASE_BODY_KEYS = new Set(['prompt', 'negativePrompt', 'width', 'height', 'model']);
const EDIT_BODY_KEYS = new Set([...BASE_BODY_KEYS, 'referenceImages']);
const MAX_REFERENCE_IMAGES = 4;
const MAX_REFERENCE_IMAGE_BYTES = 768 * 1024;
const MAX_TOTAL_REFERENCE_BYTES = 2 * 1024 * 1024;
const MAX_REFERENCE_DIMENSION_EXCLUSIVE = 512;

function semanticDeliveryGateEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.ORIGIN_RASTER_SEMANTIC_DELIVERY_GATE?.trim().toLowerCase() !== 'false';
}

function sensitiveKinds(body: unknown): string[] {
  let safeBody = body;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    safeBody = {
      ...record,
      ...(record.referenceImages !== undefined
        ? { referenceImages: Array.isArray(record.referenceImages) ? `[${record.referenceImages.length} reference image(s)]` : '[invalid reference images]' }
        : {}),
    };
  }
  let serialized = '';
  try { serialized = JSON.stringify(safeBody ?? {}); } catch { return ['unserializable_input']; }
  return detectSensitiveConversation([{ role: 'user', content: serialized }]);
}

function fail(
  res: Response,
  status: number,
  code: string,
  message?: string,
  retryable = status >= 500,
) {
  return res.status(status).json({
    ok: false,
    code,
    message: message ?? code,
    retryable,
    freeOnly: true,
    paidFallbackUsed: false,
    secretDelivery: 'server-only',
  });
}

function parseReferenceImages(value: unknown): RasterReferenceImageV15[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_REFERENCE_IMAGES) {
    throw new Error('REFERENCE_IMAGE_COUNT_OUT_OF_BOUNDS');
  }
  let totalBytes = 0;
  return value.map((item) => {
    if (typeof item !== 'string') throw new Error('REFERENCE_IMAGE_INVALID');
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(item);
    if (!match) throw new Error('REFERENCE_IMAGE_INVALID');
    const declaredMime = match[1];
    const encoded = match[2];
    if (!declaredMime || !encoded || encoded.length % 4 !== 0) throw new Error('REFERENCE_IMAGE_INVALID');
    const mimeType = declaredMime as RasterReferenceImageV15['mimeType'];
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length < 64 || bytes.length > MAX_REFERENCE_IMAGE_BYTES) {
      throw new Error('REFERENCE_IMAGE_SIZE_OUT_OF_BOUNDS');
    }
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_REFERENCE_BYTES) throw new Error('REFERENCE_IMAGE_TOTAL_SIZE_OUT_OF_BOUNDS');
    const dimensions = readRasterDimensionsV15(bytes, mimeType);
    if (!dimensions) throw new Error('REFERENCE_IMAGE_SIGNATURE_MISMATCH');
    if (dimensions.width >= MAX_REFERENCE_DIMENSION_EXCLUSIVE || dimensions.height >= MAX_REFERENCE_DIMENSION_EXCLUSIVE) {
      throw new Error('REFERENCE_IMAGE_DIMENSION_OUT_OF_BOUNDS');
    }
    return { bytes, mimeType, width: dimensions.width, height: dimensions.height };
  });
}

function parseBody(body: unknown, mode: 'generate' | 'edit' = 'generate'): RasterImageRequestV15 {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('INVALID_RASTER_REQUEST');
  const record = body as Record<string, unknown>;
  const allowedKeys = mode === 'edit' ? EDIT_BODY_KEYS : BASE_BODY_KEYS;
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) throw new Error('INVALID_RASTER_REQUEST_FIELD');
  if (typeof record.prompt !== 'string' || !record.prompt.trim()) throw new Error('INVALID_RASTER_PROMPT');
  if (record.negativePrompt !== undefined && typeof record.negativePrompt !== 'string') throw new Error('INVALID_RASTER_NEGATIVE_PROMPT');
  if (record.model !== undefined && typeof record.model !== 'string') throw new Error('INVALID_RASTER_MODEL');
  for (const key of ['width', 'height'] as const) {
    if (record[key] !== undefined && (
      typeof record[key] !== 'number'
      || !Number.isInteger(record[key])
      || record[key] < 256
      || record[key] > 1536
    )) {
      throw new Error('INVALID_RASTER_DIMENSION');
    }
  }
  if ((record.width === undefined) !== (record.height === undefined)) throw new Error('INVALID_RASTER_DIMENSION_PAIR');
  const referenceImages = mode === 'edit' ? parseReferenceImages(record.referenceImages) : undefined;
  return {
    prompt: record.prompt,
    negativePrompt: record.negativePrompt as string | undefined,
    width: record.width as number | undefined,
    height: record.height as number | undefined,
    model: record.model as string | undefined,
    referenceImages,
  };
}

function filename(mime: string): string {
  if (mime === 'image/png') return 'origin-image.png';
  if (mime === 'image/webp') return 'origin-image.webp';
  return 'origin-image.jpg';
}

export function createRasterImageV15Router(env: NodeJS.ProcessEnv = process.env) {
  const router = Router();

  router.get('/api/creative/v1.5/raster/status', (_req, res) => {
    // Public status must never fan out to provider/billing APIs. It reports only
    // locally known, conservative state; live qualification is handled separately.
    return res.status(503).json({
      ok: false,
      configured: false,
      ready: false,
      providerId: null,
      model: null,
      zeroCostVerified: false,
      freeAllocationEligible: false,
      paymentMethodRequired: false,
      secretDelivery: 'server-only',
      externalNetwork: false,
      reason: 'STATUS_NOT_LIVE_VERIFIED',
      providerAgnostic: true,
      registryVersion: 'raster-provider-registry-v1',
      providers: [],
      freeOnly: true,
      paidFallbackEnabled: false,
      supportedTasks: [],
      rasterCritic: {
        version: 'raster-structural-critic-v1',
        failClosed: true,
        checks: ['decodable-dimensions', 'dimensions-within-origin-bounds', 'requested-dimensions-match', 'nontrivial-image-payload'],
      },
      technicalPixelCritic: {
        version: 'raster-technical-critic-v1',
        implemented: true,
        execution: 'available-local-module',
        deliveryGateWired: true,
        checks: ['non-empty-alpha', 'non-uniform-content', 'black-white-clipping', 'minimum-information-density'],
        semanticVisionJudgment: false,
      },
      semanticVisionCritic: {
        version: 'raster-semantic-critic-v1',
        implemented: true,
        freeOnly: true,
        costEvidence: 'free-allocation-preflight-only; per-request-usage-unverified',
        paidFallbackEnabled: false,
        secretDelivery: 'server-only',
        deliveryGateWired: true,
        enabled: semanticDeliveryGateEnabled(env),
        activationGate: 'real-free-image-e2e-plus-semantic-effectiveness-and-quota-evidence',
      },
      templateEngine: {
        version: 'raster-template-engine-v1',
        templates: rasterVisualTemplatesV15().map(template => ({
          id: template.id,
          platform: template.platform,
          width: template.width,
          height: template.height,
          safeMarginPct: template.safeMarginPct,
          typographyZone: template.typographyZone,
        })),
      },
      modelBasedImageEditing: false,
      referenceImagePolicy: {
        transport: 'data-url-only',
        remoteUrlsAllowed: false,
        maxImages: MAX_REFERENCE_IMAGES,
        maxBytesPerImage: MAX_REFERENCE_IMAGE_BYTES,
        maxTotalBytes: MAX_TOTAL_REFERENCE_BYTES,
        maxDimensionExclusive: MAX_REFERENCE_DIMENSION_EXCLUSIVE,
        mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
      },
    });
  });

  router.post('/api/creative/v1.5/raster/plan', (req, res) => {
    const kinds = sensitiveKinds(req.body);
    if (kinds.length > 0) return fail(res, 422, 'SENSITIVE_INPUT_BLOCKED');

    try {
      const input = parseBody(req.body);
      const plan = planRasterVisualRequestV15(input.prompt, { width: input.width, height: input.height });
      return res.status(plan.ready ? 200 : 409).json({
        ok: plan.ready,
        code: plan.ready ? 'RASTER_PLAN_READY' : 'IMAGE_REQUIREMENTS_INCOMPLETE',
        plan,
        candidatePolicy: candidatePolicyForRasterRequestV15(input.prompt, plan.purpose),
        freeOnly: true,
        paidFallbackUsed: false,
        providerExecutions: 0,
      });
    } catch (error) {
      return fail(res, 400, error instanceof Error ? error.message : 'INVALID_RASTER_REQUEST');
    }
  });

  const handler = (mode: 'generate' | 'edit') => async (req: Request, res: Response) => {
    const kinds = sensitiveKinds(req.body);
    if (kinds.length > 0) {
      return fail(res, 422, 'SENSITIVE_INPUT_BLOCKED', '機密・個人情報の可能性があるため、外部画像プロバイダへ送信しませんでした。');
    }

    let input: RasterImageRequestV15;
    try {
      input = parseBody(req.body, mode);
    } catch (error) {
      return fail(res, 400, error instanceof Error ? error.message : 'INVALID_RASTER_REQUEST');
    }

    try {
      const plan = planRasterVisualRequestV15(input.prompt, { width: input.width, height: input.height });
      if (!plan.ready) {
        return res.status(409).json({
          ok: false,
          code: 'IMAGE_REQUIREMENTS_INCOMPLETE',
          message: '画像の仕上がりを大きく左右する情報が不足しています。',
          questions: plan.questions,
          plan: {
            version: plan.version,
            purpose: plan.purpose,
            platform: plan.platform,
            width: plan.width,
            height: plan.height,
          },
          candidatePolicy: candidatePolicyForRasterRequestV15(input.prompt, plan.purpose),
          freeOnly: true,
          paidFallbackUsed: false,
          providerExecutions: 0,
          secretDelivery: 'server-only',
        });
      }
      const providerTask = mode === 'edit' ? 'edit' : 'text-to-image';
      // Use the same readiness and zero-cost gate as /status. A static first-provider
      // lookup can otherwise report Pollinations as ready but still invoke Cloudflare.
      let providerSelectionRequests = 0;
      let providerGenerationRequests = 0;
      const countedFetch: typeof fetch = (request: RequestInfo | URL, init?: RequestInit) => {
        providerSelectionRequests += 1;
        return fetch(request, init);
      };
      const countedGenerationFetch: typeof fetch = (request: RequestInfo | URL, init?: RequestInit) => {
        providerGenerationRequests += 1;
        return fetch(request, init);
      };
      const selection = await selectRasterProviderV15(providerTask, env, countedFetch);
      if (selection.ready === false) {
        return fail(
          res,
          503,
          selection.reason,
          '費用0円と実行可能性を検証できる画像プロバイダがありません。',
        );
      }
      const generationInput: RasterImageRequestV15 = {
        ...input,
        prompt: plan.compiledPrompt,
        negativePrompt: input.negativePrompt?.trim()
          ? `${plan.negativePrompt}, ${input.negativePrompt.trim()}`
          : plan.negativePrompt,
        width: input.width ?? plan.width,
        height: input.height ?? plan.height,
      };
      let result: RasterImageResultV15;
      try {
        result = await selection.provider.generate(generationInput, env, countedGenerationFetch);
      } catch (generationError) {
        const generationCode = generationError instanceof Error ? generationError.message : '';
        // Cloudflare code 3036 is an explicit quota rejection: inference was not
        // accepted. Only this response permits a separately verified free-provider
        // switch. Ambiguous transport failures and post-generation failures remain terminal.
        if (mode !== 'generate'
          || selection.provider.descriptor.id !== 'cloudflare-workers-ai-free'
          || generationCode !== 'CLOUDFLARE_FREE_ALLOCATION_EXHAUSTED') {
          throw generationError;
        }
        const fallback = await selectRasterProviderExcludingV15(
          'text-to-image',
          env,
          [selection.provider.descriptor.id],
          countedFetch,
        );
        if (!fallback.ready) throw generationError;
        result = await fallback.provider.generate(generationInput, env, countedGenerationFetch);
      }
      const expectedWidth = input.width ?? plan.width;
      const expectedHeight = input.height ?? plan.height;
      const critic = critiqueRasterStructureV15(result.bytes, result.mimeType, expectedWidth, expectedHeight);
      if (!critic.passed) {
        return res.status(422).json({
          ok: false,
          code: 'RASTER_CRITIC_REJECTED',
          message: '生成画像の構造検証に失敗したため、画像を返しませんでした。',
          critic,
          retryable: false,
          freeOnly: true,
          paidFallbackUsed: false,
          secretDelivery: 'server-only',
        });
      }

      const semanticGateEnabled = semanticDeliveryGateEnabled(env);
      let semanticCritic: Awaited<ReturnType<typeof critiqueCloudflareRasterSemanticV15>> | null = null;
      let semanticGateState: 'passed' | 'rejected' | 'skipped' | 'disabled' = 'disabled';
      if (semanticGateEnabled) {
        if (result.providerId !== 'cloudflare-workers-ai-free') {
          // Do not spend the exhausted Cloudflare allocation on a critic after a
          // successful fallback from another provider. The generated image remains deliverable.
          semanticGateState = 'skipped';
        } else {
          try {
            semanticCritic = await critiqueCloudflareRasterSemanticV15({
              originalRequest: input.prompt,
              exactText: plan.exactText,
              bytes: result.bytes,
              mimeType: result.mimeType,
            }, env);
            if (!semanticCritic.safetyPassed) {
              return res.status(422).json({
                ok: false,
                code: 'RASTER_OUTPUT_SAFETY_REJECTED',
                message: '生成画像が安全性基準を満たさないため、画像を返しませんでした。',
                semanticCritic,
                retryable: false,
                freeOnly: true,
                paidFallbackUsed: false,
                secretDelivery: 'server-only',
              });
            }
            semanticGateState = semanticCritic.passed ? 'passed' : 'rejected';
          } catch {
            // A post-generation critic outage must not discard an already-created image.
            // The response explicitly marks the semantic stage as skipped.
            semanticGateState = 'skipped';
          }
        }
      }
      const planSha256 = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename(result.mimeType)}"`);
      res.setHeader('X-Origin-Structural-Verified', 'true');
      if (semanticCritic?.passed) res.setHeader('X-Origin-Visual-Verified', 'true');
      res.setHeader('X-Origin-Visual-Sha256', result.sha256);
      res.setHeader('X-Origin-Visual-Generation-Id', `raster-${result.sha256.slice(0, 24)}`);
      res.setHeader('X-Origin-Visual-Brain', 'visual-brain-v1');
      res.setHeader('X-Origin-Visual-Plan', plan.version);
      res.setHeader('X-Origin-Visual-Plan-Sha256', planSha256);
      res.setHeader('X-Origin-Visual-Purpose', plan.purpose);
      res.setHeader('X-Origin-Visual-Template', plan.templateId);
      res.setHeader('X-Origin-Visual-Safe-Margin-Pct', String(plan.safeMarginPct));
      res.setHeader('X-Origin-Visual-Typography-Zone', plan.typographyZone);
      res.setHeader('X-Origin-Visual-Critic', critic.version);
      res.setHeader('X-Origin-Visual-Quality-Score', String(critic.score));
      res.setHeader('X-Origin-Visual-Semantic-Gate', semanticGateState);
      if (semanticCritic?.passed) {
        res.setHeader('X-Origin-Visual-Semantic-Verified', 'true');
        res.setHeader('X-Origin-Visual-Semantic-Critic', semanticCritic.version);
        res.setHeader('X-Origin-Visual-Semantic-Score', String(semanticCritic.score));
      }
      res.setHeader('X-Origin-Visual-Actual-Width', String(critic.actualWidth));
      res.setHeader('X-Origin-Visual-Actual-Height', String(critic.actualHeight));
      const candidatePolicy = candidatePolicyForRasterRequestV15(input.prompt, plan.purpose);
      res.setHeader('X-Origin-Visual-Typography-Overlay', plan.requiresDeterministicTypography ? 'recommended' : 'not-required');
      res.setHeader('X-Origin-Visual-Candidate-Policy', candidatePolicy.version);
      res.setHeader('X-Origin-Visual-Candidates-Recommended', String(candidatePolicy.recommendedCandidates));
      res.setHeader('X-Origin-Visual-Candidates-Active', String(candidatePolicy.activeCandidates));
      res.setHeader('X-Origin-Visual-Best-Of-N', candidatePolicy.bestOfNEnabled ? 'true' : 'false');
      res.setHeader('X-Origin-Visual-Task', mode);
      res.setHeader('X-Origin-Visual-Reference-Count', String(input.referenceImages?.length ?? 0));
      res.setHeader('X-Origin-Visual-Provider', result.providerId);
      res.setHeader('X-Origin-Visual-Model', result.model);
      res.setHeader('X-Origin-Visual-Width', String(result.width));
      res.setHeader('X-Origin-Visual-Height', String(result.height));
      res.setHeader('X-Origin-Free-Only', 'true');
      res.setHeader('X-Origin-Cost-Evidence', result.costEvidence);
      res.setHeader('X-Origin-Paid-Fallback', 'false');
      res.setHeader('X-Origin-External-Network', 'true');
      res.setHeader('X-Origin-External-Network-Requests', String(providerSelectionRequests + providerGenerationRequests + (semanticCritic?.externalNetworkRequests ?? 0)));
      res.setHeader('X-Origin-Secret-Delivery', 'server-only');
      return res.status(200).send(result.bytes);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'RASTER_IMAGE_GENERATION_FAILED';
      if (code === 'CLOUDFLARE_WORKERS_AI_NOT_CONFIGURED') {
        return fail(res, 503, code, '無料画像生成のCloudflare Workers AI接続がまだ構成されていません。');
      }
      if (code === 'CLOUDFLARE_FREE_ALLOCATION_EXHAUSTED') {
        return fail(res, 429, code, '本日のCloudflare Workers AI無料枠を使い切ったため、画像生成を停止しました。無料枠のリセット後に再度利用できます。', false);
      }
      if (code === 'CLOUDFLARE_WORKERS_AI_CAPACITY_UNAVAILABLE') {
        return fail(res, 503, code, 'Cloudflare Workers AIが一時的に混雑しているため、画像生成を停止しました。少し時間を空けて再試行できます。', true);
      }
      if (code === 'CLOUDFLARE_MODEL_REQUIRES_PAID_PLAN'
        || code === 'CLOUDFLARE_PAID_PATH_BLOCKED'
        || code === 'CLOUDFLARE_WORKERS_PAID_PLAN_DETECTED') {
        return fail(res, 503, code, '有料プランが必要な経路はORIGINの0円条件に反するため、画像生成を停止しました。', false);
      }
      if (code === 'CLOUDFLARE_WORKERS_AI_AUTH_REQUIRED'
        || code === 'CLOUDFLARE_WORKERS_AI_ACCESS_DENIED'
        || code === 'CLOUDFLARE_BILLING_READ_REQUIRED'
        || code === 'CLOUDFLARE_WORKERS_AI_PERMISSION_REQUIRED') {
        return fail(res, 503, code, 'Cloudflare Workers AIの認証または権限を安全に確認できないため、画像生成を停止しました。', false);
      }
      if (code === 'CLOUDFLARE_WORKERS_PLAN_UNVERIFIED'
        || code === 'CLOUDFLARE_WORKERS_AI_MODEL_UNVERIFIED'
        || code === 'CLOUDFLARE_FREE_ALLOCATION_UNAVAILABLE'
        || code === 'CLOUDFLARE_FREE_OR_CAPACITY_UNAVAILABLE') {
        return fail(res, 503, code, '費用0円を事前保証できないため、画像生成を停止しました。', false);
      }
      if (code === 'RASTER_SEMANTIC_CRITIC_RESPONSE_INVALID'
        || code.startsWith('CLOUDFLARE_SEMANTIC_CRITIC_HTTP_')) {
        // The provider may already have generated an image. Never invite a client retry that could duplicate generation or consume another free allocation.
        return fail(res, 502, code, '意味品質の検証を完了できなかったため、生成画像を返しませんでした。重複生成を避けるため自動再試行を停止しました。', false);
      }
      if (code === 'ZERO_COST_USAGE_NOT_VERIFIED') {
        // Generation may already have happened. A client retry could create a duplicate
        // and consume another free allocation, so this verification failure is terminal.
        return fail(res, 503, code, '生成後の費用0円証拠を一意に確認できませんでした。重複生成を避けるため自動再試行を停止しました。', false);
      }
      if (code === 'POLLINATIONS_KEY_NOT_CONFIGURED'
        || code === 'NO_VERIFIED_ZERO_COST_RASTER_MODEL'
        || code === 'REQUESTED_IMAGE_MODEL_NOT_ZERO_COST'
        || code === 'PAID_OR_EXHAUSTED_PROVIDER_PATH_BLOCKED') {
        return fail(res, 503, code, '旧画像プロバイダ経路は有効化していません。');
      }
      return fail(res, 502, code, '画像生成プロバイダから応答を確認できませんでした。生成が既に受理された可能性があるため、自動再試行を停止しました。', false);
    }
  };

  router.post('/api/creative/v1.5/raster/generate', handler('generate'));
  router.post('/api/creative/v1.5/raster/edit', handler('edit'));
  router.post('/api/generate-image', handler('generate'));

  return router;
}
