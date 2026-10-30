import { Router } from 'express';

const BLOCKED_CODE = 'PAID_IMAGE_ROUTE_DISABLED_BY_ZERO_COST_POLICY';
const BLOCKED_MESSAGE = '0円運用ポリシーにより、有料frontier画像モデル経路は無効です。';

export function createWorldClassImageV16Router(_env: NodeJS.ProcessEnv = process.env) {
  const router = Router();
  const blocked = (_req: unknown, res: import('express').Response) => res.status(503).json({
    ok: false,
    ready: false,
    evaluationReady: false,
    enabled: false,
    qualified: false,
    provider: 'disabled-by-zero-cost-policy',
    providerReady: false,
    freeOnly: true,
    paidFallbackEnabled: false,
    code: BLOCKED_CODE,
    message: BLOCKED_MESSAGE,
    retryable: false,
    secretDelivery: 'server-only',
  });

  // This router is permanently disabled: configuration must never re-enable a paid image path.
  router.get('/api/creative/v1.6/world-class/status', blocked);
  router.post('/api/creative/v1.6/world-class/generate', blocked);
  router.post('/api/creative/v1.6/world-class/edit', blocked);
  return router;
}
