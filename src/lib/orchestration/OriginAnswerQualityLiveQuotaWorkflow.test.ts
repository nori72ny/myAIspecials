import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { load: parse } = require("js-yaml") as { load: (input: string) => unknown };

import { describe, expect, it } from "vitest";

const workflowPath = ".github/workflows/aq-live-lane-shard.yml";
const calibrationWorkflowPath = ".github/workflows/aq-free-provider-calibration.yml";
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
  it("restricts calibration to explicit manual dispatch with no quota bypass or schedule", () => {
    const value = read(calibrationWorkflowPath);
    expect(value).toContain("workflow_dispatch:");
    expect(value).not.toContain("schedule:");
    expect(value).not.toContain("  push:");
    expect(value).not.toContain("bypass_quota_guard");
    expect(value).toContain("github.event_name == 'workflow_dispatch'");
    expect(value).toContain("AQ_FREE_CALIBRATION_SKIPPED_QUOTA");
  });

  it("counts current-run reservations on lane reruns", () => {
    const value = read(workflowPath);
    expect(value).toContain("AQ_LIVE_INCLUDE_CURRENT_RUN_RESERVATIONS: 'true'");
  });

  it("parses workflow YAML and structurally verifies the PR secret boundary", () => {
    const workflow = parse(read(workflowPath)) as Record<string, any>;
    const trigger = workflow.on ?? workflow["on"];
    expect(trigger?.pull_request).toBeDefined();
    const job = workflow.jobs?.compare;
    expect(job).toBeDefined();
    expect(job.if).toBe(false);

    const containsSecretContext = (value: unknown): boolean => {
      if (typeof value === "string") return /\bsecrets\b/i.test(value);
      if (Array.isArray(value)) return value.some(containsSecretContext);
      if (value && typeof value === "object") {
        return Object.entries(value as Record<string, unknown>).some(([key, child]) =>
          /\bsecrets\b/i.test(key) || containsSecretContext(child));
      }
      return false;
    };
    expect(containsSecretContext(job)).toBe(false);

    const guardCheckout = job.steps.find((step: any) =>
      step.name === "Checkout quota guard from trusted pinned snapshot");
    expect(guardCheckout).toBeDefined();
    expect(guardCheckout.uses).toMatch(/^actions\/checkout@/);
    expect(guardCheckout.with.ref).toBe("51d22e2f9647e1851e0a596203299ca6c582fc45");

    const calibration = parse(read(calibrationWorkflowPath)) as Record<string, any>;
    const calibrationTrigger = calibration.on ?? calibration["on"];
    expect(calibrationTrigger?.workflow_dispatch).toBeDefined();
    expect(calibrationTrigger?.push).toBeUndefined();
    expect(calibrationTrigger?.schedule).toBeUndefined();
    expect(calibration.jobs?.["calibrate-public-only"]?.environment?.name).toBe("aq-live");
    expect(read(calibrationWorkflowPath)).toContain("secrets.AQ_LIVE_OPENROUTER_API_KEY");
    expect(read(calibrationWorkflowPath)).not.toContain("secrets.OPENROUTER_API_KEY");
    expect(calibration.jobs?.["calibrate-public-only"]?.if)
      .toBe("github.ref == 'refs/heads/main' && github.event_name == 'workflow_dispatch'");
    expect(calibration.concurrency?.group)
      .toBe(workflow.concurrency?.group);
  });
  it("fails mutation tests when the PR lane is enabled or a secrets context is injected", () => {
    const original = read(workflowPath);
    const assertSecure = (source: string) => {
      const parsed = parse(source) as Record<string, any>;
      const job = parsed.jobs?.compare;
      if (!job || job.if !== false) throw new Error("AQ_PR_LIVE_JOB_MUST_REMAIN_DISABLED");
      const containsSecretContext = (value: unknown): boolean => {
        if (typeof value === "string") return /\bsecrets\b/i.test(value);
        if (Array.isArray(value)) return value.some(containsSecretContext);
        if (value && typeof value === "object") {
          return Object.entries(value as Record<string, unknown>).some(([key, child]) =>
            /\bsecrets\b/i.test(key) || containsSecretContext(child));
        }
        return false;
      };
      if (containsSecretContext(job)) throw new Error("AQ_PR_LIVE_JOB_MUST_NOT_REFERENCE_SECRETS");
    };

    expect(() => assertSecure(original)).not.toThrow();

    const enabledMutation = original.replace("    if: false", "    if: true # was: if: false");
    expect(enabledMutation).not.toBe(original);
    expect(() => assertSecure(enabledMutation)).toThrow("AQ_PR_LIVE_JOB_MUST_REMAIN_DISABLED");

    const secretMutation = original.replace(
      "      ORIGIN_AQ_BASELINE_PORT:",
      "      LEAK: ${{ toJSON(secrets) }}\n      ORIGIN_AQ_BASELINE_PORT:",
    );
    expect(secretMutation).not.toBe(original);
    expect(() => assertSecure(secretMutation)).toThrow("AQ_PR_LIVE_JOB_MUST_NOT_REFERENCE_SECRETS");
  });

  it("allows calibration of the currently configured ORIGIN free model", () => {
    const value = read(calibrationWorkflowPath);
    expect(value).toContain("inclusionai/ling-3.0-flash-sante:free");
    expect(value).toContain("ORIGIN_FREE_MODEL_CANDIDATE");
  });

});
