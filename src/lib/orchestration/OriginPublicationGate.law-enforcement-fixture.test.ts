import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyOriginPublicationGate,
  detectOriginPublicationClaims,
  publicationGateLawEnforcementSuppressed,
  resolveOriginPublicationGateLawEnforcementMode,
  type OriginPublicationGateSummary,
} from "./OriginPublicationGate";

// Law-enforcement fixture set for the PR-G4 accompaniment condition
// (GATE_SLIP_COUNTERMEASURE_DESIGN_2026-11-19 §PR-G4). Before this
// PR, law-enforcement fired unconditionally: a direct answer naming a
// REAL statute with its long-past enforcement date was held on the
// date alone — the second half of the Q-12 over-defence (PR-G2 fixed
// the fragmented name; a draft of the form 「…は2015年5月26日に施行」
// still fired). The condition makes a hit suppressible only when its
// asserted date is strictly past, some statute name in the answer
// verified, and no unverified candidate exists anywhere in the
// answer. All expectations below are pinned at a fixed "today" of
// 2026-11-19 (Asia/Tokyo), the measurement date.
//
// Groups and what is pinned:
// - verified-past-correct (4): real statute, correct past date. Every
//   hit is suppressible — these are the Q-12-shape answers the
//   condition exists to stop holding once it enforces.
// - verified-past-wrong (3): real statute, WRONG past date (the Q-15
//   shape in a wording the patterns reach). Suppressible exactly like
//   the correct ones — the detector cannot judge a date's correctness.
//   This is the residual risk the design records for the coordinator
//   to accept or reject; it is pinned here, not hidden.
// - verified-past-boundary (5): the strict-past boundary at the pinned
//   today. Today itself, a year-only assertion for the current year,
//   and a year-month assertion for the current month are NOT past
//   (they can still point at a future day) and never suppressible;
//   yesterday and last month are past and suppressible.
// - future-or-scheduled (2): verified name, future date. Never
//   suppressible — scheduled enforcement keeps firing.
// - unverified-name (3): the I-04 shape. A fabricated statute name is
//   unverified, so the accompaniment fails and every hit keeps
//   firing — including the mixed answer that pairs a real statute's
//   past date with a fabricated name's date.
// - no-verified-name (3): a past enforcement date with no verified
//   name in play (no name at all, or a real statute written in its
//   full 〜に関する法律 form, from which the candidate pattern —
//   unchanged by this PR — extracts no candidate because the name
//   ends in 法律）. Never suppressible.
// - mixed-dates (1): one past and one future hit under a verified
//   name. Only the past hit is suppressible, so the kind as a whole
//   keeps firing.
// - no-date (3): enforcement claims the unchanged detection patterns
//   do not reach (no date at all, and the 全面施行 form, whose date is
//   separated from 施行 by 全面）. Zero law-enforcement hits; the
//   condition has nothing to act on. The fabricated entry still fires
//   law-name, which this PR does not touch.

type FixtureGroup =
  | "verified-past-correct"
  | "verified-past-wrong"
  | "verified-past-boundary"
  | "future-or-scheduled"
  | "unverified-name"
  | "no-verified-name"
  | "mixed-dates"
  | "no-date";

interface LawEnforcementFixtureEntry {
  id: string;
  group: FixtureGroup;
  question: string;
  answer: string;
  lawEnforcementCount: number;
  pastDateCount: number;
  suppressibleCount: number;
  verifiedCount: number;
  unverifiedCount: number;
}

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  readFileSync(join(here, "OriginPublicationGate.law-enforcement-fixtures.json"), "utf8"),
) as LawEnforcementFixtureEntry[];
const byGroup = (group: FixtureGroup) => fixtures.filter((entry) => entry.group === group);
const byId = new Map(fixtures.map((entry) => [entry.id, entry]));

/** 2026-11-19 00:00 Asia/Tokyo. */
const FIXED_NOW_MS = Date.UTC(2026, 10, 18, 15, 0, 0);

const summaryOf = (entry: LawEnforcementFixtureEntry): OriginPublicationGateSummary =>
  detectOriginPublicationClaims(entry.answer, { nowMs: FIXED_NOW_MS });

describe("publication gate law-enforcement fixture — set composition", () => {
  it("covers the design's case division", () => {
    expect(byGroup("verified-past-correct").length).toBe(4);
    expect(byGroup("verified-past-wrong").length).toBe(3);
    expect(byGroup("verified-past-boundary").length).toBe(5);
    expect(byGroup("future-or-scheduled").length).toBe(2);
    expect(byGroup("unverified-name").length).toBe(3);
    expect(byGroup("no-verified-name").length).toBe(3);
    expect(byGroup("mixed-dates").length).toBe(1);
    expect(byGroup("no-date").length).toBe(3);
    expect(fixtures.length).toBe(24);
  });
});

describe("publication gate law-enforcement fixture — measured classification", () => {
  it("matches the pinned counts for every entry", () => {
    for (const entry of fixtures) {
      const summary = summaryOf(entry);
      expect(summary.counts["law-enforcement"], `${entry.id} law-enforcement`).toBe(
        entry.lawEnforcementCount,
      );
      expect(summary.lawEnforcement.pastDateCount, `${entry.id} pastDate`).toBe(entry.pastDateCount);
      expect(summary.lawEnforcement.suppressibleCount, `${entry.id} suppressible`).toBe(
        entry.suppressibleCount,
      );
      expect(summary.lawCheck.verifiedCount, `${entry.id} verified`).toBe(entry.verifiedCount);
      expect(summary.lawCheck.unverifiedCount, `${entry.id} unverified`).toBe(entry.unverifiedCount);
    }
  });

  it("suppresses the kind exactly when every hit is suppressible", () => {
    for (const entry of fixtures) {
      const summary = summaryOf(entry);
      const expected =
        entry.lawEnforcementCount > 0 && entry.suppressibleCount === entry.lawEnforcementCount;
      expect(publicationGateLawEnforcementSuppressed(summary), entry.id).toBe(expected);
    }
  });

  it("makes every correct past-date assertion for a real statute suppressible (Q-12 shape)", () => {
    for (const entry of byGroup("verified-past-correct")) {
      expect(publicationGateLawEnforcementSuppressed(summaryOf(entry)), entry.id).toBe(true);
    }
  });

  it("pins the residual risk: wrong past dates for real statutes are suppressible too (Q-15 shape)", () => {
    for (const entry of byGroup("verified-past-wrong")) {
      expect(publicationGateLawEnforcementSuppressed(summaryOf(entry)), entry.id).toBe(true);
    }
  });

  it("never suppresses fabricated names, future dates, missing names, or mixed dates", () => {
    for (const group of [
      "unverified-name",
      "future-or-scheduled",
      "no-verified-name",
      "mixed-dates",
    ] as const) {
      for (const entry of byGroup(group)) {
        expect(publicationGateLawEnforcementSuppressed(summaryOf(entry)), entry.id).toBe(false);
      }
    }
  });
});

describe("resolveOriginPublicationGateLawEnforcementMode", () => {
  it("defaults to shadow unless the env value is exactly 'enforce' or 'off'", () => {
    expect(resolveOriginPublicationGateLawEnforcementMode(undefined)).toBe("shadow");
    expect(resolveOriginPublicationGateLawEnforcementMode({})).toBe("shadow");
    expect(
      resolveOriginPublicationGateLawEnforcementMode({
        ORIGIN_PUBLICATION_GATE_LAW_ENFORCEMENT_MODE: "shadow",
      }),
    ).toBe("shadow");
    expect(
      resolveOriginPublicationGateLawEnforcementMode({
        ORIGIN_PUBLICATION_GATE_LAW_ENFORCEMENT_MODE: "ENFORCE",
      }),
    ).toBe("shadow");
    expect(
      resolveOriginPublicationGateLawEnforcementMode({
        ORIGIN_PUBLICATION_GATE_LAW_ENFORCEMENT_MODE: "true",
      }),
    ).toBe("shadow");
    expect(
      resolveOriginPublicationGateLawEnforcementMode({
        ORIGIN_PUBLICATION_GATE_LAW_ENFORCEMENT_MODE: "enforce",
      }),
    ).toBe("enforce");
    expect(
      resolveOriginPublicationGateLawEnforcementMode({
        ORIGIN_PUBLICATION_GATE_LAW_ENFORCEMENT_MODE: "off",
      }),
    ).toBe("off");
  });
});

describe("applyOriginPublicationGate — law-enforcement drops only under its own sub-switch", () => {
  const q12 = byId.get("Q-12-form")!;
  const i04 = byId.get("I-04-real")!;
  const apply = (entry: LawEnforcementFixtureEntry, env: NodeJS.ProcessEnv) =>
    applyOriginPublicationGate({
      requestId: `test-${entry.id}`,
      answerText: entry.answer,
      query: entry.question,
      language: "ja",
      env,
      nowMs: FIXED_NOW_MS,
      logger: () => {},
    });

  it("still holds the Q-12 shape under the main enforce mode while the sub-switch stays at its shadow default", () => {
    const outcome = apply(q12, { ORIGIN_PUBLICATION_GATE_MODE: "enforce" } as NodeJS.ProcessEnv);
    expect(outcome.held).toBe(true);
    expect(outcome.firingKinds).toContain("law-enforcement");
    expect(outcome.answerText).not.toBe(q12.answer);
  });

  it("still holds the Q-12 shape when the sub-switch is off", () => {
    const outcome = apply(q12, {
      ORIGIN_PUBLICATION_GATE_MODE: "enforce",
      ORIGIN_PUBLICATION_GATE_LAW_ENFORCEMENT_MODE: "off",
    } as NodeJS.ProcessEnv);
    expect(outcome.held).toBe(true);
    expect(outcome.firingKinds).toContain("law-enforcement");
  });

  it("delivers the Q-12 shape byte-identical when both the gate and the sub-switch enforce", () => {
    const outcome = apply(q12, {
      ORIGIN_PUBLICATION_GATE_MODE: "enforce",
      ORIGIN_PUBLICATION_GATE_LAW_ENFORCEMENT_MODE: "enforce",
    } as NodeJS.ProcessEnv);
    expect(outcome.held).toBe(false);
    expect(outcome.firingKinds).not.toContain("law-enforcement");
    expect(outcome.answerText).toBe(q12.answer);
    expect(outcome.landing).toBeNull();
  });

  it("still holds the I-04 shape even when the sub-switch enforces (the name is unverified)", () => {
    const outcome = apply(i04, {
      ORIGIN_PUBLICATION_GATE_MODE: "enforce",
      ORIGIN_PUBLICATION_GATE_LAW_ENFORCEMENT_MODE: "enforce",
    } as NodeJS.ProcessEnv);
    expect(outcome.held).toBe(true);
    expect(outcome.firingKinds).toContain("law-name");
    expect(outcome.firingKinds).toContain("law-enforcement");
  });

  it("still holds a future enforcement date for a real statute when the sub-switch enforces", () => {
    const future = byId.get("future-revision")!;
    const outcome = apply(future, {
      ORIGIN_PUBLICATION_GATE_MODE: "enforce",
      ORIGIN_PUBLICATION_GATE_LAW_ENFORCEMENT_MODE: "enforce",
    } as NodeJS.ProcessEnv);
    expect(outcome.held).toBe(true);
    expect(outcome.firingKinds).toContain("law-enforcement");
  });

  it("never holds in the main shadow mode, even with the sub-switch enforcing", () => {
    const outcome = apply(q12, {
      ORIGIN_PUBLICATION_GATE_MODE: "shadow",
      ORIGIN_PUBLICATION_GATE_LAW_ENFORCEMENT_MODE: "enforce",
    } as NodeJS.ProcessEnv);
    expect(outcome.held).toBe(false);
    expect(outcome.answerText).toBe(q12.answer);
  });

  it("logs the sub-switch comparison (mode + would-be suppression) in shadow mode", () => {
    const logs: Record<string, unknown>[] = [];
    applyOriginPublicationGate({
      requestId: "test-log-fields",
      answerText: q12.answer,
      query: q12.question,
      language: "ja",
      env: { ORIGIN_PUBLICATION_GATE_MODE: "enforce" } as NodeJS.ProcessEnv,
      nowMs: FIXED_NOW_MS,
      logger: (_message, fields) => logs.push(fields),
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].publicationGateLawEnforcementMode).toBe("shadow");
    expect(logs[0].publicationGateLawEnforcementSuppressed).toBe(true);
    expect(logs[0].publicationGateLawEnforcementSuppressibleCount).toBe(1);
    expect(logs[0].publicationGateLawEnforcementPastDateCount).toBe(1);
  });

  it("omits the suppression field when the sub-switch is off", () => {
    const logs: Record<string, unknown>[] = [];
    applyOriginPublicationGate({
      requestId: "test-log-fields-off",
      answerText: q12.answer,
      query: q12.question,
      language: "ja",
      env: {
        ORIGIN_PUBLICATION_GATE_MODE: "enforce",
        ORIGIN_PUBLICATION_GATE_LAW_ENFORCEMENT_MODE: "off",
      } as NodeJS.ProcessEnv,
      nowMs: FIXED_NOW_MS,
      logger: (_message, fields) => logs.push(fields),
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].publicationGateLawEnforcementMode).toBe("off");
    expect(logs[0].publicationGateLawEnforcementSuppressed).toBeUndefined();
  });
});
