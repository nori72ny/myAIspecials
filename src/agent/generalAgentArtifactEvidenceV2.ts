import { createHash } from 'node:crypto';

/** Evaluator-owned expectation. It must never be supplied to the candidate tool. */
export type GeneralAgentArtifactExpectationV2 = {
  sha256: string;
  byteLength: number;
};

/** Shared preflight/runtime validation; corpus JSON is untrusted. */
export function isGeneralAgentArtifactExpectationV2(value: unknown): value is GeneralAgentArtifactExpectationV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const expectation = value as Record<string, unknown>;
  return typeof expectation.sha256 === 'string' && /^[a-f0-9]{64}$/.test(expectation.sha256)
    && typeof expectation.byteLength === 'number' && Number.isSafeInteger(expectation.byteLength)
    && expectation.byteLength >= 0 && expectation.byteLength <= 480_000;
}

export function verifyGeneralAgentArtifactEvidenceV2(
  artifact: unknown,
  expectation: GeneralAgentArtifactExpectationV2 | undefined,
): { ok: boolean; code: string } {
  if (!expectation) return { ok: false, code: 'TASK_ARTIFACT_EXPECTATION_MISSING' };
  if (!isGeneralAgentArtifactExpectationV2(expectation)) {
    return { ok: false, code: 'TASK_ARTIFACT_EXPECTATION_INVALID' };
  }
  if (typeof artifact !== 'string' || artifact.length > 120_000) {
    return { ok: false, code: 'TASK_ARTIFACT_MISSING_OR_OVERSIZED' };
  }
  if (Buffer.byteLength(artifact, 'utf8') !== expectation.byteLength
    || createHash('sha256').update(artifact, 'utf8').digest('hex') !== expectation.sha256) {
    return { ok: false, code: 'TASK_ARTIFACT_CONTENT_MISMATCH' };
  }
  return { ok: true, code: 'TASK_ARTIFACT_EXACT_MATCH' };
}
