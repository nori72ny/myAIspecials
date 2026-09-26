import { createHash } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { detectSensitiveConversation } from '../legacy/originChatValidation.js';
import { type RasterImageRequestV15 } from './rasterImageProviderV15.js';
import {
  rasterProviderRuntimeStatusV15,
  resolveRasterProviderV15,
} from './rasterProviderRegistryV15.js';
import { planRasterVisualRequestV15 } from './rasterVisualPlannerV15.js';
import { critiqueRasterStructureV15 } from './rasterImageCriticV15.js';
import { rasterVisualTemplatesV15 } from './rasterVisualTemplatesV15.js';
import { candidatePolicyForRasterRequestV15 } from './rasterTechnicalCriticV15.js';
import {
  completeRasterDeviceAuthV15,
  disconnectRasterDeviceAuthV15,
  rasterDeviceAuthConfiguredV15,
  resolveRasterDeviceApiKeyV15,
  startRasterDeviceAuthV15,
} from './rasterDeviceAuthV15.js';

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
  return {
    prompt: record.prompt,
    negativePrompt: record.negativePrompt as string | undefined,
    width: record.width as number | undefined,
    height: record.height as number | undefined,
    model: record.model as string | undefined,
  };
}

function providerEnvForRequest(req: Request, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const cookieKey = resolveRasterDeviceApiKeyV15(req, env);
  return cookieKey ? { ...env, POLLINATIONS_API_KEY: cookieKey } : env;
}

function filename(mime: string): string {
  if (mime === 'image/png') return 'origin-image.png';
  if (mime === 'image/webp') return 'origin-image.webp';
  return 'origin-image.jpg';
}

export function createRasterImageV15Router(env: NodeJS.ProcessEnv = process.env) {
  const router = Router();

  router.get('/api/creative/v1.5/raster/status', async (req, res) => {
    const runtimeEnv = providerEnvForRequest(req, env);
    const runtime = await rasterProviderRuntimeStatusV15(runtimeEnv);
    const status = runtime.textToImageStatus;
    return res.status(runtime.textToImageReady ? 200 : 503).json({
      ok: runtime.textToImageReady,
      configured: status?.configured ?? false,
      ready: runtime.textToImageReady,
      providerId: status?.providerId ?? null,
      model: status?.model ?? null,
      zeroCostVerified: status?.zeroCostVerified ?? false,
      paymentMethodRequired: status?.paymentMethodRequired ?? false,
      secretDelivery: status?.secretDelivery ?? 'server-only',
      externalNetwork: status?.externalNetwork ?? true,
      reason: runtime.textToImageReason,
      providerAgnostic: runtime.providerAgnostic,
      registryVersion: runtime.registryVersion,
      providers: runtime.providers,
      freeOnly: true,
      costUsd: 0,
      paidFallbackEnabled: false,
      supportedTasks: runtime.supportedTasks,
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
      candidateSelection: {
        ...candidatePolicyForRasterRequestV15('高品質な広告画像を作ってください', 'advertisement'),
        activationGate: 'live-zero-cost-quota-and-latency-evidence',
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
      modelBasedImageEditing: runtime.editingReady,
    });
  });

  router.get('/api/creative/v1.5/raster/connect/status', (req, res) => {
    const connected = Boolean(resolveRasterDeviceApiKeyV15(req, env) || env.POLLINATIONS_API_KEY?.trim());
    return res.status(200).json({
      ok: true,
      connected,
      deviceAuthReady: rasterDeviceAuthConfiguredV15(env),
      mode: resolveRasterDeviceApiKeyV15(req, env) ? 'device-cookie' : env.POLLINATIONS_API_KEY?.trim() ? 'server-env' : 'disconnected',
      secretDelivery: 'server-only',
      freeOnly: true,
      paidFallbackEnabled: false,
    });
  });

  router.post('/api/creative/v1.5/raster/connect/start', async (req, res) => {
    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body) && Object.keys(req.body).length > 0) {
      return fail(res, 400, 'IMAGE_DEVICE_AUTH_BODY_NOT_ALLOWED');
    }
    try { return await startRasterDeviceAuthV15(req, res, env); }
    catch { return fail(res, 502, 'IMAGE_DEVICE_AUTH_START_FAILED'); }
  });

  router.post('/api/creative/v1.5/raster/connect/complete', async (req, res) => {
    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body) && Object.keys(req.body).length > 0) {
      return fail(res, 400, 'IMAGE_DEVICE_AUTH_BODY_NOT_ALLOWED');
    }
    try { return await completeRasterDeviceAuthV15(req, res, env); }
    catch { return fail(res, 502, 'IMAGE_DEVICE_AUTH_COMPLETE_FAILED'); }
  });

  router.post('/api/creative/v1.5/raster/connect/disconnect', (req, res) => {
    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body) && Object.keys(req.body).length > 0) {
      return fail(res, 400, 'IMAGE_DEVICE_AUTH_BODY_NOT_ALLOWED');
    }
    return disconnectRasterDeviceAuthV15(req, res);
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
        costUsd: 0,
        paidFallbackUsed: false,
        providerExecutions: 0,
      });
    } catch (error) {
      return fail(res, 400, error instanceof Error ? error.message : 'INVALID_RASTER_REQUEST');
    }
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
          costUsd: 0,
          paidFallbackUsed: false,
          providerExecutions: 0,
          secretDelivery: 'server-only',
        });
      }
      const provider = resolveRasterProviderV15('text-to-image');
      if (!provider) {
        return fail(res, 503, 'NO_PROVIDER_SUPPORTS_TASK', '画像生成に対応する検証済みプロバイダがありません。');
      }
      const runtimeEnv = providerEnvForRequest(req, env);
      const result = await provider.generate({
        ...input,
        prompt: plan.compiledPrompt,
        negativePrompt: input.negativePrompt?.trim()
          ? `${plan.negativePrompt}, ${input.negativePrompt.trim()}`
          : plan.negativePrompt,
        width: input.width ?? plan.width,
        height: input.height ?? plan.height,
      }, runtimeEnv);
      const expectedWidth = input.width ?? plan.width;
      const expectedHeight = input.height ?? plan.height;
      const critic = critiqueRasterStructureV15(result.bytes, result.mimeType, expectedWidth, expectedHeight);
      if (!critic.passed) {
        return res.status(502).json({
          ok: false,
          code: 'RASTER_CRITIC_REJECTED',
          message: '生成画像の構造検証に失敗したため、画像を返しませんでした。',
          critic,
          freeOnly: true,
          costUsd: 0,
          paidFallbackUsed: false,
          secretDelivery: 'server-only',
        });
      }
      const planSha256 = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename(result.mimeType)}"`);
      res.setHeader('X-Origin-Visual-Verified', 'true');
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
      res.setHeader('X-Origin-Visual-Actual-Width', String(critic.actualWidth));
      res.setHeader('X-Origin-Visual-Actual-Height', String(critic.actualHeight));
      const candidatePolicy = candidatePolicyForRasterRequestV15(input.prompt, plan.purpose);
      res.setHeader('X-Origin-Visual-Typography-Overlay', plan.requiresDeterministicTypography ? 'recommended' : 'not-required');
      res.setHeader('X-Origin-Visual-Candidate-Policy', candidatePolicy.version);
      res.setHeader('X-Origin-Visual-Candidates-Recommended', String(candidatePolicy.recommendedCandidates));
      res.setHeader('X-Origin-Visual-Candidates-Active', String(candidatePolicy.activeCandidates));
      res.setHeader('X-Origin-Visual-Best-Of-N', candidatePolicy.bestOfNEnabled ? 'true' : 'false');
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
