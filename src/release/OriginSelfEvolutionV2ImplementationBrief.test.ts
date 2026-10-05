import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");

describe("ORIGIN Self-Evolution V2 implementation brief contract",()=>{
  it("keeps brief generator syntactically valid",()=>{
    expect(()=>execFileSync(process.execPath,["--check","scripts/origin-self-evolution-v2-implementation-brief.mjs"],{stdio:"pipe"})).not.toThrow();
  });

  it("separates measurement briefs from implementation experiment briefs",()=>{
    const s=read("scripts/origin-self-evolution-v2-implementation-brief.mjs");
    expect(s).toContain("IMPLEMENTATION_EXPERIMENT_BRIEF");
    expect(s).toContain("SOLUTION_FIT_MEASUREMENT_BRIEF");
    expect(s).toContain("BASELINE_GAP_MEASUREMENT_BRIEF");
    expect(s).toContain('request?.status==="READY_FOR_INTERNAL_DRY_RUN"');
  });

  it("forbids privileged or unsafe changes",()=>{
    const s=read("scripts/origin-self-evolution-v2-implementation-brief.mjs");
    for(const boundary of [
      "main-direct-write",
      "production-direct-deploy",
      "secret-or-credential-change",
      "permission-expansion",
      "paid-provider-or-billing",
      "held-out-corpus-authorship-or-inspection",
      "security-gate-relaxation",
      "evaluation-bypass"
    ]) expect(s).toContain(boundary);
  });

  it("grants no mutation authority",()=>{
    const s=read("scripts/origin-self-evolution-v2-implementation-brief.mjs");
    expect(s).toContain("codeWrite:false");
    expect(s).toContain("branchCreate:false");
    expect(s).toContain("pullRequestCreate:false");
    expect(s).toContain("merge:false");
    expect(s).toContain("deploy:false");
    expect(s).toContain("secretWrite:false");
    expect(s).toContain("environmentWrite:false");
    expect(s).toContain("billing:false");
  });

  it("requires exact-base and reversible measurable evidence for implementation experiments",()=>{
    const s=read("scripts/origin-self-evolution-v2-implementation-brief.mjs");
    expect(s).toContain("exact-base-sha");
    expect(s).toContain("minimal-reversible-change");
    expect(s).toContain("before-after-metric");
    expect(s).toContain("rollback-plan");
  });
});
