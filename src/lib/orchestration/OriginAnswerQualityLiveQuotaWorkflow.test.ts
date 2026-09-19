import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workflowPath = ".github/workflows/aq-live-lane-shard.yml";

function workflow(): string {
  return readFileSync(resolve(process.cwd(), workflowPath), "utf8");
}

describe("AQ live unified lane quota workflow", () => {
  it("uses reservation artifacts rather than workflow conclusion as the 24-hour quota signal", () => {
    const value = workflow();

    expect(value).toContain("latest_reserved_from_workflow()");
    expect(value).toContain("actions/runs/${run_id}/artifacts?per_page=100");
    expect(value).toContain("^aq-live-quota-reservation$");
    expect(value).toContain("^aq-live-research-shard");
    expect(value).not.toContain('.conclusion != "skipped"');
    expect(value).not.toContain("prior non-skipped AQ lane run");
  });

  it("creates the reservation before any provider-capable checkout or comparison step", () => {
    const value = workflow();
    const create = value.indexOf("- name: Create sanitized quota reservation");
    const reserve = value.indexOf("- name: Reserve 24-hour provider quota");
    const baselineCheckout = value.indexOf("- name: Checkout frozen baseline");
    const comparison = value.indexOf("- name: Run exact-SHA lane shard comparison");

    expect(create).toBeGreaterThan(0);
    expect(reserve).toBeGreaterThan(create);
    expect(baselineCheckout).toBeGreaterThan(reserve);
    expect(comparison).toBeGreaterThan(baselineCheckout);
  });

  it("persists only minimal sanitized reservation metadata", () => {
    const value = workflow();

    expect(value).toContain("origin.aq-live-quota-reservation.v1");
    expect(value).toContain("runId: process.env.GITHUB_RUN_ID");
    expect(value).toContain("lane: process.env.AQ_LANE");
    expect(value).toContain("candidateSha: process.env.CANDIDATE_SHA");
    expect(value).toContain("retention-days: 2");
    expect(value).not.toContain("baselineAnswer");
    expect(value).not.toContain("candidateAnswer");
  });

  it("still keeps one global concurrency group across every live lane", () => {
    const value = workflow();

    expect(value).toContain("group: origin-aq-live-unified-lane-shard");
    expect(value).toContain("cancel-in-progress: false");
    expect(value).toContain("ci/aq-live-lane-research-*");
    expect(value).toContain("ci/aq-live-lane-chat-*");
    expect(value).toContain("ci/aq-live-lane-coding-*");
    expect(value).toContain("ci/aq-live-lane-artifact-*");
  });
});
