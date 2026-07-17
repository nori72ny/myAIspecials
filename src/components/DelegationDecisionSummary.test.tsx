import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DelegationDecisionSummary from "./DelegationDecisionSummary";
import type { AIRoutingDecision } from "../lib/orchestration/MultiAIOrchestrator";

const SECURITY_DECISION: AIRoutingDecision = {
  taskType: "security",
  selectedProvider: "security-review-assistant",
  selectedProviderName: "Security Review Assistant",
  reason: "Preferred specialist",
  requiresHumanApproval: false,
  verificationProvider: "external-review",
  verificationPlan: {
    autoVerification: true,
    verificationProvider: "external-review",
    steps: ["Review"],
  },
};

describe("DelegationDecisionSummary", () => {
  it("renders localized user-facing labels without internal identifiers", () => {
    const html = renderToStaticMarkup(<DelegationDecisionSummary decision={SECURITY_DECISION} />);

    expect(html).toContain("セキュリティレビュー担当AI");
    expect(html).toContain("セキュリティ確認");
    expect(html).toContain("独立レビュー担当AI");
    expect(html).toContain("認証・権限・秘密情報");
    expect(html).not.toContain("security-review-assistant");
    expect(html).not.toContain("Security Review Assistant");
    expect(html).not.toContain(">security<");
  });

  it("uses a two-column layout only from the medium breakpoint", () => {
    const html = renderToStaticMarkup(<DelegationDecisionSummary decision={SECURITY_DECISION} />);

    expect(html).toContain("grid gap-3 md:grid-cols-2");
    expect(html).toContain("text-xl");
    expect(html).toContain("leading-6");
  });
});
