import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import app from "./index";

const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
const originalGeminiKey = process.env.GEMINI_API_KEY;

afterEach(() => {
  if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;

  if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalGeminiKey;
});

describe("serverless ORIGIN chat boundary", () => {
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

  it("blocks unsupported chat methods before legacy routing", async () => {
    const response = await request(app).get("/api/chat");

    expect(response.status).toBe(500);
    expect(response.body.code).toBe("ORIGIN_CHAT_BOUNDARY_NOT_HANDLED");
  });
});
