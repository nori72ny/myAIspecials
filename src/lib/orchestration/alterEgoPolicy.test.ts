import { describe, expect, it } from "vitest";
import {
  originAnswerQualityInstructionWithActiveContext,
  resolveOriginAnswerQualityPolicy,
} from "./OriginAnswerQualityPolicy";
import type { OriginRequestIntent } from "./OriginRequestIntent";
import {
  enterAlterEgoMode,
  isAlterEgoMode,
  withAlterEgoMode,
} from "./alterEgoRequestStore";
import { buildAlterEgoInstruction } from "../../services/alterEgoPersona";

// Alter-ego mode in the answer quality policy (design
// ALTER_EGO_MODE_DESIGN_2026-11-27 §3/§3.5). While the request scope
// carries the alter-ego flag, the persona instruction is appended to
// the base answer instruction — outside the untrusted memory boundary,
// because the persona is trusted code while the remembered records stay
// data inside the boundary. With the mode off (or never entered), the
// assembled instruction is byte-identical to before the mode existed,
// and nothing about the base instruction — response mode, verification
// discipline, research/coding guidance — is dropped or weakened when
// the mode is on (owner instruction 2026-11-27 18:24: capability is
// never limited by the persona).

function intent(overrides: Partial<OriginRequestIntent> = {}): OriginRequestIntent {
  return {
    primaryTask: "implementation",
    interactionMode: "conversation",
    requiredCapabilities: [],
    requestedOutputs: [],
    suggestedOutputs: [],
    ...overrides,
  };
}

const researchPolicy = resolveOriginAnswerQualityPolicy({
  intent: intent({ requiredCapabilities: ["research"] }),
  taskType: "research",
  independentReviewRequired: false,
});

describe("alterEgoRequestStore", () => {
  it("enables the mode only for the literal boolean true", () => {
    expect(withAlterEgoMode(true, () => isAlterEgoMode())).toBe(true);
    expect(withAlterEgoMode(false, () => isAlterEgoMode())).toBe(false);
    expect(withAlterEgoMode("true", () => isAlterEgoMode())).toBe(false);
    expect(withAlterEgoMode(1, () => isAlterEgoMode())).toBe(false);
    expect(withAlterEgoMode(undefined, () => isAlterEgoMode())).toBe(false);
  });

  it("enterAlterEgoMode applies the same literal-true rule", () => {
    enterAlterEgoMode("yes");
    expect(isAlterEgoMode()).toBe(false);
    enterAlterEgoMode(true);
    expect(isAlterEgoMode()).toBe(true);
    enterAlterEgoMode(false);
    expect(isAlterEgoMode()).toBe(false);
  });
});

describe("originAnswerQualityInstructionWithActiveContext with alter-ego mode", () => {
  it("is byte-identical to the pre-mode output while the mode is off", () => {
    const off = originAnswerQualityInstructionWithActiveContext(researchPolicy, "日本の失業率は？", "");
    const offScoped = withAlterEgoMode(false, () => originAnswerQualityInstructionWithActiveContext(researchPolicy, "日本の失業率は？", ""));
    expect(offScoped).toBe(off);
    expect(off).not.toContain("Alter-ego mode");
  });

  it("appends the persona instruction after the full base instruction while on", () => {
    const off = originAnswerQualityInstructionWithActiveContext(researchPolicy, "日本の失業率は？", "");
    const on = withAlterEgoMode(true, () => originAnswerQualityInstructionWithActiveContext(researchPolicy, "日本の失業率は？", ""));
    // The base instruction is retained whole, as a prefix: the persona
    // limits manner only, never capability (18:24 requirement).
    expect(on.startsWith(off)).toBe(true);
    expect(on.slice(off.length)).toBe(`\n\n${buildAlterEgoInstruction()}`);
    expect(on).toContain("Response mode:");
    expect(on).toContain("Never display invented confidence percentages");
  });

  it("keeps the persona outside the untrusted memory boundary when context is present", () => {
    const on = withAlterEgoMode(true, () => originAnswerQualityInstructionWithActiveContext(researchPolicy, "私の好みは？", "覚えている内容"));
    expect(on).toContain("<untrusted_memory_boundary>");
    expect(on.indexOf("Alter-ego mode")).toBeGreaterThan(-1);
    expect(on.indexOf("Alter-ego mode")).toBeLessThan(on.indexOf("<untrusted_memory_boundary>"));
    const off = originAnswerQualityInstructionWithActiveContext(researchPolicy, "私の好みは？", "覚えている内容");
    expect(off).toContain("<untrusted_memory_boundary>");
    expect(off).not.toContain("Alter-ego mode");
  });
});
