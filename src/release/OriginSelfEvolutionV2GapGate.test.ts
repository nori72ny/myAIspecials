import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");

describe("ORIGIN Self-Evolution V2 measured-gap gate",()=>{
  it("keeps the gap assessor syntactically valid",()=>{
    expect(()=>execFileSync(process.execPath,["--check","scripts/origin-self-evolution-v2-gap.mjs"],{stdio:"pipe"})).not.toThrow();
  });

  it("does not equate external novelty with an ORIGIN gap",()=>{
    const s=read("scripts/origin-self-evolution-v2-gap.mjs");
    expect(s).toContain("solutionFitVerified:false");
    expect(s).toContain("measuredGapEvidence");
    expect(s).toContain("BLOCKED_PENDING_MEASURED_GAP");
    expect(s).toContain("DRY_RUN_EXPERIMENT_MEASUREMENT_ELIGIBLE");
  });

  it("validates bounded reproducible non-held-out gap evidence",()=>{
    const s=read("scripts/origin-self-evolution-v2-gap-measurement.mjs");
    expect(s).toContain("REPRODUCIBLE_NON_HELD_OUT");
    expect(s).toContain("privateHeldOut===false");
    expect(s).toContain("RUNNER_TEMP");
    expect(s).toContain("GAP_MEASUREMENT_INPUT_TOO_LARGE");
    expect(s).toContain("measuredGap>=minGap");
  });

  it("requires measured opportunity before priority can be actionable",()=>{
    const s=read("scripts/origin-self-evolution-v2-priority.mjs");
    expect(s).toContain("measuredImprovementOpportunity");
    expect(s).toMatch(/actionable\s*=\s*gapAssessment\?\.measuredImprovementOpportunity\s*===\s*true/);
  });

  it("requires actionable priority before experiment specs become executable",()=>{
    const s=read("scripts/origin-self-evolution-v2-experiments.mjs");
    expect(s).toContain("origin-self-evolution-priority-v2.json");
    expect(s).toContain("candidate.actionable === true");
  });

  it("keeps promotion held until a real experiment result exists",()=>{
    const s=read("scripts/origin-self-evolution-v2-promotion.mjs");
    expect(s).toContain("HOLD_PENDING_EXPERIMENT_RESULT");
    expect(s).not.toContain('ready?"DRAFT_PR_PACKAGE_ONLY"');
  });
});
