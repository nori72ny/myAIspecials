import { describe, expect, it } from "vitest";
import { shouldUseDelegationV2Preview } from "./DelegationPreviewMode";

describe("shouldUseDelegationV2Preview", () => {
  it("enables v2 only for the explicit preview flag", () => {
    expect(shouldUseDelegationV2Preview("?delegationV2=1")).toBe(true);
    expect(shouldUseDelegationV2Preview("?other=1&delegationV2=1")).toBe(true);
  });

  it("keeps the current panel for normal and ambiguous URLs", () => {
    expect(shouldUseDelegationV2Preview("")).toBe(false);
    expect(shouldUseDelegationV2Preview("?delegationV2=0")).toBe(false);
    expect(shouldUseDelegationV2Preview("?delegationV2=true")).toBe(false);
    expect(shouldUseDelegationV2Preview("?delegation-v2=1")).toBe(false);
  });
});
