import { describe, expect, it, vi } from "vitest";
import {
  extractOriginBenefitProgramNames,
  matchesOriginUnlistedBenefitProcedureQuestion,
  requiresOriginGroundedResearch,
  requiresOriginGroundedResearchRouted,
  resolveOriginBenefitProcedureRoutingMode,
} from "./originChatResponsePolicy";

// PR-G5 (GATE_SLIP_COUNTERMEASURE_DESIGN_2026-11-19): procedure
// questions about benefit programs missing from the bundled
// major-programs table — the expansion set's Q-10 fatal shape — are
// escalated to the grounded path under a dedicated switch that
// defaults OFF. Shadow mode logs the comparison (booleans only) and
// routes exactly as before. Procedure questions about listed major
// programs must never match (no false escalation of real programs).

const Q10_QUESTION = "国民幸福手当の申請方法を教えてください";

describe("extractOriginBenefitProgramNames", () => {
  it("extracts the program name before a benefit suffix", () => {
    expect(extractOriginBenefitProgramNames(Q10_QUESTION)).toEqual(["国民幸福手当"]);
    expect(extractOriginBenefitProgramNames("児童手当と特別児童扶養手当について")).toEqual([
      "児童手当",
      "特別児童扶養手当",
    ]);
  });

  it("extracts the short form for 雇用保険の基本手当 (the run stops at の)", () => {
    expect(extractOriginBenefitProgramNames("雇用保険の基本手当の申請手続きを教えてください")).toEqual([
      "基本手当",
    ]);
  });

  it("treats 手当金 as the longer suffix for the health-insurance allowances", () => {
    expect(extractOriginBenefitProgramNames("傷病手当金と出産手当金の申請")).toEqual([
      "傷病手当金",
      "出産手当金",
    ]);
  });

  it("yields no candidate for a bare suffix with no program name", () => {
    expect(extractOriginBenefitProgramNames("手当の申請方法を教えてください")).toEqual([]);
    expect(extractOriginBenefitProgramNames("給付金をもらうにはどうすればいいですか？")).toEqual([]);
  });
});

describe("matchesOriginUnlistedBenefitProcedureQuestion", () => {
  it("matches the Q-10 fatal question shape (nonexistent program, procedure asked)", () => {
    expect(matchesOriginUnlistedBenefitProcedureQuestion(Q10_QUESTION)).toBe(true);
    expect(matchesOriginUnlistedBenefitProcedureQuestion("国民幸福手当はどこで申請できますか？")).toBe(true);
    expect(matchesOriginUnlistedBenefitProcedureQuestion("国民幸福手当をもらうにはどうすればいいですか？")).toBe(true);
    expect(matchesOriginUnlistedBenefitProcedureQuestion("ベビー支援給付金の申し込み方法を教えてください")).toBe(true);
  });

  it("matches when a listed and an unlisted program are named together", () => {
    expect(
      matchesOriginUnlistedBenefitProcedureQuestion("児童手当と国民幸福手当の申請方法を教えてください"),
    ).toBe(true);
  });

  it("does not match procedure questions about listed major programs", () => {
    expect(matchesOriginUnlistedBenefitProcedureQuestion("児童手当の申請方法を教えてください")).toBe(false);
    expect(matchesOriginUnlistedBenefitProcedureQuestion("児童扶養手当の手続きについて教えてください")).toBe(false);
    expect(matchesOriginUnlistedBenefitProcedureQuestion("特別児童扶養手当の申請方法は？")).toBe(false);
    expect(matchesOriginUnlistedBenefitProcedureQuestion("障害児福祉手当の申請方法を教えてください")).toBe(false);
    expect(matchesOriginUnlistedBenefitProcedureQuestion("基本手当の申請方法を教えてください")).toBe(false);
    expect(matchesOriginUnlistedBenefitProcedureQuestion("雇用保険の基本手当の申請手続きを教えてください")).toBe(false);
    expect(matchesOriginUnlistedBenefitProcedureQuestion("育児休業給付金の申請方法を教えてください")).toBe(false);
    expect(matchesOriginUnlistedBenefitProcedureQuestion("介護休業給付金の手続きを教えてください")).toBe(false);
    expect(matchesOriginUnlistedBenefitProcedureQuestion("教育訓練給付金の申請方法を教えてください")).toBe(false);
    expect(matchesOriginUnlistedBenefitProcedureQuestion("住居確保給付金の申請方法を教えてください")).toBe(false);
    expect(matchesOriginUnlistedBenefitProcedureQuestion("雇用調整助成金の申請方法を教えてください")).toBe(false);
    expect(matchesOriginUnlistedBenefitProcedureQuestion("傷病手当金の申請方法を教えてください")).toBe(false);
    expect(matchesOriginUnlistedBenefitProcedureQuestion("出産手当金の手続きを教えてください")).toBe(false);
  });

  it("does not match non-procedure questions about an unlisted program", () => {
    // Definition and amount shapes are other layers' territory; G5
    // covers only the procedure shape (the Q-10 fatal).
    expect(matchesOriginUnlistedBenefitProcedureQuestion("国民幸福手当とは何ですか？")).toBe(false);
    expect(matchesOriginUnlistedBenefitProcedureQuestion("国民幸福手当の支給額はいくらですか？")).toBe(false);
  });

  it("does not match a bare-suffix procedure question with no program name", () => {
    expect(matchesOriginUnlistedBenefitProcedureQuestion("手当の申請方法を教えてください")).toBe(false);
    expect(matchesOriginUnlistedBenefitProcedureQuestion("給付金をもらうにはどうすればいいですか？")).toBe(false);
  });

  it("does not match unrelated questions or transform-only requests", () => {
    expect(matchesOriginUnlistedBenefitProcedureQuestion("メールの書き方を教えてください")).toBe(false);
    expect(matchesOriginUnlistedBenefitProcedureQuestion("今日の東京の天気は？")).toBe(false);
    expect(
      matchesOriginUnlistedBenefitProcedureQuestion(
        "次の文章を要約してください。「国民幸福手当の申請方法は市区町村の窓口で受け付けています」",
      ),
    ).toBe(false);
  });
});

describe("resolveOriginBenefitProcedureRoutingMode", () => {
  it("defaults to off unless the env value is exactly 'shadow' or 'enforce'", () => {
    expect(resolveOriginBenefitProcedureRoutingMode(undefined)).toBe("off");
    expect(resolveOriginBenefitProcedureRoutingMode({})).toBe("off");
    expect(resolveOriginBenefitProcedureRoutingMode({ ORIGIN_BENEFIT_PROCEDURE_ROUTING_MODE: "off" })).toBe("off");
    expect(resolveOriginBenefitProcedureRoutingMode({ ORIGIN_BENEFIT_PROCEDURE_ROUTING_MODE: "true" })).toBe("off");
    expect(resolveOriginBenefitProcedureRoutingMode({ ORIGIN_BENEFIT_PROCEDURE_ROUTING_MODE: "SHADOW" })).toBe("off");
    expect(resolveOriginBenefitProcedureRoutingMode({ ORIGIN_BENEFIT_PROCEDURE_ROUTING_MODE: "shadow" })).toBe("shadow");
    expect(resolveOriginBenefitProcedureRoutingMode({ ORIGIN_BENEFIT_PROCEDURE_ROUTING_MODE: "enforce" })).toBe("enforce");
  });
});

describe("requiresOriginGroundedResearchRouted with the G5 switch", () => {
  it("is exactly the canonical determination while the switch is off (the default)", () => {
    for (const message of [Q10_QUESTION, "児童手当の申請方法を教えてください", "今日のニュースを教えて", "メールの書き方を教えて"]) {
      expect(requiresOriginGroundedResearchRouted(message, { env: {} as NodeJS.ProcessEnv })).toBe(
        requiresOriginGroundedResearch(message),
      );
    }
  });

  it("the Q-10 shape stays on the direct path under the canonical determination (the gap G5 closes)", () => {
    expect(requiresOriginGroundedResearch(Q10_QUESTION)).toBe(false);
    expect(requiresOriginGroundedResearchRouted(Q10_QUESTION, { env: {} as NodeJS.ProcessEnv })).toBe(false);
  });

  it("shadow mode logs the comparison and still routes exactly as before", () => {
    const logger = vi.fn();
    const routed = requiresOriginGroundedResearchRouted(Q10_QUESTION, {
      env: { ORIGIN_BENEFIT_PROCEDURE_ROUTING_MODE: "shadow" } as NodeJS.ProcessEnv,
      logger,
    });
    expect(routed).toBe(requiresOriginGroundedResearch(Q10_QUESTION));
    expect(logger).toHaveBeenCalledTimes(1);
    const fields = logger.mock.calls[0][1] as Record<string, unknown>;
    expect(fields.benefitProcedureQuestionMatched).toBe(true);
    expect(fields.groundedResearchRequired).toBe(requiresOriginGroundedResearch(Q10_QUESTION));
    expect(fields.benefitProcedureWouldEscalate).toBe(!requiresOriginGroundedResearch(Q10_QUESTION));
    // Booleans only — the log never carries the message text.
    expect(Object.values(fields).every((value) => typeof value === "boolean")).toBe(true);
  });

  it("shadow mode stays silent for listed-program and unrelated questions", () => {
    const logger = vi.fn();
    const env = { ORIGIN_BENEFIT_PROCEDURE_ROUTING_MODE: "shadow" } as NodeJS.ProcessEnv;
    requiresOriginGroundedResearchRouted("児童手当の申請方法を教えてください", { env, logger });
    requiresOriginGroundedResearchRouted("メールの書き方を教えて", { env, logger });
    expect(logger).not.toHaveBeenCalled();
  });

  it("enforce mode escalates the Q-10 shape to the grounded path", () => {
    const env = { ORIGIN_BENEFIT_PROCEDURE_ROUTING_MODE: "enforce" } as NodeJS.ProcessEnv;
    expect(requiresOriginGroundedResearchRouted(Q10_QUESTION, { env })).toBe(true);
    // Listed programs keep the canonical result even in enforce mode.
    expect(requiresOriginGroundedResearchRouted("児童手当の申請方法を教えてください", { env })).toBe(
      requiresOriginGroundedResearch("児童手当の申請方法を教えてください"),
    );
    expect(requiresOriginGroundedResearchRouted("メールの書き方を教えて", { env })).toBe(
      requiresOriginGroundedResearch("メールの書き方を教えて"),
    );
  });

  it("the G5 and G3-a switches compose independently", () => {
    const logger = vi.fn();
    // G5 enforce alone escalates Q-10; the price predicate is untouched.
    expect(
      requiresOriginGroundedResearchRouted(Q10_QUESTION, {
        env: { ORIGIN_BENEFIT_PROCEDURE_ROUTING_MODE: "enforce" } as NodeJS.ProcessEnv,
        logger,
      }),
    ).toBe(true);
    // G3-a enforce alone does not escalate Q-10 (it is not a price question).
    expect(
      requiresOriginGroundedResearchRouted(Q10_QUESTION, {
        env: { ORIGIN_OFFICIAL_PRICE_ROUTING_MODE: "enforce" } as NodeJS.ProcessEnv,
        logger,
      }),
    ).toBe(requiresOriginGroundedResearch(Q10_QUESTION));
    expect(logger).not.toHaveBeenCalled();
  });
});
