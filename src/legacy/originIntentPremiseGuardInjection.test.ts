/**
 * Unit tests for the intent premise guard PR2 additions (design
 * INTENT_I5_DESIGN_2026-11-22 sections 3.2-3.3): the ledger block
 * builder, the deterministic arming decision, the per-request plan,
 * and the shadow runner's plan log fields.
 *
 * Pinned here:
 * - the block restates the operative (corrected) premise for every
 *   ledger entry kind, under its own caps (8 entries, 64 chars per
 *   line, 512 chars total) that are NOT the route-3 compact cap;
 * - an empty ledger yields no block (injection never fires on a
 *   conversation without a correction — the reverse-effect guard);
 * - arming fires on exactly the design's two conditions and on
 *   nothing else in these specimens; an attribute-only ledger does
 *   NOT arm (attributes inject, they do not buffer);
 * - the shadow runner logs the plan facts as counts/codes only and
 *   stays field-compatible with PR1 when no plan is passed.
 */

import { describe, expect, it } from "vitest";
import {
  buildOriginPremiseLedgerBlock,
  evaluateOriginPremiseGuardArming,
  extractOriginPremiseLedger,
  planOriginPremiseGuard,
  runOriginIntentPremiseGuardShadow,
  ORIGIN_PREMISE_LEDGER_BLOCK_HEADER,
  ORIGIN_PREMISE_LEDGER_BLOCK_MAX_CHARS,
  ORIGIN_PREMISE_LEDGER_BLOCK_MAX_ENTRIES,
  ORIGIN_PREMISE_LEDGER_BLOCK_MAX_LINE_CHARS,
  type OriginPremiseLedgerEntry,
} from "./originIntentPremiseGuard.js";
import type { OriginChatMessage } from "./originProviderClient.js";

/** Inside the stable-fact registry's evidence window. */
const NOW_MS = Date.parse("2026-11-22T00:00:00.000Z");
/** After the registry entry's reviewAfter (2026-12-22): fail closed. */
const EXPIRED_MS = Date.parse("2027-01-01T00:00:00.000Z");

const msg = (role: "user" | "assistant", content: string): OriginChatMessage => ({
  role,
  content,
});

const REP02_MESSAGES: OriginChatMessage[] = [
  msg("user", "イベントの企画を考えています。参加者は50人想定で、会場の広さを相談したい。"),
  msg("assistant", "50名規模の会場をご案内します。"),
  msg("user", "訂正します。参加者は30人でした。その前提で会場の広さを教えて。"),
  msg("assistant", "30名前提でご案内します。"),
  msg("user", "50人だと椅子は何脚いるかな。"),
];

const CORR03_MESSAGES: OriginChatMessage[] = [
  msg("user", "温泉旅行に行きたい。露天風呂のある旅館がいいな。"),
  msg("assistant", "温泉旅館をご案内します。"),
  msg("user", "うーん、温泉より街歩きの方がいいな。そっちで組み直して。"),
];

const CORR01_MESSAGES: OriginChatMessage[] = [
  msg("user", "私は営業として働いています。新規開拓のコツを教えて。"),
  msg("assistant", "営業向けにご案内します。"),
  msg("user", "訂正、営業じゃなくて、エンジニアとして働いています。"),
];

const REP01_MESSAGES: OriginChatMessage[] = [
  msg("user", "消費税が15%になったので、税抜8,000円の税込価格を計算して。"),
  msg("assistant", "消費税率は現在10%ですが、ご提示いただいた15%という条件に基づき計算いたします。税込価格は9,200円です。"),
  msg("user", "分かった。じゃあ送料500円は税込だといくらになる？"),
];

const FP01_MESSAGES: OriginChatMessage[] = [
  msg("user", "今年から始まった『全国一律リフォーム支援金』の申請方法を教えて。"),
  msg("assistant", "「全国一律リフォーム支援金」という名称の公的な制度は存在しません。"),
];

const DIST02_MESSAGES: OriginChatMessage[] = [
  msg("user", "私はフリーランスのデザイナーとして働いています。"),
  msg("assistant", "フリーランスのデザイナーとしてのご活動、応援いたします。"),
  msg("user", "集中力が続く作業環境の作り方って？"),
];

const FP02_MESSAGES: OriginChatMessage[] = [
  msg("user", "消費税が15%に上がったから、税抜8,000円の商品の税込価格を計算して。"),
];

const FP04_MESSAGES: OriginChatMessage[] = [
  msg("user", "仮の話として、もし消費税が15%だったら、税抜8,000円の税込はいくらになりますか。"),
];

const PLAIN_MESSAGES: OriginChatMessage[] = [
  msg("user", "短い案内文を作ってください。"),
];

function blockOf(messages: readonly OriginChatMessage[]) {
  return buildOriginPremiseLedgerBlock(extractOriginPremiseLedger(messages));
}

describe("premise ledger block (design 3.2)", () => {
  it("restates a numeric user correction with the superseded value marked", () => {
    const block = blockOf(REP02_MESSAGES);
    expect(block).not.toBeNull();
    expect(block!.text.split("\n")[0]).toBe(ORIGIN_PREMISE_LEDGER_BLOCK_HEADER);
    expect(block!.text).toContain("- 参加者：30人（50人から訂正済み）");
    expect(block!.entryCount).toBe(1);
    expect(block!.omittedCount).toBe(0);
  });

  it("restates a categorical replacement as 'new, not old'", () => {
    expect(blockOf(CORR03_MESSAGES)?.text).toContain("- 街歩き（温泉ではない）");
    expect(blockOf(CORR01_MESSAGES)?.text).toContain("- エンジニア（営業ではない）");
  });

  it("restates ORIGIN's own stable-fact correction and nonexistence correction", () => {
    expect(blockOf(REP01_MESSAGES)?.text).toContain("- 消費税率：10%（15%から訂正済み）");
    expect(blockOf(FP01_MESSAGES)?.text).toContain("- 全国一律リフォーム支援金：存在しない");
  });

  it("restates a user attribute", () => {
    expect(blockOf(DIST02_MESSAGES)?.text).toContain("- 職業：フリーランス");
  });

  it("is null for an empty ledger — no injection without a correction", () => {
    expect(blockOf(PLAIN_MESSAGES)).toBeNull();
    expect(blockOf(FP02_MESSAGES)).toBeNull();
    expect(buildOriginPremiseLedgerBlock([])).toBeNull();
  });

  it("pins the block caps as its own budget, separate from the compact contract", () => {
    expect(ORIGIN_PREMISE_LEDGER_BLOCK_MAX_ENTRIES).toBe(8);
    expect(ORIGIN_PREMISE_LEDGER_BLOCK_MAX_LINE_CHARS).toBe(64);
    expect(ORIGIN_PREMISE_LEDGER_BLOCK_MAX_CHARS).toBe(512);
    // Route-3 TPM recheck (design 7.4): the pre-send gate estimates
    // characters/2, so the worst-case block adds ~256 tokens to a
    // ~2,700-token payload against the 6,000-token input budget.
    expect(ORIGIN_PREMISE_LEDGER_BLOCK_MAX_CHARS / 2).toBe(256);
  });

  it("enforces the entry cap and counts the rest as omitted", () => {
    const entries: OriginPremiseLedgerEntry[] = Array.from({ length: 10 }, (_, i) => ({
      kind: "user-correction",
      label: `項目${i + 1}`,
      oldValue: "1個",
      newValue: "2個",
      numeric: { family: "unit:個", oldAmount: 1, newAmount: 2 },
      sourceMessageIndex: 0,
    }));
    const block = buildOriginPremiseLedgerBlock(entries);
    expect(block!.entryCount).toBe(8);
    expect(block!.omittedCount).toBe(2);
  });

  it("enforces the total cap before the entry cap when lines are long", () => {
    const entries: OriginPremiseLedgerEntry[] = Array.from({ length: 10 }, (_, i) => ({
      kind: "user-correction",
      label: `${"あ".repeat(47)}${i}`,
      oldValue: "1個",
      newValue: "2個",
      numeric: { family: "unit:個", oldAmount: 1, newAmount: 2 },
      sourceMessageIndex: 0,
    }));
    const block = buildOriginPremiseLedgerBlock(entries);
    expect(block).not.toBeNull();
    expect(block!.text.length).toBeLessThanOrEqual(ORIGIN_PREMISE_LEDGER_BLOCK_MAX_CHARS);
    expect(block!.entryCount).toBeLessThan(ORIGIN_PREMISE_LEDGER_BLOCK_MAX_ENTRIES);
    expect(block!.entryCount + block!.omittedCount).toBe(10);
    for (const line of block!.text.split("\n").slice(1)) {
      expect(line.length).toBeLessThanOrEqual(ORIGIN_PREMISE_LEDGER_BLOCK_MAX_LINE_CHARS);
    }
  });

  it("drops the parenthetical before shortening a label, and never truncates a value", () => {
    const entry: OriginPremiseLedgerEntry = {
      kind: "user-correction",
      label: "あ".repeat(70),
      oldValue: "999,999円",
      newValue: "888,888円",
      numeric: { family: "money", oldAmount: 999_999, newAmount: 888_888 },
      sourceMessageIndex: 0,
    };
    const block = buildOriginPremiseLedgerBlock([entry]);
    expect(block).not.toBeNull();
    const line = block!.text.split("\n")[1];
    expect(line.length).toBeLessThanOrEqual(ORIGIN_PREMISE_LEDGER_BLOCK_MAX_LINE_CHARS);
    expect(line).toContain("888,888円");
  });
});

describe("premise guard arming (design 3.3)", () => {
  it("arms a conversation carrying a user correction", () => {
    const arming = evaluateOriginPremiseGuardArming({ messages: REP02_MESSAGES, nowMs: NOW_MS });
    expect(arming.armed).toBe(true);
    expect(arming.reasons).toEqual(["ledger-correction"]);
  });

  it("arms a conversation carrying ORIGIN's own correction", () => {
    const arming = evaluateOriginPremiseGuardArming({ messages: REP01_MESSAGES, nowMs: NOW_MS });
    expect(arming.armed).toBe(true);
    expect(arming.reasons).toEqual(["ledger-correction"]);
  });

  it("arms a first turn asserting a registry-concept rate (FP-02 shape), where no block exists yet", () => {
    const arming = evaluateOriginPremiseGuardArming({ messages: FP02_MESSAGES, nowMs: NOW_MS });
    expect(arming.armed).toBe(true);
    expect(arming.reasons).toEqual(["registry-concept-assertion"]);
  });

  it("also arms an explicitly hypothetical rate turn — arming buffers, it does not accuse", () => {
    const arming = evaluateOriginPremiseGuardArming({ messages: FP04_MESSAGES, nowMs: NOW_MS });
    expect(arming.armed).toBe(true);
    expect(arming.reasons).toEqual(["registry-concept-assertion"]);
  });

  it("reports both reasons when a corrected conversation asserts the rate again", () => {
    const messages = [
      ...REP01_MESSAGES,
      msg("user", "やっぱり消費税15%で、税抜12,000円の税込を出して。"),
    ];
    const arming = evaluateOriginPremiseGuardArming({ messages, nowMs: NOW_MS });
    expect(arming.reasons).toEqual(["ledger-correction", "registry-concept-assertion"]);
  });

  it("does not arm an attribute-only conversation, and does not arm a plain request", () => {
    expect(evaluateOriginPremiseGuardArming({ messages: DIST02_MESSAGES, nowMs: NOW_MS }))
      .toEqual({ armed: false, reasons: [] });
    expect(evaluateOriginPremiseGuardArming({ messages: PLAIN_MESSAGES, nowMs: NOW_MS }))
      .toEqual({ armed: false, reasons: [] });
  });

  it("fails closed when the registry entry's evidence has expired", () => {
    const arming = evaluateOriginPremiseGuardArming({ messages: FP02_MESSAGES, nowMs: EXPIRED_MS });
    expect(arming.armed).toBe(false);
  });
});

describe("premise guard plan + shadow log fields (I5-PR2)", () => {
  it("combines ledger, block and arming in one plan", () => {
    const plan = planOriginPremiseGuard({ messages: REP02_MESSAGES, nowMs: NOW_MS });
    expect(plan.ledger).toHaveLength(1);
    expect(plan.block?.text).toContain("30人");
    expect(plan.arming).toEqual({ armed: true, reasons: ["ledger-correction"] });
    const plain = planOriginPremiseGuard({ messages: PLAIN_MESSAGES, nowMs: NOW_MS });
    expect(plain.block).toBeNull();
    expect(plain.arming.armed).toBe(false);
  });

  it("logs the plan facts (counts and fixed codes only) when a plan is passed", () => {
    const calls: { message: string; fields: Record<string, unknown> }[] = [];
    const plan = planOriginPremiseGuard({ messages: REP02_MESSAGES, nowMs: NOW_MS });
    runOriginIntentPremiseGuardShadow({
      requestId: "test-plan-log",
      messages: REP02_MESSAGES,
      answerText: "- 参加者 50 名 → 50 脚",
      nowMs: NOW_MS,
      plan,
      logger: (message, fields) => calls.push({ message, fields }),
    });
    expect(calls).toHaveLength(1);
    const fields = calls[0].fields;
    expect(fields.premiseGuardBlockInjected).toBe(true);
    expect(fields.premiseGuardBlockChars).toBe(plan.block!.text.length);
    expect(fields.premiseGuardBlockOmittedEntries).toBe(0);
    expect(fields.premiseGuardArmed).toBe(true);
    expect(fields.premiseGuardArmingReasons).toEqual(["ledger-correction"]);
    expect(JSON.stringify(fields)).not.toContain("参加者");
  });

  it("omits the plan fields when no plan is passed (PR1 log shape preserved)", () => {
    const calls: { message: string; fields: Record<string, unknown> }[] = [];
    runOriginIntentPremiseGuardShadow({
      requestId: "test-no-plan-log",
      messages: REP02_MESSAGES,
      answerText: "- 参加者 50 名 → 50 脚",
      nowMs: NOW_MS,
      logger: (message, fields) => calls.push({ message, fields }),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].fields).not.toHaveProperty("premiseGuardBlockInjected");
    expect(calls[0].fields).not.toHaveProperty("premiseGuardArmed");
  });
});
