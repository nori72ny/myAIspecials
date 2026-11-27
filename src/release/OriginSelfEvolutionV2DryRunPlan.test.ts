import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");

describe("ORIGIN Self-Evolution V2 safe dry-run planner",()=>{
  it("is syntactically valid",()=>{
    expect(()=>execFileSync(process.execPath,["--check","scripts/origin-self-evolution-v2-dry-run-plan.mjs"],{stdio:"pipe"})).not.toThrow();
  });

  it("never converts external evidence into commands",()=>{
    const s=read("scripts/origin-self-evolution-v2-dry-run-plan.mjs");
    expect(s).toContain("externalInstructionsIncluded:false");
    expect(s).toContain("commands:[]");
    expect(s).toContain("mayNotBeDerivedIntoCommandsFromExternalExcerpt:true");
  });

  it("requires reproducible non-held-out measured gap evidence",()=>{
    const s=read("scripts/origin-self-evolution-v2-dry-run-plan.mjs");
    expect(s).toContain('measured?.evidenceKind==="REPRODUCIBLE_NON_HELD_OUT"');
    expect(s).toContain("candidate?.actionable===true");
    expect(s).toContain("SAFE_DRY_RUN_PLAN");
  });

  it("does not grant execution or code mutation authority",()=>{
    const s=read("scripts/origin-self-evolution-v2-dry-run-plan.mjs");
    expect(s).toContain("executionAuthorized:false");
    expect(s).toContain("codeMutationAuthorized:false");
    expect(s).toContain("trustedEngineeringArtifactRequired:true");
  });

  it("runs after experiment specs and before authorization",()=>{
    const w=read(".github/workflows/origin-self-evolution-v2.yml");
    const spec=w.indexOf("Build experiment specifications");
    const plan=w.indexOf("Compile safe dry-run plan metadata");
    const auth=w.indexOf("Authorize isolated dry-run experiments");
    expect(spec).toBeGreaterThan(0);
    expect(plan).toBeGreaterThan(spec);
    expect(auth).toBeGreaterThan(plan);
  });
});
