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
});
