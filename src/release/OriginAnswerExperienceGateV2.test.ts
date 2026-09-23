// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  evaluateOriginAnswerExperienceGateV2,
  type OriginAnswerExperienceBlindJudgmentV2,
  type OriginAnswerExperienceRenderObservationV2,
  type OriginAnswerExperienceSemanticObservationV2,
  type OriginAnswerExperienceSurfaceV2,
} from "./OriginAnswerExperienceGateV2.js";

const surfaces: OriginAnswerExperienceSurfaceV2[] = ["chat", "research", "coding", "artifact"];

function semantics(score = 4): OriginAnswerExperienceSemanticObservationV2[] {
  return Array.from({ length: 24 }, (_, index) => ({
    caseId: `semantic-${index + 1}`,
    family: `family-${Math.floor(index / 3) + 1}`,
    surface: surfaces[index % surfaces.length],
    locale: index % 3 === 0 ? "en" : "ja",
    mode: (["direct", "decision", "deliverable", "research"] as const)[index % 4],
    scores: {
      intentAlignment: score,
      directness: score,
      clarity: score,
      structure: score,
      informationDensity: score,
      taskFit: score,
      actionability: score,
    },
  }));
}

function renders(): OriginAnswerExperienceRenderObservationV2[] {
  return Array.from({ length: 12 }, (_, index) => ({
    caseId: `render-${index + 1}`,
    viewport: ([390, 768, 1440] as const)[index % 3],
    noHorizontalOverflow: true,
    textContrastAA: true,
    headingHierarchyValid: true,
    primaryAnswerReadable: true,
    touchTargets44px: index % 3 === 0 ? true : null,
    tableMobileFallback: true,
    codeReadable: true,
  }));
}

function blind(): OriginAnswerExperienceBlindJudgmentV2[] {
  return Array.from({ length: 40 }, (_, index) => ({
    caseId: `blind-${index + 1}`,
    surface: surfaces[index % surfaces.length],
    judgeId: index % 2 === 0 ? "judge-alpha" : "judge-beta",
    competitorId: index % 4 < 2 ? "competitor-one" : "competitor-two",
    candidateDigest: `sha256:${"a".repeat(64)}`,
    competitorDigest: `sha256:${index % 2 === 0 ? "b".repeat(64) : "c".repeat(64)}`,
    presentedCandidateAs: index % 2 === 0 ? "A" : "B",
    winner: index % 5 === 0 ? "tie" : "candidate",
  }));
}

describe("OriginAnswerExperienceGateV2", () => {
  it("requires absolute quality, render evidence and blind superiority evidence", () => {
    const report = evaluateOriginAnswerExperienceGateV2({
      semantics: semantics(),
      renders: renders(),
      blind: blind(),
    });
    expect(report.promotionEligible).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.blindWinRate).toBe(0.8);
    expect(report.blindNonLossRate).toBe(1);
  });

  it("fails closed without independent blind comparison evidence", () => {
    const report = evaluateOriginAnswerExperienceGateV2({
      semantics: semantics(),
      renders: renders(),
      blind: [],
    });
    expect(report.promotionEligible).toBe(false);
    expect(report.blockers).toContain("BLIND_EVIDENCE_INSUFFICIENT");
  });

  it("blocks one materially weak answer even when the mean stays high", () => {
    const rows = semantics();
    rows[0] = {
      ...rows[0],
      scores: { ...rows[0].scores, clarity: 1 },
    };
    const report = evaluateOriginAnswerExperienceGateV2({
      semantics: rows,
      renders: renders(),
      blind: blind(),
    });
    expect(report.blockers).toContain("SEMANTIC_CASE_HAS_MATERIAL_WEAKNESS");
  });

  it("blocks mobile readability regressions", () => {
    const rows = renders();
    rows[0] = { ...rows[0], noHorizontalOverflow: false };
    const report = evaluateOriginAnswerExperienceGateV2({
      semantics: semantics(),
      renders: rows,
      blind: blind(),
    });
    expect(report.blockers).toContain("RENDER_REGRESSION");
  });

  it("blocks label-order bias and weak per-surface preference", () => {
    const rows = blind().map((item, index) => ({
      ...item,
      presentedCandidateAs: "A" as const,
      winner: item.surface === "research" ? "competitor" as const : item.winner,
    }));
    const report = evaluateOriginAnswerExperienceGateV2({
      semantics: semantics(),
      renders: renders(),
      blind: rows,
    });
    expect(report.blockers).toContain("BLIND_ORDER_IMBALANCED");
    expect(report.blockers).toContain("BLIND_SURFACE_REGRESSION");
  });
});
