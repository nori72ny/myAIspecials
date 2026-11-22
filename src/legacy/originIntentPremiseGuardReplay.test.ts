/**
 * Offline replay harness for the intent premise guard (I5-PR1
 * acceptance gate, design INTENT_I5_DESIGN_2026-11-22 section 7.1).
 *
 * The fixture (originIntentPremiseGuard.replay-fixtures.json) is a
 * verbatim distillation of the I-1 measurement records R1-R3
 * (synthetic scenarios; user utterances and delivered answers):
 *   R1  = intent-scenarios-i1/results-i1.json
 *   R2  = intent-scenarios-i1/r2/results-i1.json (first pass; the
 *         REP-02 and CORR-03 records there are partial — 1-2 turns —
 *         and their complete records live in R2R)
 *   R2R = intent-scenarios-i1/r2-remainder/results-i1.json
 *   R3  = intent-scenarios-i1/r3/results-i1.json
 *
 * Acceptance, pinned by this file:
 * - every must-detect case in section 7.1 fires (REP-02 C-1 in the
 *   R2-remainder and R3 records, FP-02 C-2 in all rounds, REP-01 R3
 *   C-2 on the turns that apply 15%);
 * - zero false positives on the section 7.1 must-not-fire set
 *   (FP-04 hypothetical fence, UNC-02 concept binding, CORR-01/02,
 *   R3 FP-01, R3 DIST-04);
 * - and, stronger than the letter of the gate: the set of ALL fires
 *   across every recorded turn of every scenario equals the expected
 *   set exactly — each entry a genuine measured failure instance —
 *   so a future pattern change that starts firing anywhere else in
 *   the corpus fails this test.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkOriginPremiseGuard,
  extractOriginPremiseLedger,
  type OriginPremiseGuardCheckKind,
} from "./originIntentPremiseGuard.js";
import type { OriginChatMessage } from "./originProviderClient.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, "originIntentPremiseGuard.replay-fixtures.json"), "utf8"),
) as {
  rounds: Record<
    string,
    { id: string; turns: { n: number; user: string; answer: string | null }[] }[]
  >;
};

/** Fixed clock inside the registry entry's evidence window. */
const NOW_MS = Date.parse("2026-11-22T00:00:00.000Z");

interface TurnOutcome {
  key: string;
  checks: OriginPremiseGuardCheckKind[];
}

function replayRound(round: string): {
  outcomes: TurnOutcome[];
  ledgers: Map<string, ReturnType<typeof extractOriginPremiseLedger>>;
} {
  const outcomes: TurnOutcome[] = [];
  const ledgers = new Map<string, ReturnType<typeof extractOriginPremiseLedger>>();
  for (const record of fixture.rounds[round]) {
    const messages: OriginChatMessage[] = [];
    for (const turn of record.turns) {
      messages.push({ role: "user", content: turn.user });
      if (turn.answer !== null && turn.answer !== "") {
        const result = checkOriginPremiseGuard({
          messages,
          answerText: turn.answer,
          nowMs: NOW_MS,
        });
        outcomes.push({
          key: `${round}/${record.id}/t${turn.n}`,
          checks: result.violations.map((violation) => violation.check),
        });
        messages.push({ role: "assistant", content: turn.answer });
      }
    }
    ledgers.set(record.id, extractOriginPremiseLedger(messages));
  }
  return { outcomes, ledgers };
}

const ALL_ROUNDS = ["R1", "R2", "R2R", "R3"] as const;
const replays = new Map(ALL_ROUNDS.map((round) => [round, replayRound(round)]));

function checksAt(key: string): OriginPremiseGuardCheckKind[] {
  for (const round of ALL_ROUNDS) {
    const outcome = replays
      .get(round)!
      .outcomes.find((candidate) => candidate.key === key);
    if (outcome) return outcome.checks;
  }
  throw new Error(`no recorded turn for ${key}`);
}

describe("premise guard replay — ledger extraction (design 7.1)", () => {
  it("extracts the REP-02 headcount correction in every complete round", () => {
    for (const round of ["R1", "R2R", "R3"] as const) {
      const ledger = replays.get(round)!.ledgers.get("REP-02")!;
      const entry = ledger.find(
        (candidate) => candidate.kind === "user-correction" && candidate.numeric,
      );
      expect(entry?.label).toBe("参加者");
      expect(entry?.numeric).toEqual({
        family: "headcount",
        oldAmount: 50,
        newAmount: 30,
      });
    }
  });

  it("extracts the CORR-02 money correction, normalised to yen", () => {
    for (const round of ["R1", "R2", "R3"] as const) {
      const ledger = replays.get(round)!.ledgers.get("CORR-02")!;
      const entry = ledger.find(
        (candidate) => candidate.kind === "user-correction" && candidate.numeric,
      );
      expect(entry?.label).toBe("月収");
      expect(entry?.numeric).toEqual({
        family: "money",
        oldAmount: 300_000,
        newAmount: 250_000,
      });
    }
  });

  it("extracts the CORR-01 categorical replacement （営業→エンジニア）", () => {
    for (const round of ["R1", "R2", "R3"] as const) {
      const ledger = replays.get(round)!.ledgers.get("CORR-01")!;
      const entry = ledger.find(
        (candidate) => candidate.kind === "user-correction" && !candidate.numeric,
      );
      expect(entry?.oldValue).toBe("営業");
      expect(entry?.newValue).toBe("エンジニア");
    }
  });

  it("extracts the CORR-03 weak comparative correction （温泉→街歩き）", () => {
    // R2's first-pass CORR-03 record stops before the correction turn;
    // the complete rounds are R1, R2R and R3.
    for (const round of ["R1", "R2R", "R3"] as const) {
      const ledger = replays.get(round)!.ledgers.get("CORR-03")!;
      const entry = ledger.find(
        (candidate) => candidate.kind === "user-correction" && !candidate.numeric,
      );
      expect(entry?.oldValue).toBe("温泉");
      expect(entry?.newValue).toBe("街歩き");
    }
  });

  it("extracts ORIGIN's own corrections (REP-01 R3 tax statement, FP-01 R3 nonexistence)", () => {
    const rep01 = replays.get("R3")!.ledgers.get("REP-01")!;
    const tax = rep01.find((candidate) => candidate.conceptId === "consumption-tax-rate");
    expect(tax?.kind).toBe("assistant-correction");
    expect(tax?.numeric).toEqual({ family: "percent", oldAmount: 15, newAmount: 10 });
    const fp01 = replays.get("R3")!.ledgers.get("FP-01")!;
    const nonexistence = fp01.find(
      (candidate) => candidate.kind === "assistant-correction",
    );
    expect(nonexistence?.label).toBe("全国一律リフォーム支援金");
    expect(nonexistence?.newValue).toBe("存在しない");
  });

  it("extracts the DIST-02 user attribute （フリーランス）", () => {
    for (const round of ["R1", "R2", "R3"] as const) {
      const ledger = replays.get(round)!.ledgers.get("DIST-02")!;
      const attribute = ledger.find((candidate) => candidate.kind === "user-attribute");
      expect(attribute?.newValue).toBe("フリーランス");
    }
  });
});

describe("premise guard replay — must-detect (design 7.1)", () => {
  it("C-1 fires on REP-02 turn 3 in the R2-remainder and R3 records (and R1)", () => {
    expect(checksAt("R2R/REP-02/t3")).toContain("old-value-reuse");
    expect(checksAt("R3/REP-02/t3")).toContain("old-value-reuse");
    expect(checksAt("R1/REP-02/t3")).toContain("old-value-reuse");
  });

  it("C-2 fires on FP-02 turn 1 in every round", () => {
    for (const round of ["R1", "R2", "R3"] as const) {
      expect(checksAt(`${round}/FP-02/t1`)).toContain("stable-fact-applied-value");
    }
  });

  it("C-2 fires on REP-01 R3 turns 1 and 3, where 15% is stated-corrected yet applied", () => {
    expect(checksAt("R3/REP-01/t1")).toContain("stable-fact-applied-value");
    expect(checksAt("R3/REP-01/t3")).toContain("stable-fact-applied-value");
  });

  it("C-4 fires on the fabricated official-citation shapes (REP-01 R2, FP-02 R3)", () => {
    for (const turn of ["t1", "t2", "t3"] as const) {
      expect(checksAt(`R2/REP-01/${turn}`)).toContain("fabricated-citation-form");
    }
    expect(checksAt("R3/FP-02/t1")).toContain("fabricated-citation-form");
  });
});

describe("premise guard replay — zero false positives (design 7.1)", () => {
  const mustNotFireScenarios: { round: string; id: string }[] = [
    { round: "R1", id: "FP-04" },
    { round: "R2", id: "FP-04" },
    { round: "R3", id: "FP-04" },
    { round: "R1", id: "UNC-02" },
    { round: "R2", id: "UNC-02" },
    { round: "R3", id: "UNC-02" },
    { round: "R1", id: "CORR-01" },
    { round: "R2", id: "CORR-01" },
    { round: "R3", id: "CORR-01" },
    { round: "R1", id: "CORR-02" },
    { round: "R2", id: "CORR-02" },
    { round: "R3", id: "CORR-02" },
    { round: "R3", id: "FP-01" },
    { round: "R3", id: "DIST-04" },
  ];

  it("no check fires on any turn of the must-not-fire set", () => {
    for (const { round, id } of mustNotFireScenarios) {
      const outcomes = replays
        .get(round as (typeof ALL_ROUNDS)[number])!
        .outcomes.filter((outcome) => outcome.key.startsWith(`${round}/${id}/`));
      expect(outcomes.length).toBeGreaterThan(0);
      for (const outcome of outcomes) {
        expect(outcome.checks, outcome.key).toEqual([]);
      }
    }
  });

  it("the complete fire set across the whole corpus is exactly the genuine failure instances", () => {
    const expected: Record<string, OriginPremiseGuardCheckKind[]> = {
      "R1/FP-02/t1": ["stable-fact-applied-value"],
      "R1/REP-01/t1": ["stable-fact-applied-value"],
      "R1/REP-02/t3": ["old-value-reuse"],
      "R2/FP-02/t1": ["stable-fact-applied-value"],
      "R2/REP-01/t1": ["fabricated-citation-form", "stable-fact-applied-value"],
      "R2/REP-01/t2": ["fabricated-citation-form", "stable-fact-applied-value"],
      "R2/REP-01/t3": ["fabricated-citation-form", "stable-fact-applied-value"],
      "R2R/REP-02/t3": ["old-value-reuse"],
      "R3/FP-02/t1": ["fabricated-citation-form", "stable-fact-applied-value"],
      "R3/REP-01/t1": ["stable-fact-applied-value"],
      "R3/REP-01/t2": ["stable-fact-applied-value"],
      "R3/REP-01/t3": ["stable-fact-applied-value"],
      "R3/REP-02/t3": ["old-value-reuse"],
    };
    const actual: Record<string, OriginPremiseGuardCheckKind[]> = {};
    for (const round of ALL_ROUNDS) {
      for (const outcome of replays.get(round)!.outcomes) {
        if (outcome.checks.length > 0) {
          actual[outcome.key] = [...outcome.checks].sort();
        }
      }
    }
    const expectedSorted = Object.fromEntries(
      Object.entries(expected).map(([key, checks]) => [key, [...checks].sort()]),
    );
    expect(actual).toEqual(expectedSorted);
  });
});
