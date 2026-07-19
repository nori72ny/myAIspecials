import { Router } from "express";

export const ORIGIN_DISABLED_LEGACY_PROVIDER_PATHS = [
  "/api/v1/validate-mission",
  "/api/analyze",
  "/api/generate-image",
  "/api/swarm/run",
] as const;

const DISABLED_RESPONSE = {
  code: "ORIGIN_LEGACY_PROVIDER_PATH_DISABLED",
  message: "この旧AI実行経路はORIGINの安全・無料実行ポリシーへ未移行のため停止しています。",
  retryable: false,
  requestId: "UNKNOWN",
} as const;

export function createOriginLegacyProviderBoundaryRouter() {
  const router = Router();

  for (const path of ORIGIN_DISABLED_LEGACY_PROVIDER_PATHS) {
    router.all(path, (_req, res) => {
      res.status(503).json(DISABLED_RESPONSE);
    });
  }

  return router;
}
