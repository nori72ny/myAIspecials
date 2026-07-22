import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { originChatBoundaryGuard } from "./originChatBoundaryGuard";

function createGuardedApp() {
  const app = express();
  app.use(express.json());
  app.all("/api/chat", originChatBoundaryGuard);
  app.post("/api/chat", vi.fn((_req, res) => res.json({ bypassed: true })));
  return app;
}

describe("originChatBoundaryGuard", () => {
  it("blocks POST fallthrough before a later legacy handler can execute", async () => {
    const response = await request(createGuardedApp()).post("/api/chat").send({
      messages: [{ role: "user", content: "test" }],
    });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      code: "ORIGIN_CHAT_BOUNDARY_NOT_HANDLED",
      message: "ORIGINの安全なチャット境界でリクエストを処理できなかったため、旧経路への移行を停止しました。",
      retryable: false,
      requestId: "UNKNOWN",
    });
    expect(response.body).not.toHaveProperty("bypassed");
  });

  it("blocks unsupported methods on the chat path", async () => {
    const response = await request(createGuardedApp()).get("/api/chat");

    expect(response.status).toBe(500);
    expect(response.body.code).toBe("ORIGIN_CHAT_BOUNDARY_NOT_HANDLED");
  });
});
