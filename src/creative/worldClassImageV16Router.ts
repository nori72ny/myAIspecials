import type { Router } from 'express';

import { createWorldClassImageZeroCostRouter } from './worldClassImageZeroCostRouter.js';

/**
 * Compatibility export for callers that still import the V1.6 router name.
 *
 * ORIGIN is permanently zero-cost for image generation. This compatibility
 * layer intentionally delegates to the zero-cost router and contains no paid
 * image-provider code or fallback.
 */
export function createWorldClassImageV16Router(
  env: NodeJS.ProcessEnv = process.env,
): Router {
  return createWorldClassImageZeroCostRouter(env);
}
