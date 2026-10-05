import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");

describe("ORIGIN Self-Evolution V2 automation boundary",()=>{
  for(const file of [
    "scripts/origin-self-evolution-v2-baseline.mjs",
    "scripts/origin-self-evolution-v2-priority.mjs",
    "scripts/origin-self-evolution-v2-issue.mjs"
  ]){
    it(`${file} is syntactically valid`,()=>{
      expect(()=>execFileSync(process.execPath,["--check",file],{stdio:"pipe"})).not.toThrow();
    });
  }

  it("keeps production baseline collection read-only",()=>{
    const s=read("scripts/origin-self-evolution-v2-baseline.mjs");
    expect(s).toContain('getJson("/api/health")');
    expect(s).not.toContain('method:"POST"');
    expect(s).not.toContain('method: "POST"');
  });

  it("deduplicates issue publication by queue fingerprint",()=>{
    const s=read("scripts/origin-self-evolution-v2-issue.mjs");
    expect(s).toContain("DUPLICATE_FINGERPRINT");
    expect(s).toContain("origin-self-evolution-v2:");
  });

  it("publishes issues only and has no repo/deploy mutation paths",()=>{
    const s=read("scripts/origin-self-evolution-v2-issue.mjs");
    expect(s).toContain('gh("/issues"');
    expect(s).not.toContain("/contents/");
    expect(s).not.toContain("/git/refs");
    expect(s).not.toContain("/merges");
    expect(s).not.toContain("/deployments");
  });
});
