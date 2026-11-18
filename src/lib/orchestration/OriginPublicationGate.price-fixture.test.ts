import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyOriginPublicationGate,
  detectOriginPublicationClaims,
  resolveOriginPublicationGatePriceMode,
} from "./OriginPublicationGate";

// Price fixture set for the official-price subclass (PR-G3-b,
// GATE_SLIP_COUNTERMEASURE_DESIGN_2026-11-19). The pre-existing
// measurement sets (fixed 100 + expansion 140) contain NO correct
// official-price direct answer, so the subclass's behaviour on real
// price assertions could not be measured there — this set exists to
// close that gap before the subclass may ever enforce.
//
// Groups and what is pinned:
// - official-price-wrong: stale or fabricated institutional prices
//   asserted bare. The five P-18/P-19 entries are the expansion set's
//   real delivered texts (production 800ede4d era, 2026-11-18). Every
//   entry must be classified official-price (10/10 measured).
// - official-price-correct: correct institutional prices asserted
//   bare. The detector is deterministic and cannot judge correctness,
//   so these are classified exactly like the wrong ones (4/4
//   measured) — the same philosophy as statutory-capacity, where the
//   correct 248 also fires. This is NOT counted as a false positive:
//   the subclass stops unverified assertions, and the honest answer
//   for a price question is the grounded path (PR-G3-a). It is,
//   however, exactly why the sub-switch starts in shadow.
// - calculation: answers that compute with supplied values, including
//   ones that mention a price domain （送料・切手・手数料）. None may
//   be classified official-price (0/8 measured) — this is the N-3
//   false-positive surface the subclass was carved out to protect.
// - general-amount: amounts with no price domain in the sentence.
//   None may be classified (0/3 measured).

interface PriceFixtureEntry {
  id: string;
  group: "official-price-wrong" | "official-price-correct" | "calculation" | "general-amount";
  question: string;
  answer: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  readFileSync(join(here, "OriginPublicationGate.price-fixtures.json"), "utf8"),
) as PriceFixtureEntry[];
const byGroup = (group: PriceFixtureEntry["group"]) => fixtures.filter((entry) => entry.group === group);
const officialPriceCount = (entry: PriceFixtureEntry) =>
  detectOriginPublicationClaims(entry.answer).counts["official-price"];

describe("publication gate price fixture — set composition", () => {
  it("covers wrong / correct / calculation / general-amount groups", () => {
    expect(byGroup("official-price-wrong").length).toBe(10);
    expect(byGroup("official-price-correct").length).toBe(4);
    expect(byGroup("calculation").length).toBe(8);
    expect(byGroup("general-amount").length).toBe(3);
  });
});

describe("publication gate price fixture — wrong official prices are classified", () => {
  it("classifies every wrong/stale assertion, including all five real P-18/P-19 texts", () => {
    for (const entry of byGroup("official-price-wrong")) {
      expect(officialPriceCount(entry), entry.id).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("publication gate price fixture — correct official prices classify identically", () => {
  it("classifies correct assertions the same way (the gate cannot judge correctness)", () => {
    for (const entry of byGroup("official-price-correct")) {
      expect(officialPriceCount(entry), entry.id).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("publication gate price fixture — no false classification on calculations or general amounts", () => {
  it("classifies zero calculation answers, including price-domain calculations", () => {
    for (const entry of byGroup("calculation")) {
      expect(officialPriceCount(entry), entry.id).toBe(0);
    }
  });

  it("classifies zero general amount mentions", () => {
    for (const entry of byGroup("general-amount")) {
      expect(officialPriceCount(entry), entry.id).toBe(0);
    }
  });
});

describe("resolveOriginPublicationGatePriceMode", () => {
  it("defaults to shadow unless the env value is exactly 'enforce' or 'off'", () => {
    expect(resolveOriginPublicationGatePriceMode(undefined)).toBe("shadow");
    expect(resolveOriginPublicationGatePriceMode({})).toBe("shadow");
    expect(resolveOriginPublicationGatePriceMode({ ORIGIN_PUBLICATION_GATE_PRICE_MODE: "shadow" })).toBe("shadow");
    expect(resolveOriginPublicationGatePriceMode({ ORIGIN_PUBLICATION_GATE_PRICE_MODE: "ENFORCE" })).toBe("shadow");
    expect(resolveOriginPublicationGatePriceMode({ ORIGIN_PUBLICATION_GATE_PRICE_MODE: "true" })).toBe("shadow");
    expect(resolveOriginPublicationGatePriceMode({ ORIGIN_PUBLICATION_GATE_PRICE_MODE: "enforce" })).toBe("enforce");
    expect(resolveOriginPublicationGatePriceMode({ ORIGIN_PUBLICATION_GATE_PRICE_MODE: "off" })).toBe("off");
  });
});

describe("applyOriginPublicationGate — official-price fires only under its own sub-switch", () => {
  const p19run2 = fixtures.find((entry) => entry.id === "P-19-run2")!;
  const apply = (env: NodeJS.ProcessEnv) =>
    applyOriginPublicationGate({
      requestId: `test-${p19run2.id}`,
      answerText: p19run2.answer,
      query: p19run2.question,
      language: "ja",
      env,
      logger: () => {},
    });

  it("does not hold under the main enforce mode while the price mode stays at its shadow default", () => {
    const outcome = apply({ ORIGIN_PUBLICATION_GATE_MODE: "enforce" } as NodeJS.ProcessEnv);
    expect(outcome.held).toBe(false);
    expect(outcome.answerText).toBe(p19run2.answer);
    expect(outcome.summary?.counts["official-price"]).toBeGreaterThanOrEqual(1);
  });

  it("does not hold when the price mode is off", () => {
    const outcome = apply({
      ORIGIN_PUBLICATION_GATE_MODE: "enforce",
      ORIGIN_PUBLICATION_GATE_PRICE_MODE: "off",
    } as NodeJS.ProcessEnv);
    expect(outcome.held).toBe(false);
    expect(outcome.answerText).toBe(p19run2.answer);
  });

  it("holds on the tier-T4 landing when both the gate and the price mode enforce", () => {
    const outcome = apply({
      ORIGIN_PUBLICATION_GATE_MODE: "enforce",
      ORIGIN_PUBLICATION_GATE_PRICE_MODE: "enforce",
    } as NodeJS.ProcessEnv);
    expect(outcome.held).toBe(true);
    expect(outcome.firingKinds).toContain("official-price");
    expect(outcome.landing).toEqual({
      tier: "T4",
      outcome: "ABSTAIN",
      abstainReason: "high-risk-insufficient-sources",
    });
    expect(outcome.answerText).not.toContain("70円");
  });

  it("never holds in the main shadow mode, even with the price mode enforcing", () => {
    const outcome = apply({
      ORIGIN_PUBLICATION_GATE_MODE: "shadow",
      ORIGIN_PUBLICATION_GATE_PRICE_MODE: "enforce",
    } as NodeJS.ProcessEnv);
    expect(outcome.held).toBe(false);
    expect(outcome.answerText).toBe(p19run2.answer);
  });
});
