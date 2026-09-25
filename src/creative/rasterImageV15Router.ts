import { Router, type Request, type Response } from 'express';
import { detectSensitiveConversation } from '../legacy/originChatValidation.js';
import {
  generateRasterImageV15,
  getRasterProviderStatusV15,
  type RasterImageRequestV15,
} from './rasterImageProviderV15.js';

const MAX_BODY_KEYS = new Set(['prompt', 'negativePrompt', 'width', 'height', 'model']);

function sensitiveKinds(body: unknown): string[] {
  let serialized = '';
  try { serialized = JSON.stringify(body ?? {}); } catch { return ['unserializable_input']; }
  return detectSensitiveConversation([{ role: 'user', content: serialized }]);
}

function fail(res: Response, status: number, code: string, message?: string) {
  return res.status(status).json({
    ok: false,
    code,
    message: message ?? code,
    retryable: status >= 500,
    freeOnly: true,
    costUsd: 0,
    paidFallbackUsed: false,
    secretDelivery: 'server-only',
  });
}

function parseBody(body: unknown): RasterImageRequestV15 {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('INVALID_RASTER_REQUEST');
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !MAX_BODY_KEYS.has(key))) throw new Error('INVALID_RASTER_REQUEST_FIELD');
  if (typeof record.prompt !== 'string' || !record.prompt.trim()) throw new Error('INVALID_RASTER_PROMPT');
  if (record.negativePrompt !== undefined && typeof record.negativePrompt !== 'string') throw new Error('INVALID_RASTER_NEGATIVE_PROMPT');
  if (record.model !== undefined && typeof record.model !== 'string') throw new Error('INVALID_RASTER_MODEL');
  for (const key of ['width', 'height'] as const) {
    if (record[key] !== undefined && (typeof record[key] !== 'number' || !Number.isInteger(record[key]))) {
      throw new Error('INVALID_RASTER_DIMENSION');
    }
  }
  return {
    prompt: record.prompt,
    negativePrompt: record.negativePrompt as string | undefined,
    width: record.width as number | undefined,
    height: record.height as number | undefined,
    model: record.model as string | undefined,
  };
}

function filename(mime: string): string {
  if (mime === 'image/png') return 'origin-image.png';
  if (mime === 'image/webp') return 'origin-image.webp';
  return 'origin-image.jpg';
}

export function createRasterImageV15Router(env: NodeJS.ProcessEnv = process.env) {
  const router = Router();

  router.get('/api/creative/v1.5/raster/status', async (_req, res) => {
    const status = await getRasterProviderStatusV15(env);
    return res.status(status.ready ? 200 : 503).json({
      ok: status.ready,
      ...status,
      freeOnly: true,
      costUsd: 0,
      paidFallbackEnabled: false,
      supportedTasks: status.ready ? ['text-to-image'] : [],
      modelBasedImageEditing: false,
    });
  });

  const handler = async (req: Request, res: Response) => {
    const kinds = sensitiveKinds(req.body);
    if (kinds.length > 0) {
      return fail(res, 422, 'SENSITIVE_INPUT_BLOCKED', '機密・個人情報の可能性があるため、外部画像プロバイダへ送信しませんでした。');
    }

    let input: RasterImageRequestV15;
    try {
      input = parseBody(req.body);
    } catch (error) {
      return fail(res, 400, error instanceof Error ? error.message : 'INVALID_RASTER_REQUEST');
    }

    try {
      const result = await generateRasterImageV15(input, env);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename(result.mimeType)}"`);
      res.setHeader('X-Origin-Visual-Verified', 'true');
      res.setHeader('X-Origin-Visual-Sha256', result.sha256);
      res.setHeader('X-Origin-Visual-Generation-Id', `raster-${result.sha256.slice(0, 24)}`);
      res.setHeader('X-Origin-Visual-Provider', result.providerId);
      res.setHeader('X-Origin-Visual-Model', result.model);
      res.setHeader('X-Origin-Visual-Width', String(result.width));
      res.setHeader('X-Origin-Visual-Height', String(result.height));
      res.setHeader('X-Origin-Free-Only', 'true');
      res.setHeader('X-Origin-Cost-Usd', '0');
      res.setHeader('X-Origin-Paid-Fallback', 'false');
      res.setHeader('X-Origin-External-Network', 'true');
      res.setHeader('X-Origin-External-Network-Requests', String(result.externalNetworkRequests));
      res.setHeader('X-Origin-Secret-Delivery', 'server-only');
      return res.status(200).send(result.bytes);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'RASTER_IMAGE_GENERATION_FAILED';
      if (code === 'POLLINATIONS_KEY_NOT_CONFIGURED') {
        return fail(res, 503, code, '無料画像生成プロバイダの認証がまだ構成されていません。');
      }
      if (code === 'NO_VERIFIED_ZERO_COST_RASTER_MODEL' || code === 'REQUESTED_IMAGE_MODEL_NOT_ZERO_COST' || code === 'PAID_OR_EXHAUSTED_PROVIDER_PATH_BLOCKED') {
        return fail(res, 503, code, '費用0円を証明できる画像モデルがないため、生成を停止しました。');
      }
      return fail(res, 502, code, '画像生成プロバイダの検証または生成に失敗しました。');
    }
  };

  router.post('/api/creative/v1.5/raster/generate', handler);
  router.post('/api/generate-image', handler);

  return router;
}
