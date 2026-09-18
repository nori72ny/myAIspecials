export type OriginAnswerQualityIntegrationStage =
  | "claim-extraction"
  | "claim-coverage-review"
  | "evidence-ledger"
  | "source-verification"
  | "conflict-detection"
  | "verifier"
  | "independent-review"
  | "repair"
  | "reverification"
  | "presenter"
  | "trace"
  | "benchmark";

export interface OriginAnswerQualityIntegrationStageRecord {
  readonly stage: OriginAnswerQualityIntegrationStage;
  readonly requiredBeforeProduction: boolean;
  readonly productionEnabled: boolean;
  readonly validationState: "not-validated" | "validated-automated" | "validated-independent";
}

export interface OriginAnswerQualityIntegrationManifest {
  readonly schemaVersion: "origin.aq-integration.v1";
  readonly mainFrozenSha: string;
  readonly stages: readonly OriginAnswerQualityIntegrationStageRecord[];
}

const REQUIRED_ORDER: readonly OriginAnswerQualityIntegrationStage[] = Object.freeze([
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
]);

const SHA40 = /^[a-f0-9]{40}$/;

export function validateOriginAnswerQualityIntegrationManifest(
  manifest: OriginAnswerQualityIntegrationManifest,
): { ok: true } | { ok: false; code: string } {
  if (
    manifest.schemaVersion !== "origin.aq-integration.v1"
    || !SHA40.test(manifest.mainFrozenSha)
    || manifest.stages.length !== REQUIRED_ORDER.length
  ) {
    return { ok: false, code: "AQ_INTEGRATION_MANIFEST_INVALID" };
  }

  for (let index = 0; index < REQUIRED_ORDER.length; index += 1) {
    const record = manifest.stages[index];
    if (!record || record.stage !== REQUIRED_ORDER[index]) {
      return { ok: false, code: "AQ_INTEGRATION_ORDER_INVALID" };
    }

    if (
      record.productionEnabled
      && record.requiredBeforeProduction
      && record.validationState === "not-validated"
    ) {
      return { ok: false, code: "AQ_PRODUCTION_ENABLEMENT_UNVALIDATED" };
    }
  }

  return { ok: true };
}

export function canEnableOriginAnswerQualityProduction(
  manifest: OriginAnswerQualityIntegrationManifest,
): boolean {
  if (!validateOriginAnswerQualityIntegrationManifest(manifest).ok) return false;

  return manifest.stages
    .filter((stage) => stage.requiredBeforeProduction)
    .every((stage) =>
      stage.validationState !== "not-validated"
      && stage.productionEnabled === false
    );
}
