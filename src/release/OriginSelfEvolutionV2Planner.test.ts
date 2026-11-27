import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("ORIGIN Self-Evolution V2 candidate planner", () => {
  it("is syntactically valid", () => {
    expect(() => execFileSync(process.execPath, ["--check", "scripts/origin-self-evolution-v2-plan.mjs"], { stdio: "pipe" })).not.toThrow();
  });

  it("does not permit direct code write, merge, or deployment", () => {
    const planner = read("scripts/origin-self-evolution-v2-plan.mjs");
    expect(planner).toMatch(/codeWriteAllowed:\s*false/);
    expect(planner).toMatch(/mergeAllowed:\s*false/);
    expect(planner).toMatch(/productionDeployAllowed:\s*false/);
    expect(planner).toMatch(/requireMeasuredImprovement:\s*true/);
    expect(planner).toMatch(/maxCostUsd:\s*0/);
  });

  it("routes non-primary sensitive evidence away from implementation", () => {
    const planner = read("scripts/origin-self-evolution-v2-plan.mjs");
    expect(planner).toContain("Sensitive changes require Tier A primary evidence");
    expect(planner).toContain("CONFIRM_PRIMARY_EVIDENCE");
    expect(planner).toContain("BASELINE_COMPARISON");
  });
});
