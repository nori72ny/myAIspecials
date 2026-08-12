import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import app, { createVercelHandler } from "./index";

const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
const originalGeminiKey = process.env.GEMINI_API_KEY;
const originalAiStudioEnabled = process.env.ORIGIN_AI_STUDIO_RUNTIME_ENABLED;
const originalAiStudioKey = process.env.ORIGIN_AI_STUDIO_API_KEY;
const originalAiStudioApproval = process.env.ORIGIN_AI_STUDIO_OWNER_APPROVED;

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

describe("serverless ORIGIN chat boundary", () => {
  it("exports a two-argument Vercel handler and serves health after deferred initialization", async () => {
    expect(app.length).toBe(2);

    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.service).toBe("acos-2");
  });

  it("reports only a bounded error class and code when initialization fails", async () => {
    const secret = ["synthetic", "initialization", "secret", "123456"].join("_");
    const error = Object.assign(new Error(secret), { code: "ERR_MODULE_NOT_FOUND" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failingHandler = createVercelHandler(async () => {
      throw error;
    });

    const response = await request(failingHandler).get("/api/health");

    expect(response.status).toBe(500);
    expect(response.body.code).toBe("ORIGIN_FUNCTION_INIT_FAILED");
    expect(JSON.stringify(response.body)).not.toContain(secret);
    expect(errorSpy).toHaveBeenCalledWith("ORIGIN_FUNCTION_INIT_FAILED", {
      name: "Error",
      code: "ERR_MODULE_NOT_FOUND",
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(secret);
  });

  it("blocks a synthetic secret before legacy routing or provider execution", async () => {
    const secret = ["synthetic", "serverless", "secret", "123456"].join("_");
    const response = await request(app).post("/api/chat").send({
      messages: [{
        role: "user",
        content: `Authorization: Bearer ${secret}`,
      }],
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe("SENSITIVE_INPUT_BLOCKED");
    expect(response.body.requestId).toMatch(/^origin-/);
    expect(JSON.stringify(response.body)).not.toContain(secret);
  });

  it("does not fall back to the historical Gemini chat path", async () => {
    delete process.env.OPENROUTER_API_KEY;
    process.env.GEMINI_API_KEY = ["synthetic", "gemini", "configuration"].join("-");

    const response = await request(app).post("/api/chat").send({
      messages: [{ role: "user", content: "文章を確認してください" }],
    });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe("FREE_PROVIDER_NOT_CONFIGURED");
    expect(response.body.requestId).toMatch(/^origin-/);
  });

  it("does not activate AI Studio from environment flags or approval-like values", async () => {
    delete process.env.OPENROUTER_API_KEY;
    process.env.ORIGIN_AI_STUDIO_RUNTIME_ENABLED = "true";
    process.env.ORIGIN_AI_STUDIO_API_KEY = ["synthetic", "origin", "configuration"].join("-");
    process.env.ORIGIN_AI_STUDIO_OWNER_APPROVED = "true";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const response = await request(app).post("/api/chat").send({
      messages: [{ role: "user", content: "文章を確認してください" }],
    });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe("FREE_PROVIDER_NOT_CONFIGURED");
    expect(JSON.stringify(response.body)).not.toContain(process.env.ORIGIN_AI_STUDIO_API_KEY);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks unsupported chat methods before legacy routing", async () => {
    const response = await request(app).get("/api/chat");

    expect(response.status).toBe(500);
    expect(response.body.code).toBe("ORIGIN_CHAT_BOUNDARY_NOT_HANDLED");
  });
});
