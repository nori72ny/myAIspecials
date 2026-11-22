/**
 * Offline replay for the I5-PR2 additions (design INTENT_I5_DESIGN
 * sections 3.2-3.3, acceptance view of section 7.1): over the same
 * R1-R3 fixture as the PR1 harness, compute the per-request plan at
 * every recorded turn — the ledger block that WOULD have been
 * injected and the arming decision that WOULD have been taken — and
 * pin which PR2 mechanism applies to each measured failure.
 *
 * Honest scope: replay involves no generation, so it cannot show
 * that injection would have changed the answers. What it pins is
 * the deterministic precondition: on the turns that failed, the
 * operative premise was in fact restated in the block (REP-02,
 * CORR-03, REP-01 turns 2-3), or — where no correction existed yet
 * (FP-02, REP-01 turn 1) — that injection had nothing to restate
 * and the applicable mechanisms are the arming decision plus the
 * PR1 exit checks. The injection effect itself is measured in the
 * R4 production run, not here.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  planOriginPremiseGuard,
  type OriginPremiseGuardPlan,
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

interface ScenarioReplay {
  /** Plan at each turn's request time (current user turn included). */
  turnPlans: Map<number, OriginPremiseGuardPlan>;
  /** Plan over the full recorded conversation, answers included. */
  finalPlan: OriginPremiseGuardPlan;
}

function replayScenario(round: string, id: string): ScenarioReplay {
  const record = fixture.rounds[round].find((candidate) => candidate.id === id);
  if (!record) throw new Error(`no fixture record for ${round}/${id}`);
  const messages: OriginChatMessage[] = [];
  const turnPlans = new Map<number, OriginPremiseGuardPlan>();
  for (const turn of record.turns) {
    messages.push({ role: "user", content: turn.user });
    turnPlans.set(turn.n, planOriginPremiseGuard({ messages, nowMs: NOW_MS }));
    if (turn.answer !== null && turn.answer !== "") {
      messages.push({ role: "assistant", content: turn.answer });
    }
  }
  return {
    turnPlans,
    finalPlan: planOriginPremiseGuard({ messages, nowMs: NOW_MS }),
  };
}

const lastTurn = (replay: ScenarioReplay): number =>
  Math.max(...replay.turnPlans.keys());

describe("premise guard replay — PR2 injection coverage (design 7.1 view)", () => {
  it("REP-02: the block restates 30人 (50人 superseded) from the correction turn on, including the failing turn 3", () => {
    for (const round of ["R1", "R2R", "R3"] as const) {
      const replay = replayScenario(round, "REP-02");
      for (const turn of [2, 3]) {
        const plan = replay.turnPlans.get(turn)!;
        expect(plan.block?.text, `${round}/REP-02/t${turn}`).toContain("30人");
        expect(plan.block?.text, `${round}/REP-02/t${turn}`).toContain("50人から訂正済み");
        expect(plan.arming.reasons).toContain("ledger-correction");
      }
    }
  });

  it("CORR-03: the block restates the weak correction （街歩き, not 温泉） on the final turn", () => {
    for (const round of ["R1", "R2R", "R3"] as const) {
      const replay = replayScenario(round, "CORR-03");
      const plan = replay.turnPlans.get(lastTurn(replay))!;
      expect(plan.block?.text, `${round}/CORR-03`).toContain("街歩き");
      expect(plan.block?.text, `${round}/CORR-03`).toContain("温泉ではない");
      expect(plan.arming.reasons).toContain("ledger-correction");
    }
  });

  it("CORR-01 / CORR-02: the block restates the operative values on the final turn", () => {
    for (const round of ["R1", "R2", "R3"] as const) {
      const corr01 = replayScenario(round, "CORR-01");
      const corr01Plan = corr01.turnPlans.get(lastTurn(corr01))!;
      expect(corr01Plan.block?.text, `${round}/CORR-01`).toContain("エンジニア");
      expect(corr01Plan.block?.text, `${round}/CORR-01`).toContain("営業ではない");
      const corr02 = replayScenario(round, "CORR-02");
      const corr02Plan = corr02.turnPlans.get(lastTurn(corr02))!;
      expect(corr02Plan.block?.text, `${round}/CORR-02`).toContain("25万円");
      expect(corr02Plan.block?.text, `${round}/CORR-02`).toContain("30万円から訂正済み");
    }
  });

  it("REP-01 R3: turn 1 has nothing to inject but is armed; from turn 2 the block restates the corrected 10%", () => {
    const replay = replayScenario("R3", "REP-01");
    const t1 = replay.turnPlans.get(1)!;
    expect(t1.block).toBeNull();
    expect(t1.arming.reasons).toEqual(["registry-concept-assertion"]);
    for (const turn of [2, 3]) {
      const plan = replay.turnPlans.get(turn)!;
      expect(plan.block?.text, `R3/REP-01/t${turn}`).toContain("消費税率：10%");
      expect(plan.block?.text, `R3/REP-01/t${turn}`).toContain("15%から訂正済み");
      expect(plan.arming.reasons).toContain("ledger-correction");
    }
  });

  it("FP-02: no block exists on the failing first turn in any round — arming plus the PR1 C-2 check are the mechanisms", () => {
    for (const round of ["R1", "R2", "R3"] as const) {
      const replay = replayScenario(round, "FP-02");
      const t1 = replay.turnPlans.get(1)!;
      expect(t1.block, `${round}/FP-02/t1`).toBeNull();
      expect(t1.arming.reasons).toEqual(["registry-concept-assertion"]);
    }
  });

  it("FP-01 R3: from the next turn on, the block restates the nonexistence correction", () => {
    const replay = replayScenario("R3", "FP-01");
    expect(replay.turnPlans.get(1)!.block).toBeNull();
    expect(replay.finalPlan.block?.text).toContain("全国一律リフォーム支援金：存在しない");
    expect(replay.finalPlan.arming.reasons).toContain("ledger-correction");
  });

  it("UNC-02: no block and no arming on any turn (nothing was corrected, no registry concept)", () => {
    for (const round of ["R1", "R2", "R3"] as const) {
      const replay = replayScenario(round, "UNC-02");
      for (const [turn, plan] of replay.turnPlans) {
        expect(plan.block, `${round}/UNC-02/t${turn}`).toBeNull();
        expect(plan.arming.armed, `${round}/UNC-02/t${turn}`).toBe(false);
      }
    }
  });

  it("DIST-02: the attribute is restated in the block but never arms the turn", () => {
    for (const round of ["R1", "R2", "R3"] as const) {
      const replay = replayScenario(round, "DIST-02");
      const final = replay.turnPlans.get(lastTurn(replay))!;
      expect(final.block?.text, `${round}/DIST-02`).toContain("フリーランス");
      for (const [turn, plan] of replay.turnPlans) {
        expect(plan.arming.armed, `${round}/DIST-02/t${turn}`).toBe(false);
      }
    }
  });
});
