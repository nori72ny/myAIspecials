import { Router, type Request, type Response } from "express";

export interface OriginDisabledProviderRoute {
  method: "all" | "post";
  routePath: string;
  testPath: string;
}

export const ORIGIN_DISABLED_PROVIDER_ROUTES: readonly OriginDisabledProviderRoute[] = [
  { method: "all", routePath: "/api/v1/validate-mission", testPath: "/api/v1/validate-mission" },
  { method: "all", routePath: "/api/analyze", testPath: "/api/analyze" },
  { method: "all", routePath: "/api/generate-image", testPath: "/api/generate-image" },
  { method: "all", routePath: "/api/swarm/run", testPath: "/api/swarm/run" },
  { method: "all", routePath: "/api/github/generate-changelog", testPath: "/api/github/generate-changelog" },
  { method: "all", routePath: "/api/github/audit-issues", testPath: "/api/github/audit-issues" },
  { method: "post", routePath: "/api/v1/missions", testPath: "/api/v1/missions" },
  {
    method: "post",
    routePath: "/api/v1/missions/:missionId/execute",
    testPath: "/api/v1/missions/test-mission/execute",
  },
  {
    method: "all",
    routePath: "/api/v1/organizations/:orgId/execute",
    testPath: "/api/v1/organizations/test-organization/execute",
  },
  { method: "post", routePath: "/api/v1/executive/run", testPath: "/api/v1/executive/run" },
] as const;

export const ORIGIN_DISABLED_LEGACY_PROVIDER_PATHS = ORIGIN_DISABLED_PROVIDER_ROUTES
  .filter((route) => route.method === "all")
  .map((route) => route.routePath);

const DISABLED_RESPONSE = {
  code: "ORIGIN_PROVIDER_PATH_DISABLED",
  message: "このAI実行経路はORIGINの安全・無料実行ポリシーへ未移行のため停止しています。",
  retryable: false,
  requestId: "UNKNOWN",
} as const;

export function createOriginLegacyProviderBoundaryRouter() {
  const router = Router();
  const reject = (_req: Request, res: Response) => {
    res.status(503).json(DISABLED_RESPONSE);
  };

  for (const route of ORIGIN_DISABLED_PROVIDER_ROUTES) {
    if (route.method === "all") {
      router.all(route.routePath, reject);
    } else {
      router.post(route.routePath, reject);
    }
  }

  return router;
}
