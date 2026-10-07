import { Router } from 'express';

const GATEWAY_BASE = 'https://ai-gateway.vercel.sh/v1';
const REQUIRED_IMAGE_MODELS = [
  'bytedance/seedream-5.0-pro',
  'bytedance/seedream-5.0-lite',
  'recraft/recraft-v4.1',
  'recraft/recraft-v4',
  'bfl/flux-pro-1.1',
] as const;

export function createImageGatewayEvalPreflightRouter(env: NodeJS.ProcessEnv = process.env) {
  const router = Router();

  router.get('/api/eval/image-gateway/credits', async (req, res) => {
    if (env.VERCEL_ENV?.trim().toLowerCase() !== 'preview') {
      return res.status(404).json({ code: 'EVAL_ROUTE_NOT_AVAILABLE' });
    }

    const token = req.get('x-vercel-oidc-token')?.trim() || env.VERCEL_OIDC_TOKEN?.trim();
    if (!token) {
      return res.status(503).json({
        ok: false,
        code: 'VERCEL_OIDC_TOKEN_NOT_AVAILABLE',
        retryable: false,
      });
    }

    const creditsResponse = await fetch(`${GATEWAY_BASE}/credits`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);

    if (!creditsResponse) {
      return res.status(503).json({ ok: false, code: 'AI_GATEWAY_CREDITS_NETWORK_FAILED', retryable: true });
    }

    const creditsBody = await creditsResponse.json().catch(() => ({})) as Record<string, unknown>;
    if (!creditsResponse.ok) {
      return res.status(creditsResponse.status).json({
        ok: false,
        code: typeof creditsBody.error === 'string'
          ? creditsBody.error.slice(0, 120)
          : `AI_GATEWAY_CREDITS_HTTP_${creditsResponse.status}`,
        retryable: creditsResponse.status >= 500,
      });
    }

    const modelsResponse = await fetch(`${GATEWAY_BASE}/models`, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);

    if (!modelsResponse?.ok) {
      return res.status(503).json({ ok: false, code: 'AI_GATEWAY_MODELS_UNAVAILABLE', retryable: true });
    }

    const modelsBody = await modelsResponse.json().catch(() => ({})) as { data?: Array<{ id?: string }> };
    const ids = new Set((modelsBody.data ?? []).map((row) => row.id).filter((id): id is string => Boolean(id)));
    const requiredModels = Object.fromEntries(REQUIRED_IMAGE_MODELS.map((id) => [id, ids.has(id)]));

    return res.status(200).json({
      ok: true,
      previewOnly: true,
      oidcAuthenticated: true,
      requiredModels,
      allRequiredModelsAvailable: Object.values(requiredModels).every(Boolean),
      credits: creditsBody,
      hardEvaluationCapUsd: 6,
      perCaseTargetCapUsd: 0.22,
      publicationEffect: 'none',
    });
  });

  return router;
}
