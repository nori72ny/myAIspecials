import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MultiAIDelegationPanelV2 from "./MultiAIDelegationPanelV2";


describe("MultiAIDelegationPanelV2", () => {
  it("renders a localized accessible launcher without exposing internal provider identifiers", () => {
    const html = renderToStaticMarkup(<MultiAIDelegationPanelV2 />);

    expect(html).toContain("AI作業振り分け");
    expect(html).toContain("aria-label=\"AI作業振り分けを開く\"");
    expect(html).toContain("min-h-11");
    expect(html).not.toContain("security-review-assistant");
    expect(html).not.toContain("ai-studio-primary");
    expect(html).not.toContain("Human Approval Gate");
  });
});
