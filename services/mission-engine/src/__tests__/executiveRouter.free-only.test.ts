import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createExecutiveRouter } from "../presentation/routes/executiveRouter";
import type { GeminiLLMClient } from "../infrastructure/ai/GeminiLLMClient";

describe("legacy Executive Brain FREE_ONLY boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects production execution even if FREE_ONLY is incorrectly false", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FREE_ONLY", "false");
    const generateText = vi.fn();
    const app = express();
    app.use(express.json());
    app.use("/executive", createExecutiveRouter({ generateText } as unknown as GeminiLLMClient));

    const response = await request(app).post("/executive/run").send({ input: "sensitive request" });
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("FREE_ONLY_EXECUTION_BOUNDARY");
    expect(generateText).not.toHaveBeenCalled();
  });
});
