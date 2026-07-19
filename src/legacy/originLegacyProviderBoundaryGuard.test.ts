import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  createOriginLegacyProviderBoundaryRouter,
  ORIGIN_DISABLED_LEGACY_PROVIDER_PATHS,
} from "./originLegacyProviderBoundaryGuard";

function createGuardedApp() {
  const app = express();
  app.use(express.json());
  app.use(createOriginLegacyProviderBoundaryRouter());

  for (const path of ORIGIN_DISABLED_LEGACY_PROVIDER_PATHS) {
    app.all(path, vi.fn((_req, res) => res.json({ bypassed: true })));
  }

  app.post("/api/chat", (_req, res) => res.json({ handledByChat: true }));
  return app;
}

describe("createOriginLegacyProviderBoundaryRouter", () => {
  it.each(ORIGIN_DISABLED_LEGACY_PROVIDER_PATHS)(
    "blocks %s before a later legacy handler can transmit content",
    async (path) => {
      const response = await request(createGuardedApp()).post(path).send({
        prompt: "private test value that must not be echoed",
        request: "private request",
        output: "private output",
      });

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        code: "ORIGIN_LEGACY_PROVIDER_PATH_DISABLED",
        message: "この旧AI実行経路はORIGINの安全・無料実行ポリシーへ未移行のため停止しています。",
        retryable: false,
        requestId: "UNKNOWN",
      });
      expect(JSON.stringify(response.body)).not.toContain("private test value");
      expect(response.body).not.toHaveProperty("bypassed");
    },
  );

  it("blocks unsupported methods on a disabled provider path", async () => {
    const response = await request(createGuardedApp()).get("/api/analyze");

    expect(response.status).toBe(503);
    expect(response.body.code).toBe("ORIGIN_LEGACY_PROVIDER_PATH_DISABLED");
  });

  it("does not intercept the authoritative chat path", async () => {
    const response = await request(createGuardedApp()).post("/api/chat").send({
      messages: [{ role: "user", content: "test" }],
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ handledByChat: true });
  });
});
