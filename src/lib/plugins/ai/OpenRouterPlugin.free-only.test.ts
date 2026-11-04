import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenRouterPlugin } from "./OpenRouterPlugin";

describe("OpenRouterPlugin strict free model boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    "openai/gpt-4o",
    "provider/model-free",
    "provider/free",
    "provider/model:free:preview",
    "provider/model:FREE-extra",
  ])("rejects non-canonical free model identifiers: %s", async (modelId) => {
    vi.stubEnv("FREE_ONLY", "false");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const plugin = new OpenRouterPlugin("test-key");

    await expect(plugin.generateText(modelId, "test", { freeOnly: false, throwOnBlock: true }))
      .rejects.toMatchObject({ message: "FREE_MODEL_UNAVAILABLE", statusCode: 400 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts only an exact :free suffix without contacting the network in test mode", async () => {
    vi.stubEnv("FREE_ONLY", "false");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const plugin = new OpenRouterPlugin("test-key");

    await expect(plugin.generateText("google/gemini-2.5-flash:free", "test"))
      .resolves.toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
