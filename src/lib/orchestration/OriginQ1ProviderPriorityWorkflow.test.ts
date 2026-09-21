import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const aqWorkflowPath = ".github/workflows/q1-final-aq.yml";
const heldoutWorkflowPath = ".github/workflows/held-out-coding-final-v14.yml";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Q1 provider-priority orchestration", () => {
  it("pauses new AQ provider work when a final held-out corpus is configured", () => {
    const workflow = read(aqWorkflowPath);

    expect(workflow).toContain("Detect final held-out priority");
    expect(workflow).toContain("ORIGIN_HELDOUT_FINAL_CORPUS_GZIP_B64");
    expect(workflow).toContain('echo "pause_aq=true" >> "$GITHUB_OUTPUT"');
    expect(workflow).toContain(
      "if: steps.heldout_priority.outputs.pause_aq != 'true' && steps.state.outputs.complete != 'true'",
    );

    const reservation = workflow.indexOf("\n      - name: Reserve 24-hour provider quota");
    const run = workflow.indexOf("\n      - name: Run next exact-main shard comparison");
    expect(reservation).toBeGreaterThan(0);
    expect(run).toBeGreaterThan(reservation);

    const reservationBlock = workflow.slice(
      workflow.lastIndexOf("\n      - name:", reservation - 1),
      workflow.indexOf("\n      - name:", reservation + 1),
    );
    expect(reservationBlock).toContain("steps.heldout_priority.outputs.pause_aq != 'true'");

    const runBlock = workflow.slice(
      workflow.lastIndexOf("\n      - name:", run - 1),
      workflow.indexOf("\n      - name:", run + 1),
    );
    expect(runBlock).toContain("steps.heldout_priority.outputs.pause_aq != 'true'");
  });

  it("still allows zero-provider AQ aggregation after all shards are already complete", () => {
    const workflow = read(aqWorkflowPath);
    const safeCondition =
      "if: steps.state.outputs.complete == 'true' || (steps.heldout_priority.outputs.pause_aq != 'true' && steps.quota_guard.outputs.allowed == 'true')";

    expect(workflow.split(safeCondition).length - 1).toBeGreaterThanOrEqual(4);
    expect(workflow).toContain("if: steps.final.outputs.ready == 'true'");
  });

  it("automatically checks held-out readiness without exposing the sealed corpus", () => {
    const workflow = read(heldoutWorkflowPath);

    expect(workflow).toContain("schedule:");
    expect(workflow).toContain("cron: '47 */3 * * *'");
    expect(workflow).toContain("Check final corpus readiness");
    expect(workflow).toContain("FINAL_CORPUS: ${{ secrets.ORIGIN_HELDOUT_FINAL_CORPUS_GZIP_B64 }}");
    expect(workflow).toContain('echo "ready=false" >> "$GITHUB_OUTPUT"');
    expect(workflow).not.toContain('echo "$FINAL_CORPUS"');
  });

  it("waits for a clean provider window before revealing only opaque task identities", () => {
    const workflow = read(heldoutWorkflowPath);
    const window = workflow.indexOf("\n      - name: Verify clean free-provider window");
    const select = workflow.indexOf("\n      - name: Select sealed final task identities");
    const marker = workflow.indexOf("\n      - name: Check one-shot start marker");

    expect(window).toBeGreaterThan(0);
    expect(select).toBeGreaterThan(window);
    expect(marker).toBeGreaterThan(select);
    expect(workflow).toContain("continue-on-error: true");
    expect(workflow).toContain("steps.free_window.outputs.allowed == 'true'");
  });

  it("prevents any second final run after the start marker exists", () => {
    const workflow = read(heldoutWorkflowPath);

    expect(workflow).toContain('echo "can_start=false" >> "$GITHUB_OUTPUT"');
    expect(workflow).toContain('echo "can_start=true" >> "$GITHUB_OUTPUT"');
    expect(workflow).toContain("start_ready: ${{ steps.one_shot.outputs.can_start }}");
    expect(workflow).toContain(
      "if: github.event.repository.private == false && needs.preflight.outputs.start_ready == 'true'",
    );
    expect(workflow).toContain(
      "if: always() && needs.preflight.result == 'success' && needs.preflight.outputs.start_ready == 'true'",
    );
  });
});
