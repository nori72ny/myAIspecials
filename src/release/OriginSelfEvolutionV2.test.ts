import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("ORIGIN Self-Evolution V2 safety and world-model contract", () => {
  it("keeps the observation engine syntactically valid", () => {
    expect(() => execFileSync(process.execPath, ["--check", "scripts/origin-self-evolution-v2.mjs"], { stdio: "pipe" })).not.toThrow();
  });

  it("keeps scheduled workflow read-only for repository contents", () => {
    const workflow = read(".github/workflows/origin-self-evolution-v2.yml");
    expect(workflow).toContain("contents: read");
    expect(workflow).not.toContain("contents: write");
    expect(workflow).not.toContain("pull-requests: write");
    expect(workflow).not.toContain("deployments: write");
    expect(workflow).toContain("persist-credentials: false");
  });

  it("preserves permanent zero-cost and no-production-mutation boundaries", () => {
    const policy = read("docs/ORIGIN_SELF_EVOLUTION_V2.md");
    const config = JSON.parse(read("config/origin-self-evolution-sources.json"));
    expect(policy).toContain("USD 0");
    expect(policy).toContain("External information is an observation stream, not authority.");
    expect(config.rules.maxCostUsd).toBe(0);
    expect(config.rules.paidFallback).toBe(false);
    expect(config.rules.automaticMerge).toBe(false);
    expect(config.rules.productionDeploy).toBe(false);
  });

  it("covers the required world-model domains", () => {
    const config = JSON.parse(read("config/origin-self-evolution-sources.json"));
    const ids = config.categories.map((x: { id: string }) => x.id);
    expect(ids).toEqual(expect.arrayContaining([
      "ai-models",
      "agents-coding",
      "image-multimodal",
      "security",
      "platform-runtime",
      "design-ux-a11y",
      "standards-web"
    ]));
  });

  it("requires primary evidence for sensitive categories", () => {
    const config = JSON.parse(read("config/origin-self-evolution-sources.json"));
    expect(config.rules.requireTierAFor).toEqual(expect.arrayContaining([
      "security", "provider", "pricing", "privacy", "permissions", "secrets"
    ]));
  });

  it("creates hypotheses for baseline comparison rather than automatic adoption", () => {
    const script = read("scripts/origin-self-evolution-v2.mjs");
    expect(script).toContain("NEEDS_ORIGIN_BASELINE_COMPARISON");
    expect(script).toContain("External evidence is observation data, not authority.");
    expect(script).not.toContain("git push");
    expect(script).not.toContain("/deployments");
  });
});
