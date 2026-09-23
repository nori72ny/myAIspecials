export interface OriginAnswerVisualViewportEvidenceV2 {
  readonly viewport: 390 | 1440;
  readonly screenshotName: string;
  readonly horizontalOverflowDetected: boolean;
  readonly clippedCriticalContent: boolean;
  readonly responsiveTablePassed: boolean;
  readonly codeBlockReadable: boolean;
  readonly headingHierarchyPassed: boolean;
}

export interface OriginAnswerVisualEvidenceV2 {
  readonly schemaVersion: "origin.answer-visual-evidence.v2";
  readonly candidateSha: string;
  readonly evidenceId: string;
  readonly artifactDigest: string;
  readonly accessibilityAutomationPassed: boolean;
  readonly longAnswerNavigationPassed: boolean;
  readonly trustMetadataDoesNotDominate: boolean;
  readonly viewports: readonly OriginAnswerVisualViewportEvidenceV2[];
}

export interface OriginAnswerVisualQualificationV2 {
  readonly schemaVersion: "origin.answer-visual-qualification.v2";
  readonly passed: boolean;
  readonly blockers: readonly string[];
}

function validId(value: string): boolean {
  return /^[A-Za-z0-9._:/-]{8,180}$/.test(value);
}

function validScreenshotName(value: string): boolean {
  return /^[A-Za-z0-9._-]{4,180}\.png$/.test(value);
}

export function qualifyOriginAnswerVisualEvidenceV2(
  input: OriginAnswerVisualEvidenceV2 | null,
  candidateSha: string,
): OriginAnswerVisualQualificationV2 {
  const blockers: string[] = [];
  if (!input) {
    return Object.freeze({
      schemaVersion: "origin.answer-visual-qualification.v2",
      passed: false,
      blockers: Object.freeze(["AQ_V2_VISUAL_EVIDENCE_MISSING"]),
    });
  }

  if (!/^[a-f0-9]{40}$/.test(candidateSha) || input.candidateSha !== candidateSha) {
    blockers.push("AQ_V2_VISUAL_SHA_MISMATCH");
  }
  if (!validId(input.evidenceId) || !/^sha256:[a-f0-9]{64}$/.test(input.artifactDigest)) {
    blockers.push("AQ_V2_VISUAL_PROVENANCE_INVALID");
  }

  const byViewport = new Map(input.viewports.map(item => [item.viewport, item]));
  for (const required of [390, 1440] as const) {
    const row = byViewport.get(required);
    if (!row || !validScreenshotName(row.screenshotName)) {
      blockers.push(`AQ_V2_VISUAL_VIEWPORT_MISSING:${required}`);
      continue;
    }
    if (row.horizontalOverflowDetected) blockers.push(`AQ_V2_VISUAL_OVERFLOW:${required}`);
    if (row.clippedCriticalContent) blockers.push(`AQ_V2_VISUAL_CLIPPING:${required}`);
    if (!row.responsiveTablePassed) blockers.push(`AQ_V2_VISUAL_TABLE_FAILURE:${required}`);
    if (!row.codeBlockReadable) blockers.push(`AQ_V2_VISUAL_CODE_FAILURE:${required}`);
    if (!row.headingHierarchyPassed) blockers.push(`AQ_V2_VISUAL_HEADING_FAILURE:${required}`);
  }

  if (!input.accessibilityAutomationPassed) blockers.push("AQ_V2_VISUAL_A11Y_FAILED");
  if (!input.longAnswerNavigationPassed) blockers.push("AQ_V2_VISUAL_LONG_ANSWER_NAVIGATION_FAILED");
  if (!input.trustMetadataDoesNotDominate) blockers.push("AQ_V2_VISUAL_TRUST_METADATA_DOMINATES");

  return Object.freeze({
    schemaVersion: "origin.answer-visual-qualification.v2",
    passed: blockers.length === 0,
    blockers: Object.freeze(blockers),
  });
}
