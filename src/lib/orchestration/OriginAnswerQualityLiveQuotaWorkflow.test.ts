import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workflowPath = ".github/workflows/aq-live-lane-shard.yml";
const guardPath = "scripts/check-aq-live-quota-guard.mjs";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("AQ live frozen-main quota workflow", () => {
  it("uses reservation artifact creation time rather than workflow conclusion as the 24-hour quota signal", () => {
    const workflow = read(workflowPath);
    const guard = read(guardPath);

    expect(workflow).toContain("node runner/scripts/check-aq-live-quota-guard.mjs");
    expect(workflow).toContain("AQ_LIVE_INCLUDE_CURRENT_RUN_RESERVATIONS: 'true'");
    expect(guard).toContain("actions/runs/${run.id}/artifacts?per_page=100");
    expect(guard).toContain('name === "aq-live-quota-reservation"');
    expect(guard).toContain('name.startsWith("aq-live-research-shard")');
    expect(guard).toContain("artifact.created_at");
    expect(guard).not.toContain('.conclusion != "skipped"');
  });

  it("reserves quota before any provider-capable baseline/candidate execution", () => {
    const value = read(workflowPath);
    const create = value.indexOf("\n      - name: Create sanitized quota reservation");
    const reserve = value.indexOf("\n      - name: Reserve 24-hour provider quota");
    const baselineCheckout = value.indexOf("\n      - name: Checkout frozen baseline");
    const comparison = value.indexOf("\n      - name: Run next frozen-main shard comparison");

    expect(create).toBeGreaterThan(0);
    expect(reserve).toBeGreaterThan(create);
    expect(baselineCheckout).toBeGreaterThan(reserve);
    expect(comparison).toBeGreaterThan(baselineCheckout);
  });

  it("persists only minimal sanitized reservation metadata", () => {
    const value = read(workflowPath);

    expect(value).toContain("origin.aq-live-quota-reservation.v1");
    expect(value).toContain("runId:process.env.GITHUB_RUN_ID");
    expect(value).toContain("candidateSha:process.env.CANDIDATE_SHA");
    expect(value).toContain("shardIndex:Number(process.env.NEXT_INDEX)");
    expect(value).toContain("retention-days: 2");
    expect(value).not.toContain("baselineAnswer");
    expect(value).not.toContain("candidateAnswer");
    const reservationStart = value.indexOf("\n      - name: Create sanitized quota reservation");
    const reservationEnd = value.indexOf("\n      - name: Reserve 24-hour provider quota");
    expect(reservationStart).toBeGreaterThan(0);
    expect(reservationEnd).toBeGreaterThan(reservationStart);
    const reservation = value.slice(reservationStart, reservationEnd);
    expect(reservation).not.toContain("answerText");
    // The shard validator must still reject answer text in uploaded evidence.
    expect(value).toContain('const forbidden=["answerText"');
  });

  it("serializes the final frozen-main measurement runner globally", () => {
    const value = read(workflowPath);

    expect(value).toContain("group: origin-aq-live-final-frozen-main");
    expect(value).toContain("cancel-in-progress: false");
    expect(value).toContain("ci/aq-live-final-");
    expect(value).toContain("CANDIDATE_SHA: 93ce7b14c5c7c807b08b6284f49984b342b47a88");
    expect(value).toContain("BASELINE_SHA: f0c1bff22d3246d3eac3903b9def5d3aa7c1e498");
  });
});
