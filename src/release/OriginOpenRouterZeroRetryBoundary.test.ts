// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/lib/plugins/ai/OpenRouterPlugin.ts"), "utf8");

describe("OpenRouter free-only retry boundary", () => {
  it("keeps free-only execution to one request with zero automatic retries", () => {
    expect(source).toContain("const maxRetries = isFreeOnly ? 0 : requestedRetries");
    expect(source).toContain("const maxAttempts = 1 + maxRetries");
    expect(source).toContain("while (attempt < maxAttempts)");
    expect(source).not.toContain("options?.maxRetries ?? 3");
  });

  it("keeps upstream failure diagnostics metadata-only", () => {
    expect(source).not.toContain("response.text()");
    expect(source).not.toContain("requestId, errorBody");
    expect(source).not.toContain("public readonly rawError");
    expect(source).not.toContain("requestId, data");
    expect(source).not.toContain("undefined, undefined, error");
    expect(source).toContain('Logger.error(`[OpenRouterPlugin] Request error on attempt ${attempt}`, { name: error?.name || "Error" })');
  });

  it("never turns a missing provider credential into a fake successful answer", () => {
    expect(source).toContain('throw new OpenRouterError("PROVIDER_NOT_CONFIGURED", 503)');
    expect(source).not.toContain("!this._apiKey || this._apiKey.startsWith");
    expect(source).toContain('process.env.NODE_ENV === "test" || this._apiKey.startsWith("mock-")');
  });

  it("does not retry 429 or 5xx when free-only forces maxRetries to zero", () => {
    expect(source).toContain("if (status === 429)");
    expect(source).toContain("if (status >= 500)");
    expect(source).toContain("if (attempt < maxAttempts)");
  });
});
