import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read=(path:string)=>readFileSync(resolve(process.cwd(),path),"utf8");

describe("AQ budgeted daily runner contract",()=>{
  it("keeps the public free-tier safety budget below the documented 50 request ceiling",()=>{
    const runner=read("scripts/run-aq-budgeted-day.ts");
    expect(runner).toContain("const DAILY_PROVIDER_BUDGET = 45;");
    expect(runner).toContain("const MAX_SHARDS_PER_DAY = 4;");
    expect(runner).toContain("selectOriginAnswerQualityBenchmarkNextBudgetedShard");
    expect(runner).toContain("actualRequests > next.pairedRequestsMax");
    expect(runner).toContain("used + actualRequests > DAILY_PROVIDER_BUDGET");
    expect(runner).toContain("executed.length < MAX_SHARDS_PER_DAY");
  });

  it("binds every restored and new result to the same exact candidate and baseline",()=>{
    const runner=read("scripts/run-aq-budgeted-day.ts");
    expect(runner).toContain('value.shard?.baselineGitSha !== baselineSha');
    expect(runner).toContain('value.shard?.candidateGitSha !== candidateSha');
    expect(runner).toContain('shard?.baselineGitSha !== baselineSha');
    expect(runner).toContain('shard?.candidateGitSha !== candidateSha');
    expect(runner).toContain("baselineSha === candidateSha");
  });

  it("uses case-isolated evidence without changing the frozen 40-case corpus or score aggregate",()=>{
    const pkg=JSON.parse(read("package.json"));
    const workflow=read(".github/workflows/q1-final-aq.yml");
    expect(pkg.scripts["eval:aq-budgeted-day"]).toBe("tsx scripts/run-aq-budgeted-day.ts");
    expect(workflow).toContain("EXPECTED_SHARD_COUNT: '40'");
    expect(workflow).toContain("ORIGIN_AQ_SHARD_MODE: case-isolated");
    expect(workflow).toContain('test "$max" -eq 616');
    expect(workflow).toContain("Aggregate all 40 cases");
  });

  it("retains read-only workflow permissions and the 24-hour global guard",()=>{
    const workflow=read(".github/workflows/q1-final-aq.yml");
    expect(workflow).toContain("permissions:\n  contents: read\n  actions: read");
    expect(workflow).toContain("Enforce global 24-hour live quota guard");
    expect(workflow).toContain("Reserve 24-hour provider quota");
    expect(workflow).not.toContain("contents: write");
  });
});
