import { describe, expect, it } from "vitest";

import {
  createOriginAnswerQualityBenchmarkEphemeralEvidenceVault,
} from "./OriginAnswerQualityBenchmarkEphemeralEvidenceVault";

const ref = (char: string) => `sha256:${char.repeat(64)}`;

describe("OriginAnswerQualityBenchmarkEphemeralEvidenceVault", () => {
  it("stores bounded evidence in memory and consumes it exactly once", () => {
    const vault = createOriginAnswerQualityBenchmarkEphemeralEvidenceVault();
    vault.put({
      caseId: "case-1",
      finalAnswerRef: ref("a"),
      evidenceLedgerRef: ref("b"),
      answerText: "  Answer text  ",
      evidenceJson: { sources: [{ id: "S1" }] },
    });

    expect(vault.size()).toBe(1);
    expect(vault.consume("case-1", ref("a"), ref("b"))).toEqual({
      caseId: "case-1",
      finalAnswerRef: ref("a"),
      evidenceLedgerRef: ref("b"),
      answerText: "Answer text",
      evidenceJson: { sources: [{ id: "S1" }] },
    });
    expect(vault.size()).toBe(0);
    expect(vault.consume("case-1", ref("a"), ref("b"))).toBeNull();
  });

  it("does not consume evidence when answer or ledger refs differ", () => {
    const vault = createOriginAnswerQualityBenchmarkEphemeralEvidenceVault();
    vault.put({
      caseId: "case-1",
      finalAnswerRef: ref("a"),
      evidenceLedgerRef: ref("b"),
      answerText: "Answer text",
      evidenceJson: { ok: true },
    });

    expect(vault.consume("case-1", ref("c"), ref("b"))).toBeNull();
    expect(vault.consume("case-1", ref("a"), ref("c"))).toBeNull();
    expect(vault.size()).toBe(1);
  });

  it("rejects duplicate cases and non-digest references", () => {
    const vault = createOriginAnswerQualityBenchmarkEphemeralEvidenceVault();
    vault.put({
      caseId: "case-1",
      finalAnswerRef: ref("a"),
      evidenceLedgerRef: ref("b"),
      answerText: "Answer",
      evidenceJson: {},
    });

    expect(() => vault.put({
      caseId: "case-1",
      finalAnswerRef: ref("c"),
      evidenceLedgerRef: ref("d"),
      answerText: "Another",
      evidenceJson: {},
    })).toThrow("AQ_BENCHMARK_EPHEMERAL_EVIDENCE_DUPLICATE_CASE");

    expect(() => createOriginAnswerQualityBenchmarkEphemeralEvidenceVault().put({
      caseId: "case-2",
      finalAnswerRef: "raw-answer",
      evidenceLedgerRef: ref("b"),
      answerText: "Answer",
      evidenceJson: {},
    })).toThrow("AQ_BENCHMARK_EPHEMERAL_EVIDENCE_INVALID");
  });

  it("clones evidence JSON so callers cannot mutate stored evaluator input", () => {
    const vault = createOriginAnswerQualityBenchmarkEphemeralEvidenceVault();
    const evidenceJson = { sources: [{ id: "S1" }] };
    vault.put({
      caseId: "case-1",
      finalAnswerRef: ref("a"),
      evidenceLedgerRef: ref("b"),
      answerText: "Answer",
      evidenceJson,
    });

    evidenceJson.sources[0].id = "tampered";
    const consumed = vault.consume("case-1", ref("a"), ref("b"));
    expect(consumed?.evidenceJson).toEqual({ sources: [{ id: "S1" }] });

    const returned = consumed?.evidenceJson as { sources: Array<{ id: string }> };
    returned.sources[0].id = "caller-change";
    expect(vault.size()).toBe(0);
  });

  it("clears all transient evidence without exposing an enumeration API", () => {
    const vault = createOriginAnswerQualityBenchmarkEphemeralEvidenceVault();
    vault.put({
      caseId: "case-1",
      finalAnswerRef: ref("a"),
      evidenceLedgerRef: ref("b"),
      answerText: "Answer",
      evidenceJson: {},
    });
    vault.clear();

    expect(vault.size()).toBe(0);
    expect(vault.consume("case-1", ref("a"), ref("b"))).toBeNull();
  });
});
