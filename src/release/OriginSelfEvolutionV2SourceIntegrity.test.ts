import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");

describe("ORIGIN Self-Evolution V2 source integrity",()=>{
  it("keeps source-integrity scanner syntactically valid",()=>{
    expect(()=>execFileSync(process.execPath,["--check","scripts/origin-self-evolution-v2-source-integrity.mjs"],{stdio:"pipe"})).not.toThrow();
  });

  it("requires public HTTPS and blocks prompt-like external evidence",()=>{
    const s=read("scripts/origin-self-evolution-v2-source-integrity.mjs");
    expect(s).toContain("validPublicHttps");
    expect(s).toContain("blockedEvidenceFingerprints");
    expect(s).toContain("system\\s+prompt");
    expect(s).toContain("safeForExperiments");
    expect(s).toContain("tainted");
  });

  it("maps observations onto explicit ORIGIN capability axes and gates",()=>{
    const config=JSON.parse(read("config/origin-self-evolution-capabilities.json"));
    expect(config.categories["ai-models"].axes).toContain("answer-quality");
    expect(config.categories["agents-coding"].axes).toContain("general-agent");
    expect(config.categories["image-multimodal"].axes).toContain("image-generation");
    expect(config.categories.security.requiredGates).toContain("codeql");
    expect(config.categories["design-ux-a11y"].requiredGates).toContain("lighthouse");
  });

  it("runs source integrity before candidate planning",()=>{
    const workflow=read(".github/workflows/origin-self-evolution-v2.yml");
    const integrity=workflow.indexOf("Validate source integrity and untrusted-content boundary");
    const planning=workflow.indexOf("Build baseline-comparison candidate queue");
    expect(integrity).toBeGreaterThan(0);
    expect(planning).toBeGreaterThan(integrity);
  });

  it("keeps source evidence as data, never authority",()=>{
    const plan=read("scripts/origin-self-evolution-v2-plan.mjs");
    expect(plan).toContain("sourceIntegritySafe");
    expect(plan).toContain("blockedEvidenceCount");
    expect(plan).toContain("codeWriteAllowed:false");
    expect(plan).toContain("mergeAllowed:false");
    expect(plan).toContain("productionDeployAllowed:false");
  });
});
