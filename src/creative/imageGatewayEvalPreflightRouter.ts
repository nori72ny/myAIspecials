import { Router } from 'express';

/**
 * Paid AI Gateway evaluation is not part of ORIGIN Personal.
 * Keep this route permanently unavailable even if mounted by a future refactor.
 */
export function createImageGatewayEvalPreflightRouter() {
  const router = Router();
  router.all('/api/eval/image-gateway/credits', (_req, res) =>
    res.status(404).json({ code: 'EVAL_ROUTE_NOT_AVAILABLE' }),
  );
  return router;
}
