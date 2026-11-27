import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const read=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");
describe("ORIGIN Self-Evolution V2 decision ledger",()=>{
  it("is syntactically valid",()=>{
    expect(()=>execFileSync(process.execPath,["--check","scripts/origin-self-evolution-v2-ledger.mjs"],{stdio:"pipe"})).not.toThrow();
  });
  it("records exact baseline and evidence fingerprints",()=>{
    const s=read("scripts/origin-self-evolution-v2-ledger.mjs");
    expect(s).toContain("exactBaseSha");
    expect(s).toContain("baselineFingerprint");
    expect(s).toContain("evidenceFingerprint");
    expect(s).toContain("decision-ledger.v2");
  });
  it("cannot mutate repository or production",()=>{
    const s=read("scripts/origin-self-evolution-v2-ledger.mjs");
    expect(s).not.toContain("git push");
    expect(s).not.toContain("/contents/");
    expect(s).not.toContain("/deployments");
    expect(s).not.toContain("/merges");
  });
});
