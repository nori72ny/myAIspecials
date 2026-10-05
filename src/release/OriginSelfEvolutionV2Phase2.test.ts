import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");

describe("ORIGIN Self-Evolution V2 phase-2 dry-run gates",()=>{
  for (const file of [
    "scripts/origin-self-evolution-v2-experiments.mjs",
    "scripts/origin-self-evolution-v2-verify.mjs",
    "scripts/origin-self-evolution-v2-promotion.mjs"
  ]) {
    it(`${file} is syntactically valid`,()=>{
      expect(()=>execFileSync(process.execPath,["--check",file],{stdio:"pipe"})).not.toThrow();
    });
  }

  it("keeps experiments isolated and zero-cost",()=>{
    const s=read("scripts/origin-self-evolution-v2-experiments.mjs");
    expect(s).toContain("repoWrite: false");
    expect(s).toContain("secretAccess: false");
    expect(s).toContain("productionAccess: false");
    expect(s).toContain("paidProvider: false");
    expect(s).toContain("maxCostUsd: 0");
  });

  it("keeps promotion as packaging only",()=>{
    const s=read("scripts/origin-self-evolution-v2-promotion.mjs");
    expect(s).toContain("DRAFT_PR_PACKAGE_ONLY");
    expect(s).toContain("automaticMerge:false");
    expect(s).toContain("automaticDeploy:false");
    expect(s).toContain("codeWriteAuthorized:false");
  });
});
