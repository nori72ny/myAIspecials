import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  createOriginLegacyProviderBoundaryRouter,
  ORIGIN_DISABLED_PROVIDER_ROUTES,
} from "./originLegacyProviderBoundaryGuard";

function createGuardedApp() {
  const app = express();
  app.use(express.json());
  app.use(createOriginLegacyProviderBoundaryRouter());

  for (const route of ORIGIN_DISABLED_PROVIDER_ROUTES) {
    app.all(route.routePath, vi.fn((_req, res) => res.json({ bypassed: true })));
  }

  app.post("/api/chat", (_req, res) => res.json({ handledByChat: true }));
  return app;
}

describe("createOriginLegacyProviderBoundaryRouter", () => {
  it.each(ORIGIN_DISABLED_PROVIDER_ROUTES)(
    "blocks $testPath before a later provider handler can transmit content",
    async ({ testPath }) => {
      const response = await request(createGuardedApp()).post(testPath).send({
        prompt: "private test value that must not be echoed",
        input: "private executive input",
        objective: "private mission objective",
        request: "private request",
        output: "private output",
      });

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        code: "ORIGIN_PROVIDER_PATH_DISABLED",
        message: "このAI実行経路はORIGINの安全・無料実行ポリシーへ未移行のため停止しています。",
        retryable: false,
        requestId: "UNKNOWN",
      });
      expect(JSON.stringify(response.body)).not.toContain("private test value");
      expect(JSON.stringify(response.body)).not.toContain("private mission objective");
      expect(response.body).not.toHaveProperty("bypassed");
    },
  );

  it("blocks unsupported methods on an all-method disabled provider path", async () => {
    const response = await request(createGuardedApp()).get("/api/analyze");

    expect(response.status).toBe(503);
    expect(response.body.code).toBe("ORIGIN_PROVIDER_PATH_DISABLED");
  });

  it("does not intercept read-only mission status requests", async () => {
    const app = createGuardedApp();
    app.get("/api/v1/missions/test-mission", (_req, res) => res.json({ status: "local-only" }));

    const response = await request(app).get("/api/v1/missions/test-mission");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "local-only" });
  });

  it("does not intercept the authoritative chat path", async () => {
    const response = await request(createGuardedApp()).post("/api/chat").send({
      messages: [{ role: "user", content: "test" }],
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ handledByChat: true });
  });
});
