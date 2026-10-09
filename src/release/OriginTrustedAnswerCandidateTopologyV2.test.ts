import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertOriginTrustedAnswerCandidateTopologyV2 as assertAncestry,
  type OriginTrustedAnswerCandidateTopologyInputV2,
} from "./OriginTrustedAnswerCandidateTopologyV2.js";

const main = "a".repeat(40);
const candidate = "b".repeat(40);
const valid = (): OriginTrustedAnswerCandidateTopologyInputV2 => ({
  trustedEvaluatorSha: main,
  currentMain: { commit: { sha: main }, protected: true },
  candidateSha: candidate,
  prNumber: "930",
  comparison: {
    status: "ahead",
    behind_by: 0,
    ahead_by: 58,
    base_commit: { sha: main },
    merge_base_commit: { sha: main },
  },
});

describe("trusted sealed AQ V2 candidate topology", () => {
  it("accepts only a PR whose entire current main is an ancestor of the exact candidate", () => {
    expect(() => assertAncestry(valid())).not.toThrow();
  });

  it("accepts an exact trusted-main candidate only for the special PR 0 path", () => {
    const input = valid();
    expect(() => assertAncestry({
      ...input,
      prNumber: "0",
      candidateSha: main,
      comparison: { ...input.comparison as object, status: "identical", ahead_by: 0 },
    })).not.toThrow();
    expect(() => assertAncestry({ ...input, prNumber: "0" })).toThrow("AQ_V2_CANDIDATE_OUTDATED_MAIN");
  });

  it("rejects a moved main branch even if candidate comparison is otherwise green", () => {
    expect(() => assertAncestry({
      ...valid(), currentMain: { commit: { sha: "c".repeat(40) } },
    })).toThrow("AQ_V2_TRUSTED_MAIN_MOVED");
  });

  it.each([
    ["diverged candidate missing a main commit", { status: "diverged", behind_by: 1 }],
    ["behind candidate", { status: "behind", behind_by: 1, ahead_by: 0 }],
    ["false ahead with missing ancestor", { status: "ahead", merge_base_commit: { sha: "c".repeat(40) } }],
    ["unrelated comparison base", { base_commit: { sha: "c".repeat(40) } }],
    ["comparison with non-numeric behind", { behind_by: "0" }],
    ["comparison with non-numeric ahead", { ahead_by: "58" }],
    ["comparison with unknown status", { status: "ok" }],
    ["zero-commit PR", { status: "identical", ahead_by: 0 }],
  ] as const)("blocks %s before any sealed corpus reservation", (_name, override) => {
    const input = valid();
    expect(() => assertAncestry({
      ...input, comparison: { ...input.comparison as object, ...override },
    })).toThrow("AQ_V2_CANDIDATE_OUTDATED_MAIN");
  });

  it.each([
    ["untrusted response", null],
    ["missing compare fields", {}],
    ["a string instead of an object", "ahead"],
    ["an array instead of an object", []],
  ] as const)("blocks %s", (_name, comparison) => {
    expect(() => assertAncestry({ ...valid(), comparison }))
      .toThrow("AQ_V2_CANDIDATE_OUTDATED_MAIN");
  });

  it("rejects invalid SHA / PR input and a zero-commit PR", () => {
    expect(() => assertAncestry({ ...valid(), candidateSha: "main" }))
      .toThrow("AQ_V2_CANDIDATE_TOPOLOGY_INPUT_INVALID");
    expect(() => assertAncestry({ ...valid(), prNumber: "-1" }))
      .toThrow("AQ_V2_CANDIDATE_TOPOLOGY_INPUT_INVALID");
    expect(() => assertAncestry({ ...valid(), candidateSha: main }))
      .toThrow("AQ_V2_CANDIDATE_OUTDATED_MAIN");
  });

  it("rechecks current main before opening sealed corpus and again before one-shot reservation", () => {
    const workflow = readFileSync(
      "./.github/workflows/trusted-answer-quality-v2.yml",
      "utf8",
    );
    const evaluate = workflow.split("\n  evaluate:\n")[1];
    expect(evaluate).toBeDefined();
    const early = evaluate.indexOf("name: Revalidate main ancestry before reading sealed corpus");
    const fetch = evaluate.indexOf("name: Fetch sealed corpus into trusted runner temp");
    const late = evaluate.indexOf("name: Verify current main ancestry before any sealed evaluation");
    const reserve = evaluate.indexOf("name: Reserve exact candidate and sealed corpus before provider execution");
    const run = evaluate.indexOf("name: Run 48 leased cases through the trusted boundary");
    expect(early).toBeGreaterThanOrEqual(0);
    expect(fetch).toBeGreaterThan(early);
    expect(late).toBeGreaterThan(fetch);
    expect(reserve).toBeGreaterThan(late);
    expect(run).toBeGreaterThan(reserve);
  });
});
