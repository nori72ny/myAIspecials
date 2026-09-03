import { beforeEach, describe, expect, it, vi } from "vitest";

const secureFetch = vi.fn();
vi.mock("../../services/mission-engine/src/application/agent/ToolExecutor.js", () => ({ secureFetch }));

import { researchCurrentInformation } from "./originResearchSource.js";

describe("originResearchSource", () => {
  beforeEach(() => secureFetch.mockReset());

  it("searches the language-appropriate public Wikipedia endpoint and returns source metadata", async () => {
    secureFetch
      .mockResolvedValueOnce(JSON.stringify({ pages: [{ key: "AIO", title: "AI optimization", excerpt: "AI search optimization is the practice of improving visibility in AI-mediated search." }] }))
      .mockResolvedValueOnce(JSON.stringify({ html_url: "https://en.wikipedia.org/wiki/AI_optimization", latest: { timestamp: "2026-09-01T00:00:00Z" } }));

    const result = await researchCurrentInformation("AIO");
    expect(result.ok).toBe(true);
    expect(result.sources[0]).toMatchObject({ title: "AI optimization", url: "https://en.wikipedia.org/wiki/AI_optimization", revisionTimestamp: "2026-09-01T00:00:00Z" });
    expect(secureFetch.mock.calls[0][0]).toContain("https://en.wikipedia.org/w/rest.php/v1/search/page?q=AIO");
  });

  it("uses Japanese Wikipedia for Japanese queries", async () => {
    secureFetch.mockResolvedValueOnce(JSON.stringify({ pages: [{ key: "人工知能", title: "人工知能", excerpt: "人工知能に関する説明" }] }));
    const result = await researchCurrentInformation("人工知能");
    expect(result.ok).toBe(true);
    expect(secureFetch.mock.calls[0][0]).toContain("https://ja.wikipedia.org/");
  });

  it("fails closed when the source cannot be reached", async () => {
    secureFetch.mockRejectedValueOnce(new Error("network blocked"));
    const result = await researchCurrentInformation("latest AI news");
    expect(result.ok).toBe(false);
    expect(result.sources).toEqual([]);
    expect(result.limitation).toContain("network blocked");
  });
});
