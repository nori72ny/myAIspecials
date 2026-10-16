import { describe, it, expect } from "vitest";
import { ArtifactDesignStudio } from "../../src/server/artifacts/artifactDesignStudio";
describe("ArtifactDesignStudio Invariants", () => {
  it("generates valid SVG with correct dimensions", () => {
    const res = ArtifactDesignStudio.generateAdBanner({
      headline: "ORIGIN Personal", subheadline: "World Class AI",
      priceTag: "Free Tier", callToAction: "Start",
      themeColor: "#1E40AF", aspectRatio: "OGP_1200_630"
    });
    expect(res.format).toBe("SVG");
    expect(res.dimensions.width).toBe(1200);
    expect(res.rawSvg).toContain("viewBox=\"0 0 1200 630\"");
  });
});
