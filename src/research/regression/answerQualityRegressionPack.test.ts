// @vitest-environment node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// N-6 regression pack integrity (CONSULT_ADOPTION_DESIGN_2026-11-17 §6.1):
// the pack is the fixed yardstick for later quality PRs, so its own shape —
// counts, ID coverage, failure-type attribution, and the presence of an
// explicit correct landing for every entry — is pinned here. If a future
// measurement supersedes an entry, update the pack version and this test
// together; never let the pack silently rot or shrink.

const here = dirname(fileURLToPath(import.meta.url));

interface PackEntry {
  id: string;
  category: string;
  categoryName: string;
  question: string;
  keyFacts: unknown;
  group: "fatal" | "synthesis-discarded" | "synthesis-unavailable";
  failureType: string | null;
  failureCode: string | null;
  observed: { form: string; fatal: boolean; substantive: boolean; scoreNote: string };
  answerKey: string;
  expectedOutcome: string;
  logEvidence?: string;
  stageClassification?: string;
  route?: string;
  wrongAssertion?: string;
  rootCauseNote?: string;
  compoundFailureTypes?: string[];
}

interface Pack {
  meta: {
    name: string;
    version: string;
    counts: { fatal: number; synthesisDiscarded: number; synthesisUnavailable: number; total: number };
  };
  entries: PackEntry[];
}

const pack = JSON.parse(readFileSync(join(here, "answerQualityRegressionPack2026-11-17.json"), "utf8")) as Pack;
const questionsDoc = JSON.parse(readFileSync(join(here, "questions.json"), "utf8")) as {
  questions: Array<{ id: string; question: string; key_facts: unknown }>;
};

const byGroup = (group: PackEntry["group"]) => pack.entries.filter((entry) => entry.group === group);
const byId = (id: string) => pack.entries.find((entry) => entry.id === id);

describe("answer quality regression pack (2026-11-17 re-measurement failures)", () => {
  it("holds exactly the measured failure counts: fatal 3, discarded 8, unavailable 16", () => {
    expect(pack.meta.counts).toEqual({ fatal: 3, synthesisDiscarded: 8, synthesisUnavailable: 16, total: 27 });
    expect(byGroup("fatal")).toHaveLength(3);
    expect(byGroup("synthesis-discarded")).toHaveLength(8);
    expect(byGroup("synthesis-unavailable")).toHaveLength(16);
    expect(pack.entries).toHaveLength(27);
  });

  it("has unique question IDs that match the fixed 100-question set IDs", () => {
    const ids = pack.entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-J]-\d{2}$/);
  });

  it("gives every entry a question, an answer key, an expected landing, and the observed score note", () => {
    for (const entry of pack.entries) {
      expect(entry.question.length, entry.id).toBeGreaterThan(0);
      expect(entry.answerKey.length, entry.id).toBeGreaterThan(0);
      expect(entry.expectedOutcome.length, entry.id).toBeGreaterThan(0);
      expect(entry.observed.scoreNote.length, entry.id).toBeGreaterThan(0);
      expect(entry.observed.substantive, entry.id).toBe(false);
    }
  });

  it("registers the three fatals with stage classification and the wrong assertion that was made", () => {
    expect(byGroup("fatal").map((entry) => entry.id).sort()).toEqual(["D-15", "H-07", "I-04"]);
    for (const entry of byGroup("fatal")) {
      expect(entry.observed.fatal, entry.id).toBe(true);
      expect(entry.failureType, entry.id).toBeNull();
      expect(entry.stageClassification, entry.id).toContain("生成時の飛躍");
      expect(entry.wrongAssertion?.length, entry.id).toBeGreaterThan(0);
      expect(entry.route, entry.id).toBe("直接経路");
    }
    // The correct landings are pinned, not just described.
    expect(byId("D-15")?.answerKey).toContain("248");
    expect(byId("D-15")?.wrongAssertion).toContain("245");
    expect(byId("H-07")?.answerKey).toContain("12月22日");
    expect(byId("H-07")?.answerKey).toContain("火曜日");
    expect(byId("H-07")?.stageClassification).toContain("検証漏れ");
    expect(byId("I-04")?.answerKey).toContain("確認できない");
    expect(byId("I-04")?.expectedOutcome).toContain("デジタル資産保護法");
  });

  it("attributes the 8 discarded syntheses to their validation codes (ISC 4 / UNCITED 2 / MISMATCHED 1 / NUMERIC 1)", () => {
    const codes = byGroup("synthesis-discarded").map((entry) => entry.failureCode);
    expect(codes.filter((code) => code === "INSUFFICIENT_SOURCE_COVERAGE")).toHaveLength(4);
    expect(codes.filter((code) => code === "UNCITED_FACTUAL_UNIT")).toHaveLength(2);
    expect(codes.filter((code) => code === "MISMATCHED_CITATION_URL")).toHaveLength(1);
    expect(codes.filter((code) => code === "UNSUPPORTED_NUMERIC_TOKEN")).toHaveLength(1);
    for (const entry of byGroup("synthesis-discarded")) {
      expect(entry.failureType, entry.id).toMatch(/^T-[3-6]a?$/);
      expect(entry.logEvidence, entry.id).toContain("discarded");
    }
    // The zero-citation subtype named in the floor design.
    expect(byId("F-07")?.failureType).toBe("T-3a");
    expect(byId("F-09")?.failureType).toBe("T-3a");
    expect(byId("G-02")?.failureType).toBe("T-3a");
    expect(byId("F-08")?.failureType).toBe("T-5");
    // H-06: the discard is recorded, and so is the classifier root cause.
    expect(byId("H-06")?.failureType).toBe("T-6");
    expect(byId("H-06")?.rootCauseNote).toContain("過剰発火");
  });

  it("attributes the 16 unavailable syntheses to T-1 (rate limited 15 / invalid response 1)", () => {
    const codes = byGroup("synthesis-unavailable").map((entry) => entry.failureCode);
    expect(codes.filter((code) => code === "PROVIDER_RATE_LIMITED")).toHaveLength(15);
    expect(codes.filter((code) => code === "PROVIDER_INVALID_RESPONSE")).toHaveLength(1);
    for (const entry of byGroup("synthesis-unavailable")) {
      expect(entry.failureType, entry.id).toBe("T-1");
      expect(entry.logEvidence, entry.id).toContain("unavailable");
    }
    expect(byId("E-08")?.failureCode).toBe("PROVIDER_INVALID_RESPONSE");
    // F-12 is the compound case: synthesis unavailable AND an empty
    // response delivered (T-8) — the terminal-guarantee regression target.
    expect(byId("F-12")?.compoundFailureTypes).toEqual(["T-8"]);
    expect(byId("F-12")?.expectedOutcome).toContain("空応答");
  });

  it("keeps the runner subset (questions.json) identical to the pack entries", () => {
    expect(questionsDoc.questions).toHaveLength(27);
    const questionIds = questionsDoc.questions.map((question) => question.id).sort();
    const packIds = pack.entries.map((entry) => entry.id).sort();
    expect(questionIds).toEqual(packIds);
    for (const question of questionsDoc.questions) {
      const entry = byId(question.id);
      expect(entry?.question).toBe(question.question);
      expect(entry?.keyFacts).toEqual(question.key_facts);
    }
  });
});
