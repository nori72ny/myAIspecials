import { describe, expect, it, vi } from "vitest";
import {
  matchesOriginOfficialPriceQuestion,
  requiresOriginGroundedResearch,
  requiresOriginGroundedResearchRouted,
  resolveOriginOfficialPriceRoutingMode,
} from "./originChatResponsePolicy";

// PR-G3-a (GATE_SLIP_COUNTERMEASURE_DESIGN_2026-11-19): official-price
// questions the existing price branch missed — the expansion set's
// P-18 (「何円の切手」) and P-19 (「いくらかかる？」) shapes — are
// escalated to the grounded path under a dedicated switch that
// defaults OFF. Shadow mode logs the comparison (booleans only) and
// routes exactly as before.

const P18_QUESTION = "はがきを出すのに何円の切手が要りますか？";
const P19_QUESTION = "はがき1枚送るといくらかかる？";

describe("matchesOriginOfficialPriceQuestion", () => {
  it("matches the P-18 and P-19 fatal question shapes", () => {
    expect(matchesOriginOfficialPriceQuestion(P18_QUESTION)).toBe(true);
    expect(matchesOriginOfficialPriceQuestion(P19_QUESTION)).toBe(true);
  });

  it("matches other institutional-price question shapes", () => {
    expect(matchesOriginOfficialPriceQuestion("東京から大阪へ荷物を送る送料を教えてください")).toBe(true);
    expect(matchesOriginOfficialPriceQuestion("切手の料金を教えてください")).toBe(true);
    expect(matchesOriginOfficialPriceQuestion("この区間の運賃はいくらですか？")).toBe(true);
  });

  it("does not match a calculation that supplies its own price", () => {
    expect(matchesOriginOfficialPriceQuestion("85円の切手を3枚買うといくらかかる？")).toBe(false);
    expect(matchesOriginOfficialPriceQuestion("送料800円の商品を2つ買うといくらですか？")).toBe(false);
  });

  it("does not match pricing-concept or unrelated questions", () => {
    expect(matchesOriginOfficialPriceQuestion("価格戦略の基本を教えてください")).toBe(false);
    expect(matchesOriginOfficialPriceQuestion("メールの書き方を教えてください")).toBe(false);
    expect(matchesOriginOfficialPriceQuestion("今日の東京の天気は？")).toBe(false);
  });
});

describe("resolveOriginOfficialPriceRoutingMode", () => {
  it("defaults to off unless the env value is exactly 'shadow' or 'enforce'", () => {
    expect(resolveOriginOfficialPriceRoutingMode(undefined)).toBe("off");
    expect(resolveOriginOfficialPriceRoutingMode({})).toBe("off");
    expect(resolveOriginOfficialPriceRoutingMode({ ORIGIN_OFFICIAL_PRICE_ROUTING_MODE: "off" })).toBe("off");
    expect(resolveOriginOfficialPriceRoutingMode({ ORIGIN_OFFICIAL_PRICE_ROUTING_MODE: "true" })).toBe("off");
    expect(resolveOriginOfficialPriceRoutingMode({ ORIGIN_OFFICIAL_PRICE_ROUTING_MODE: "SHADOW" })).toBe("off");
    expect(resolveOriginOfficialPriceRoutingMode({ ORIGIN_OFFICIAL_PRICE_ROUTING_MODE: "shadow" })).toBe("shadow");
    expect(resolveOriginOfficialPriceRoutingMode({ ORIGIN_OFFICIAL_PRICE_ROUTING_MODE: "enforce" })).toBe("enforce");
  });
});

describe("requiresOriginGroundedResearchRouted", () => {
  it("is exactly the canonical determination while the switch is off (the default)", () => {
    for (const message of [P18_QUESTION, P19_QUESTION, "今日のニュースを教えて", "メールの書き方を教えて"]) {
      expect(requiresOriginGroundedResearchRouted(message, { env: {} as NodeJS.ProcessEnv })).toBe(
        requiresOriginGroundedResearch(message),
      );
    }
  });

  it("shadow mode logs the comparison and still routes exactly as before", () => {
    const logger = vi.fn();
    const routed = requiresOriginGroundedResearchRouted(P18_QUESTION, {
      env: { ORIGIN_OFFICIAL_PRICE_ROUTING_MODE: "shadow" } as NodeJS.ProcessEnv,
      logger,
    });
    expect(routed).toBe(requiresOriginGroundedResearch(P18_QUESTION));
    expect(logger).toHaveBeenCalledTimes(1);
    const fields = logger.mock.calls[0][1] as Record<string, unknown>;
    expect(fields.officialPriceQuestionMatched).toBe(true);
    expect(fields.groundedResearchRequired).toBe(requiresOriginGroundedResearch(P18_QUESTION));
    expect(fields.officialPriceWouldEscalate).toBe(!requiresOriginGroundedResearch(P18_QUESTION));
    // Booleans only — the log never carries the message text.
    expect(Object.values(fields).every((value) => typeof value === "boolean")).toBe(true);
  });

  it("shadow mode stays silent for questions the predicate does not match", () => {
    const logger = vi.fn();
    requiresOriginGroundedResearchRouted("メールの書き方を教えて", {
      env: { ORIGIN_OFFICIAL_PRICE_ROUTING_MODE: "shadow" } as NodeJS.ProcessEnv,
      logger,
    });
    expect(logger).not.toHaveBeenCalled();
  });

  it("enforce mode escalates the P-18/P-19 shapes to the grounded path", () => {
    const env = { ORIGIN_OFFICIAL_PRICE_ROUTING_MODE: "enforce" } as NodeJS.ProcessEnv;
    expect(requiresOriginGroundedResearchRouted(P18_QUESTION, { env })).toBe(true);
    expect(requiresOriginGroundedResearchRouted(P19_QUESTION, { env })).toBe(true);
    // Questions outside the predicate keep the canonical result.
    expect(requiresOriginGroundedResearchRouted("メールの書き方を教えて", { env })).toBe(
      requiresOriginGroundedResearch("メールの書き方を教えて"),
    );
    // A supplied-price calculation is not escalated even in enforce mode.
    expect(requiresOriginGroundedResearchRouted("85円の切手を3枚買うといくらかかる？", { env })).toBe(false);
  });
});
