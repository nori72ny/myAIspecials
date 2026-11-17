import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { detectOriginPublicationClaims } from "./OriginPublicationGate";

// Fixture verification for the publication gate detector (stage 1,
// shadow mode), run against real measured answers from the round-4
// fixed-100 measurement (production bef1e6b4, 2026-11-17;
// ~/workspace/origin-fix/records-remeasurement-2026-11-17-r2/answers.json,
// copied into OriginPublicationGate.fixtures.json with ids and groups).
//
// The three fatal cases of that round must fire on the claim kinds that
// made them fatal — that firing is the input to the enforcement-stage
// decision (adoption 1 of EXTERNAL_CONSULT_STALE_ADOPTION_2026-11-17).
// The normal-direct group measures over-detection on answers that were
// safe to give directly (creation, calculation, concept explanation,
// advice); the real-law group checks that answers citing real statutes
// produce zero unverified names.

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

function summaryOf(id: string) {
  const entry = byId.get(id);
  if (!entry) throw new Error(`fixture ${id} missing`);
  return detectOriginPublicationClaims(entry.answer);
}

describe("publication gate fixture — round-4 fatal cases fire", () => {
  it("D-15 (stale Diet capacity asserted as current) fires statutory-capacity", () => {
    const summary = summaryOf("D-15");
    expect(summary.counts["statutory-capacity"]).toBeGreaterThanOrEqual(1);
    // The statute it cites （公職選挙法） is real: verified, not unverified.
    expect(summary.lawCheck.verifiedCount).toBeGreaterThanOrEqual(1);
    expect(summary.lawCheck.unverifiedCount).toBe(0);
  });

  it("C-01 (stale passport age condition) fires age-condition and amount-fee", () => {
    const summary = summaryOf("C-01");
    expect(summary.counts["age-condition"]).toBeGreaterThanOrEqual(1);
    expect(summary.counts["amount-fee"]).toBeGreaterThanOrEqual(1);
  });

  it("I-04 (fabricated statute with invented enforcement date) fires law-name, unverified, and law-enforcement", () => {
    const summary = summaryOf("I-04");
    expect(summary.counts["law-name"]).toBeGreaterThanOrEqual(1);
    expect(summary.counts["law-enforcement"]).toBeGreaterThanOrEqual(1);
    expect(summary.lawCheck.unverifiedCount).toBeGreaterThanOrEqual(1);
    expect(summary.lawCheck.verifiedCount).toBe(0);
  });
});

describe("publication gate fixture — over-detection on normal direct answers", () => {
  const normal = fixtures.filter((entry) => entry.group === "normal-direct");

  it("covers a representative normal set", () => {
    expect(normal.length).toBe(22);
  });

  it("produces no unverified statute names and no non-amount claim kinds", () => {
    for (const entry of normal) {
      const summary = detectOriginPublicationClaims(entry.answer);
      expect(summary.lawCheck.unverifiedCount, entry.id).toBe(0);
      expect(summary.lawCheck.candidateCount, entry.id).toBe(0);
      expect(summary.counts["law-enforcement"], entry.id).toBe(0);
      expect(summary.counts["statutory-capacity"], entry.id).toBe(0);
      expect(summary.counts["age-condition"], entry.id).toBe(0);
      expect(summary.counts["position-status"], entry.id).toBe(0);
    }
  });

  it("fires only amount-fee, and only on calculation answers whose results are yen amounts", () => {
    // Measured 2026-11-17: 7 of the 22 normal answers fire, every one a
    // calculation answer (H group) and every hit an amount-fee — the
    // arithmetic results themselves. That is the known over-detection
    // class for the enforcement stage to carve out (amounts that are
    // uniquely determined by recomputation, cf. N-3); creation, concept,
    // translation-style, and advice answers fire nothing at all.
    const fired = normal
      .filter((entry) => detectOriginPublicationClaims(entry.answer).totalCount > 0)
      .map((entry) => entry.id)
      .sort();
    expect(fired).toEqual(["H-01", "H-02", "H-03", "H-05", "H-06", "H-08", "H-10"]);
    for (const entry of normal) {
      const summary = detectOriginPublicationClaims(entry.answer);
      if (summary.totalCount > 0) {
        expect(summary.counts["amount-fee"], entry.id).toBe(summary.totalCount);
      }
    }
  });
});

describe("publication gate fixture — answers citing real statutes", () => {
  it("verifies every statute candidate (zero unverified across the group)", () => {
    const group = fixtures.filter((entry) => entry.group === "real-law");
    let candidates = 0;
    let verified = 0;
    let unverified = 0;
    for (const entry of group) {
      const summary = detectOriginPublicationClaims(entry.answer);
      candidates += summary.lawCheck.candidateCount;
      verified += summary.lawCheck.verifiedCount;
      unverified += summary.lawCheck.unverifiedCount;
    }
    // Measured 2026-11-17: 23 candidates （労働基準法・民法・司法書士法・
    // 弁護士法 plus 旧民法／改正民法／旧商法 variants and the 基準法 short
    // form), all verified. A-03 and B-04 cite no statute name at all.
    expect(candidates).toBe(23);
    expect(verified).toBe(23);
    expect(unverified).toBe(0);
  });
});
