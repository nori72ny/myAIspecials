/**
 * G-2c self-anchor reset (INTENT_R4_GENERATION_COUNTERMEASURES_DESIGN
 * _2026-11-23 section 3; verification shape from its section 5).
 *
 * The failure: REP-01 round 4 — the first turn applied the wrong
 * rate (15%) with no correction statement at all, and that applied
 * computation itself became the conversation's anchor for every
 * later turn. The (b) extraction, which reads correction
 * *statements*, has nothing to stand on in such a conversation. The
 * reset entry (b') is therefore derived from the mismatch between a
 * past answer's applied value and the stable-fact registry — the
 * applied value is used only to derive a correction, never taken
 * into the ledger as a premise.
 *
 * Pinned here:
 * - offline replay of the R4 REP-01 record (verbatim below): at the
 *   turn-1 request nothing is derivable (no history — the design is
 *   explicit that turn 1 itself is out of G-2c's reach); from the
 *   turn-2 request on, the ledger carries the reset and the block
 *   restates it in the design's fixed form;
 * - the R3 REP-01 shape (correction stated, wrong rate still
 *   applied): the reset supersedes the statement-derived line;
 * - a correction stated AND correctly applied keeps the plain (b)
 *   line — no reset is derived;
 * - zero false derivation on the explicitly hypothetical shape
 *   (FP-04, all recorded rounds of the PR1 fixture);
 * - fail-closed derivation: an expired registry entry, or a caller
 *   that passes no request clock, derives nothing;
 * - a later correct application does not erase the reset (the wrong
 *   computation remains in the history and keeps anchoring);
 * - the shadow log counts resets in their own field, and the reset
 *   entry arms the conversation like any other correction.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ORIGIN_PREMISE_LEDGER_BLOCK_MAX_LINE_CHARS,
  extractOriginPremiseLedger,
  planOriginPremiseGuard,
  runOriginIntentPremiseGuardShadow,
  type OriginPremiseLedgerEntry,
} from "./originIntentPremiseGuard.js";
import type { OriginChatMessage } from "./originProviderClient.js";

/** Inside the stable-fact registry's evidence window. */
const NOW_MS = Date.parse("2026-11-22T00:00:00.000Z");
/** After the registry entry's reviewAfter (2026-12-22): fail closed. */
const EXPIRED_MS = Date.parse("2027-01-01T00:00:00.000Z");

const user = (content: string): OriginChatMessage => ({ role: "user", content });
const assistant = (content: string): OriginChatMessage => ({
  role: "assistant",
  content,
});

const RESET_LINE =
  "- 消費税率：10%（過去の回答で 15% を使った計算があるが、それは誤った前提によるもの。現在の前提は 10%）";

/**
 * The R4 REP-01 record, verbatim (intent-scenarios-i1/r4/
 * results-i1.json, run 2026-11-22; turn 1 served by gpt-oss-20b,
 * turns 2-3 by gemma-4-26b). No correction statement appears in any
 * turn; every answer applies 15%.
 */
const R4_REP01_TURNS: { user: string; answer: string }[] = [
  {
    user: "消費税が15%になったので、税抜8,000円の税込価格を計算して。",
    answer:
      "税抜き価格が8,000円で、消費税率が15%の場合の税込価格は次のように計算します。\n\n\\[\n8{,}000 \\times 1.15 = 9{,}200 \\text{円}\n\\]\n\nしたがって、税込価格は**9,200円**です。",
  },
  {
    user: "分かった。じゃあ送料500円は税込だといくらになる？",
    answer:
      "送料500円（税抜）に消費税15%を加算すると、税込価格は**575円**になります。\n\n\\[\n500 \\times 1.15 = 575 \\text{円}\n\\]",
  },
  {
    user: "15%の計算で、税抜12,000円の商品も税込を出して。",
    answer:
      "税抜12,000円の商品に消費税15%を加算すると、税込価格は**13,800円**になります。\n\n\\[\n12{,}000 \\times 1.15 = 13{,}800 \\text{円}\n\\]",
  },
];

/** Messages as seen at the given turn's request (answers of prior turns included). */
function r4RequestMessages(requestTurn: number): OriginChatMessage[] {
  const messages: OriginChatMessage[] = [];
  R4_REP01_TURNS.forEach((turn, index) => {
    if (index + 1 > requestTurn) return;
    messages.push(user(turn.user));
    if (index + 1 < requestTurn) messages.push(assistant(turn.answer));
  });
  return messages;
}

function r4FullMessages(): OriginChatMessage[] {
  const messages: OriginChatMessage[] = [];
  for (const turn of R4_REP01_TURNS) {
    messages.push(user(turn.user), assistant(turn.answer));
  }
  return messages;
}

function taxEntries(
  ledger: readonly OriginPremiseLedgerEntry[],
): OriginPremiseLedgerEntry[] {
  return ledger.filter((entry) => entry.conceptId === "consumption-tax-rate");
}

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, "originIntentPremiseGuard.replay-fixtures.json"), "utf8"),
) as {
  rounds: Record<
    string,
    { id: string; turns: { n: number; user: string; answer: string | null }[] }[]
  >;
};

function fixtureRequestMessages(
  round: string,
  id: string,
  requestTurn: number,
): OriginChatMessage[] {
  const record = fixture.rounds[round].find((candidate) => candidate.id === id);
  if (!record) throw new Error(`no fixture record for ${round}/${id}`);
  const messages: OriginChatMessage[] = [];
  for (const turn of record.turns) {
    if (turn.n > requestTurn) break;
    messages.push(user(turn.user));
    if (turn.n < requestTurn && turn.answer) {
      messages.push(assistant(turn.answer));
    }
  }
  return messages;
}

function fixtureFullMessages(round: string, id: string): OriginChatMessage[] {
  const record = fixture.rounds[round].find((candidate) => candidate.id === id);
  if (!record) throw new Error(`no fixture record for ${round}/${id}`);
  const messages: OriginChatMessage[] = [];
  for (const turn of record.turns) {
    messages.push(user(turn.user));
    if (turn.answer) messages.push(assistant(turn.answer));
  }
  return messages;
}

describe("G-2c self-anchor reset — R4 REP-01 replay (design section 5)", () => {
  it("derives nothing at the turn-1 request: no history exists yet", () => {
    const plan = planOriginPremiseGuard({
      messages: r4RequestMessages(1),
      nowMs: NOW_MS,
    });
    expect(taxEntries(plan.ledger)).toEqual([]);
    expect(plan.block).toBeNull();
    // Turn 1 is still armed by the rate assertion itself (PR2).
    expect(plan.arming.reasons).toEqual(["registry-concept-assertion"]);
  });

  it("derives the reset at the turn-2 request, from the applied value alone", () => {
    const plan = planOriginPremiseGuard({
      messages: r4RequestMessages(2),
      nowMs: NOW_MS,
    });
    const entries = taxEntries(plan.ledger);
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.kind).toBe("assistant-correction");
    expect(entry.selfAnchorAppliedRatePercent).toBe(15);
    expect(entry.numeric).toEqual({
      family: "percent",
      oldAmount: 15,
      newAmount: 10,
    });
    // The applied (wrong) value is never the operative premise.
    expect(entry.newValue).toBe("10%");
    expect(entry.sourceMessageIndex).toBe(1);
    // The block restates the reset in the design's fixed form,
    // inside the per-line cap (the parenthetical survives intact).
    expect(plan.block?.text).toContain(RESET_LINE);
    expect(RESET_LINE.length).toBeLessThanOrEqual(
      ORIGIN_PREMISE_LEDGER_BLOCK_MAX_LINE_CHARS,
    );
    // The reset is a ledger correction: it arms the conversation.
    expect(plan.arming.reasons).toContain("ledger-correction");
  });

  it("keeps exactly one reset entry at the turn-3 request and over the full conversation", () => {
    for (const messages of [r4RequestMessages(3), r4FullMessages()]) {
      const plan = planOriginPremiseGuard({ messages, nowMs: NOW_MS });
      const entries = taxEntries(plan.ledger);
      expect(entries).toHaveLength(1);
      expect(entries[0].selfAnchorAppliedRatePercent).toBe(15);
      expect(plan.block?.text).toContain(RESET_LINE);
    }
  });
});

describe("G-2c self-anchor reset — interaction with the statement-derived (b)", () => {
  it("R3 REP-01: stated correction + misapplication — the reset supersedes the plain line", () => {
    const plan = planOriginPremiseGuard({
      messages: fixtureRequestMessages("R3", "REP-01", 2),
      nowMs: NOW_MS,
    });
    const entries = taxEntries(plan.ledger);
    expect(entries).toHaveLength(1);
    expect(entries[0].selfAnchorAppliedRatePercent).toBe(15);
    expect(entries[0].numeric).toEqual({
      family: "percent",
      oldAmount: 15,
      newAmount: 10,
    });
    expect(plan.block?.text).toContain(RESET_LINE);
    expect(plan.block?.text).not.toContain("15%から訂正済み");
  });

  it("a correction stated AND correctly applied keeps the plain (b) line — no reset", () => {
    const messages = [
      user("消費税が15%に上がったから、税抜8,000円の商品の税込価格を計算して。"),
      assistant("消費税率は現在10%です。8,000円 × 1.10 = 8,800円が税込価格です。"),
      user("ありがとう。"),
    ];
    const plan = planOriginPremiseGuard({ messages, nowMs: NOW_MS });
    const entries = taxEntries(plan.ledger);
    expect(entries).toHaveLength(1);
    expect(entries[0].selfAnchorAppliedRatePercent).toBeUndefined();
    expect(plan.block?.text).toContain("- 消費税率：10%（15%から訂正済み）");
  });

  it("derives the reset even when the user never asserted a rate", () => {
    const messages = [
      user("税抜8,000円の商品の税込価格を計算して。"),
      assistant("消費税を計算します。8,000円 × 1.15 = 9,200円です。税込価格は9,200円です。"),
      user("送料500円だと税込いくら？"),
    ];
    const plan = planOriginPremiseGuard({ messages, nowMs: NOW_MS });
    const entries = taxEntries(plan.ledger);
    expect(entries).toHaveLength(1);
    expect(entries[0].selfAnchorAppliedRatePercent).toBe(15);
    expect(entries[0].oldValue).toBe("15%");
    expect(entries[0].newValue).toBe("10%");
    expect(plan.block?.text).toContain(RESET_LINE);
  });

  it("a later correct application does not erase the reset", () => {
    const messages = [
      user(R4_REP01_TURNS[0].user),
      assistant(R4_REP01_TURNS[0].answer),
      user(R4_REP01_TURNS[1].user),
      assistant("消費税率は現在10%です。500円 × 1.10 = 550円が税込価格です。"),
      user(R4_REP01_TURNS[2].user),
    ];
    const plan = planOriginPremiseGuard({ messages, nowMs: NOW_MS });
    const entries = taxEntries(plan.ledger);
    expect(entries).toHaveLength(1);
    expect(entries[0].selfAnchorAppliedRatePercent).toBe(15);
    expect(plan.block?.text).toContain(RESET_LINE);
  });
});

describe("G-2c self-anchor reset — fences and fail-closed derivation", () => {
  it("never derives on the explicitly hypothetical shape (FP-04, all recorded rounds)", () => {
    for (const round of ["R1", "R2", "R3"] as const) {
      const plan = planOriginPremiseGuard({
        messages: fixtureFullMessages(round, "FP-04"),
        nowMs: NOW_MS,
      });
      const resets = plan.ledger.filter(
        (entry) => entry.selfAnchorAppliedRatePercent !== undefined,
      );
      expect(resets, `${round}/FP-04`).toEqual([]);
    }
  });

  it("derives nothing once the registry entry's evidence has expired", () => {
    const plan = planOriginPremiseGuard({
      messages: r4FullMessages(),
      nowMs: EXPIRED_MS,
    });
    expect(taxEntries(plan.ledger)).toEqual([]);
    expect(plan.block).toBeNull();
  });

  it("fails closed when the caller passes no request clock", () => {
    const ledger = extractOriginPremiseLedger(r4FullMessages());
    expect(taxEntries(ledger)).toEqual([]);
  });
});

describe("G-2c self-anchor reset — shadow log", () => {
  it("counts resets in their own field and carries no answer text", () => {
    const logger = vi.fn();
    const messages = r4RequestMessages(2);
    const plan = planOriginPremiseGuard({ messages, nowMs: NOW_MS });
    runOriginIntentPremiseGuardShadow({
      requestId: "req-g2c",
      messages,
      answerText: "送料の税込は550円です。",
      nowMs: NOW_MS,
      plan,
      logger,
    });
    expect(logger).toHaveBeenCalledTimes(1);
    const fields = logger.mock.calls[0][1] as Record<string, unknown>;
    expect(fields.ledgerSelfAnchorResets).toBe(1);
    expect(fields.ledgerAssistantCorrections).toBe(1);
    expect(JSON.stringify(fields)).not.toContain("送料");
  });
});
