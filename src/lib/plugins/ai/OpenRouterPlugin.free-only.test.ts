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
    " google/gemma-4-31b-it:free ",
  ])("rejects non-canonical free model identifiers: %s", async (modelId) => {
    vi.stubEnv("FREE_ONLY", "false");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const plugin = new OpenRouterPlugin("test-key");

    await expect(plugin.generateText(modelId, "test", { freeOnly: false, throwOnBlock: true }))
      .rejects.toMatchObject({ message: "FREE_MODEL_UNAVAILABLE", statusCode: 400 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not let callers expand the mutable public manifest into paid-model authorization", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const plugin = new OpenRouterPlugin("test-key");
    plugin.manifest.models.push({
      id: "openai/gpt-4o",
      name: "Injected paid model",
      speed: 10,
      cost: 0,
      quality: 10,
      failureRate: 0,
      specialties: []
    });

    await expect(plugin.generateText("openai/gpt-4o", "test", { throwOnBlock: true }))
      .rejects.toMatchObject({ message: "FREE_MODEL_UNAVAILABLE", statusCode: 400 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an unlisted model even when its identifier ends in :free", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const plugin = new OpenRouterPlugin("test-key");

    await expect(plugin.generateText("unlisted/provider-model:free", "test", { throwOnBlock: true }))
      .rejects.toMatchObject({ message: "FREE_MODEL_UNAVAILABLE", statusCode: 400 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(["", "mock-placeholder"])("fails closed when runtime credentials are unavailable: %s", async (apiKey) => {
    vi.stubEnv("NODE_ENV", "production");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const plugin = new OpenRouterPlugin(apiKey);

    await expect(plugin.generateText("google/gemma-4-31b-it:free", "test"))
      .rejects.toMatchObject({ message: "FREE_ONLY_PROVIDER_BOUNDARY_REQUIRED", statusCode: 503 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never sends a direct legacy request even with a valid key and canonical model", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const plugin = new OpenRouterPlugin("configured-key");

    await expect(plugin.generateText("google/gemma-4-31b-it:free", "test"))
      .rejects.toMatchObject({ message: "FREE_ONLY_PROVIDER_BOUNDARY_REQUIRED", statusCode: 503 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts the catalogued free model through deterministic test mock only", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("FREE_ONLY", "false");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const plugin = new OpenRouterPlugin("test-key");

    await expect(plugin.generateText("google/gemma-4-31b-it:free", "test"))
      .resolves.toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
