import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");

describe("ORIGIN Self-Evolution V2 cadence and publication correctness",()=>{
  it("keeps cadence-aware observer syntactically valid",()=>{
    expect(()=>execFileSync(process.execPath,["--check","scripts/origin-self-evolution-v2.mjs"],{stdio:"pipe"})).not.toThrow();
  });

  it("runs security hourly, broader intelligence daily, and deep design/standards weekly",()=>{
    const workflow=read(".github/workflows/origin-self-evolution-v2.yml");
    expect(workflow).toContain('cron: "17 * * * *"');
    expect(workflow).toContain('cron: "37 20 * * *"');
    expect(workflow).toContain('cron: "47 23 * * 0"');
    expect(workflow).toContain("ORIGIN_SELF_EVOLUTION_SCAN_MODE");
    const config=JSON.parse(read("config/origin-self-evolution-sources.json"));
    expect(config.categories.find((x:{id:string})=>x.id==="security")?.cadence).toBe("hourly");
    expect(config.categories.find((x:{id:string})=>x.id==="ai-models")?.cadence).toBe("daily");
    expect(config.categories.find((x:{id:string})=>x.id==="design-ux-a11y")?.cadence).toBe("weekly");
  });

  it("does not claim automatic code-write authority",()=>{
    const config=JSON.parse(read("config/origin-self-evolution-sources.json"));
    expect(config.rules.automaticCodeWrite).toBe(false);
    expect(config.rules.automaticMerge).toBe(false);
    expect(config.rules.productionDeploy).toBe(false);
  });

  it("filters observation categories by the selected cadence",()=>{
    const script=read("scripts/origin-self-evolution-v2.mjs");
    expect(script).toContain('category.cadence !== scanMode');
    expect(script).toContain("INVALID_SELF_EVOLUTION_SCAN_MODE");
    expect(script).toContain("scanMode");
  });

  it("paginates issue deduplication beyond the first 100 open issues",()=>{
    const script=read("scripts/origin-self-evolution-v2-issue.mjs");
    expect(script).toContain("for(let page=1; page<=10; page++)");
    expect(script).toContain("per_page=100&page=");
    expect(script).toContain("DUPLICATE_FINGERPRINT");
  });
});
