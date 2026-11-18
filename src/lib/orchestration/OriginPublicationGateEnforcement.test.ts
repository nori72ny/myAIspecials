import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyOriginPublicationGate,
  detectOriginPublicationClaims,
  publicationGateFiringKinds,
  resolveOriginPublicationGateMode,
} from "./OriginPublicationGate";

// Enforcement-stage tests for the publication gate (N-5b,
// N2_N5_IMPLEMENTATION_DESIGN_2026-11-17 §2.7 use A): with
// ORIGIN_PUBLICATION_GATE_MODE=enforce, a direct answer carrying an
// evidence-required claim lands on the N-1 ladder's tier-T4 hold
// instead of being published; amount-fee alone never holds an answer
// (the N-3 carve-out). Fixtures are the round-4 fixed-100 measured
// answers (production bef1e6b4, 2026-11-17), shared with the shadow
// fixture test: the three fatal cases must be held, and every normal
// direct answer — including the seven calculation answers whose only
// hits are amount-fee — must pass through byte-identical.

interface FixtureEntry {
  id: string;
  group: "fatal-target" | "normal-direct" | "real-law";
  question: string;
  answer: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  readFileSync(join(here, "OriginPublicationGate.fixtures.json"), "utf8"),
) as FixtureEntry[];
const byId = new Map(fixtures.map((entry) => [entry.id, entry]));

const ENFORCE_ENV = { ORIGIN_PUBLICATION_GATE_MODE: "enforce" } as NodeJS.ProcessEnv;

function applyEnforce(entry: FixtureEntry) {
  return applyOriginPublicationGate({
    requestId: `test-${entry.id}`,
    answerText: entry.answer,
    query: entry.question,
    language: "ja",
    env: ENFORCE_ENV,
    logger: () => {},
  });
}

describe("resolveOriginPublicationGateMode", () => {
  it("defaults to shadow unless the env value is exactly 'enforce'", () => {
    expect(resolveOriginPublicationGateMode(undefined)).toBe("shadow");
    expect(resolveOriginPublicationGateMode({})).toBe("shadow");
    expect(resolveOriginPublicationGateMode({ ORIGIN_PUBLICATION_GATE_MODE: "shadow" })).toBe("shadow");
    expect(resolveOriginPublicationGateMode({ ORIGIN_PUBLICATION_GATE_MODE: "ENFORCE" })).toBe("shadow");
    expect(resolveOriginPublicationGateMode({ ORIGIN_PUBLICATION_GATE_MODE: "true" })).toBe("shadow");
    expect(resolveOriginPublicationGateMode({ ORIGIN_PUBLICATION_GATE_MODE: "enforce" })).toBe("enforce");
  });
});

describe("publicationGateFiringKinds", () => {
  it("fires per evidence-required kind, and never on amount-fee alone", () => {
    const cases: [string, string[]][] = [
      ["参議院の定数は245名です。", ["statutory-capacity"]],
      ["参議院の議員は242人です。", ["statutory-capacity"]],
      ["この制度は満65歳から利用できます。", ["age-condition"]],
      ["この制度は2024年4月1日に施行されました。", ["law-enforcement"]],
      ["現在の首相は石破茂です。", ["position-status"]],
      ["デジタル資産保護法という法律があります。", ["law-name"]],
      // Q-12 (PR-G2): the full official name is on the list, so the
      // extended match verifies it and law-name no longer fires.
      ["空家等対策の推進に関する特別措置法は、空家等に関する対策を推進するための法律です。", []],
      // The fabricated embedding of the same tail still fires.
      ["新空家等対策の推進に関する特別措置法という法律があります。", ["law-name"]],
      ["合計は42,240円です。", []],
      ["手数料は16,000円で、手続きは労働基準法に基づきます。", []],
    ];
    for (const [text, expected] of cases) {
      expect(publicationGateFiringKinds(detectOriginPublicationClaims(text)), text).toEqual(expected);
    }
  });
});

describe("applyOriginPublicationGate — enforce mode holds the round-4 fatal cases", () => {
  it("D-15 (stale Diet capacity) is held on the tier-T4 landing", () => {
    const entry = byId.get("D-15")!;
    const outcome = applyEnforce(entry);
    expect(outcome.mode).toBe("enforce");
    expect(outcome.held).toBe(true);
    expect(outcome.firingKinds).toContain("statutory-capacity");
    expect(outcome.landing).toEqual({
      tier: "T4",
      outcome: "ABSTAIN",
      abstainReason: "high-risk-insufficient-sources",
    });
    // The stale figure is not published, and the hold text carries no
    // internal vocabulary (no tier label, no reason code).
    expect(outcome.answerText).not.toContain("245名");
    expect(outcome.answerText).toContain("出典による裏付けが取れなかったため、推測で回答しません");
    expect(outcome.answerText).toContain("確認できた情報はありませんでした");
    expect(outcome.answerText).not.toContain("T4");
    expect(outcome.answerText).not.toContain("high-risk-insufficient-sources");
    // The direct path performed no search, so the hold must not claim one.
    expect(outcome.answerText).not.toContain("調べましたが");
  });

  it("C-01 (stale passport age condition) is held via age-condition", () => {
    const entry = byId.get("C-01")!;
    const outcome = applyEnforce(entry);
    expect(outcome.held).toBe(true);
    expect(outcome.firingKinds).toContain("age-condition");
    expect(outcome.answerText).not.toContain("満20歳");
  });

  it("I-04 (fabricated statute) is held via law-name and law-enforcement", () => {
    const entry = byId.get("I-04")!;
    const outcome = applyEnforce(entry);
    expect(outcome.held).toBe(true);
    expect(outcome.firingKinds).toContain("law-name");
    expect(outcome.firingKinds).toContain("law-enforcement");
    // The fabricated body (registration system, security duties…) is
    // not published. The hold echoes the question topic but never
    // asserts the statute does not exist: unverified is not a
    // nonexistence verdict.
    expect(outcome.answerText).not.toContain("登録制度");
    expect(outcome.answerText).not.toContain("存在しない");
    expect(outcome.answerText).not.toContain("存在しません");
  });
});

describe("applyOriginPublicationGate — enforce mode leaves safe answers byte-identical", () => {
  it("passes every normal direct answer unchanged, including amount-only calculation answers", () => {
    const normal = fixtures.filter((entry) => entry.group === "normal-direct");
    expect(normal.length).toBe(22);
    for (const entry of normal) {
      const outcome = applyEnforce(entry);
      expect(outcome.held, entry.id).toBe(false);
      expect(outcome.answerText, entry.id).toBe(entry.answer);
      expect(outcome.firingKinds, entry.id).toEqual([]);
      expect(outcome.landing, entry.id).toBeNull();
    }
  });

  it("passes answers citing only verified statutes unchanged", () => {
    const group = fixtures.filter((entry) => entry.group === "real-law");
    expect(group.length).toBeGreaterThan(0);
    for (const entry of group) {
      const outcome = applyEnforce(entry);
      expect(outcome.held, entry.id).toBe(false);
      expect(outcome.answerText, entry.id).toBe(entry.answer);
    }
  });
});

describe("applyOriginPublicationGate — shadow mode never alters the answer", () => {
  it("delivers even the fatal fixtures unchanged without the env switch", () => {
    for (const entry of fixtures.filter((fixture) => fixture.group === "fatal-target")) {
      const outcome = applyOriginPublicationGate({
        requestId: `test-shadow-${entry.id}`,
        answerText: entry.answer,
        query: entry.question,
        language: "ja",
        env: {},
        logger: () => {},
      });
      expect(outcome.mode).toBe("shadow");
      expect(outcome.held).toBe(false);
      expect(outcome.answerText).toBe(entry.answer);
      expect(outcome.summary).not.toBeNull();
    }
  });

  it("logs the enforce outcome with the landing fields, kinds and counts only", () => {
    const calls: [string, Record<string, unknown>][] = [];
    const entry = byId.get("D-15")!;
    applyOriginPublicationGate({
      requestId: "test-log",
      answerText: entry.answer,
      query: entry.question,
      language: "ja",
      env: ENFORCE_ENV,
      logger: (message, fields) => calls.push([message, fields]),
    });
    expect(calls).toHaveLength(1);
    const [message, fields] = calls[0];
    expect(message).toContain("publication gate (enforce)");
    expect(fields.publicationGateHeld).toBe(true);
    expect(fields.publicationGateFiringKinds).toEqual(["statutory-capacity"]);
    expect(fields.researchTier).toBe("T4");
    expect(fields.researchOutcome).toBe("ABSTAIN");
    expect(fields.researchAbstainReason).toBe("high-risk-insufficient-sources");
    // No answer text anywhere in the log fields.
    expect(JSON.stringify(fields)).not.toContain("245名");
  });

  it("isolates gate failures: a throwing logger delivers the original text", () => {
    const entry = byId.get("D-15")!;
    const outcome = applyOriginPublicationGate({
      requestId: "test-failure",
      answerText: entry.answer,
      query: entry.question,
      language: "ja",
      env: ENFORCE_ENV,
      logger: () => {
        throw new Error("logger unavailable");
      },
    });
    expect(outcome.held).toBe(false);
    expect(outcome.answerText).toBe(entry.answer);
  });

  it("produces the English hold text for an English request", () => {
    const entry = byId.get("D-15")!;
    const outcome = applyOriginPublicationGate({
      requestId: "test-en",
      answerText: entry.answer,
      query: "How many seats are in each house of the Diet?",
      language: "en",
      env: ENFORCE_ENV,
      logger: () => {},
    });
    expect(outcome.held).toBe(true);
    expect(outcome.answerText).toContain("I could not verify reliable backing");
    expect(outcome.answerText).not.toContain("I searched public sources");
  });
});
