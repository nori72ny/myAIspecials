import { Router, type Request, type Response } from 'express';
import { detectSensitiveConversation } from '../legacy/originChatValidation.js';
import { type RasterImageRequestV15, type RasterReferenceImageV15 } from './rasterImageProviderV15.js';
import { planRasterVisualRequestV15 } from './rasterVisualPlannerV15.js';
import { readRasterDimensionsV15 } from './rasterImageCriticV15.js';
import { rasterVisualTemplatesV15 } from './rasterVisualTemplatesV15.js';
import { candidatePolicyForRasterRequestV15 } from './rasterTechnicalCriticV15.js';

const BASE_BODY_KEYS = new Set(['prompt', 'negativePrompt', 'width', 'height', 'model']);
const EDIT_BODY_KEYS = new Set([...BASE_BODY_KEYS, 'referenceImages']);
const MAX_REFERENCE_IMAGES = 4;
const MAX_REFERENCE_IMAGE_BYTES = 768 * 1024;
const MAX_TOTAL_REFERENCE_BYTES = 2 * 1024 * 1024;
const MAX_REFERENCE_DIMENSION_EXCLUSIVE = 512;

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

export function createRasterImageV15Router(_env: NodeJS.ProcessEnv = process.env) {
  const router = Router();

  router.get('/api/creative/v1.5/raster/status', (_req, res) => {
    // Public status must never fan out to provider/billing APIs. It reports only
    // locally known, conservative state; live qualification is handled separately.
    return res.status(503).json({
      ok: false,
      ready: false,
      providerId: null,
      model: null,
      zeroCostVerified: false,
      freeAllocationEligible: false,
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
        enabled: false,
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
    // Release safety boundary: raster inference remains disabled until exact-request
    // pre-inference $0.00 evidence is independently verifiable. This server-side
    // guard applies to direct API calls as well as the browser UI.
    return fail(
      res,
      503,
      'RASTER_GENERATION_DISABLED_ZERO_COST_POLICY',
      'リクエスト単位で費用0円を事前保証できないため、AI画像生成・編集は停止しています。',
      false,
    );

      } catch (error) {
        return fail(res, 400, error instanceof Error ? error.message : 'INVALID_RASTER_REQUEST');
      }
  };

  router.post('/api/creative/v1.5/raster/generate', handler('generate'));
  router.post('/api/creative/v1.5/raster/edit', handler('edit'));
  router.post('/api/generate-image', handler('generate'));

  return router;
}
