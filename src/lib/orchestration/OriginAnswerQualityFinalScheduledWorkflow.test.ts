import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workflowPath = ".github/workflows/q1-final-aq.yml";
const guardPath = "scripts/check-aq-live-quota-guard.mjs";
const restorePath = "scripts/prepare-aq-live-final-state.mjs";
const summaryPath = "scripts/summarize-aq-live-final.mjs";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Q1 final AQ scheduled workflow", () => {
  it("runs on main on a bounded recurring schedule and shares global AQ concurrency", () => {
    const workflow = read(workflowPath);

    expect(workflow).toContain("cron: '17 */3 * * *'");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("if: github.ref == 'refs/heads/main'");
    expect(workflow).toContain("group: origin-aq-live-unified-lane-shard");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("CANDIDATE_SHA: ${{ github.sha }}");
  });

  it("checks durable state and the 24-hour guard before reserving provider quota", () => {
    const workflow = read(workflowPath);
    const restore = workflow.indexOf("\n      - name: Restore and validate completed shard evidence");
    const guard = workflow.indexOf("\n      - name: Enforce global 24-hour live quota guard");
    const create = workflow.indexOf("\n      - name: Create sanitized quota reservation");
    const reserve = workflow.indexOf("\n      - name: Reserve 24-hour provider quota");
    const baseline = workflow.indexOf("\n      - name: Checkout frozen baseline");
    const comparison = workflow.indexOf("\n      - name: Run next exact-main shard comparison");

    expect(restore).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(restore);
    expect(create).toBeGreaterThan(guard);
    expect(reserve).toBeGreaterThan(create);
    expect(baseline).toBeGreaterThan(reserve);
    expect(comparison).toBeGreaterThan(baseline);
    expect(workflow).toContain("AQ_LIVE_INCLUDE_CURRENT_RUN_RESERVATIONS: 'true'");
  });

  it("keeps final evidence exact-SHA, zero-cost and resumable across runs", () => {
    const workflow = read(workflowPath);
    const guard = read(guardPath);
    const restore = read(restorePath);
    const summary = read(summaryPath);

    expect(workflow).toContain("EXPECTED_SHARD_COUNT: '16'");
    expect(workflow).toContain('test "$max" -eq 616');
    expect(workflow).toContain("aq-live-final-shard-${{ env.CANDIDATE_SHA }}-s${{ steps.state.outputs.next_index }}");
    expect(workflow).toContain("retention-days: 30");
    expect(workflow).toContain("OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}");
    expect(workflow).not.toContain("secrets.OPENAI_API_KEY");
    expect(workflow).not.toContain("secrets.ANTHROPIC_API_KEY");
    expect(workflow).not.toContain("secrets.GEMINI_API_KEY");

    expect(guard).toContain('const FINAL_WORKFLOW = "q1-final-aq.yml"');
    expect(guard).toContain("artifact.created_at");
    expect(restore).toContain("candidateGitSha === candidateSha");
    expect(restore).toContain("baselineGitSha === baselineSha");
    expect(summary).toContain("caseCount: 40");
    expect(summary).toContain("familyCount: 10");
    expect(summary).toContain("promotionEligible: blockers.length === 0");
  });
});
