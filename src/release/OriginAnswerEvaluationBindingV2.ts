export interface OriginAnswerEvaluationBindingV2 {
  readonly schemaVersion: "origin.answer-evaluation-binding.v2";
  readonly candidateSha: string;
  readonly corpusDigest: string;
  readonly evaluatorSha: string;
  readonly rubricDigest: string;
  readonly roundId: string;
}

export interface OriginAnswerEvaluationBindingSetV2 {
  readonly answerExperience: OriginAnswerEvaluationBindingV2 | null;
  readonly blindPreference: OriginAnswerEvaluationBindingV2 | null;
  readonly visual: OriginAnswerEvaluationBindingV2 | null;
  readonly trustedExecution: OriginAnswerEvaluationBindingV2 | null;
  readonly liveProvider: OriginAnswerEvaluationBindingV2 | null;
}

export interface OriginAnswerEvaluationBindingQualificationV2 {
  readonly schemaVersion: "origin.answer-evaluation-binding-qualification.v2";
  readonly passed: boolean;
  readonly blockers: readonly string[];
}

function validSha(value: string): boolean {
  return /^[a-f0-9]{40}$/.test(value);
}

function validDigest(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function validRoundId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$/.test(value);
}

function validBinding(value: OriginAnswerEvaluationBindingV2 | null): value is OriginAnswerEvaluationBindingV2 {
  return !!value
    && value.schemaVersion === "origin.answer-evaluation-binding.v2"
    && validSha(value.candidateSha)
    && validDigest(value.corpusDigest)
    && validSha(value.evaluatorSha)
    && validDigest(value.rubricDigest)
    && validRoundId(value.roundId);
}

export function qualifyOriginAnswerEvaluationBindingsV2(
  expected: {
    readonly candidateSha: string;
    readonly corpusDigest: string;
    readonly evaluatorSha: string;
    readonly rubricDigest: string;
    readonly roundId: string;
  },
  bindings: OriginAnswerEvaluationBindingSetV2,
): OriginAnswerEvaluationBindingQualificationV2 {
  const blockers: string[] = [];
  if (
    !validSha(expected.candidateSha)
    || !validDigest(expected.corpusDigest)
    || !validSha(expected.evaluatorSha)
    || !validDigest(expected.rubricDigest)
    || !validRoundId(expected.roundId)
  ) {
    throw new Error("AQ_V2_BINDING_EXPECTATION_INVALID");
  }

  for (const [name, binding] of Object.entries(bindings) as [
    keyof OriginAnswerEvaluationBindingSetV2,
    OriginAnswerEvaluationBindingV2 | null,
  ][]) {
    if (!validBinding(binding)) {
      blockers.push(`AQ_V2_BINDING_MISSING_OR_INVALID:${name}`);
      continue;
    }
    if (binding.candidateSha !== expected.candidateSha) blockers.push(`AQ_V2_BINDING_CANDIDATE_MISMATCH:${name}`);
    if (binding.corpusDigest !== expected.corpusDigest) blockers.push(`AQ_V2_BINDING_CORPUS_MISMATCH:${name}`);
    if (binding.evaluatorSha !== expected.evaluatorSha) blockers.push(`AQ_V2_BINDING_EVALUATOR_MISMATCH:${name}`);
    if (binding.rubricDigest !== expected.rubricDigest) blockers.push(`AQ_V2_BINDING_RUBRIC_MISMATCH:${name}`);
    if (binding.roundId !== expected.roundId) blockers.push(`AQ_V2_BINDING_ROUND_MISMATCH:${name}`);
  }

  return Object.freeze({
    schemaVersion: "origin.answer-evaluation-binding-qualification.v2",
    passed: blockers.length === 0,
    blockers: Object.freeze(blockers),
  });
}
