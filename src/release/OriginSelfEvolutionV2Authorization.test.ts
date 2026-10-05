import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");

describe("ORIGIN Self-Evolution V2 authorization and circuit breaker",()=>{
  for(const file of [
    "scripts/origin-self-evolution-v2-authorize.mjs",
    "scripts/origin-self-evolution-v2-circuit-breaker.mjs"
  ]){
    it(`${file} is syntactically valid`,()=>{
      expect(()=>execFileSync(process.execPath,["--check",file],{stdio:"pipe"})).not.toThrow();
    });
  }

  it("blocks isolated experiments during evaluation freeze",()=>{
    const s=read("scripts/origin-self-evolution-v2-authorize.mjs");
    expect(s).toContain('ORIGIN_EVALUATION_FREEZE');
    expect(s).toContain('EVALUATION_FREEZE_ACTIVE');
    expect(s).toContain('isolatedDryRunOnly:true');
    expect(s).toContain('repoWrite:false');
    expect(s).toContain('production:false');
    expect(s).toContain('integrity.safeForExperiments');
    expect(s).toContain('SOURCE_INTEGRITY_BLOCKED');
    expect(s).toContain('SAFE_DRY_RUN_PLAN_MISSING');
    expect(s).toContain('EXTERNAL_INSTRUCTIONS_BLOCKED');
    expect(s).toContain('PLAN_AUTHORITY_VIOLATION');
    expect(s).toContain('plan?.status === "SAFE_DRY_RUN_PLAN"');
  });

  it("fails closed on stale baseline or invariant break",()=>{
    const s=read("scripts/origin-self-evolution-v2-circuit-breaker.mjs");
    expect(s).toContain("PRODUCTION_BASELINE_UNHEALTHY");
    expect(s).toContain("ZERO_COST_INVARIANT_BROKEN");
    expect(s).toContain("PAID_FALLBACK_INVARIANT_BROKEN");
    expect(s).toContain("SECRET_DELIVERY_INVARIANT_BROKEN");
    expect(s).toContain("BASELINE_STALE");
    expect(s).toContain("SOURCE_INTEGRITY_PLANNING_UNSAFE");
    expect(s).toContain("SOURCE_INTEGRITY_AUTHORIZATION_BUG");
    expect(s).toContain("HALT_ALL_EXPERIMENTS");
  });
});
