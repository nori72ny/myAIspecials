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

  it("packages a stable improvement proposal without publishing it",()=>{
    const s=read("scripts/origin-self-evolution-v2-issue.mjs");
    expect(s).toContain("origin-self-evolution-v2:");
    expect(s).toContain("publishAuthorized:false");
    expect(s).toContain("issue-proposal.v2");
    expect(s).toContain("origin-self-evolution-issue-proposal-v2.md");
  });

  it("has no GitHub write, ref, merge, or deployment mutation path",()=>{
    const s=read("scripts/origin-self-evolution-v2-issue.mjs");
    expect(s).not.toContain("api.github.com");
    expect(s).not.toContain("GITHUB_TOKEN");
    expect(s).not.toContain("/contents/");
    expect(s).not.toContain("/git/refs");
    expect(s).not.toContain("/merges");
    expect(s).not.toContain("/deployments");
  });

  it("keeps the scheduled workflow repository-read-only",()=>{
    const workflow=read(".github/workflows/origin-self-evolution-v2.yml");
    expect(workflow).toContain("contents: read");
    expect(workflow).not.toContain("issues: write");
    expect(workflow).not.toContain("contents: write");
    expect(workflow).not.toContain("pull-requests: write");
    expect(workflow).not.toContain("deployments: write");
    expect(workflow).not.toContain("npm ci");
    expect(workflow).not.toContain("cache: npm");
  });
});
