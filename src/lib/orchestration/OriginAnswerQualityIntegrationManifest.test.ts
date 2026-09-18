import { describe, expect, it } from "vitest";

import {
  canEnableOriginAnswerQualityProduction,
  validateOriginAnswerQualityIntegrationManifest,
  type OriginAnswerQualityIntegrationManifest,
} from "./OriginAnswerQualityIntegrationManifest";

const stages: OriginAnswerQualityIntegrationManifest["stages"] = [
  "claim-extraction",
  "claim-coverage-review",
  "evidence-ledger",
  "source-verification",
  "conflict-detection",
  "verifier",
  "independent-review",
  "repair",
  "reverification",
  "presenter",
  "trace",
  "benchmark",
].map((stage) => ({
  stage,
  requiredBeforeProduction: true,
  productionEnabled: false,
  validationState: "validated-automated",
})) as OriginAnswerQualityIntegrationManifest["stages"];

const manifest: OriginAnswerQualityIntegrationManifest = {
  schemaVersion: "origin.aq-integration.v1",
  mainFrozenSha: "f0c1bff22d3246d3eac3903b9def5d3aa7c1e498",
  stages,
};

describe("OriginAnswerQualityIntegrationManifest", () => {
  it("accepts the fixed integration order while production remains disabled", () => {
    expect(validateOriginAnswerQualityIntegrationManifest(manifest)).toEqual({ ok: true });
    expect(canEnableOriginAnswerQualityProduction(manifest)).toBe(true);
  });

  it("rejects stage reordering", () => {
    const reordered = {
      ...manifest,
      stages: [...manifest.stages].reverse(),
    };
    expect(validateOriginAnswerQualityIntegrationManifest(reordered))
      .toEqual({ ok: false, code: "AQ_INTEGRATION_ORDER_INVALID" });
  });

  it("rejects production enablement for an unvalidated required stage", () => {
    const invalid = {
      ...manifest,
      stages: manifest.stages.map((stage) =>
        stage.stage === "verifier"
          ? { ...stage, productionEnabled: true, validationState: "not-validated" as const }
          : stage
      ),
    };

    expect(validateOriginAnswerQualityIntegrationManifest(invalid))
      .toEqual({ ok: false, code: "AQ_PRODUCTION_ENABLEMENT_UNVALIDATED" });
  });

  it("returns false once any required stage is already production enabled", () => {
    const alreadyEnabled = {
      ...manifest,
      stages: manifest.stages.map((stage) =>
        stage.stage === "presenter"
          ? { ...stage, productionEnabled: true }
          : stage
      ),
    };

    expect(canEnableOriginAnswerQualityProduction(alreadyEnabled)).toBe(false);
  });
});
