import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workflowPath = ".github/workflows/aq-live-lane-shard.yml";
const guardPath = "scripts/check-aq-live-quota-guard.mjs";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("AQ live unified lane quota workflow", () => {
  it("uses reservation artifacts rather than workflow conclusion as the 24-hour quota signal", () => {
    const workflow = read(workflowPath);
    const guard = read(guardPath);

    expect(workflow).toContain("node guard/scripts/check-aq-live-quota-guard.mjs");
    expect(guard).toContain("actions/runs/${run.id}/artifacts?per_page=100");
    expect(guard).toContain('name === "aq-live-quota-reservation"');
    expect(guard).toContain('name.startsWith("aq-live-research-shard")');
    expect(guard).not.toContain('.conclusion != "skipped"');
    expect(workflow).not.toContain("prior non-skipped AQ lane run");
  });

  it("reserves quota before provider-capable baseline/candidate execution", () => {
    const value = read(workflowPath);
    const create = value.indexOf("\n      - name: Create sanitized quota reservation");
    const reserve = value.indexOf("\n      - name: Reserve 24-hour provider quota");
    const baselineCheckout = value.indexOf("\n      - name: Checkout frozen baseline");
    const comparison = value.indexOf("\n      - name: Run exact-SHA lane shard comparison");

    expect(create).toBeGreaterThan(0);
    expect(reserve).toBeGreaterThan(create);
    expect(baselineCheckout).toBeGreaterThan(reserve);
    expect(comparison).toBeGreaterThan(baselineCheckout);
  });

  it("persists only minimal sanitized reservation metadata", () => {
    const value = read(workflowPath);

    expect(value).toContain("origin.aq-live-quota-reservation.v1");
    expect(value).toContain("runId: process.env.GITHUB_RUN_ID");
    expect(value).toContain("lane: process.env.AQ_LANE");
    expect(value).toContain("candidateSha: process.env.CANDIDATE_SHA");
    expect(value).toContain("retention-days: 2");
    expect(value).not.toContain("baselineAnswer");
    expect(value).not.toContain("candidateAnswer");
  });

  it("still keeps one global concurrency group across every live lane", () => {
    const value = read(workflowPath);

    expect(value).toContain("group: origin-aq-live-unified-lane-shard");
    expect(value).toContain("cancel-in-progress: false");
    expect(value).toContain("ci/aq-live-lane-research-*");
    expect(value).toContain("ci/aq-live-lane-chat-*");
    expect(value).toContain("ci/aq-live-lane-coding-*");
    expect(value).toContain("ci/aq-live-lane-artifact-*");
  });
});
