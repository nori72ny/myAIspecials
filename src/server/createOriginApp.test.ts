import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ORIGIN_DISABLED_PROVIDER_ROUTES } from "../legacy/originLegacyProviderBoundaryGuard";
import { createOriginApp } from "./createOriginApp";

const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
const originalGeminiKey = process.env.GEMINI_API_KEY;
const originalAiStudioEnabled = process.env.ORIGIN_AI_STUDIO_RUNTIME_ENABLED;
const originalAiStudioKey = process.env.ORIGIN_AI_STUDIO_API_KEY;
const originalAiStudioApproval = process.env.ORIGIN_AI_STUDIO_OWNER_APPROVED;

describe("createOriginApp provider isolation", () => {
  let fetchSpy = vi.fn();

  beforeEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    process.env.GEMINI_API_KEY = "synthetic-gemini-key-that-must-remain-unused";
    process.env.ORIGIN_AI_STUDIO_RUNTIME_ENABLED = "true";
    process.env.ORIGIN_AI_STUDIO_API_KEY = "synthetic-origin-value-that-must-remain-unused";
    process.env.ORIGIN_AI_STUDIO_OWNER_APPROVED = "true";
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();

    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;

    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiKey;

    if (originalAiStudioEnabled === undefined) delete process.env.ORIGIN_AI_STUDIO_RUNTIME_ENABLED;
    else process.env.ORIGIN_AI_STUDIO_RUNTIME_ENABLED = originalAiStudioEnabled;

    if (originalAiStudioKey === undefined) delete process.env.ORIGIN_AI_STUDIO_API_KEY;
    else process.env.ORIGIN_AI_STUDIO_API_KEY = originalAiStudioKey;

    if (originalAiStudioApproval === undefined) delete process.env.ORIGIN_AI_STUDIO_OWNER_APPROVED;
    else process.env.ORIGIN_AI_STUDIO_OWNER_APPROVED = originalAiStudioApproval;
  });

  it.each(ORIGIN_DISABLED_PROVIDER_ROUTES)(
    "blocks $testPath at the Personal release boundary",
    async ({ testPath }) => {
      const privateValue = "private value that must not be parsed, echoed, or transmitted";
      const response = await request(createOriginApp()).post(testPath).send({
        prompt: privateValue,
        objective: privateValue,
        input: privateValue,
      });

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        code: "ORIGIN_PROVIDER_PATH_DISABLED",
        message: "このAI実行経路はORIGINの安全・無料実行ポリシーへ未移行のため停止しています。",
        retryable: false,
        requestId: "UNKNOWN",
      });
      expect(JSON.stringify(response.body)).not.toContain(privateValue);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it("does not use the configured Gemini key as fallback for authoritative chat", async () => {
    const response = await request(createOriginApp()).post("/api/chat").send({
      messages: [{ role: "user", content: "文章を安全に整理してください" }],
    });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe("FREE_PROVIDER_NOT_CONFIGURED");
    expect(JSON.stringify(response.body)).not.toContain(process.env.GEMINI_API_KEY);
    expect(JSON.stringify(response.body)).not.toContain(process.env.ORIGIN_AI_STUDIO_API_KEY);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks unsupported chat methods before the legacy chat handler", async () => {
    const response = await request(createOriginApp()).get("/api/chat");

    expect(response.status).toBe(500);
    expect(response.body.code).toBe("ORIGIN_CHAT_BOUNDARY_NOT_HANDLED");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    "/api/strategic",
    "/api/evolution",
    "/api/v1/missions/test-mission",
  ])("does not expose retired legacy or Mission Engine route %s", async (path) => {
    const response = await request(createOriginApp()).get(path);

    expect(response.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports the normalized Vercel deployment SHA ahead of an explicit fallback", async () => {
    const response = await request(createOriginApp({
      ORIGIN_RELEASE_SHA: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      VERCEL_GIT_COMMIT_SHA: "D128F5DCC826D4DFAE83F7B004F38AF1DAD9BC14",
    })).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      service: "acos-2",
      releaseSha: "d128f5dcc826d4dfae83f7b004f38af1dad9bc14",
    });
  });

  it("keeps the local health path aligned with the production API health path", async () => {
    const env = {
      VERCEL_GIT_COMMIT_SHA: "cccccccccccccccccccccccccccccccccccccccc",
    };
    const localResponse = await request(createOriginApp(env)).get("/health");
    const productionResponse = await request(createOriginApp(env)).get("/api/health");

    expect(localResponse.body).toEqual(productionResponse.body);
  });

  it.each(["/api", "/api/unknown", "/api/unknown/nested"])(
    "returns a JSON fail-closed response for unknown API route %s",
    async (path) => {
      const response = await request(createOriginApp()).get(path);

      expect(response.status).toBe(404);
      expect(response.headers["content-type"]).toMatch(/^application\/json/);
      expect(response.body).toEqual({
        code: "ORIGIN_API_ROUTE_NOT_FOUND",
        message: "指定されたAPIは利用できません。",
        retryable: false,
        requestId: "UNKNOWN",
      });
    },
  );

  it("uses the explicit fallback outside Vercel and rejects malformed values", async () => {
    const fallbackResponse = await request(createOriginApp({
      ORIGIN_RELEASE_SHA: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    })).get("/health");
    const malformedResponse = await request(createOriginApp({
      ORIGIN_RELEASE_SHA: "main",
    })).get("/health");

    expect(fallbackResponse.body.releaseSha).toBe(
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );
    expect(malformedResponse.body.releaseSha).toBe("unknown");
  });

  it("sets strict production security headers and removes Express fingerprinting", async () => {
    const response = await request(createOriginApp({ NODE_ENV: "production" }))
      .get("/api/health");

    expect(response.status).toBe(200);
    expect(response.headers["x-powered-by"]).toBeUndefined();
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBeUndefined();
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["strict-transport-security"]).toContain("max-age=31536000");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers["content-security-policy"]).not.toContain("frame-ancestors *");
    expect(response.headers["content-security-policy"]).toContain("object-src 'none'");
    expect(response.headers["content-security-policy"]).toContain("base-uri 'self'");
    expect(response.headers["content-security-policy"]).not.toContain("unsafe-eval");
  });

  it("accepts only JSON requests on the public chat endpoint", async () => {
    const response = await request(createOriginApp())
      .post("/api/chat")
      .type("text")
      .send("plain text");

    expect(response.status).toBe(415);
    expect(response.body.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks cross-origin chat submission before parsing or provider execution", async () => {
    const response = await request(createOriginApp())
      .post("/api/chat")
      .set("Origin", "https://attacker.example")
      .send({ messages: [{ role: "user", content: "送信しないでください" }] });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("CROSS_ORIGIN_REQUEST_BLOCKED");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns a sanitized error for malformed JSON", async () => {
    const response = await request(createOriginApp())
      .post("/api/chat")
      .set("Content-Type", "application/json")
      .send('{"messages":');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      code: "INVALID_JSON_BODY",
      message: "JSONリクエストの形式が正しくありません。",
      retryable: false,
      requestId: "UNKNOWN",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects request bodies larger than the public API limit", async () => {
    const response = await request(createOriginApp())
      .post("/api/chat")
      .send({
        messages: [{ role: "user", content: "x".repeat(70_000) }],
      });

    expect(response.status).toBe(413);
    expect(response.body.code).toBe("REQUEST_BODY_TOO_LARGE");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rate limits repeated chat requests before provider execution", async () => {
    const app = createOriginApp();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await request(app).post("/api/chat").send({
        messages: [{ role: "user", content: `安全な確認 ${attempt}` }],
      });
      expect(response.status).toBe(503);
    }

    const limited = await request(app).post("/api/chat").send({
      messages: [{ role: "user", content: "上限確認" }],
    });

    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("CHAT_RATE_LIMITED");
    expect(limited.headers["retry-after"]).toBeDefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

});
